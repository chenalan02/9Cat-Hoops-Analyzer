import { CATEGORIES } from '../../utils/zScore.js';
import { getMarketRank } from '../../utils/tradeEngine.js';
import { signed, fmtCatDelta } from './tradeFormatters.js';

const FORMAT_LABELS = {
  '1for1': '1-for-1',
  '2for1': '2-for-1 Upgrade',
  '1for2': '1-for-2 Depth',
};

export default function TradeTargetCard({ t, ctx, puntedCats, onLoad }) {
  const gives = t.gives || [t.give];
  const gets = t.gets || [t.get];
  const formatLabel = FORMAT_LABELS[t.type] || '1-for-1';

  return (
    <div className={`target-card ${t.winWin ? 'win-win' : ''}`}>
      <div className="tc-format-row">
        <span className={`tc-format-pill fmt-${t.type || '1for1'}`}>{formatLabel}</span>
        {t.type === '2for1' && ctx?.replacement?.name && (
          <span className="tc-spot-note" title={`Open roster spot filled by ${ctx.replacement.name}`}>
            + opens spot ({ctx.replacement.isRealFreeAgent ? ctx.replacement.name : 'waiver add'})
          </span>
        )}
        {t.type === '1for2' && t.myDrops?.[0] && (
          <span className="tc-spot-note drop" title="Lowest active roster player assumed dropped to fit 2 incoming players">
            − drops {t.myDrops[0].name}
          </span>
        )}
      </div>

      <div className="tc-top">
        <div className="tc-swap">
          <div className="tc-player give">
            <span className="tc-label">Give</span>
            {gives.map(p => {
              const r = getMarketRank(ctx, p.name);
              return (
                <div key={p.name} className="tc-player-item">
                  <span className="tc-name" title={p.name}>{p.name}</span>
                  <span className="tc-meta">#{r ?? '—'} · {p.nba_team} · {p.positions}</span>
                </div>
              );
            })}
          </div>
          <span className="tc-arrow">⇄</span>
          <div className="tc-player get">
            <span className="tc-label">Get</span>
            {gets.map(p => {
              const r = getMarketRank(ctx, p.name);
              return (
                <div key={p.name} className="tc-player-item">
                  <span className="tc-name" title={p.name}>
                    {p.name}
                    {p.status && <span className="sp-status-tag">{p.status}</span>}
                  </span>
                  <span className="tc-meta">#{r ?? '—'} · {p.nba_team} · {p.positions}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="tc-delta" title="Change in your expected H2H category wins per week vs the league">
          <span className="tc-delta-val">{signed(t.myDelta)}</span>
          <span className="tc-delta-lbl">cat wins / wk</span>
        </div>
      </div>

      <div className="tc-badges">
        <span className="tc-owner">with <strong>{t.partnerName}</strong></span>
        <span className={`tc-badge ${t.winWin ? 'good' : 'bad'}`} title="Change in the partner's expected 9-cat category wins">
          {t.winWin ? '🤝 Win-win' : 'Partner 9-cat'} {signed(t.partnerDelta)}
        </span>
        <span className={`tc-badge ${t.fairness === 'Fair value' ? 'neutral' : t.fairness === 'Reach' ? 'warn' : 'info'}`} title="Market value comparison">
          {t.fairness}{t.type === '1for1' && t.rankGap !== 0 ? ` (${t.rankGap > 0 ? '+' : ''}${t.rankGap} ranks)` : ''}
        </span>
      </div>

      {t.posWarnings?.length > 0 && (
        <div className="tc-pos-warn">⚠️ {t.posWarnings[0].text}</div>
      )}

      <div className="tc-cats">
        {CATEGORIES.map(cat => {
          const c = t.catChanges[cat.key];
          const punted = puntedCats.has(cat.key);
          const cls = punted ? 'punted' : c.probDelta > 0.005 ? 'pos' : c.probDelta < -0.005 ? 'neg' : 'flat';
          return (
            <span
              key={cat.key}
              className={`tc-cat ${cls}`}
              title={`${cat.label}: weekly ${fmtCatDelta(cat, c.muDelta)} · win chance ${signed(c.probDelta * 100, 1)} pts`}
            >
              <span className="tc-cat-key">{cat.key}</span>
              <span className="tc-cat-val">{fmtCatDelta(cat, c.muDelta)}</span>
            </span>
          );
        })}
      </div>

      <button type="button" className="tc-load-btn" onClick={() => onLoad(t)}>
        Open in Trade Analyzer →
      </button>
    </div>
  );
}
