// API key middleware for the external /v1/* surface (Kairos + partners).
//
// Keys are loaded from env at startup. Format:
//   KAIROS_API_KEYS="kairos_prod_<hex>:prod,kairos_stg_<hex>:staging,kairos_dev_<hex>:dev"
//
// Each comma-separated entry is `<key>:<env_label>`. The env label is
// surfaced to handlers via req.kairosKeyEnv for per-env rate limiting /
// audit logging. Keys are compared in constant time.
//
// /v1/health is exempt (mounted before this middleware in the router).

import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';

type KeyEntry = { key: string; env: string };

declare global {
  // Augments Express's Request so downstream handlers can introspect
  // which environment key was used (audit, rate limit, response shape).
  // Express's type system is famously loose here — we keep the surface
  // narrow so a typo on req.kairosKeyEnv would still be caught.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      kairosKeyEnv?: string;
    }
  }
}

function loadKeys(): KeyEntry[] {
  const raw = process.env['KAIROS_API_KEYS'] || '';
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [key, env] = entry.split(':');
      return { key: (key || '').trim(), env: (env || 'unknown').trim() };
    })
    .filter((e) => e.key.length > 0);
}

const KEYS = loadKeys();

if (KEYS.length === 0) {
  // Loud warning at boot — running the /v1 surface without keys means
  // any third party can hit cost-bearing routes (ask, research) for free.
  // We allow boot to proceed so dev environments without the env var set
  // can still smoke-test the integration locally, but the /v1 middleware
  // will reject every request 401 below.
  console.warn(
    '[kairos] KAIROS_API_KEYS not set — /v1/* will reject every request 401. ' +
      'Set the env var to enable the external API surface.',
  );
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function kairosApiKey(req: Request, res: Response, next: NextFunction): void {
  const presented = req.header('x-api-key') || '';
  if (!presented) {
    res.status(401).json({ error: 'missing_api_key', message: 'Send X-Api-Key header.' });
    return;
  }
  const match = KEYS.find((k) => safeEqual(k.key, presented));
  if (!match) {
    res.status(401).json({ error: 'invalid_api_key', message: 'API key not recognised.' });
    return;
  }
  req.kairosKeyEnv = match.env;
  next();
}
