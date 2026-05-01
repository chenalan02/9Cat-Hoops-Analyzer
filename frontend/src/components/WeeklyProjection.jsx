import { useState, useMemo } from 'react';
import { CATEGORIES, computeTeamWeeklyProjection } from '../utils/zScore.js';
import { formatMu, formatCI, ordinal } from '../utils/formatters.js';
import { zScoreClass } from '../utils/zScore.js';
import './WeeklyProjection.css';

/**
 * Weekly projection panel — shows team-level μ and CI for each category
 * assuming a hypothetical 3.5-game week.
 *
 * Props:
 *   players:     Player[]   — team roster
 *   leagueTeams: Team[]     — all league teams (for league rank coloring)
 *   projGames:   number     — default 3.5
 */
export default function WeeklyProjection({ players, leagueTeams, projGames = 3.5 }) {
  const [ciMode, setCiMode]   = useState('95'); // '95' | '68'
  const [pgInput, setPgInput] = useState(String(projGames));
  const [pg, setPg]           = useState(projGames);

  const proj = useMemo(
    () => computeTeamWeeklyProjection(players ?? [], pg),
    [players, pg]
  );

  // Compute league-wide projections for all teams to get league rank
  const leagueProjs = useMemo(() => {
    if (!leagueTeams) return [];
    return leagueTeams.map(t => computeTeamWeeklyProjection(t.players ?? [], pg));
  }, [leagueTeams, pg]);

  function getLeagueRank(catKey) {
    const myVal = proj[catKey]?.mu ?? 0;
    const cat = CATEGORIES.find(c => c.key === catKey);
    const vals = leagueProjs.map(p => p[catKey]?.mu ?? 0);
    const rank = vals.filter(v => (cat?.lowerBetter ? v < myVal : v > myVal)).length + 1;
    return rank;
  }

  const handlePgChange = (e) => {
    const val = parseFloat(e.target.value);
    setPgInput(e.target.value);
    if (!isNaN(val) && val > 0 && val <= 7) setPg(val);
  };

  return (
    <div className="weekly-proj-panel card fade-up">
      <div className="proj-header">
        <div>
          <h3 className="proj-title">📅 Weekly Projection</h3>
          <p className="proj-subtitle">Expected team totals given hypothetical game week</p>
        </div>
        <div className="proj-controls">
          <label className="proj-control-label">
            Games/Week
            <input
              type="number"
              min="1" max="7" step="0.5"
              value={pgInput}
              onChange={handlePgChange}
              className="proj-games-input"
              aria-label="Projected games per week"
            />
          </label>
          <div className="ci-toggle">
            <button
              className={`btn-ghost ${ciMode === '95' ? 'active' : ''}`}
              onClick={() => setCiMode('95')}
            >95% CI</button>
            <button
              className={`btn-ghost ${ciMode === '68' ? 'active' : ''}`}
              onClick={() => setCiMode('68')}
            >68% CI</button>
          </div>
        </div>
      </div>

      <div className="projection-grid">
        {CATEGORIES.map(cat => {
          const p = proj[cat.key];
          if (!p) return null;
          const mu  = p.mu;
          const low  = ciMode === '95' ? p.ci95Low  : p.ci68Low;
          const high = ciMode === '95' ? p.ci95High : p.ci68High;
          const rank = getLeagueRank(cat.key);
          const totalTeams = leagueTeams?.length ?? 10;
          // Rank-based z-score coloring (rank 1 = best)
          const rankZ = (totalTeams - rank) / (totalTeams - 1) * 3 - 1.5; // maps [1..N] to [1.5..-1.5]

          return (
            <div key={cat.key} className="proj-card">
              <div className="proj-cat">{cat.icon} {cat.key}</div>
              <div className={`proj-mu ${zScoreClass(rankZ)}`}>
                {formatMu(mu, cat.key)}
              </div>
              <div className="proj-ci">{formatCI(low, high, cat.key)}</div>
              <div className={`proj-rank ${zScoreClass(rankZ)}`}>
                {ordinal(rank)} of {totalTeams}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
