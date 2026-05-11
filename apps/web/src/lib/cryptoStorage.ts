// cryptoStorage — IndexedDB-backed AES-GCM secret store for BYOK keys.
//
// Architecture (v2 — May 2026):
//   - DB: 'pm-copilot' (version 2)
//   - secrets store: { name, iv (base64), ct (base64) }
//   - keys store: { name, key: CryptoKey } — holds the master key as a
//     non-extractable AES-GCM 256 key. Structured-clone preserves the
//     `extractable: false` flag, so XSS reading the key gets an opaque
//     handle: it can encrypt/decrypt while the session is live, but
//     cannot exfiltrate the raw bytes for offline use.
//   - One-shot migration from v1 (PBKDF2-from-localStorage-seed): on first
//     read/write after upgrade, decrypt v1 records under the legacy key,
//     re-encrypt under v2, drop the v1 seed from localStorage. Idempotent.

const DB_NAME = 'pm-copilot';
const STORE = 'secrets';
const KEY_STORE = 'keys';
const MASTER_KEY_NAME = 'master-v2';
// Legacy seed location — read-only, consumed during one-time migration then deleted.
const LEGACY_SEED_KEY = 'pm-copilot:install-seed';
const LEGACY_SALT_TEXT = 'pm-copilot-v1';
const LEGACY_PBKDF2_ITERS = 100_000;

type SecretRecord = { name: string; iv: string; ct: string };
type KeyRecord = { name: string; key: CryptoKey };

// ---------- base64 helpers (browser-safe) ----------

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i] as number);
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- master key (v2: non-extractable AES-GCM in IndexedDB) ----------

let cachedKey: CryptoKey | null = null;

async function getMasterKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('cryptoStorage: WebCrypto subtle API unavailable');
  }
  const existing = await readKey(MASTER_KEY_NAME);
  if (existing) {
    cachedKey = existing;
    return existing;
  }
  // Generate a fresh non-extractable AES-GCM 256 key. extractable=false means
  // crypto.subtle.exportKey will refuse, even in same-origin JS — XSS reading
  // the CryptoKey from IndexedDB cannot exfiltrate the raw bytes.
  const fresh = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  await writeKey(MASTER_KEY_NAME, fresh);
  cachedKey = fresh;
  return fresh;
}

// ---------- v1 → v2 migration (one-shot, idempotent) ----------

let migrationRan = false;

async function migrateV1IfNeeded(): Promise<void> {
  if (migrationRan || typeof window === 'undefined') return;
  migrationRan = true;
  const v1Seed = window.localStorage.getItem(LEGACY_SEED_KEY);
  if (!v1Seed) return;
  try {
    const seed = fromBase64(v1Seed);
    if (seed.length !== 32) {
      window.localStorage.removeItem(LEGACY_SEED_KEY);
      return;
    }
    const baseKey = await window.crypto.subtle.importKey(
      'raw',
      new Uint8Array(seed) as BufferSource,
      { name: 'PBKDF2' },
      false,
      ['deriveKey'],
    );
    const salt = new TextEncoder().encode(LEGACY_SALT_TEXT);
    const v1Key = await window.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations: LEGACY_PBKDF2_ITERS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );

    const v2Key = await getMasterKey();
    const records = await tx<SecretRecord[]>('readonly', (store) => store.getAll() as IDBRequest<SecretRecord[]>);
    for (const rec of records ?? []) {
      try {
        const iv = fromBase64(rec.iv);
        const ct = fromBase64(rec.ct);
        const plain = await window.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as BufferSource },
          v1Key,
          ct as BufferSource,
        );
        const newIv = window.crypto.getRandomValues(new Uint8Array(12));
        const newCt = await window.crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: newIv as BufferSource },
          v2Key,
          plain,
        );
        await tx<undefined>('readwrite', (store) =>
          store.put({ name: rec.name, iv: toBase64(newIv), ct: toBase64(newCt) }) as unknown as IDBRequest<undefined>,
        );
      } catch {
        // Skip un-decryptable rows. Worst case: the user re-pastes their
        // key. Never silently corrupt by re-encrypting bad plaintext.
      }
    }
    window.localStorage.removeItem(LEGACY_SEED_KEY);
  } catch {
    // Migration failure: leave v1 seed in place, allow retry on next call.
    migrationRan = false;
  }
}

// ---------- IndexedDB helpers ----------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('cryptoStorage: IndexedDB unavailable'));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        let result: T | undefined;
        let resultResolved = false;

        const maybe = fn(store);
        if (maybe instanceof Promise) {
          maybe.then((v) => {
            result = v;
            resultResolved = true;
          }).catch(reject);
        } else {
          maybe.onsuccess = () => {
            result = maybe.result;
            resultResolved = true;
          };
          maybe.onerror = () => reject(maybe.error ?? new Error('idb request failed'));
        }

        transaction.oncomplete = () => {
          if (resultResolved) {
            resolve(result as T);
          } else {
            // fn never set result — treat as void.
            resolve(undefined as unknown as T);
          }
          db.close();
        };
        transaction.onerror = () => reject(transaction.error ?? new Error('idb tx failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('idb tx aborted'));
      }),
  );
}

async function readKey(name: string): Promise<CryptoKey | null> {
  try {
    const db = await openDb();
    return await new Promise<CryptoKey | null>((resolve, reject) => {
      const transaction = db.transaction(KEY_STORE, 'readonly');
      const store = transaction.objectStore(KEY_STORE);
      const req = store.get(name) as IDBRequest<KeyRecord | undefined>;
      req.onsuccess = () => resolve(req.result?.key ?? null);
      req.onerror = () => reject(req.error ?? new Error('idb key request failed'));
      transaction.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

async function writeKey(name: string, key: CryptoKey): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(KEY_STORE, 'readwrite');
    const store = transaction.objectStore(KEY_STORE);
    const req = store.put({ name, key });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('idb key write failed'));
    transaction.oncomplete = () => db.close();
  });
}

// ---------- public API ----------

export async function setSecret(key: string, plaintext: string): Promise<void> {
  if (typeof window === 'undefined') return;
  await migrateV1IfNeeded();
  const masterKey = await getMasterKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(plaintext);
  const ct = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    masterKey,
    enc as BufferSource,
  );
  const record: SecretRecord = { name: key, iv: toBase64(iv), ct: toBase64(ct) };
  await tx<undefined>('readwrite', (store) => store.put(record) as unknown as IDBRequest<undefined>);
}

export async function getSecret(key: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  await migrateV1IfNeeded();
  let record: SecretRecord | undefined;
  try {
    record = await tx<SecretRecord | undefined>('readonly', (store) => store.get(key) as IDBRequest<SecretRecord | undefined>);
  } catch {
    return null;
  }
  if (!record || typeof record.iv !== 'string' || typeof record.ct !== 'string') return null;
  try {
    const masterKey = await getMasterKey();
    const iv = fromBase64(record.iv);
    const ct = fromBase64(record.ct);
    const plain = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      masterKey,
      ct as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function deleteSecret(key: string): Promise<void> {
  if (typeof window === 'undefined') return;
  await tx<undefined>('readwrite', (store) => store.delete(key) as unknown as IDBRequest<undefined>);
}

export async function listSecrets(): Promise<string[]> {
  if (typeof window === 'undefined') return [];
  await migrateV1IfNeeded();
  try {
    const keys = await tx<IDBValidKey[]>('readonly', (store) => store.getAllKeys() as IDBRequest<IDBValidKey[]>);
    return keys.map((k) => String(k));
  } catch {
    return [];
  }
}
