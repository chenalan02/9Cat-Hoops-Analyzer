import { CATEGORIES } from '../../utils/zScore.js';
import { formatPct, ordinal } from '../../utils/formatters.js';

export default function CategoryStandings({ wins, ranks, numTeams, puntedCats, activeCount }) {
  const puntHints = CATEGORIES
    .filter(c => !puntedCats.has(c.key) && wins.perCat[c.key] < 0.3)
    .sort((a, b) => wins.perCat[a.key] - wins.perCat[b.key])
    .slice(0, 2);

  return (
    <div className="cat-standings card">
      <div className="cs-header">
        <span className="cs-title">Your Category Standing vs League</span>
        <span className="cs-total">
          Expected cat wins / week: <strong>{wins.total.toFixed(2)}</strong> of {activeCount}
        </span>
      </div>
      <div className="cs-grid">
        {CATEGORIES.map(cat => {
          const punted = puntedCats.has(cat.key);
          const r = ranks[cat.key];
          const tier = r <= Math.ceil(numTeams / 3) ? 'strong' : r > Math.floor((numTeams * 2) / 3) ? 'weak' : 'mid';
          return (
            <div
              key={cat.key}
              className={`cs-cell ${tier} ${punted ? 'punted' : ''}`}
              title={`${cat.label}: ${ordinal(r)} of ${numTeams}, ${formatPct(wins.perCat[cat.key])} avg H2H win chance`}
            >
              <span className="cs-cat">{cat.key}</span>
              <span className="cs-rank">{ordinal(r)}</span>
              <span className="cs-prob">{punted ? 'PUNT' : `${formatPct(wins.perCat[cat.key])} win`}</span>
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
