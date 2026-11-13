import { formatMu, formatPct } from '../../utils/formatters.js';
import { formatCatMargin } from '../../utils/matchupHelpers.js';
import MatchupDistributionChart from '../MatchupDistributionChart.jsx';

export default function CategoryOddsGrid({
  rows,
  activeCatKey,
  onSelectCategory,
  winChanceLabel = 'Win Chance',
  marginLabel = 'Margin:',
  selectedCatData,
  chartMy,
  chartOpp,
  chartWinProb,
}) {
  return (
    <div className="category-analysis-workspace">
      <div className="odds-grid">
        {rows.map(({ cat, myMu, oppMu, winProb }) => {
          const color = winProb >= 0.6 ? 'var(--accent)' : winProb >= 0.4 ? '#fbbf24' : '#e53935';
          const favorable = cat.key === 'TO' ? myMu < oppMu : myMu > oppMu;
          return (
            <div
              className={`odds-card ${activeCatKey === cat.key ? 'active' : ''}`}
              key={cat.key}
              onClick={() => onSelectCategory(cat.key)}
            >
              <div className="odds-cat">{cat.icon} {cat.label}</div>
              <div className="odds-pct" style={{ color }}>
                {formatPct(winProb)}
                <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600, textTransform: 'uppercase', marginTop: '2px' }}>
                  {winChanceLabel}
                </span>
              </div>
              <div className="odds-bar">
                <div
                  className="odds-bar-fill"
                  style={{ width: `${winProb * 100}%`, background: color }}
                />
              </div>
              <div className="odds-vs-row">
                <span title="You">You: <strong>{formatMu(myMu, cat.key)}</strong></span>
                <span title="Opponent">Opp: <strong>{formatMu(oppMu, cat.key)}</strong></span>
              </div>
              <div className="odds-proj-margin">
                <span style={{ color: 'var(--text-muted)' }}>{marginLabel}</span>
                <span style={{ color: myMu === oppMu ? 'var(--text-muted)' : favorable ? '#4ade80' : '#f87171' }}>
                  {formatCatMargin(cat, myMu, oppMu)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {selectedCatData && (
        <MatchupDistributionChart
          category={selectedCatData.cat}
          my={chartMy}
          opp={chartOpp}
          winProb={chartWinProb}
          onSelectCategory={onSelectCategory}
        />
      )}
    </div>
  );
}
