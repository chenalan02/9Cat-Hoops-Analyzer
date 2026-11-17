import { formatMu, formatPct, ordinal } from '../../utils/formatters.js';
import { isRateCat, fmtCatDelta } from './tradeFormatters.js';

const clampPct = v => Math.max(0, Math.min(100, (Number(v) || 0) * 100));

export default function CatBar({ cat, before, after, probBefore, probAfter, rankBefore, rankAfter, punted, showChange }) {
  const delta = showChange && after != null && before != null ? after - before : null;
  const meaningful = delta != null && Math.abs(delta) > (isRateCat(cat) ? 0.0001 : 0.05);
  const isGood = !meaningful ? null : cat.lowerBetter ? delta < 0 : delta > 0;

  const bPct = clampPct(probBefore);
  const aPct = clampPct(showChange ? probAfter : probBefore);
  const probDelta = showChange ? (probAfter ?? 0) - (probBefore ?? 0) : 0;
  const probPts = Math.round(probDelta * 100);

  const baseWidth = showChange ? Math.min(bPct, aPct) : bPct;
  const diffLeft = Math.min(bPct, aPct);
  const diffWidth = showChange ? Math.abs(aPct - bPct) : 0;
  const isGain = aPct >= bPct;

  const rowTone = !showChange || punted
    ? ''
    : probDelta >= 0.015
      ? 'row-gain'
      : probDelta <= -0.015
        ? 'row-loss'
        : '';

  return (
    <div className={`cat-impact-row ${punted ? 'punted' : ''} ${rowTone}`}>
      <div className="cir-cat">
        <span className="cir-key">{cat.key}</span>
        {punted && <span className="cat-punt-tag">PUNT</span>}
      </div>

      <div
        className="cir-bar-col"
        title={showChange
          ? `${cat.label}: Win chance ${Math.round(bPct)}% → ${Math.round(aPct)}% (${probPts >= 0 ? '+' : ''}${probPts} pts)`
          : `${cat.label}: ${Math.round(bPct)}% win chance vs league`}
      >
        <div className="cir-track">
          <div className="cir-fill-base" style={{ width: `${baseWidth}%` }} />
          {showChange && diffWidth >= 0.25 && (
            <div
              className={`cir-fill-delta ${isGain ? 'gain' : 'loss'}`}
              style={{ left: `${diffLeft}%`, width: `${diffWidth}%` }}
            />
          )}
          <div className="cir-midline" aria-hidden="true" />
        </div>
      </div>

      <div className="cir-odds-col">
        <div className="cir-win">
          <span>{formatPct(probBefore)}</span>
          {showChange && Math.abs(probDelta) >= 0.005 && (
            <>
              <span className="cat-arrow">→</span>
              <strong className={probDelta > 0 ? 'z-elite' : 'z-bad'}>{formatPct(probAfter)}</strong>
              {probPts !== 0 && (
                <span className={`cir-pts ${probPts > 0 ? 'good' : 'bad'}`}>
                  {probPts > 0 ? `+${probPts}` : probPts}
                </span>
              )}
            </>
          )}
        </div>
        <div className="cir-rank">
          <span>#{rankBefore}</span>
          {showChange && rankAfter !== rankBefore && (
            <>
              <span className="cat-arrow">→</span>
              <strong className={rankAfter < rankBefore ? 'z-elite' : 'z-bad'}>#{rankAfter}</strong>
            </>
          )}
          <span className="cir-rank-lbl">({ordinal(showChange ? rankAfter : rankBefore)} in lg)</span>
        </div>
      </div>

      <div className="cir-proj-col">
        <div className="cir-proj-vals">
          <span className="cat-val-before">{formatMu(before, cat.key)}</span>
          {showChange && (
            <>
              <span className="cat-arrow">→</span>
              <span className={`cat-val-after ${meaningful ? (isGood ? 'z-elite' : 'z-bad') : ''}`}>
                {formatMu(after, cat.key)}
              </span>
            </>
          )}
        </div>
        {meaningful && (
          <span className={`cat-delta-chip ${isGood ? 'good' : 'bad'}`}>{fmtCatDelta(cat, delta)}</span>
        )}
      </div>
    </div>
  );
}
