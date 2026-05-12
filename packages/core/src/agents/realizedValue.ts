// realizedValue.ts — extract the realized number from a resolved
// comparable's Gamma payload. Three priority tiers:
//   1. Shape-aware regex over the description/resolutionWording. Each
//      metric ('tweets' / 'temperature' / 'price' / 'snow'/'rain') has
//      its own well-anchored pattern; non-matching shapes return null
//      from this tier rather than risk a false positive.
//   2. Inference from outcome + shape threshold (no exact number, but
//      we know the realized was above/below the threshold).
//   3. Unknown (the comp gets reported with outcome only).
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

/** Metric-specific regex patterns. Each is anchored by the metric's
 *  unit/noun so a percent or cents value can't false-positive into a
 *  realized count. Numbers are captured permissively (commas, decimals,
 *  optional negative sign). */
const METRIC_PATTERNS: Record<string, RegExp[]> = {
  tweets: [
    /\b(?:recorded|counted|reached|hit|fired|posted|tweeted|sent)\s+(\d[\d,]*(?:\.\d+)?)\s*(?:tweets|posts|mentions)\b/i,
    /\b(\d[\d,]*(?:\.\d+)?)\s*(?:tweets|posts|mentions)\s+(?:were|was|recorded|counted)/i,
  ],
  temperature: [
    /\bhigh\s+of\s+(-?\d+(?:\.\d+)?)\s*°?\s*F\b/i,
    /\b(?:recorded|reached|hit|measured)\s+(-?\d+(?:\.\d+)?)\s*°\s*F\b/i,
    /\b(-?\d+(?:\.\d+)?)\s*°\s*F\s+(?:was|recorded|measured)/i,
  ],
  price: [
    /\b(?:settled|closed|resolved|final|reached|hit)\s+(?:at\s+)?\$([\d,]+(?:\.\d+)?)\b/i,
    /\b\$([\d,]+(?:\.\d+)?)\s+(?:was|recorded|reached|achieved)/i,
  ],
  snow: [
    /\b(?:received|recorded|measured|got|saw)\s+(\d+(?:\.\d+)?)\s*(?:inch(?:es)?|mm|cm)\s+(?:of\s+)?snow\b/i,
    /\b(\d+(?:\.\d+)?)\s*(?:inch(?:es)?|mm|cm)\s+(?:of\s+)?snow\s+(?:was|recorded|fell|measured)/i,
  ],
  rain: [
    /\b(?:received|recorded|measured|got|saw)\s+(\d+(?:\.\d+)?)\s*(?:inch(?:es)?|mm|cm)\s+(?:of\s+)?rain\b/i,
    /\b(\d+(?:\.\d+)?)\s*(?:inch(?:es)?|mm|cm)\s+(?:of\s+)?rain\s+(?:was|recorded|fell|measured)/i,
  ],
  precipitation: [
    /\b(?:received|recorded|measured|got)\s+(\d+(?:\.\d+)?)\s*(?:inch(?:es)?|mm|cm)\s+(?:of\s+)?precipitation\b/i,
    /\b(\d+(?:\.\d+)?)\s*(?:inch(?:es)?|mm|cm)\s+(?:of\s+)?precipitation\s+(?:was|recorded|fell|measured)/i,
  ],
};

/** Canonical unit-aware display formatter. Used by BOTH tryGammaNote
 *  and inferFromOutcome so the LLM sees consistent strings. */
function formatValueWithUnit(value: number, unit: string | undefined): string {
  if (unit === '°F') return `${value}°F`;
  if (unit === '$') return `$${value.toLocaleString('en-US')}`;
  if (unit) return `${value} ${unit}`;
  return String(value);
}

/** Same formatter for inferred inequalities like `≥ 200 tweets` /
 *  `< $100,000`. The inequality lead is prepended, then we reuse
 *  the unit logic so the unit follows the same rules. */
function formatInequalityWithUnit(lead: string, value: number, unit: string | undefined): string {
  if (unit === '°F') return `${lead} ${value}°F`;
  if (unit === '$') return `${lead} $${value.toLocaleString('en-US')}`;
  if (unit) return `${lead} ${value} ${unit}`;
  return `${lead} ${value}`;
}

function tryGammaNote(comp: ComparableHit, shape: MarketShape | null): RealizedValue | null {
  if (!shape) return null;
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

  // Shape-aware regex selection. Without a known metric, we can't safely
  // pick a regex — return null and let inferFromOutcome try.
  const patterns = METRIC_PATTERNS[shape.metric];
  if (!patterns) return null;

  for (const rx of patterns) {
    const m = rx.exec(text);
    if (!m) continue;
    const raw = m[1]!.replace(/,/g, '');
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    return {
      value,
      source: 'gamma-note',
      display: formatValueWithUnit(value, shape.unit),
    };
  }
  return null;
}

function inferFromOutcome(comp: ComparableHit, shape: MarketShape | null): RealizedValue | null {
  if (!shape) return null;
  if (comp.outcome !== 'yes' && comp.outcome !== 'no') return null;
  const { comparator, threshold, unit } = shape;
  // YES means the threshold was met under the original comparator; NO means
  // it wasn't. Translate to the actual realized inequality.
  const yesLead: Record<MarketShape['comparator'], string> = {
    '>=': '≥',
    '<=': '≤',
    '>':  '>',
    '<':  '<',
  };
  const noLead: Record<MarketShape['comparator'], string> = {
    '>=': '<',
    '<=': '>',
    '>':  '≤',
    '<':  '≥',
  };
  const lead = comp.outcome === 'yes' ? yesLead[comparator] : noLead[comparator];
  return {
    value: null,
    source: 'inferred-from-outcome',
    display: formatInequalityWithUnit(lead, threshold, unit),
  };
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
