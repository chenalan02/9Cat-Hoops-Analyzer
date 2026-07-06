import { useState, useMemo, useContext, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import { CATEGORIES } from '../utils/zScore.js';
import { formatMu, formatPct } from '../utils/formatters.js';
import MatchupDistributionChart from '../components/MatchupDistributionChart.jsx';
import './MatchupPage.css';

// ─── Backend key → frontend CATEGORIES key mapping ──────────────
const BACKEND_TO_FRONTEND = {
  'pts':  'PTS',
  'reb':  'REB',
  'ast':  'AST',
  'stl':  'STL',
  'blk':  'BLK',
  'tov':  'TO',
  'fg3m': '3PM',
  'fg%':  'FG%',
  'ft%':  'FT%',
};

const FRONTEND_TO_BACKEND = Object.fromEntries(
  Object.entries(BACKEND_TO_FRONTEND).map(([b, f]) => [f, b])
);

// Get today's date in YYYY-MM-DD
function todayString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Convert backend analysis result to the odds format our UI expects.
 * Returns an array of { cat, myMu, mySigma, oppMu, oppSigma, winProb } objects.
 */
function parseAnalysisResult(result) {
  const { win_probs, agg_dists } = result;
  if (!win_probs || !agg_dists) return [];

  return CATEGORIES.map(cat => {
    const bKey = FRONTEND_TO_BACKEND[cat.key];
    const winProb = win_probs[bKey] ?? 0;

    let myMu, mySigma, oppMu, oppSigma;

    if (cat.derived === 'fg') {
      // FG%: compute from fgm / fga
      const t1 = agg_dists.team1;
      const t2 = agg_dists.team2;
      myMu     = t1.fga?.mu > 0 ? t1.fgm.mu / t1.fga.mu : 0;
      oppMu    = t2.fga?.mu > 0 ? t2.fgm.mu / t2.fga.mu : 0;
      // Delta method for sigma: Var(X/Y) ≈ (μx²/μy⁴)·Var(y) + (1/μy²)·Var(x)
      const myVar = t1.fga?.mu > 0
        ? (t1.fgm.mu ** 2 / t1.fga.mu ** 4) * (t1.fga.var ?? 0) + (1 / t1.fga.mu ** 2) * (t1.fgm.var ?? 0)
        : 0;
      const oppVar = t2.fga?.mu > 0
        ? (t2.fgm.mu ** 2 / t2.fga.mu ** 4) * (t2.fga.var ?? 0) + (1 / t2.fga.mu ** 2) * (t2.fgm.var ?? 0)
        : 0;
      mySigma  = Math.sqrt(Math.max(myVar, 0));
      oppSigma = Math.sqrt(Math.max(oppVar, 0));
    } else if (cat.derived === 'ft') {
      // FT%: compute from ftm / fta
      const t1 = agg_dists.team1;
      const t2 = agg_dists.team2;
      myMu     = t1.fta?.mu > 0 ? t1.ftm.mu / t1.fta.mu : 0;
      oppMu    = t2.fta?.mu > 0 ? t2.ftm.mu / t2.fta.mu : 0;
      const myVar = t1.fta?.mu > 0
        ? (t1.ftm.mu ** 2 / t1.fta.mu ** 4) * (t1.fta.var ?? 0) + (1 / t1.fta.mu ** 2) * (t1.ftm.var ?? 0)
        : 0;
      const oppVar = t2.fta?.mu > 0
        ? (t2.ftm.mu ** 2 / t2.fta.mu ** 4) * (t2.fta.var ?? 0) + (1 / t2.fta.mu ** 2) * (t2.ftm.var ?? 0)
        : 0;
      mySigma  = Math.sqrt(Math.max(myVar, 0));
      oppSigma = Math.sqrt(Math.max(oppVar, 0));
    } else {
      // Standard counting stats (pts, reb, ast, stl, blk, fg3m, tov)
      const t1Dist = agg_dists.team1?.[bKey];
      const t2Dist = agg_dists.team2?.[bKey];
      myMu     = t1Dist?.mu  ?? 0;
      mySigma  = Math.sqrt(Math.max(t1Dist?.var ?? 0, 0));
      oppMu    = t2Dist?.mu  ?? 0;
      oppSigma = Math.sqrt(Math.max(t2Dist?.var ?? 0, 0));
    }

    return { cat, myMu, mySigma, oppMu, oppSigma, winProb };
  });
}

export default function MatchupPage() {
  const { myTeam, leagueData, loading } = useContext(TeamDataContext);
  const navigate = useNavigate();

  // ── Opponent selection ─────────────────────────────────
  const [oppTeamId, setOppTeamId]       = useState('');
  const [activeCatKey, setActiveCatKey] = useState('PTS');

  // ── Week / date controls ───────────────────────────────
  const [weekNum, setWeekNum]   = useState(() => leagueData?.week_num ?? 1);
  const [dateStart, setDateStart] = useState(todayString);

  // ── Analysis state (non-Monte Carlo) ───────────────────
  const [analysisResult, setAnalysisResult]   = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError]     = useState(null);

  // ── Monte Carlo state ──────────────────────────────────
  const [mcResult, setMcResult]       = useState(null);
  const [mcLoading, setMcLoading]     = useState(false);
  const [mcError, setMcError]         = useState(null);

  const opponents = leagueData?.teams?.filter(t => t.team_id !== myTeam?.team_id) ?? [];
  const oppTeam   = opponents.find(t => String(t.team_id) === String(oppTeamId)) ?? null;

  // ── Build the request body shared by both calls ────────
  const buildRequestBody = useCallback((monteCarlo) => {
    if (!myTeam || !oppTeam || !leagueData) return null;
    return {
      league_id:        leagueData.league_id,
      team1:            myTeam,
      team2:            oppTeam,
      week_num:         weekNum,
      date_start:       dateStart,
      roster_positions: leagueData.roster_positions ?? null,
      stats_source:     'weekly_stats',
      monte_carlo:      monteCarlo,
    };
  }, [myTeam, oppTeam, leagueData, weekNum, dateStart]);

  // ── Fetch analysis (non-MC) when opponent changes ──────
  const fetchAnalysis = useCallback(async () => {
    const body = buildRequestBody(false);
    if (!body) return;

    setAnalysisLoading(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    setMcResult(null);     // Clear previous MC result when opponent changes

    try {
      const res = await fetch('/api/matchup-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setAnalysisResult(data);
    } catch (err) {
      console.error('Matchup analysis failed:', err);
      setAnalysisError(err.message || 'Failed to fetch matchup analysis');
    } finally {
      setAnalysisLoading(false);
    }
  }, [buildRequestBody]);

  // Auto-fetch when opponent selection changes
  useEffect(() => {
    if (oppTeam) fetchAnalysis();
  }, [oppTeam?.team_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Run Monte Carlo ────────────────────────────────────
  const runMonteCarlo = useCallback(async () => {
    const body = buildRequestBody(true);
    if (!body) return;

    setMcLoading(true);
    setMcError(null);
    setMcResult(null);

    try {
      const res = await fetch('/api/matchup-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setMcResult(data);
    } catch (err) {
      console.error('Monte Carlo failed:', err);
      setMcError(err.message || 'Failed to run Monte Carlo simulation');
    } finally {
      setMcLoading(false);
    }
  }, [buildRequestBody]);

  // ── Derived data from analysis result ──────────────────
  const odds = useMemo(() => {
    if (!analysisResult) return null;
    return parseAnalysisResult(analysisResult);
  }, [analysisResult]);

  const selectedCatData = useMemo(() => {
    if (!odds) return null;
    return odds.find(o => o.cat.key === activeCatKey) ?? odds[0];
  }, [odds, activeCatKey]);

  const overallWin = odds
    ? odds.reduce((s, o) => s + o.winProb, 0) / odds.length
    : null;

  // ── Monte Carlo per-category data ──────────────────────
  const mcCatData = useMemo(() => {
    if (!mcResult?.win_pcts) return null;
    return CATEGORIES.map(cat => {
      const bKey = FRONTEND_TO_BACKEND[cat.key];
      return {
        cat,
        winPct: mcResult.win_pcts[bKey] ?? 0,
        myAvg:  cat.derived === 'fg'
          ? (mcResult.sim_avg?.team1?.fga > 0 ? mcResult.sim_avg?.team1?.fgm / mcResult.sim_avg?.team1?.fga : 0)
          : cat.derived === 'ft'
          ? (mcResult.sim_avg?.team1?.fta > 0 ? mcResult.sim_avg?.team1?.ftm / mcResult.sim_avg?.team1?.fta : 0)
          : mcResult.sim_avg?.team1?.[bKey] ?? 0,
        oppAvg: cat.derived === 'fg'
          ? (mcResult.sim_avg?.team2?.fga > 0 ? mcResult.sim_avg?.team2?.fgm / mcResult.sim_avg?.team2?.fga : 0)
          : cat.derived === 'ft'
          ? (mcResult.sim_avg?.team2?.fta > 0 ? mcResult.sim_avg?.team2?.ftm / mcResult.sim_avg?.team2?.fta : 0)
          : mcResult.sim_avg?.team2?.[bKey] ?? 0,
      };
    });
  }, [mcResult]);

  const mcMatchupWin = mcResult?.win_pcts?.matchup ?? null;

  // ── Render ─────────────────────────────────────────────
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
                onChange={e => { setOppTeamId(e.target.value); setAnalysisResult(null); setMcResult(null); }}
                aria-label="Select opponent team"
              >
                <option value="">— Select opponent —</option>
                {opponents.map(t => (
                  <option key={t.team_id} value={t.team_id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Week / Date controls */}
          <div className="matchup-controls">
            <label className="matchup-control-label">
              <span>Matchup Week</span>
              <input
                type="number"
                min="1"
                max="30"
                value={weekNum}
                onChange={e => setWeekNum(parseInt(e.target.value) || 1)}
                className="matchup-input"
                aria-label="Matchup week number"
              />
            </label>
            <label className="matchup-control-label">
              <span>Start Date</span>
              <input
                type="date"
                value={dateStart}
                onChange={e => setDateStart(e.target.value)}
                className="matchup-input"
                aria-label="Matchup start date"
              />
            </label>
            {oppTeam && (
              <button
                className="btn-secondary"
                onClick={fetchAnalysis}
                disabled={analysisLoading}
                style={{ alignSelf: 'flex-end' }}
              >
                {analysisLoading ? <><span className="spinner" /> Refreshing…</> : '🔄 Re-analyze'}
              </button>
            )}
          </div>

          {/* Analysis loading / error */}
          {analysisLoading && (
            <div className="analysis-loading">
              <span className="spinner" />
              <span>Analyzing matchup from backend…</span>
            </div>
          )}
          {analysisError && (
            <p className="input-error" role="alert" style={{ marginTop: '1rem' }}>
              ⚠️ {analysisError}
            </p>
          )}

          {/* Summary + Monte Carlo button */}
          {oppTeam && overallWin !== null && !analysisLoading && (
            <div className="matchup-summary">
              <div className="summary-pct" style={{ color: overallWin >= 0.5 ? 'var(--accent)' : '#e53935' }}>
                {Math.round(overallWin * 100)}%
              </div>
              <div className="summary-label">avg. category win probability</div>
              <button
                className="btn-primary"
                style={{ marginTop: '0.75rem' }}
                onClick={runMonteCarlo}
                disabled={mcLoading}
                id="run-monte-carlo-btn"
              >
                {mcLoading ? <><span className="spinner" /> Running…</> : '🎲 Run Monte Carlo (Backend)'}
              </button>
              {mcError && (
                <p className="input-error" role="alert" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                  ⚠️ {mcError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Monte Carlo Result */}
        {mcResult && mcMatchupWin !== null && (
          <div className="sim-result card fade-up">
            <h3 style={{ marginBottom: '1rem' }}>🎲 Monte Carlo Results</h3>

            {/* Overall matchup win rate */}
            <div className="mc-matchup-highlight">
              <div
                className="mc-matchup-pct"
                style={{ color: mcMatchupWin >= 0.5 ? 'var(--accent)' : '#e53935' }}
              >
                {Math.round(mcMatchupWin * 100)}%
              </div>
              <div className="mc-matchup-label">Overall Matchup Win Rate</div>
            </div>

            {/* Per-category MC win rates */}
            {mcCatData && (
              <div className="mc-cat-grid">
                {mcCatData.map(({ cat, winPct, myAvg, oppAvg }) => {
                  const color = winPct >= 0.6 ? 'var(--accent)'
                              : winPct >= 0.4 ? 'var(--text-secondary)'
                              : '#e53935';
                  return (
                    <div className="mc-cat-card" key={cat.key}>
                      <div className="mc-cat-label">{cat.key}</div>
                      <div className="mc-cat-pct" style={{ color }}>{formatPct(winPct)}</div>
                      <div className="mc-cat-bar">
                        <div className="mc-cat-bar-fill" style={{ width: `${winPct * 100}%`, background: color }} />
                      </div>
                      <div className="mc-cat-avgs">
                        <span>You: <strong>{formatMu(myAvg, cat.key)}</strong></span>
                        <span>Opp: <strong>{formatMu(oppAvg, cat.key)}</strong></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Category odds grid (from non-MC analysis) */}
        {odds && !analysisLoading && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem', fontWeight: 700 }}>Category Breakdown</h3>
            <div className="odds-grid">
              {odds.map(({ cat, myMu, oppMu, winProb }) => {
                const color = winProb >= 0.6 ? 'var(--accent)'
                            : winProb >= 0.4 ? 'var(--text-secondary)'
                            : '#e53935';
                return (
                  <div
                    className={`odds-card ${activeCatKey === cat.key ? 'active' : ''}`}
                    key={cat.key}
                    onClick={() => setActiveCatKey(cat.key)}
                  >
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

            {selectedCatData && (
              <MatchupDistributionChart
                category={selectedCatData.cat}
                my={{ mu: selectedCatData.myMu, sigma: selectedCatData.mySigma }}
                opp={{ mu: selectedCatData.oppMu, sigma: selectedCatData.oppSigma }}
                winProb={selectedCatData.winProb}
              />
            )}
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
