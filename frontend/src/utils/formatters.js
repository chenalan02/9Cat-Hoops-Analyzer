export function formatMu(value, catKey) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  if (catKey === 'FG%' || catKey === 'FT%') return value.toFixed(3).replace(/^0/, '');
  return value.toFixed(1);
}

export function formatZ(z) {
  if (z === null || z === undefined || isNaN(z)) return '—';
  const sign = z >= 0 ? '+' : '';
  return `${sign}${z.toFixed(2)}`;
}

export function formatPct(p) {
  if (p === null || p === undefined || isNaN(p)) return '—';
  return `${Math.round(p * 100)}%`;
}

export function formatDelta(delta) {
  if (delta === 0) return { symbol: '—', cls: 'delta-same' };
  if (delta > 0) return { symbol: `▲${delta}`, cls: 'delta-up' };
  return { symbol: `▼${Math.abs(delta)}`, cls: 'delta-down' };
}

export function formatCI(low, high, catKey) {
  return `[${formatMu(low, catKey)}, ${formatMu(high, catKey)}]`;
}

export function ordinal(n) {
  if (n === null || n === undefined) return '—';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
