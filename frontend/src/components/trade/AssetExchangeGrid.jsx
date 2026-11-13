import { CATEGORIES, getPlayerMu } from '../../utils/zScore.js';
import { formatMu } from '../../utils/formatters.js';
import { PROJ_GAMES } from '../../utils/tradeEngine.js';
import { isRateCat, fmtCatDelta } from './tradeFormatters.js';

export default function AssetExchangeGrid({ inList, outList, source, puntedCats }) {
  const sumStat = (list, key) => list.reduce((s, p) => {
    const st = p.isReplacement ? p.ema_stats : (source === 'ros' ? p.ros_stats : source === 'weekly' ? p.weekly_stats : p.ema_stats);
    const fallback = p.ema_stats;
    const v = st && st[key] != null ? st[key] : fallback?.[key];
    return s + (Number(v) || 0);
  }, 0);

  return (
    <div className="asset-grid">
      {CATEGORIES.map(cat => {
        let inVal, outVal, delta;
        if (isRateCat(cat)) {
          const m = cat.derived === 'fg' ? 'mu_fgm' : 'mu_ftm';
          const a = cat.derived === 'fg' ? 'mu_fga' : 'mu_fta';
          const inA = sumStat(inList, a);
          const outA = sumStat(outList, a);
          inVal = inA > 0 ? sumStat(inList, m) / inA : null;
          outVal = outA > 0 ? sumStat(outList, m) / outA : null;
          delta = inVal != null && outVal != null ? inVal - outVal : null;
        } else {
          inVal = inList.reduce((s, p) => s + (getPlayerMu(p, cat, source) ?? 0), 0);
          outVal = outList.reduce((s, p) => s + (getPlayerMu(p, cat, source) ?? 0), 0);
          delta = inVal - outVal;
        }
        const isGood = delta == null ? null : cat.lowerBetter ? delta < 0 : delta > 0;
        const punted = puntedCats.has(cat.key);

        return (
          <div key={cat.key} className={`asset-card ${punted ? 'punted' : ''}`}>
            <div className="asset-card-header">
              <span>{cat.key}{punted && <span className="cat-punt-tag">PUNT</span>}</span>
              <span className="asset-card-title-sub">{cat.label}</span>
            </div>
            <div className="asset-card-body">
              <div className={`asset-card-delta ${delta != null ? (isGood ? 'z-elite' : 'z-bad') : ''}`}>
                {delta != null ? (
                  <>
                    {fmtCatDelta(cat, delta)}
                    <span className="asset-unit">{isRateCat(cat) ? '' : ' /gm'}</span>
                  </>
                ) : '—'}
              </div>
              {!isRateCat(cat) && delta != null && (
                <div className="asset-card-sub">{fmtCatDelta(cat, delta * PROJ_GAMES)} /week</div>
              )}
              <div className="asset-card-exchange-vals">
                <span>In: {isRateCat(cat) ? (inVal != null ? `${(inVal * 100).toFixed(1)}%` : '—') : formatMu(inVal, cat.key)}</span>
                <span className="asset-sep">·</span>
                <span>Out: {isRateCat(cat) ? (outVal != null ? `${(outVal * 100).toFixed(1)}%` : '—') : formatMu(outVal, cat.key)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
