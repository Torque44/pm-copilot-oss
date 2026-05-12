// realizedValue.ts — extract the realized number from a resolved
// comparable's Gamma payload. Three priority tiers:
//   1. Gamma description / resolutionWording regex (real number)
//   2. Inference from outcome + shape threshold (no exact number, but
//      we know the realized was above/below the threshold)
//   3. Unknown (the comp gets reported with outcome only)
//
// No external API calls. No LLM. Pure function over already-fetched data.

import type { ComparableHit } from './comparables';
import type { MarketShape } from './marketShape';

export type RealizedValue = {
  /** The realized number when extractable. */
  value: number | null;
  /** How we got it. */
  source: 'gamma-note' | 'inferred-from-outcome' | 'unknown';
  /** Free-text display with unit ('213 tweets', '97°F', '≥ 200 tweets'). */
  display: string | null;
};

const PATTERNS_NUMBER: RegExp[] = [
  /\b(?:settled|closed|resolved|final)\s+(?:at|count[:\s]+|value[:\s]+)?\s*\$?([\d,]+(?:\.\d+)?)/i,
  /\bhigh\s+of\s+(\d+(?:\.\d+)?)\s*°?\s*F?/i,
  /\breceived\s+(\d+(?:\.\d+)?)\s+inches?/i,
  /\b(?:recorded|counted|reached|total[:\s]+|hit|fired|posted)\s+(\d[\d,]*(?:\.\d+)?)\s*(?:tweets|posts|mentions)\b/i,
];

function tryGammaNote(comp: ComparableHit, shape: MarketShape | null): RealizedValue | null {
  // ComparableHit carries description + resolutionWording as TOP-LEVEL
  // optional fields (added in Task 5). We also tolerate a nested
  // `payload.description` shape for back-compat with older test fixtures
  // and any future Citation-style wrapper that nests Gamma fields.
  const topDescription = (comp as { description?: unknown }).description;
  const topResolution = (comp as { resolutionWording?: unknown }).resolutionWording;
  const payload = (comp as { payload?: unknown }).payload;
  const nested = payload && typeof payload === 'object'
    ? payload as { description?: unknown; resolutionWording?: unknown }
    : null;

  const text = [
    typeof topDescription === 'string' ? topDescription : '',
    typeof topResolution === 'string' ? topResolution : '',
    nested && typeof nested.description === 'string' ? nested.description : '',
    nested && typeof nested.resolutionWording === 'string' ? nested.resolutionWording : '',
  ].filter(Boolean).join(' ');
  if (!text) return null;

  for (const rx of PATTERNS_NUMBER) {
    const m = rx.exec(text);
    if (!m) continue;
    const raw = m[1]!.replace(/,/g, '');
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const unit = shape?.unit ?? '';
    const display = unit === '°F' ? `${value}°F`
      : unit === '$' ? `$${value.toLocaleString('en-US')}`
      : unit ? `${value} ${unit}`
      : String(value);
    return { value, source: 'gamma-note', display };
  }
  return null;
}

function inferFromOutcome(comp: ComparableHit, shape: MarketShape | null): RealizedValue | null {
  if (!shape) return null;
  if (comp.outcome !== 'yes' && comp.outcome !== 'no') return null;
  const { comparator, threshold, unit } = shape;
  const unitDisplay = unit ?? '';
  // YES means the threshold was met under the original comparator; NO means
  // it wasn't. Translate to the actual realized inequality.
  const yesPair: Record<MarketShape['comparator'], string> = {
    '>=': `≥ ${threshold}`,
    '<=': `≤ ${threshold}`,
    '>':  `> ${threshold}`,
    '<':  `< ${threshold}`,
    'between': `≥ ${threshold}`, // simplification; between still met when YES
  };
  const noPair: Record<MarketShape['comparator'], string> = {
    '>=': `< ${threshold}`,
    '<=': `> ${threshold}`,
    '>':  `≤ ${threshold}`,
    '<':  `≥ ${threshold}`,
    'between': `outside ${threshold}`,
  };
  const lead = comp.outcome === 'yes' ? yesPair[comparator] : noPair[comparator];
  const display = unitDisplay ? `${lead} ${unitDisplay}` : lead;
  return { value: null, source: 'inferred-from-outcome', display };
}

export function extractRealizedValue(
  comp: ComparableHit,
  shape: MarketShape | null,
): RealizedValue {
  return (
    tryGammaNote(comp, shape) ??
    inferFromOutcome(comp, shape) ??
    { value: null, source: 'unknown', display: null }
  );
}
