// Smoke test — boots the server with PROVIDER=stub on a free port, hits
// /api/health, and exits non-zero on failure.
//
// Per HANDOFF.md §Task J. Used by CI and `pnpm smoke`.

import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PORT = process.env['SMOKE_PORT'] || '8788';
const BASE = `http://localhost:${PORT}`;
const TIMEOUT_MS = 15_000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_ENTRY = resolve(__dirname, '..', 'src', 'index.ts');

async function waitForHealth(): Promise<unknown> {
  const start = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return await res.json();
    } catch (err) {
      lastErr = err;
    }
    await sleep(250);
  }
  throw new Error(`health check did not respond within ${TIMEOUT_MS}ms (last: ${String(lastErr)})`);
}

async function main(): Promise<number> {
  console.log(`[smoke] booting server on :${PORT} with PROVIDER=stub`);
  const server: ChildProcess = spawn('tsx', [SERVER_ENTRY], {
    env: {
      ...process.env,
      PROVIDER: 'stub',
      PORT,
      // CORS doesn't matter for the smoke probe but keep it set so log lines match prod shape.
      CORS_ORIGIN: process.env['CORS_ORIGIN'] || 'http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  server.stdout?.on('data', (b: Buffer) => process.stdout.write(`[server] ${b.toString()}`));
  server.stderr?.on('data', (b: Buffer) => process.stderr.write(`[server] ${b.toString()}`));

  let exitCode = 1;
  try {
    const health = await waitForHealth();
    const ok = (health as { ok?: unknown }).ok === true;
    if (!ok) throw new Error(`health.ok was not true: ${JSON.stringify(health)}`);
    console.log('[smoke] /api/health OK', health);
    exitCode = 0;
  } catch (err) {
    console.error('[smoke] FAILED:', err instanceof Error ? err.message : err);
  } finally {
    server.kill();
    await sleep(150);
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[smoke] uncaught:', err);
    process.exit(1);
  });
