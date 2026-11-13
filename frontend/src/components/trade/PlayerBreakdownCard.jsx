import { CATEGORIES, zScoreClass } from '../../utils/zScore.js';
import { formatZ } from '../../utils/formatters.js';
import { isActiveSlot, getMarketRank } from '../../utils/tradeEngine.js';
import { signed } from './tradeFormatters.js';

export default function PlayerBreakdownCard({ p, kind, ctx, puntedCats }) {
  const z = ctx.zTable.get(p.name) || {};
  const rank = getMarketRank(ctx, p.name);
  const puntZ = ctx.puntValue(p);
  const vsRep = puntZ - ctx.replacement.puntZ;

  return (
    <div className={`player-delta-card ${kind === 'out' ? 'losing' : 'gaining'}`}>
      <div className="pd-top">
        <span className={`pd-badge badge ${kind === 'out' ? 'badge-red' : 'badge-green'}`}>
          {kind === 'out' ? 'Giving Up' : 'Receiving'}
        </span>
        <span className={`pd-zsum ${kind === 'out' ? 'z-bad' : 'z-elite'}`} title={`Punt-adjusted Z ${formatZ(puntZ)} · ${signed(vsRep)} vs waiver replacement`}>
          Z {formatZ(puntZ)} ({signed(vsRep, 1)} vs FA)
        </span>
      </div>
      <span className="pd-name">{p.name}</span>
      <span className="pd-team-pos">
        {p.nba_team} · {p.positions}{rank != null ? ` · Rank #${rank}` : ''}
        {!isActiveSlot(p) ? ' · IL (no weekly impact)' : ''}
      </span>
      <div className="pd-cats">
        {CATEGORIES.map(cat => (
          <span
            key={cat.key}
            className={`pd-cat-z ${puntedCats.has(cat.key) ? 'punted' : zScoreClass(z[cat.key])}`}
            title={cat.label}
          >
            {cat.key}: {formatZ(z[cat.key])}
          </span>
        ))}
      </div>
    </div>
  );
}
