// GET /api/admin/analytics — founder-side stats dump.
//
// Auth: adminAuth middleware (X-Admin-Token header == ADMIN_TOKEN env var).
//
// Query params:
//   format=json     (default) — aggregate summary as JSON
//   format=raw      — full users + events dump as JSON (for offline analysis)
//   format=csv      — events flattened as CSV (spreadsheet-friendly)

import type { Request, Response } from 'express';
import { getStats, dumpAll } from '../analytics.js';

export async function adminAnalyticsHandler(req: Request, res: Response): Promise<void> {
  const format = String(req.query['format'] ?? 'json').toLowerCase();

  if (format === 'raw') {
    const data = await dumpAll();
    res.json(data);
    return;
  }

  if (format === 'csv') {
    const { events } = await dumpAll();
    const rows: string[] = ['ts,iso,wallet,handle,type,marketId,category'];
    for (const e of events) {
      rows.push([
        String(e.ts),
        new Date(e.ts).toISOString(),
        e.wallet ?? '',
        e.handle ?? '',
        e.type,
        e.marketId ?? '',
        e.category ?? '',
      ].map(csvField).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="pm-copilot-events.csv"');
    res.send(rows.join('\n'));
    return;
  }

  const stats = await getStats();
  res.json(stats);
}

function csvField(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
