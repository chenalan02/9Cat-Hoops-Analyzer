export default function MatchupOutlookBanner({
  weekNum,
  matchupWinStats,
  mcMatchupWin,
  mcLoading,
  onSelectMonteCarloTab,
  onRunMonteCarlo,
}) {
  return (
    <div className="card matchup-outlook-card fade-up">
      <div className="matchup-outlook-content">
        <div className="matchup-outlook-main">
          <div
            className="matchup-outlook-pct"
            style={{ color: matchupWinStats.matchupWinProb >= 0.5 ? 'var(--accent)' : '#e53935' }}
          >
            {Math.round(matchupWinStats.matchupWinProb * 100)}%
          </div>
          <div className="matchup-outlook-meta">
            <div className="matchup-outlook-title-row">
              <span className="matchup-outlook-title">Matchup Win Probability</span>
              {mcMatchupWin !== null ? (
                <div
                  className="mc-badge-pill clickable"
                  onClick={onSelectMonteCarloTab}
                  title="Click to view full Monte Carlo simulation tab"
                >
                  🎲 Monte Carlo: <strong>{Math.round(mcMatchupWin * 100)}%</strong>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn-mc-quick"
                  onClick={onRunMonteCarlo}
                  disabled={mcLoading}
                  title="Run 10,000-trial Monte Carlo simulation"
                >
                  {mcLoading ? <><span className="spinner mini" /> Simulating…</> : '🎲 Run Monte Carlo'}
                </button>
              )}
            </div>
            <div className="matchup-outlook-subtitle">
              Projected probability to win 5 or more categories in Week {weekNum}
            </div>
          </div>
        </div>

        <div className="matchup-outlook-pills">
          <div className="matchup-pill highlight">
            🎯 Projected Score: <strong>{matchupWinStats.projectedMyScore} – {matchupWinStats.projectedOppScore}</strong>
          </div>
          <div className="matchup-pill">
            ★ Favored in <strong>{matchupWinStats.favoredCatsCount} of 9</strong> categories
          </div>
          {matchupWinStats.tossupCatsCount > 0 && (
            <div className="matchup-pill" style={{ borderColor: 'rgba(234, 179, 8, 0.4)', color: '#fde047' }}>
              ⚡ <strong>{matchupWinStats.tossupCatsCount}</strong> Toss-up
            </div>
          )}
          {mcMatchupWin !== null && (
            <div
              className="matchup-pill clickable"
              onClick={onSelectMonteCarloTab}
              style={{ background: 'rgba(139, 92, 246, 0.1)', borderColor: 'rgba(139, 92, 246, 0.3)', color: '#a78bfa', cursor: 'pointer' }}
              title="Click to view Monte Carlo simulation tab"
            >
              🎲 Simulated: <strong>{Math.round(mcMatchupWin * 100)}%</strong> (10k trials)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
