import { formatMu, formatPct, ordinal } from '../../utils/formatters.js';
import { isRateCat, fmtCatDelta } from './tradeFormatters.js';

export default function CatBar({ cat, before, after, probBefore, probAfter, rankBefore, rankAfter, punted, showChange }) {
  const delta = showChange && after != null && before != null ? after - before : null;
  const meaningful = delta != null && Math.abs(delta) > (isRateCat(cat) ? 0.0001 : 0.05);
  const isGood = !meaningful ? null : cat.lowerBetter ? delta < 0 : delta > 0;
  const maxVal = Math.max(Math.abs(before ?? 0), Math.abs(after ?? 0), 0.001);
  const bFill = ((before ?? 0) / maxVal) * 100;
  const aFill = ((after ?? 0) / maxVal) * 100;
  const probDelta = showChange ? (probAfter ?? 0) - (probBefore ?? 0) : 0;

  return (
    <div className={`cat-bar-row ${punted ? 'punted' : ''}`}>
      <div className="cat-bar-label">
        <span className="cat-bar-key">
          {cat.key}
          {punted && <span className="cat-punt-tag">PUNT</span>}
        </span>
        <span className="cat-bar-vals">
          <span className="cat-val-before">{formatMu(before, cat.key)}</span>
          <span className="cat-arrow">{meaningful ? (isGood ? ' ▲ ' : ' ▼ ') : ' → '}</span>
          <span className={`cat-val-after ${meaningful ? (isGood ? 'z-elite' : 'z-bad') : ''}`}>
            {formatMu(showChange ? after : before, cat.key)}
          </span>
          {meaningful && (
            <span className={`cat-delta-chip ${isGood ? 'good' : 'bad'}`}>{fmtCatDelta(cat, delta)}</span>
          )}
        </span>
      </div>
      <div className="cat-bars-wrap">
        <div className="cat-bars">
          <div className="cat-bar-track">
            <div className="cat-bar-fill before" style={{ width: `${bFill}%` }} />
          </div>
          <div className="cat-bar-track">
            <div
              className={`cat-bar-fill after ${meaningful ? (isGood ? 'positive' : 'negative') : ''}`}
              style={{ width: `${showChange ? aFill : bFill}%` }}
            />
          </div>
        </div>
        <div className="cat-bar-meta">
          <span>
            Win {formatPct(probBefore)}
            {showChange && Math.abs(probDelta) >= 0.005 && (
              <> → <strong className={probDelta > 0 ? 'z-elite' : 'z-bad'}>{formatPct(probAfter)}</strong></>
            )}
          </span>
          <span>
            Rank {ordinal(rankBefore)}
            {showChange && rankAfter !== rankBefore && (
              <> → <strong className={rankAfter < rankBefore ? 'z-elite' : 'z-bad'}>{ordinal(rankAfter)}</strong></>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
