export const SOURCE_OPTIONS = [
  { key: 'ros',    label: 'ROS',    desc: 'Rest-of-season projections — recommended for trades (long-term value).' },
  { key: 'ema',    label: 'EMA',    desc: 'Recent-form weighted averages — captures current role and usage.' },
  { key: 'weekly', label: 'Weekly', desc: "This week's per-game projections — short-term only." },
];

export const POS_FILTERS = ['all', 'PG', 'SG', 'SF', 'PF', 'C'];

export const signed = (v, d = 2) => (v == null || isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}`);

export const isRateCat = (cat) => cat.derived === 'fg' || cat.derived === 'ft';

export function fmtCatDelta(cat, delta) {
  if (delta == null || isNaN(delta)) return '—';
  if (isRateCat(cat)) return `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`;
}

export function verdictFor(delta) {
  if (delta >= 0.3) return { text: '🌟 Strongly Recommended — major category gain', cls: 'good' };
  if (delta >= 0.08) return { text: '✓ Favorable — improves your weekly category odds', cls: 'good' };
  if (delta > -0.08) return { text: '⚖️ Roughly Neutral — little change in category odds', cls: 'neutral' };
  if (delta > -0.3) return { text: '✗ Unfavorable — lowers your weekly category odds', cls: 'bad' };
  return { text: '⛔ Avoid — significant category loss', cls: 'bad' };
}

export function partnerVerdict(delta) {
  if (delta >= 0.05) return { text: 'Likely to accept — it improves their team too', cls: 'good' };
  if (delta > -0.05) return { text: 'Neutral for them — plausible accept', cls: 'neutral' };
  return { text: 'Hurts their team — expect pushback', cls: 'bad' };
}
