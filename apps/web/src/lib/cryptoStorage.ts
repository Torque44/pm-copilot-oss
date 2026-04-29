// cryptoStorage — IndexedDB-backed AES-GCM secret store for BYOK keys.
//
// Architecture:
//   - DB: 'pm-copilot' / store: 'secrets' / keyPath: 'name'
//   - Master seed: 32 random bytes generated on first install, base64-encoded
//     into localStorage['pm-copilot:install-seed'].
//   - AES-GCM 256 key derived via PBKDF2 (100k iters, salt 'pm-copilot-v1').
//   - Each record stores { name, iv (base64), ct (base64) }. Decrypt failures
//     return null rather than throwing so a corrupted slot doesn't brick UI.

const DB_NAME = 'pm-copilot';
const STORE = 'secrets';
const SEED_KEY = 'pm-copilot:install-seed';
const SALT_TEXT = 'pm-copilot-v1';
const PBKDF2_ITERS = 100_000;

type SecretRecord = { name: string; iv: string; ct: string };

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

// ---------- master key derivation ----------

function getOrCreateSeed(): Uint8Array {
  if (typeof window === 'undefined') {
    // SSR: fall back to a deterministic-but-useless seed; cryptoStorage is
    // never actually called during SSR, but the import shouldn't crash.
    return new Uint8Array(32);
  }
  const existing = window.localStorage.getItem(SEED_KEY);
  if (existing) {
    try {
      const decoded = fromBase64(existing);
      if (decoded.length === 32) return decoded;
    } catch {
      // fall through and re-seed
    }
  }
  const fresh = new Uint8Array(32);
  window.crypto.getRandomValues(fresh);
  window.localStorage.setItem(SEED_KEY, toBase64(fresh));
  return fresh;
}

let cachedKey: CryptoKey | null = null;

async function getMasterKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('cryptoStorage: WebCrypto subtle API unavailable');
  }
  const seed = getOrCreateSeed();
  const seedBuf = new Uint8Array(seed); // copy to detach from any caller refs
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    seedBuf as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  const salt = new TextEncoder().encode(SALT_TEXT);
  const derived = await window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  cachedKey = derived;
  return derived;
}

// ---------- IndexedDB helpers ----------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('cryptoStorage: IndexedDB unavailable'));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'name' });
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

// ---------- public API ----------

export async function setSecret(key: string, plaintext: string): Promise<void> {
  if (typeof window === 'undefined') return;
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
  try {
    const keys = await tx<IDBValidKey[]>('readonly', (store) => store.getAllKeys() as IDBRequest<IDBValidKey[]>);
    return keys.map((k) => String(k));
  } catch {
    return [];
  }
}
