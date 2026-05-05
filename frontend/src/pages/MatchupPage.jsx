import { useState, useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import { CATEGORIES, getPlayerMu, getPlayerVar } from '../utils/zScore.js';
import { formatMu, formatPct } from '../utils/formatters.js';
import './MatchupPage.css';

/** Simple normal CDF approximation */
function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * For each category, compute win probability:
 * P(myMu > oppMu) using normal approximation of difference.
 */
function computeMatchupOdds(myPlayers, oppPlayers, projGames = 3.5) {
  return CATEGORIES.map(cat => {
    const aggregate = (players) => {
      let mu = 0, variance = 0;
      players.filter(p => p.selected_position !== 'IL').forEach(p => {
        const pMu  = getPlayerMu(p, cat);
        const pVar = getPlayerVar(p, cat);
        const gp   = p.ema_stats?.mu_min > 0 ? projGames : 0;
        if (pMu !== null) mu       += pMu  * gp;
        if (pVar !== null) variance += pVar * gp;
      });
      return { mu, sigma: Math.sqrt(Math.max(variance, 0.001)) };
    };

    const my  = aggregate(myPlayers);
    const opp = aggregate(oppPlayers);

    // P(my > opp) = P(diff > 0) where diff ~ N(my.mu - opp.mu, my.sigma² + opp.sigma²)
    const diffMu    = my.mu - opp.mu;
    const diffSigma = Math.sqrt(my.sigma ** 2 + opp.sigma ** 2);
    let winProb = normalCDF(diffMu / diffSigma);
    if (cat.lowerBetter) winProb = 1 - winProb;

    return {
      cat,
      myMu:   my.mu,
      oppMu:  opp.mu,
      winProb,
    };
  });
}

/** Simple Monte Carlo: N simulated weeks */
function monteCarlo(myPlayers, oppPlayers, N = 1000, projGames = 3.5) {
  let wins = 0, losses = 0, ties = 0;

  for (let i = 0; i < N; i++) {
    let wCats = 0, lCats = 0;
    for (const cat of CATEGORIES) {
      // Sample from each player's distribution
      const sample = (players) => players
        .filter(p => p.selected_position !== 'IL')
        .reduce((sum, p) => {
          const mu = getPlayerMu(p, cat) ?? 0;
          const v  = getPlayerVar(p, cat) ?? (mu * 0.1);
          const gp = p.ema_stats?.mu_min > 0 ? projGames : 0;
          // Box-Muller
          const u1 = Math.random() || 0.0001, u2 = Math.random() || 0.0001;
          const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          return sum + (mu + z * Math.sqrt(v)) * gp;
        }, 0);

      const myVal  = sample(myPlayers);
      const oppVal = sample(oppPlayers);
      const myWins = cat.lowerBetter ? myVal < oppVal : myVal > oppVal;
      if (myWins)       wCats++;
      else if (myVal === oppVal) { /* tie */ }
      else              lCats++;
    }
    if (wCats > lCats) wins++;
    else if (lCats > wCats) losses++;
    else ties++;
  }

  return { wins: wins / N, losses: losses / N, ties: ties / N };
}

export default function MatchupPage() {
  const { myTeam, leagueData, loading } = useContext(TeamDataContext);
  const navigate = useNavigate();
  const [oppTeamId, setOppTeamId] = useState('');
  const [simResult, setSimResult] = useState(null);
  const [simRunning, setSimRunning] = useState(false);

  const opponents = leagueData?.teams?.filter(t => t.team_id !== myTeam?.team_id) ?? [];
  const oppTeam   = opponents.find(t => String(t.team_id) === String(oppTeamId)) ?? null;

  const odds = useMemo(() => {
    if (!myTeam || !oppTeam) return null;
    return computeMatchupOdds(myTeam.players, oppTeam.players);
  }, [myTeam, oppTeam]);

  const runMonteCarlo = () => {
    if (!myTeam || !oppTeam) return;
    setSimRunning(true);
    setTimeout(() => {
      const result = monteCarlo(myTeam.players, oppTeam.players, 5000);
      setSimResult(result);
      setSimRunning(false);
    }, 50);
  };

  if (loading) return <div className="page-wrapper center-content"><div className="spinner" style={{ width: 36, height: 36 }} /></div>;

  if (!myTeam) {
    return (
      <div className="page-wrapper center-content">
        <div className="empty-state">
          <div style={{ fontSize: '4rem' }}>⚔️</div>
          <h2 style={{ marginBottom: '0.5rem' }}>No Team Data</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Analyze your team first to see matchup odds.
          </p>
          <button className="btn-primary" onClick={() => navigate('/')}>Analyze My Team</button>
        </div>
      </div>
    );
  }

  const overallWin = odds ? odds.reduce((s, o) => s + o.winProb, 0) / odds.length : null;

  return (
    <div className="matchup-page page-wrapper fade-up">
      <div className="section">
        <h1 className="section-title" style={{ textAlign: 'left' }}>⚔️ Matchup Analyzer</h1>
        <p className="section-subtitle" style={{ textAlign: 'left' }}>
          Category-by-category win probabilities vs. any opponent
        </p>

        {/* Opponent selector */}
        <div className="matchup-selector card">
          <div className="matchup-vs">
            <div className="vs-team">
              <span className="badge badge-green">You</span>
              <strong>{myTeam.name}</strong>
            </div>
            <span className="vs-divider">VS</span>
            <div className="vs-team">
              <span className="badge badge-orange">Opponent</span>
              <select
                className="opp-select"
                value={oppTeamId}
                onChange={e => { setOppTeamId(e.target.value); setSimResult(null); }}
                aria-label="Select opponent team"
              >
                <option value="">— Select opponent —</option>
                {opponents.map(t => (
                  <option key={t.team_id} value={t.team_id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          {oppTeam && overallWin !== null && (
            <div className="matchup-summary">
              <div className="summary-pct" style={{ color: overallWin >= 0.5 ? 'var(--accent)' : '#e53935' }}>
                {Math.round(overallWin * 100)}%
              </div>
              <div className="summary-label">avg. category win probability</div>
              <button
                className="btn-primary"
                style={{ marginTop: '0.75rem' }}
                onClick={runMonteCarlo}
                disabled={simRunning}
                id="run-monte-carlo-btn"
              >
                {simRunning ? <><span className="spinner" /> Running…</> : '🎲 Run Monte Carlo (5,000 sims)'}
              </button>
            </div>
          )}
        </div>

        {/* Monte Carlo Result */}
        {simResult && (
          <div className="sim-result card fade-up">
            <h3 style={{ marginBottom: '1rem' }}>🎲 Monte Carlo Results (5,000 simulated weeks)</h3>
            <div className="sim-bars">
              {[
                { label: 'Win', val: simResult.wins, color: 'var(--accent)' },
                { label: 'Loss', val: simResult.losses, color: '#e53935' },
                { label: 'Tie', val: simResult.ties, color: 'var(--text-muted)' },
              ].map(({ label, val, color }) => (
                <div className="sim-bar-row" key={label}>
                  <span className="sim-label">{label}</span>
                  <div className="sim-bar-track">
                    <div className="sim-bar-fill" style={{ width: `${val * 100}%`, background: color }} />
                  </div>
                  <span className="sim-pct" style={{ color }}>{Math.round(val * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Category odds grid */}
        {odds && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem', fontWeight: 700 }}>Category Breakdown</h3>
            <div className="odds-grid">
              {odds.map(({ cat, myMu, oppMu, winProb }) => {
                const color = winProb >= 0.6 ? 'var(--accent)'
                            : winProb >= 0.4 ? 'var(--text-secondary)'
                            : '#e53935';
                return (
                  <div className="odds-card" key={cat.key}>
                    <div className="odds-cat">{cat.icon} {cat.label}</div>
                    <div className="odds-pct" style={{ color }}>{formatPct(winProb)}</div>
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
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!oppTeam && (
          <div className="select-prompt">
            <span>👆 Select an opponent above to see matchup odds</span>
          </div>
        )}

        {/* Streamer Section (TODO: real backend data) */}
        <div className="streamers-section card" style={{ marginTop: '2rem' }}>
          <h3>💡 Streamer Recommendations</h3>
          <p className="proj-subtitle" style={{ textAlign: 'left' }}>
            Top available players to stream for injured/bench spots
            <span className="badge badge-orange" style={{ marginLeft: '0.5rem' }}>Coming Soon</span>
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.5rem' }}>
            Backend integration needed — will pull waiver wire data and rank by your weakest categories.
          </p>
        </div>
      </div>
    </div>
  );
}
