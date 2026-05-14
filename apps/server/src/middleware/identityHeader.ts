// identityHeader.ts — reads anonymous identity headers and attaches to req.
//
// The frontend (apps/web/src/lib/client.ts) injects two headers on every
// API request based on what's in useAuth's localStorage:
//   x-pm-wallet   → the 0x address the user pasted during onboarding
//   x-pm-handle   → their X/Twitter handle (no @, optional)
//
// We surface them on req.identity so routes can fire usage events without
// each one re-parsing headers. The middleware does NOT log, persist, or
// validate ownership — it's a fast attribution-only pass. Recording into
// analytics.ts happens in the routes that opt in.

import type { Request, Response, NextFunction } from 'express';

export type Identity = {
  wallet: string | null;
  handle: string | null;
};

declare module 'express' {
  interface Request {
    identity?: Identity;
  }
}

/** Loose 0x-prefixed hex sanity check. Doesn't verify on-chain — anyone can
 *  paste anything. We just want to refuse obviously-malformed inputs so the
 *  analytics file doesn't accumulate junk. */
function looksLikeWallet(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function cleanHandle(s: string): string {
  return s.replace(/^@/, '').trim().slice(0, 64);
}

export function identityHeader(req: Request, _res: Response, next: NextFunction): void {
  const raw = (k: string): string | null => {
    const v = req.headers[k.toLowerCase()];
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    return trimmed.length === 0 ? null : trimmed;
  };

  const walletRaw = raw('x-pm-wallet');
  const handleRaw = raw('x-pm-handle');

  req.identity = {
    wallet: walletRaw && looksLikeWallet(walletRaw) ? walletRaw.toLowerCase() : null,
    handle: handleRaw ? cleanHandle(handleRaw) || null : null,
  };

  next();
}
