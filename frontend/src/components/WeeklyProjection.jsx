import { useState, useMemo } from 'react';
import { CATEGORIES, computeTeamWeeklyProjection } from '../utils/zScore.js';
import { formatMu, formatCI, ordinal } from '../utils/formatters.js';
import { zScoreClass } from '../utils/zScore.js';
import './WeeklyProjection.css';

/**
 * Weekly projection panel — shows team-level μ and CI for each category
 * assuming a hypothetical game week.
 * FG%/FT% use total makes / total attempts aggregation.
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
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'bars'

  const proj = useMemo(
    () => computeTeamWeeklyProjection(players ?? [], pg),
    [players, pg]
  );

  // Project every league team and rank by projected category μ
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

  const totalTeams = leagueTeams?.length ?? 10;

  const handlePgChange = (e) => {
    const val = parseFloat(e.target.value);
    setPgInput(e.target.value);
    if (!isNaN(val) && val > 0 && val <= 7) setPg(val);
  };

  // Map rank to a z-like value for coloring
  const rankZ = (rank) =>
    (totalTeams - rank) / (totalTeams - 1) * 3 - 1.5;

  return (
    <div className="weekly-proj-panel card fade-up">
      <div className="proj-header">
        <div>
          <h3 className="proj-title">Weekly Projection</h3>
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
          <div className="ci-toggle">
            <button
              className={`btn-ghost ${viewMode === 'cards' ? 'active' : ''}`}
              onClick={() => setViewMode('cards')}
            >Cards</button>
            <button
              className={`btn-ghost ${viewMode === 'bars' ? 'active' : ''}`}
              onClick={() => setViewMode('bars')}
            >Charts</button>
          </div>
        </div>
      </div>

      {viewMode === 'cards' ? (
        <div className="projection-grid">
          {CATEGORIES.map(cat => {
            const p = proj[cat.key];
            if (!p) return null;
            const mu   = p.mu;
            const low  = ciMode === '95' ? p.ci95Low  : p.ci68Low;
            const high = ciMode === '95' ? p.ci95High : p.ci68High;
            const rank = getLeagueRank(cat.key);
            const rZ   = rankZ(rank);

            return (
              <div key={cat.key} className="proj-card">
                <div className="proj-cat">{cat.key}</div>
                <div className={`proj-mu ${zScoreClass(rZ)}`}>
                  {formatMu(mu, cat.key)}
                  {(cat.derived === 'fg' || cat.derived === 'ft') && p.totalAttempts > 0 && (
                    <span className="proj-raw-fga"> ({p.totalMakes.toFixed(1)}/{p.totalAttempts.toFixed(1)})</span>
                  )}
                </div>
                <div className="proj-ci">{formatCI(low, high, cat.key)}</div>
                <div className={`proj-rank ${zScoreClass(rZ)}`}>
                  {ordinal(rank)} of {totalTeams}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="proj-bar-list">
          {CATEGORIES.map(cat => {
            const p = proj[cat.key];
            if (!p) return null;
            const mu   = p.mu;
            const low  = ciMode === '95' ? p.ci95Low  : p.ci68Low;
            const high = ciMode === '95' ? p.ci95High : p.ci68High;
            const rank = getLeagueRank(cat.key);
            const rZ   = rankZ(rank);

            // Percentage fill: rank 1 = 100%, last = 0%
            const fillPct = rank !== null ? ((totalTeams - rank) / (totalTeams - 1)) * 100 : 50;
            const barColor = rZ > 1.5 ? 'var(--z-elite)'
              : rZ > 0.5 ? 'var(--z-good)'
              : rZ > -0.5 ? 'var(--z-avg)'
              : rZ > -1.5 ? 'var(--z-poor)'
              : 'var(--z-bad)';

            // CI as fraction of value for display
            const ciHalfWidth = (high - low) / 2;
            const ciPctOfMu = mu > 0 ? Math.min((ciHalfWidth / Math.abs(mu)) * 100, 40) : 20;

            return (
              <div key={cat.key} className="proj-bar-row">
                <div className="proj-bar-label">
                  <span className="proj-bar-cat">{cat.key}</span>
                  <span className={`proj-bar-val ${zScoreClass(rZ)}`}>
                    {formatMu(mu, cat.key)}
                    {(cat.derived === 'fg' || cat.derived === 'ft') && p.totalAttempts > 0 && (
                      <span className="proj-raw-fga"> ({p.totalMakes.toFixed(1)}/{p.totalAttempts.toFixed(1)})</span>
                    )}
                  </span>
                  <span className="proj-bar-rank">
                    {ordinal(rank)} / {totalTeams}
                  </span>
                </div>
                <div className="proj-bar-track">
                  {/* Main fill bar */}
                  <div
                    className="proj-bar-fill"
                    style={{ width: `${fillPct}%`, background: barColor }}
                  />
                  {/* Error bar — shows as a lighter overlay centered on fill */}
                  <div
                    className="proj-error-range"
                    style={{
                      left:  `${Math.max(0, fillPct - ciPctOfMu)}%`,
                      width: `${Math.min(ciPctOfMu * 2, 100 - Math.max(0, fillPct - ciPctOfMu))}%`,
                    }}
                  />
                  <div
                    className="proj-error-center"
                    style={{ left: `${fillPct}%` }}
                  />
                </div>
                <div className="proj-bar-ci">
                  {formatCI(low, high, cat.key)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
