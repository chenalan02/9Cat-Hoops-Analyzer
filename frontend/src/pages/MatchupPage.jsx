import { useState, useMemo, useContext, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import { fetchMatchupProjection } from '../services/apiClient.js';
import { readSessionString, writeSessionString, todayLocalDateString } from '../services/storageCache.js';
import YahooRefreshButton from '../components/common/YahooRefreshButton.jsx';
import { LoadingView, EmptyState } from '../components/common/PageStateGuard.jsx';
import MatchupSelectorCard from '../components/matchup/MatchupSelectorCard.jsx';
import MatchupOutlookBanner from '../components/matchup/MatchupOutlookBanner.jsx';
import CategoryOddsGrid from '../components/matchup/CategoryOddsGrid.jsx';
import LiveScoreboardCard from '../components/matchup/LiveScoreboardCard.jsx';
import RosterGamesSection from '../components/matchup/RosterGamesSection.jsx';
import InactivePlayersSection from '../components/matchup/InactivePlayersSection.jsx';
import {
  MATCHUP_CACHE_STORAGE_KEY,
  MC_CACHE_STORAGE_KEY,
  MATCHUP_OPP_STORAGE_KEY,
  MATCHUP_WEEK_STORAGE_KEY,
  MATCHUP_TAB_STORAGE_KEY,
  MATCHUP_HAS_RUN_KEY,
  getMatchupCache,
  setMatchupCache,
  parseAnalysisResult,
  parseMonteCarloResult,
  computeMatchupWinStats,
} from '../utils/matchupHelpers.js';
import './MatchupPage.css';

const IR_SLOTS = new Set(['IL', 'IL+', 'IR', 'IR+', 'NA']);
const INJURY_STATUSES = new Set(['O', 'INJ', 'IL', 'IL+', 'OUT', 'GTD']);

export default function MatchupPage() {
  const { myTeam, selectMyTeam, leagueData, loading, refreshTeam } = useContext(TeamDataContext);
  const navigate = useNavigate();

  const opponents = useMemo(
    () => leagueData?.teams?.filter(t => t.team_id !== myTeam?.team_id) ?? [],
    [leagueData?.teams, myTeam?.team_id]
  );

  const scheduledOppId = useMemo(
    () => myTeam?.current_opponent_id || leagueData?.weekly_matchups?.[String(myTeam?.team_id)] || null,
    [myTeam, leagueData]
  );

  const [oppTeamId, setOppTeamId] = useState(() => {
    const saved = readSessionString(MATCHUP_OPP_STORAGE_KEY, '');
    if (saved && opponents.some(t => String(t.team_id) === String(saved))) {
      return saved;
    }
    return scheduledOppId ? String(scheduledOppId) : '';
  });

  const [activeCatKey, setActiveCatKey] = useState('PTS');
  const [showOverrides, setShowOverrides] = useState(false);

  const oppTeam = opponents.find(t => String(t.team_id) === String(oppTeamId)) ?? null;

  const prevMyTeamIdRef = useRef(myTeam?.team_id);
  useEffect(() => {
    const myTeamChanged = prevMyTeamIdRef.current !== myTeam?.team_id;
    prevMyTeamIdRef.current = myTeam?.team_id;

    if (myTeamChanged && scheduledOppId) {
      setOppTeamId(String(scheduledOppId));
      writeSessionString(MATCHUP_OPP_STORAGE_KEY, scheduledOppId);
    } else if (!oppTeamId) {
      const saved = readSessionString(MATCHUP_OPP_STORAGE_KEY, '');
      const targetId = saved || (scheduledOppId ? String(scheduledOppId) : (opponents[0] ? String(opponents[0].team_id) : ''));
      if (targetId) setOppTeamId(targetId);
    }
  }, [scheduledOppId, myTeam?.team_id, oppTeamId, opponents]);

  const [weekNum, setWeekNum] = useState(() => {
    const saved = readSessionString(MATCHUP_WEEK_STORAGE_KEY, '');
    if (saved) return parseInt(saved, 10) || leagueData?.week_num || 1;
    return leagueData?.week_num ?? 1;
  });
  const [dateStart, setDateStart] = useState(todayLocalDateString);

  useEffect(() => {
    if (leagueData?.week_num && !readSessionString(MATCHUP_WEEK_STORAGE_KEY, '')) {
      setWeekNum(leagueData.week_num);
    }
  }, [leagueData]);

  const [activeAnalysisTab, setActiveAnalysisTab] = useState(
    () => readSessionString(MATCHUP_TAB_STORAGE_KEY, 'analytical') || 'analytical'
  );

  const handleTabChange = useCallback((tab) => {
    setActiveAnalysisTab(tab);
    writeSessionString(MATCHUP_TAB_STORAGE_KEY, tab);
  }, []);

  const getCacheKey = useCallback((t1Id, t2Id, w, d) => {
    const lId = leagueData?.league_id || '';
    return `${lId}-${t1Id}-${t2Id}-${w}-${d}`;
  }, [leagueData?.league_id]);

  const [analysisResult, setAnalysisResult] = useState(() => {
    if (!myTeam || !oppTeamId) return null;
    const key = `${leagueData?.league_id || ''}-${myTeam.team_id}-${oppTeamId}-${weekNum}-${dateStart}`;
    return getMatchupCache(MATCHUP_CACHE_STORAGE_KEY, key);
  });
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);

  const [mcResult, setMcResult] = useState(() => {
    if (!myTeam || !oppTeamId) return null;
    const key = `${leagueData?.league_id || ''}-${myTeam.team_id}-${oppTeamId}-${weekNum}-${dateStart}`;
    return getMatchupCache(MC_CACHE_STORAGE_KEY, key);
  });
  const [mcLoading, setMcLoading] = useState(false);

  const hasAnalysisData = !analysisLoading && Boolean(analysisResult || mcResult);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  const buildRequestBody = useCallback((monteCarlo) => {
    if (!myTeam || !oppTeam || !leagueData) return null;
    return {
      team1: myTeam,
      team2: oppTeam,
      date_start: dateStart,
      roster_positions: leagueData.roster_positions ?? null,
      stats_source: 'weekly_stats',
      monte_carlo: monteCarlo,
    };
  }, [myTeam, oppTeam, leagueData, dateStart]);

  const fetchAnalysis = useCallback(async (forceRefresh = false) => {
    const body = buildRequestBody(false);
    if (!body) return;

    const cacheKey = getCacheKey(myTeam.team_id, oppTeam.team_id, weekNum, dateStart);
    const cachedAnalysis = getMatchupCache(MATCHUP_CACHE_STORAGE_KEY, cacheKey);
    const cachedMc = getMatchupCache(MC_CACHE_STORAGE_KEY, cacheKey);

    if (!forceRefresh && cachedAnalysis) {
      setAnalysisResult(cachedAnalysis);
      setMcResult(cachedMc ?? null);
      setAnalysisError(null);
      setAnalysisLoading(false);
      return;
    }

    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setAnalysisLoading(true);
    setAnalysisError(null);
    if (forceRefresh) {
      setAnalysisResult(null);
      setMcResult(null);
    }

    try {
      const data = await fetchMatchupProjection(leagueData.league_id, weekNum, body, controller.signal);
      setMatchupCache(MATCHUP_CACHE_STORAGE_KEY, cacheKey, data);
      setAnalysisResult(data);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setAnalysisError(err.message || 'Failed to fetch matchup analysis');
    } finally {
      if (abortControllerRef.current === controller) {
        setAnalysisLoading(false);
      }
    }
  }, [buildRequestBody, getCacheKey, leagueData?.league_id, myTeam?.team_id, oppTeam?.team_id, weekNum, dateStart]);

  useEffect(() => {
    if (oppTeam) fetchAnalysis(false);
  }, [oppTeam?.team_id, weekNum]); // eslint-disable-line react-hooks/exhaustive-deps

  const runMonteCarlo = useCallback(async (forceRefresh = false) => {
    handleTabChange('monte-carlo');
    const body = buildRequestBody(true);
    if (!body) return;

    const cacheKey = getCacheKey(myTeam.team_id, oppTeam.team_id, weekNum, dateStart);
    const cachedMc = getMatchupCache(MC_CACHE_STORAGE_KEY, cacheKey);
    if (!forceRefresh && cachedMc) {
      setMcResult(cachedMc);
      return;
    }

    setMcLoading(true);
    try {
      const data = await fetchMatchupProjection(leagueData.league_id, weekNum, body);
      setMatchupCache(MC_CACHE_STORAGE_KEY, cacheKey, data);
      setMcResult(data);
    } catch (err) {
      setAnalysisError(err.message || 'Failed to run Monte Carlo simulation');
    } finally {
      setMcLoading(false);
    }
  }, [buildRequestBody, getCacheKey, handleTabChange, leagueData?.league_id, myTeam?.team_id, oppTeam?.team_id, weekNum, dateStart]);

  useEffect(() => {
    if (hasAnalysisData && myTeam && oppTeam) {
      writeSessionString(MATCHUP_HAS_RUN_KEY, `${leagueData?.league_id || ''}-${myTeam.team_id}`);
    }
  }, [hasAnalysisData, leagueData?.league_id, myTeam, oppTeam]);

  const handleSelectMyTeam = (id) => {
    if (selectMyTeam) selectMyTeam(id);
    setAnalysisResult(null);
    setMcResult(null);
  };

  const handleSelectOpponent = (newId) => {
    setOppTeamId(newId);
    writeSessionString(MATCHUP_OPP_STORAGE_KEY, newId);
    if (myTeam) {
      const key = getCacheKey(myTeam.team_id, newId, weekNum, dateStart);
      setAnalysisResult(getMatchupCache(MATCHUP_CACHE_STORAGE_KEY, key));
      setMcResult(getMatchupCache(MC_CACHE_STORAGE_KEY, key));
    }
  };

  const handleSelectWeek = (w) => {
    setWeekNum(w);
    writeSessionString(MATCHUP_WEEK_STORAGE_KEY, w);
    if (myTeam && oppTeam) {
      const key = getCacheKey(myTeam.team_id, oppTeam.team_id, w, dateStart);
      setAnalysisResult(getMatchupCache(MATCHUP_CACHE_STORAGE_KEY, key));
      setMcResult(getMatchupCache(MC_CACHE_STORAGE_KEY, key));
    }
  };

  const odds = useMemo(() => (analysisResult ? parseAnalysisResult(analysisResult) : null), [analysisResult]);
  const selectedCatData = useMemo(() => (odds ? odds.find(o => o.cat.key === activeCatKey) ?? odds[0] : null), [odds, activeCatKey]);
  const matchupWinStats = useMemo(() => computeMatchupWinStats(odds), [odds]);

  const mcCatData = useMemo(() => parseMonteCarloResult(mcResult), [mcResult]);
  const selectedMcCatData = useMemo(
    () => (mcCatData ? mcCatData.find(o => o.cat.key === activeCatKey) ?? mcCatData[0] : null),
    [mcCatData, activeCatKey]
  );
  const mcMatchupWin = mcResult?.win_pcts?.matchup ?? null;

  const accumulatedStats = analysisResult?.accumulated_stats || mcResult?.accumulated_stats || null;
  const playerGames = analysisResult?.player_games || mcResult?.player_games || null;

  const inactivePlayers = useMemo(() => {
    const backendInactive = mcResult?.inactive_players || analysisResult?.inactive_players;

    const getRosterInactive = (team, backendList) => {
      if (!team?.players) return [];
      const list = [];
      const seen = new Set();

      if (backendList?.length) {
        for (const p of backendList) {
          const rosterMatch = team.players.find(rp => rp.name === p.name);
          const selPos = String(rosterMatch?.selected_position || '').toUpperCase().trim();
          const isIr = IR_SLOTS.has(selPos);
          list.push({
            ...p,
            status: isIr && p.status && !String(p.status).includes(selPos)
              ? `${p.status} (${selPos})`
              : (p.status || (isIr ? selPos : null)),
            proj_games_played: isIr ? 0 : (p.proj_games_played ?? 0),
          });
          seen.add(p.name);
        }
      }

      for (const p of team.players) {
        if (seen.has(p.name)) continue;
        const selPos = String(p.selected_position || '').toUpperCase().trim();
        const isIr = IR_SLOTS.has(selPos);
        const isInjured = isIr || (p.status && INJURY_STATUSES.has(String(p.status).toUpperCase()));
        if (isInjured) {
          list.push({
            name: p.name,
            status: isIr && p.status ? `${p.status} (${selPos})` : (p.status || (isIr ? selPos : null)),
            proj_games_played: isIr ? 0 : (playerGames?.[team.team_id === myTeam?.team_id ? 'team1' : 'team2']?.[p.name]?.total ?? 0),
          });
          seen.add(p.name);
        }
      }
      return list;
    };

    return {
      team1: getRosterInactive(myTeam, backendInactive?.team1),
      team2: getRosterInactive(oppTeam, backendInactive?.team2),
    };
  }, [myTeam, oppTeam, mcResult, analysisResult, playerGames]);

  if (loading) {
    return <LoadingView message="Loading your team…" />;
  }

  if (!myTeam) {
    return (
      <EmptyState
        icon="⚔️"
        title="No Team Data"
        description="Analyze your team first to see matchup odds."
        actionLabel="Analyze My Team"
        onAction={() => navigate('/')}
      />
    );
  }

  return (
    <div className="matchup-page page-wrapper fade-up">
      <div className="section">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <h1 className="section-title" style={{ textAlign: 'left', margin: 0 }}>⚔️ Matchup Analyzer</h1>
            <p className="section-subtitle" style={{ textAlign: 'left', margin: '4px 0 0' }}>
              Category-by-category win probabilities vs. any opponent
            </p>
          </div>
          <YahooRefreshButton
            loading={loading}
            onRefresh={refreshTeam}
            title="Reload latest team and league data from Yahoo Fantasy"
          />
        </div>

        <MatchupSelectorCard
          leagueData={leagueData}
          myTeam={myTeam}
          opponents={opponents}
          oppTeam={oppTeam}
          oppTeamId={oppTeamId}
          scheduledOppId={scheduledOppId}
          weekNum={weekNum}
          dateStart={dateStart}
          showOverrides={showOverrides}
          setShowOverrides={setShowOverrides}
          analysisLoading={analysisLoading}
          analysisError={analysisError}
          mcLoading={mcLoading}
          onSelectMyTeam={handleSelectMyTeam}
          onSelectOpponent={handleSelectOpponent}
          onSelectWeek={handleSelectWeek}
          onOverrideWeek={setWeekNum}
          onOverrideDate={setDateStart}
          onAnalyze={() => fetchAnalysis(true)}
          onRunMonteCarlo={() => runMonteCarlo(false)}
          onOpenStreamers={() => navigate('/streamers')}
        />

        {oppTeam && matchupWinStats && hasAnalysisData && (
          <MatchupOutlookBanner
            weekNum={weekNum}
            matchupWinStats={matchupWinStats}
            mcMatchupWin={mcMatchupWin}
            mcLoading={mcLoading}
            onSelectMonteCarloTab={() => handleTabChange('monte-carlo')}
            onRunMonteCarlo={() => runMonteCarlo(false)}
          />
        )}

        {odds && hasAnalysisData && (
          <div className="projections-container" style={{ marginTop: '1.5rem', marginBottom: '2rem' }}>
            <div className="projections-tab-bar">
              <div className="projections-tabs">
                <button
                  type="button"
                  className={`projections-tab-btn ${activeAnalysisTab !== 'monte-carlo' ? 'active' : ''}`}
                  onClick={() => handleTabChange('analytical')}
                >
                  <span className="tab-icon">📊</span>
                  <span>Analytical Projections</span>
                </button>
                <button
                  type="button"
                  className={`projections-tab-btn ${activeAnalysisTab === 'monte-carlo' ? 'active' : ''}`}
                  onClick={() => handleTabChange('monte-carlo')}
                >
                  <span className="tab-icon">🎲</span>
                  <span>Monte Carlo Simulation</span>
                  {mcResult && mcMatchupWin !== null ? (
                    <span className="projections-tab-badge success">
                      {Math.round(mcMatchupWin * 100)}% Win Prob
                    </span>
                  ) : mcLoading ? (
                    <span className="projections-tab-badge loading">Simulating…</span>
                  ) : null}
                </button>
              </div>
            </div>

            {activeAnalysisTab !== 'monte-carlo' && (
              <div className="tab-pane fade-in">
                <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Click any category card on the left to inspect its head-to-head probability distribution on the right
                  </span>
                </div>

                {selectedCatData && (
                  <CategoryOddsGrid
                    rows={odds}
                    activeCatKey={activeCatKey}
                    onSelectCategory={setActiveCatKey}
                    winChanceLabel="Win Chance"
                    marginLabel="Margin:"
                    selectedCatData={selectedCatData}
                    chartMy={{ mu: selectedCatData.myMu, sigma: selectedCatData.mySigma }}
                    chartOpp={{ mu: selectedCatData.oppMu, sigma: selectedCatData.oppSigma }}
                    chartWinProb={selectedCatData.winProb}
                  />
                )}
              </div>
            )}

            {activeAnalysisTab === 'monte-carlo' && (
              <div className="tab-pane fade-in">
                {mcLoading ? (
                  <div className="card mc-loading-state" style={{ textAlign: 'center', padding: '3.5rem 1.5rem' }}>
                    <div className="spinner large" style={{ width: '40px', height: '40px', borderWidth: '3px', margin: '0 auto 1.25rem' }} />
                    <h3 style={{ margin: '0 0 0.5rem', fontWeight: 700 }}>Simulating 10,000 Matchup Weeks…</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', maxWidth: '520px', margin: '0 auto' }}>
                      Randomly sampling nightly counting stats (NegBinomial/Poisson) and shooting splits (Beta-Binomial) across all daily lineup configurations.
                    </p>
                  </div>
                ) : mcResult && mcMatchupWin !== null ? (
                  <div>
                    <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        10,000 randomized trials of nightly counting stats (NegBinomial/Poisson) &amp; shooting splits (Beta-Binomial) across daily optimal lineups
                      </span>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: mcMatchupWin >= 0.5 ? 'var(--accent)' : '#f87171' }}>
                        Simulated Matchup Win: {Math.round(mcMatchupWin * 100)}%
                      </span>
                    </div>

                    {mcCatData && selectedCatData && (
                      <CategoryOddsGrid
                        rows={mcCatData}
                        activeCatKey={activeCatKey}
                        onSelectCategory={setActiveCatKey}
                        winChanceLabel="Sim Win Chance"
                        marginLabel="Sim Margin:"
                        selectedCatData={selectedCatData}
                        chartMy={{ mu: selectedMcCatData?.myMu ?? selectedCatData.myMu, sigma: selectedCatData.mySigma }}
                        chartOpp={{ mu: selectedMcCatData?.oppMu ?? selectedCatData.oppMu, sigma: selectedCatData.oppSigma }}
                        chartWinProb={selectedMcCatData?.winProb ?? selectedCatData.winProb}
                      />
                    )}
                  </div>
                ) : (
                  <div className="card mc-empty-cta" style={{ textAlign: 'center', padding: '3.5rem 1.5rem' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🎲</div>
                    <h3 style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '1.3rem' }}>
                      Run 10,000-Trial Monte Carlo Simulation
                    </h3>
                    <p style={{ color: 'var(--text-secondary)', maxWidth: '540px', margin: '0 auto 1.5rem', fontSize: '0.9rem', lineHeight: '1.5' }}>
                      Simulate 10,000 full matchup weeks using Negative Binomial, Poisson, and Beta-Binomial models to account for nightly lineup volatility and blowout probability.
                    </p>
                    <button
                      className="btn-monte-carlo"
                      style={{ padding: '10px 24px', fontSize: '0.95rem' }}
                      onClick={() => runMonteCarlo(false)}
                      disabled={mcLoading}
                    >
                      🎲 Start 10,000 Simulations
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {oppTeam && hasAnalysisData && accumulatedStats && (
          <LiveScoreboardCard
            accumulatedStats={accumulatedStats}
            weekNum={weekNum}
            myTeam={myTeam}
            oppTeam={oppTeam}
          />
        )}

        {oppTeam && hasAnalysisData && playerGames && (
          <RosterGamesSection
            myTeam={myTeam}
            oppTeam={oppTeam}
            playerGames={playerGames}
          />
        )}

        {oppTeam && hasAnalysisData && inactivePlayers && (
          <InactivePlayersSection
            myTeamName={myTeam.name}
            oppTeamName={oppTeam.name}
            inactivePlayers={inactivePlayers}
          />
        )}

        {!oppTeam && (
          <div className="select-prompt">
            <span>👆 Select an opponent above to see matchup odds</span>
          </div>
        )}

        {oppTeam && !hasAnalysisData && !analysisLoading && !analysisError && (
          <div className="select-prompt">
            <span>⏳ Select a matchup week or click Re-analyze to begin analysis</span>
          </div>
        )}
      </div>
    </div>
  );
}
