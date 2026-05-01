// Number formatting helpers for 9Cat Hoops Analyzer

// Format a stat μ value with appropriate decimal places per category.
export function formatMu(value, catKey) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  if (catKey === 'FG%' || catKey === 'FT%') return value.toFixed(3).replace(/^0/, '');
  if (catKey === 'TO') return value.toFixed(1);
  return value.toFixed(1);
}

// Format a z-score for display.
export function formatZ(z) {
  if (z === null || z === undefined || isNaN(z)) return '—';
  const sign = z >= 0 ? '+' : '';
  return `${sign}${z.toFixed(2)}`;
}

// Format a win probability percentage.
export function formatPct(p) {
  if (p === null || p === undefined || isNaN(p)) return '—';
  return `${Math.round(p * 100)}%`;
}

// Format a rank delta for display with arrow.
export function formatDelta(delta) {
  if (delta === 0) return { symbol: '—', cls: 'delta-same' };
  if (delta > 0) return { symbol: `▲${delta}`, cls: 'delta-up' };
  return { symbol: `▼${Math.abs(delta)}`, cls: 'delta-down' };
}

// Format CI bounds for display.
export function formatCI(low, high, catKey) {
  return `[${formatMu(low, catKey)}, ${formatMu(high, catKey)}]`;
}

// Ordinal suffix for a rank number.
export function ordinal(n) {
  if (n === null || n === undefined) return '—';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
