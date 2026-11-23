import { CATEGORIES } from '../../utils/zScore.js';
import { formatPct, ordinal } from '../../utils/formatters.js';

export default function CategoryStandings({
  wins,
  ranks,
  numTeams,
  puntedCats,
  activeCount,
  rawWins = null,
  rawRanks = null,
  irActiveCount = 0,
}) {
  const puntHints = CATEGORIES
    .filter(c => !puntedCats.has(c.key) && wins.perCat[c.key] < 0.3)
    .sort((a, b) => wins.perCat[a.key] - wins.perCat[b.key])
    .slice(0, 2);

  const hasIrDelta = irActiveCount > 0 && rawWins != null;
  const totalDelta = hasIrDelta ? wins.total - rawWins.total : 0;

  return (
    <div className="cat-standings card">
      <div className="cs-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
          <span className="cs-title">Your Category Standing vs League</span>
          {hasIrDelta && (
            <span className="cs-ir-badge" title="Reflects active IR Roster Simulator swaps">
              🏥 IR Sim Active
            </span>
          )}
        </div>
        <span className="cs-total">
          Expected cat wins / week:{' '}
          {hasIrDelta ? (
            <>
              <span className="cs-total-raw">{rawWins.total.toFixed(2)} →</span>{' '}
              <strong>{wins.total.toFixed(2)}</strong>
              <span className={`cs-ir-total-delta ${totalDelta >= 0 ? 'pos' : 'neg'}`}>
                {' '}({totalDelta >= 0 ? `+${totalDelta.toFixed(2)}` : totalDelta.toFixed(2)})
              </span>
            </>
          ) : (
            <strong>{wins.total.toFixed(2)}</strong>
          )}{' '}
          of {activeCount}
        </span>
      </div>
      <div className="cs-grid">
        {CATEGORIES.map(cat => {
          const punted = puntedCats.has(cat.key);
          const r = ranks[cat.key];
          const rawR = rawRanks?.[cat.key] ?? r;
          const prob = wins.perCat[cat.key];
          const rawProb = rawWins?.perCat?.[cat.key] ?? prob;
          const diffPct = hasIrDelta ? Math.round((prob - rawProb) * 100) : 0;
          const showCellDelta = hasIrDelta && !punted && Math.abs(prob - rawProb) >= 0.01 && diffPct !== 0;
          const tier = r <= Math.ceil(numTeams / 3) ? 'strong' : r > Math.floor((numTeams * 2) / 3) ? 'weak' : 'mid';
          const title = hasIrDelta
            ? `${cat.label}: ${ordinal(rawR)} → ${ordinal(r)} of ${numTeams}, ${formatPct(rawProb)} → ${formatPct(prob)} avg H2H win chance`
            : `${cat.label}: ${ordinal(r)} of ${numTeams}, ${formatPct(prob)} avg H2H win chance`;
          return (
            <div
              key={cat.key}
              className={`cs-cell ${tier} ${punted ? 'punted' : ''}`}
              title={title}
            >
              <span className="cs-cat">{cat.key}</span>
              <span className="cs-rank">{ordinal(r)}</span>
              <span className="cs-prob">
                {punted ? 'PUNT' : `${formatPct(prob)} win`}
                {showCellDelta && (
                  <span className={`cs-ir-delta ${diffPct > 0 ? 'pos' : 'neg'}`}>
                    {' '}{diffPct > 0 ? `+${diffPct}%` : `${diffPct}%`}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {puntHints.length > 0 && (
        <div className="cs-hint">
          💡 Weakest categories: {puntHints.map(c => `${c.key} (${formatPct(wins.perCat[c.key])})`).join(', ')} — consider punting
          {puntHints.length > 1 ? ' one of them' : ' it'} to surface players who don't fit your build.
        </div>
      )}
    </div>
  );
}
