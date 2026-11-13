import { useState, useMemo, useContext, useEffect, useCallback, useRef } from 'react';
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

// ─── Matchup Persistent Cache Keys & In-Memory Store ──────────────
const MATCHUP_CACHE_STORAGE_KEY  = '9cat_matchup_analysis_cache';
const MC_CACHE_STORAGE_KEY       = '9cat_matchup_mc_cache';
const STREAMER_CACHE_STORAGE_KEY = '9cat_matchup_streamer_cache';
const MATCHUP_OPP_STORAGE_KEY    = '9cat_matchup_selected_opp';
const MATCHUP_WEEK_STORAGE_KEY   = '9cat_matchup_selected_week';
const MATCHUP_TAB_STORAGE_KEY    = '9cat_matchup_active_tab';

// Module-level caches survive page navigation across unmounts in the session
const memoryAnalysisCache = {};
const memoryMcCache = {};
const memoryStreamerCache = {};

function getCachedAnalysis(key) {
  if (!key) return null;
  if (memoryAnalysisCache[key]) return memoryAnalysisCache[key];
  try {
    const raw = sessionStorage.getItem(MATCHUP_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed[key]) {
      memoryAnalysisCache[key] = parsed[key];
      return parsed[key];
    }
  } catch (err) {
    console.warn('Failed reading analysis cache:', err);
  }
  return null;
}

function setCachedAnalysis(key, data) {
  if (!key || !data) return;
  memoryAnalysisCache[key] = data;
  try {
    const raw = sessionStorage.getItem(MATCHUP_CACHE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[key] = data;
    const keys = Object.keys(parsed);
    if (keys.length > 25) delete parsed[keys[0]];
    sessionStorage.setItem(MATCHUP_CACHE_STORAGE_KEY, JSON.stringify(parsed));
  } catch (err) {
    console.warn('Failed saving analysis cache:', err);
  }
}

function getCachedMc(key) {
  if (!key) return null;
  if (memoryMcCache[key]) return memoryMcCache[key];
  try {
    const raw = sessionStorage.getItem(MC_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed[key]) {
      memoryMcCache[key] = parsed[key];
      return parsed[key];
    }
  } catch (err) {
    console.warn('Failed reading MC cache:', err);
  }
  return null;
}

function setCachedMc(key, data) {
  if (!key || !data) return;
  memoryMcCache[key] = data;
  try {
    const raw = sessionStorage.getItem(MC_CACHE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[key] = data;
    const keys = Object.keys(parsed);
    if (keys.length > 25) delete parsed[keys[0]];
    sessionStorage.setItem(MC_CACHE_STORAGE_KEY, JSON.stringify(parsed));
  } catch (err) {
    console.warn('Failed saving MC cache:', err);
  }
}

function getCachedStreamers(key) {
  if (!key) return null;
  if (memoryStreamerCache[key]) return memoryStreamerCache[key];
  try {
    const raw = sessionStorage.getItem(STREAMER_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed[key]) {
      memoryStreamerCache[key] = parsed[key];
      return parsed[key];
    }
  } catch (err) {
    console.warn('Failed reading streamer cache:', err);
  }
  return null;
}

function setCachedStreamers(key, data) {
  if (!key || !data) return;
  memoryStreamerCache[key] = data;
  try {
    const raw = sessionStorage.getItem(STREAMER_CACHE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[key] = data;
    const keys = Object.keys(parsed);
    if (keys.length > 25) delete parsed[keys[0]];
    sessionStorage.setItem(STREAMER_CACHE_STORAGE_KEY, JSON.stringify(parsed));
  } catch (err) {
    console.warn('Failed saving streamer cache:', err);
  }
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

/**
 * Calculates Poisson-Binomial distribution of winning K categories out of 9,
 * given the array of individual category win probabilities.
 * In a standard 9-cat head-to-head matchup, winning 5 or more categories wins the week!
 */
function computeMatchupWinStats(oddsList) {
  if (!oddsList || oddsList.length === 0) {
    return {
      matchupWinProb: 0,
      expectedMyScore: '0.0',
      expectedOppScore: '0.0',
      favoredCatsCount: 0,
      tossupCatsCount: 0,
    };
  }

  // Dynamic programming: dp[k] is the probability of winning exactly k categories
  let dp = [1.0];
  let expectedWins = 0;
  let favoredCount = 0;
  let tossupCount = 0;

  for (const o of oddsList) {
    const p = Math.max(0, Math.min(1, o.winProb));
    expectedWins += p;
    if (p >= 0.55) favoredCount++;
    else if (p >= 0.45) tossupCount++;

    const nextDp = new Array(dp.length + 1).fill(0);
    for (let k = 0; k < dp.length; k++) {
      nextDp[k] += dp[k] * (1 - p);
      nextDp[k + 1] += dp[k] * p;
    }
    dp = nextDp;
  }

  // In 9 categories, winning 5 or more categories is a matchup win
  const winThreshold = Math.ceil((oddsList.length + 1) / 2);
  let winProb = 0;
  for (let k = winThreshold; k < dp.length; k++) {
    winProb += dp[k] || 0;
  }

  return {
    matchupWinProb: winProb,
    expectedWins,
    projectedMyScore: expectedWins.toFixed(1),
    projectedOppScore: (oddsList.length - expectedWins).toFixed(1),
    favoredCatsCount: favoredCount,
    tossupCatsCount: tossupCount,
  };
}

/**
 * Calculates the exact lead/deficit margin and magnitude intensity
 * for a category in the Live Matchup Scoreboard.
 */
function getCategoryMagnitude(catKey, isPct, t1Val, t2Val, leader) {
  const n1 = typeof t1Val === 'number' ? t1Val : parseFloat(t1Val) || 0;
  const n2 = typeof t2Val === 'number' ? t2Val : parseFloat(t2Val) || 0;

  if (leader === 'tie' || n1 === n2) {
    return {
      text: 'Tied',
      subText: 'Even (0)',
      pillClass: 'live-margin-tied',
      intensity: 'neutral',
      diffStr: '0',
    };
  }

  const isWinning = leader === 'team1';
  const pillClass = isWinning ? 'live-margin-winning' : 'live-margin-trailing';

  if (isPct) {
    const diffPct = Math.abs(n1 - n2) * 100;
    const diffStr = `${diffPct.toFixed(1)}%`;
    const text = isWinning ? `+${diffStr}` : `-${diffStr}`;
    const intensity = diffPct >= 3.0 ? 'decisive' : diffPct <= 1.0 ? 'close' : 'solid';
    const subText = intensity === 'decisive' ? '★ Commanding' : intensity === 'close' ? '⚡ Tight Battle' : 'Solid Margin';
    return { text, subText, pillClass, intensity, diffStr, isWinning };
  } else if (catKey === 'tov') {
    // Turnovers: lower is better!
    const diff = Math.round(Math.abs(n1 - n2));
    const text = isWinning ? `-${diff} TO` : `+${diff} TO`;
    const intensity = diff >= 8 ? 'decisive' : diff <= 2 ? 'close' : 'solid';
    const subText = intensity === 'decisive' ? '★ Commanding' : intensity === 'close' ? '⚡ Tight Battle' : 'Solid Margin';
    return { text, subText, pillClass, intensity, diffStr: `${diff} TO`, isWinning };
  } else {
    const diff = Math.round(Math.abs(n1 - n2));
    const catUnit = catKey.toUpperCase();
    const text = isWinning ? `+${diff} ${catUnit}` : `-${diff} ${catUnit}`;
    let thresh = 6;
    if (catKey === 'pts') thresh = 30;
    else if (catKey === 'reb' || catKey === 'ast') thresh = 12;
    else if (catKey === '3pm' || catKey === 'fg3m') thresh = 6;
    else if (catKey === 'stl' || catKey === 'blk') thresh = 4;

    const intensity = diff >= thresh ? 'decisive' : diff <= Math.max(1, Math.floor(thresh / 4)) ? 'close' : 'solid';
    const subText = intensity === 'decisive' ? '★ Commanding' : intensity === 'close' ? '⚡ Tight Battle' : 'Solid Margin';
    return { text, subText, pillClass, intensity, diffStr: `${diff} ${catUnit}`, isWinning };
  }
}

export default function MatchupPage() {
  const { myTeam, selectMyTeam, leagueData, loading, refreshTeam } = useContext(TeamDataContext);
  const navigate = useNavigate();
  const [justRefreshed, setJustRefreshed] = useState(false);

  const handleRefresh = async () => {
    if (loading || !refreshTeam) return;
    try {
      await refreshTeam();
      setJustRefreshed(true);
      setTimeout(() => setJustRefreshed(false), 2500);
    } catch (err) {
      console.error('Refresh failed:', err);
    }
  };

  // ── Opponent selection & Auto-detection ───────────────
  const scheduledOppId = useMemo(() => {
    return myTeam?.current_opponent_id || leagueData?.weekly_matchups?.[String(myTeam?.team_id)] || null;
  }, [myTeam, leagueData]);

  const [oppTeamId, setOppTeamId] = useState(() => {
    try {
      const saved = sessionStorage.getItem(MATCHUP_OPP_STORAGE_KEY);
      if (saved && opponents.some(t => String(t.team_id) === String(saved))) {
        return saved;
      }
    } catch {}
    return scheduledOppId ? String(scheduledOppId) : '';
  });
  const [activeCatKey, setActiveCatKey] = useState('PTS');
  const [showOverrides, setShowOverrides] = useState(false);

  const opponents = leagueData?.teams?.filter(t => t.team_id !== myTeam?.team_id) ?? [];
  const oppTeam   = opponents.find(t => String(t.team_id) === String(oppTeamId)) ?? null;

  // Auto-select scheduled opponent when myTeam changes or if not yet set
  const prevMyTeamIdRef = useRef(myTeam?.team_id);
  useEffect(() => {
    const myTeamChanged = prevMyTeamIdRef.current !== myTeam?.team_id;
    prevMyTeamIdRef.current = myTeam?.team_id;

    if (myTeamChanged && scheduledOppId) {
      setOppTeamId(String(scheduledOppId));
      try { sessionStorage.setItem(MATCHUP_OPP_STORAGE_KEY, String(scheduledOppId)); } catch {}
    } else if (!oppTeamId) {
      const saved = sessionStorage.getItem(MATCHUP_OPP_STORAGE_KEY);
      const targetId = saved || (scheduledOppId ? String(scheduledOppId) : (opponents[0] ? String(opponents[0].team_id) : ''));
      if (targetId) setOppTeamId(targetId);
    }
  }, [scheduledOppId, myTeam?.team_id, oppTeamId, opponents]);

  // ── Week / date controls ───────────────────────────────
  const [weekNum, setWeekNum] = useState(() => {
    try {
      const saved = sessionStorage.getItem(MATCHUP_WEEK_STORAGE_KEY);
      if (saved) return parseInt(saved) || leagueData?.week_num || 1;
    } catch {}
    return leagueData?.week_num ?? 1;
  });
  const [dateStart, setDateStart] = useState(todayString);

  // Sync weekNum when leagueData loads if not manually set
  useEffect(() => {
    if (leagueData?.week_num && !sessionStorage.getItem(MATCHUP_WEEK_STORAGE_KEY)) {
      setWeekNum(leagueData.week_num);
    }
  }, [leagueData]);

  const handleWeekChange = useCallback((w) => {
    setWeekNum(w);
    try { sessionStorage.setItem(MATCHUP_WEEK_STORAGE_KEY, String(w)); } catch {}
  }, []);

  const handleOpponentChange = useCallback((id) => {
    setOppTeamId(id);
    try { sessionStorage.setItem(MATCHUP_OPP_STORAGE_KEY, String(id)); } catch {}
  }, []);

  // ── Tab state for Projections vs Monte Carlo ────────────
  const [activeAnalysisTab, setActiveAnalysisTab] = useState(() => {
    try {
      return sessionStorage.getItem(MATCHUP_TAB_STORAGE_KEY) || 'analytical';
    } catch {
      return 'analytical';
    }
  });

  const handleTabChange = useCallback((tab) => {
    setActiveAnalysisTab(tab);
    try { sessionStorage.setItem(MATCHUP_TAB_STORAGE_KEY, tab); } catch {}
  }, []);

  // Cache key helper
  const getCacheKey = useCallback((t1Id, t2Id, w, d) => {
    const lId = leagueData?.league_id || '';
    return `${lId}-${t1Id}-${t2Id}-${w}-${d}`;
  }, [leagueData?.league_id]);

  // ── Analysis state (non-Monte Carlo) ───────────────────
  const [analysisResult, setAnalysisResult] = useState(() => {
    if (!myTeam || !oppTeamId) return null;
    const key = `${leagueData?.league_id || ''}-${myTeam.team_id}-${oppTeamId}-${weekNum}-${dateStart}`;
    return getCachedAnalysis(key);
  });
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError]     = useState(null);

  // ── Monte Carlo state ──────────────────────────────────
  const [mcResult, setMcResult] = useState(() => {
    if (!myTeam || !oppTeamId) return null;
    const key = `${leagueData?.league_id || ''}-${myTeam.team_id}-${oppTeamId}-${weekNum}-${dateStart}`;
    return getCachedMc(key);
  });
  const [mcLoading, setMcLoading]     = useState(false);
  const [mcError, setMcError]         = useState(null);

  const hasAnalysisData = !analysisLoading && Boolean(analysisResult || mcResult);

  const abortControllerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

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
  const fetchAnalysis = useCallback(async (forceRefresh = false) => {
    const body = buildRequestBody(false);
    if (!body) return;

    const cacheKey = getCacheKey(myTeam.team_id, oppTeam.team_id, weekNum, dateStart);

    const cachedAnalysis = getCachedAnalysis(cacheKey);
    const cachedMc       = getCachedMc(cacheKey);

    // Return cached analytical result instantly if available
    if (!forceRefresh && cachedAnalysis) {
      setAnalysisResult(cachedAnalysis);
      setMcResult(cachedMc ?? null);
      setAnalysisError(null);
      setAnalysisLoading(false);
      return;
    }

    // Cancel any previous in-flight request to avoid stacking
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setAnalysisLoading(true);
    setAnalysisError(null);
    if (forceRefresh) {
      setAnalysisResult(null);
      setMcResult(null);
    }

    try {
      const res = await fetch('/api/matchup-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setCachedAnalysis(cacheKey, data.payload);
      setAnalysisResult(data.payload);
    } catch (err) {
      if (err.name === 'AbortError') return; // Ignore aborted requests
      console.error('Matchup analysis failed:', err);
      setAnalysisError(err.message || 'Failed to fetch matchup analysis');
    } finally {
      if (abortControllerRef.current === controller) {
        setAnalysisLoading(false);
      }
    }
  }, [buildRequestBody, getCacheKey, myTeam?.team_id, oppTeam?.team_id, weekNum, dateStart]);

  // Auto-fetch when opponent selection changes
  useEffect(() => {
    if (oppTeam) fetchAnalysis(false);
  }, [oppTeam?.team_id, weekNum]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Run Monte Carlo ────────────────────────────────────
  const runMonteCarlo = useCallback(async (forceRefresh = false) => {
    handleTabChange('monte-carlo');
    const body = buildRequestBody(true);
    if (!body) return;

    const cacheKey = getCacheKey(myTeam.team_id, oppTeam.team_id, weekNum, dateStart);

    const cachedMc = getCachedMc(cacheKey);
    if (!forceRefresh && cachedMc) {
      setMcResult(cachedMc);
      setMcError(null);
      return;
    }

    setMcLoading(true);
    setMcError(null);

    try {
      const res = await fetch('/api/matchup-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setCachedMc(cacheKey, data.payload);
      setMcResult(data.payload);
    } catch (err) {
      console.error('Monte Carlo failed:', err);
      setMcError(err.message || 'Failed to run Monte Carlo simulation');
    } finally {
      setMcLoading(false);
    }
  }, [buildRequestBody, getCacheKey, handleTabChange, myTeam?.team_id, oppTeam?.team_id, weekNum, dateStart]);

  // Mark in sessionStorage that Matchup Analyzer has been run for this team
  useEffect(() => {
    if (hasAnalysisData && myTeam && oppTeam) {
      try {
        sessionStorage.setItem('9cat_matchup_has_run', `${leagueData?.league_id || ''}-${myTeam.team_id}`);
      } catch {}
    }
  }, [hasAnalysisData, leagueData?.league_id, myTeam, oppTeam]);

  // ── Derived data from analysis result ──────────────────
  const odds = useMemo(() => {
    if (analysisResult) {
      return parseAnalysisResult(analysisResult);
    }
    return null;
  }, [analysisResult]);

  const selectedCatData = useMemo(() => {
    if (!odds) return null;
    return odds.find(o => o.cat.key === activeCatKey) ?? odds[0];
  }, [odds, activeCatKey]);

  const matchupWinStats = useMemo(() => {
    return computeMatchupWinStats(odds);
  }, [odds]);

  // ── Monte Carlo per-category data ──────────────────────
  const mcCatData = useMemo(() => {
    if (!mcResult?.win_pcts) return null;
    return CATEGORIES.map(cat => {
      const bKey = FRONTEND_TO_BACKEND[cat.key];
      const winProb = mcResult.win_pcts[bKey] ?? 0;
      const myMu = cat.derived === 'fg'
        ? (mcResult.sim_avg?.team1?.fga > 0 ? mcResult.sim_avg?.team1?.fgm / mcResult.sim_avg?.team1?.fga : 0)
        : cat.derived === 'ft'
        ? (mcResult.sim_avg?.team1?.fta > 0 ? mcResult.sim_avg?.team1?.ftm / mcResult.sim_avg?.team1?.fta : 0)
        : mcResult.sim_avg?.team1?.[bKey] ?? 0;
      const oppMu = cat.derived === 'fg'
        ? (mcResult.sim_avg?.team2?.fga > 0 ? mcResult.sim_avg?.team2?.fgm / mcResult.sim_avg?.team2?.fga : 0)
        : cat.derived === 'ft'
        ? (mcResult.sim_avg?.team2?.fta > 0 ? mcResult.sim_avg?.team2?.ftm / mcResult.sim_avg?.team2?.fta : 0)
        : mcResult.sim_avg?.team2?.[bKey] ?? 0;
      return {
        cat,
        winProb,
        winPct: winProb,
        myMu,
        myAvg: myMu,
        oppMu,
        oppAvg: oppMu,
      };
    });
  }, [mcResult]);

  const selectedMcCatData = useMemo(() => {
    if (!mcCatData) return null;
    return mcCatData.find(o => o.cat.key === activeCatKey) ?? mcCatData[0];
  }, [mcCatData, activeCatKey]);

  const mcMatchupWin = mcResult?.win_pcts?.matchup ?? null;

  const accumulatedStats = useMemo(() => {
    if (analysisResult?.accumulated_stats) return analysisResult.accumulated_stats;
    if (mcResult?.accumulated_stats) return mcResult.accumulated_stats;
    return null;
  }, [analysisResult, mcResult]);

  const playerGames = useMemo(() => {
    if (analysisResult?.player_games) return analysisResult.player_games;
    if (mcResult?.player_games) return mcResult.player_games;
    return null;
  }, [analysisResult, mcResult]);

  const inactivePlayers = useMemo(() => {
    const backendInactive = mcResult?.inactive_players || analysisResult?.inactive_players;
    const irSlots = new Set(['IL', 'IL+', 'IR', 'IR+', 'NA']);

    const getRosterInactive = (team, backendList) => {
      if (!team?.players) return [];
      const list = [];
      const seen = new Set();

      if (backendList && backendList.length > 0) {
        for (const p of backendList) {
          const rosterMatch = team.players.find(rp => rp.name === p.name);
          const selPos = String(rosterMatch?.selected_position || '').toUpperCase().trim();
          const isIr = irSlots.has(selPos);
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
        if (!seen.has(p.name)) {
          const selPos = String(p.selected_position || '').toUpperCase().trim();
          const isIr = irSlots.has(selPos);
          const isInjured = isIr || Boolean(p.status && ['O', 'INJ', 'IL', 'IL+', 'OUT', 'GTD'].includes(String(p.status).toUpperCase()));
          if (isInjured) {
            list.push({
              name: p.name,
              status: isIr && p.status ? `${p.status} (${selPos})` : (p.status || (isIr ? selPos : null)),
              proj_games_played: isIr ? 0 : (playerGames?.[team.team_id === myTeam?.team_id ? 'team1' : 'team2']?.[p.name]?.total ?? 0),
            });
            seen.add(p.name);
          }
        }
      }
      return list;
    };

    return {
      team1: getRosterInactive(myTeam, backendInactive?.team1),
      team2: getRosterInactive(oppTeam, backendInactive?.team2),
    };
  }, [myTeam, oppTeam, mcResult, analysisResult, playerGames]);

  // ── Render ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="page-wrapper center-content">
        <div className="spinner" style={{ width: 36, height: 36 }} />
        <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>Loading your team…</p>
      </div>
    );
  }

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
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <h1 className="section-title" style={{ textAlign: 'left', margin: 0 }}>⚔️ Matchup Analyzer</h1>
            <p className="section-subtitle" style={{ textAlign: 'left', margin: '4px 0 0' }}>
              Category-by-category win probabilities vs. any opponent
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary refresh-btn"
            onClick={handleRefresh}
            disabled={loading}
            title="Reload latest team and league data from Yahoo Fantasy"
          >
            <span className={`refresh-icon ${loading ? 'spinning' : ''}`}>🔄</span>
            <span>{loading ? 'Reloading…' : justRefreshed ? 'Updated!' : 'Reload from Yahoo'}</span>
          </button>
        </div>

        {/* Matchup team selectors */}
        <div className="matchup-selector card">
          <div className="matchup-vs">
            <div className="vs-team">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="badge badge-green">You</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(Your Team)</span>
              </div>
              <select
                className="opp-select"
                value={myTeam?.team_id ?? ''}
                onChange={e => {
                  const id = parseInt(e.target.value);
                  if (selectMyTeam) selectMyTeam(id);
                  setAnalysisResult(null);
                  setMcResult(null);
                }}
                aria-label="Select your team"
              >
                {leagueData?.teams?.map(t => (
                  <option key={t.team_id} value={t.team_id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="vs-divider">VS</span>
            <div className="vs-team">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="badge badge-orange">Opponent</span>
                {oppTeam && String(oppTeam.team_id) === String(scheduledOppId) && (
                  <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>⚔️ Scheduled Matchup</span>
                )}
              </div>
              <select
                className="opp-select"
                value={oppTeamId}
                onChange={e => {
                  const newId = e.target.value;
                  handleOpponentChange(newId);
                  if (myTeam) {
                    const key = getCacheKey(myTeam.team_id, newId, weekNum, dateStart);
                    const cached = getCachedAnalysis(key);
                    const cachedMc = getCachedMc(key);
                    setAnalysisResult(cached || null);
                    setMcResult(cachedMc || null);
                  }
                }}
                aria-label="Select opponent team"
              >
                <option value="">— Select opponent —</option>
                {opponents.map(t => (
                  <option key={t.team_id} value={t.team_id}>
                    {t.name}{String(t.team_id) === String(scheduledOppId) ? " (This Week's Matchup ⚔️)" : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Week & Action controls */}
          <div className="matchup-controls" style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                  Matchup Week
                </span>
                <select
                  className="matchup-input week-select"
                  value={weekNum}
                  onChange={e => {
                    const w = parseInt(e.target.value) || 1;
                    handleWeekChange(w);
                    if (myTeam && oppTeam) {
                      const key = getCacheKey(myTeam.team_id, oppTeam.team_id, w, dateStart);
                      const cached = getCachedAnalysis(key);
                      const cachedMc = getCachedMc(key);
                      setAnalysisResult(cached || null);
                      setMcResult(cachedMc || null);
                    }
                  }}
                  style={{ width: 'auto', minWidth: '130px', padding: '8px 12px', fontWeight: 700, fontSize: '0.92rem' }}
                  aria-label="Select matchup week number"
                >
                  {Array.from({ length: 24 }, (_, i) => i + 1).map(w => (
                    <option key={w} value={w}>
                      Week {w}{w === (leagueData?.week_num ?? 1) ? ' (Current)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
              <button
                className="btn-secondary"
                onClick={() => setShowOverrides(!showOverrides)}
                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
              >
                {showOverrides ? '⚙️ Hide Options' : '⚙️ Advanced Options'}
              </button>

              {oppTeam && (
                <>
                  <button
                    className="btn-primary"
                    onClick={() => fetchAnalysis(true)}
                    disabled={analysisLoading}
                    style={{ padding: '8px 18px', fontSize: '0.85rem' }}
                  >
                    {analysisLoading ? <><span className="spinner" /> Refreshing…</> : '🔄 Re-analyze'}
                  </button>

                  <button
                    className="btn-monte-carlo"
                    onClick={runMonteCarlo}
                    disabled={mcLoading}
                    id="run-monte-carlo-btn"
                  >
                    {mcLoading ? <><span className="spinner" /> Running 10k…</> : '🎲 Run Monte Carlo'}
                  </button>

                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => navigate('/streamers')}
                    style={{ padding: '8px 16px', fontSize: '0.85rem', border: '1px solid var(--border)' }}
                    title="View automated streamer recommendations for this matchup"
                  >
                    🎯 Streamer Suggestions →
                  </button>
                </>
              )}
            </div>
          </div>

          {showOverrides && (
            <div className="card fade-up" style={{ marginTop: '1.5rem', padding: '1.5rem', background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--border)' }}>
              <h4 style={{ fontSize: '0.9rem', marginBottom: '1rem', color: 'var(--accent)', marginTop: 0 }}>⚙️ Advanced Simulation Overrides</h4>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                <label className="matchup-control-label" style={{ flex: 1, minWidth: '150px' }}>
                  <span>Matchup Week Number</span>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={weekNum}
                    onChange={e => setWeekNum(parseInt(e.target.value) || 1)}
                    className="matchup-input"
                    aria-label="Override matchup week number"
                  />
                </label>
                <label className="matchup-control-label" style={{ flex: 1, minWidth: '150px' }}>
                  <span>Simulation Start Date</span>
                  <input
                    type="date"
                    value={dateStart}
                    onChange={e => setDateStart(e.target.value)}
                    className="matchup-input"
                    aria-label="Override matchup start date"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Analysis loading / error */}
          {analysisLoading && (
            <div className="analysis-loading" style={{ marginTop: '1.5rem', padding: '2.5rem', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius)', border: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
              <span className="spinner" style={{ width: '32px', height: '32px', borderWidth: '3px' }} />
              <div style={{ fontWeight: 600, fontSize: '0.98rem', color: 'var(--text-primary)' }}>
                Analyzing Matchup &amp; Solving Lineups…
              </div>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Processing weekly schedule, player statistical distributions, and 9-cat probabilities
              </span>
            </div>
          )}
          {analysisError && (
            <p className="input-error" role="alert" style={{ marginTop: '1rem' }}>
              ⚠️ {analysisError}
            </p>
          )}
        </div>

        {/* 1. Matchup Outlook & Win Probability Banner */}
        {oppTeam && matchupWinStats && hasAnalysisData && (
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
                    <span className="matchup-outlook-title">
                      Matchup Win Probability
                    </span>
                    {mcMatchupWin !== null ? (
                      <div
                        className="mc-badge-pill clickable"
                        onClick={() => handleTabChange('monte-carlo')}
                        title="Click to view full Monte Carlo simulation tab"
                      >
                        🎲 Monte Carlo: <strong>{Math.round(mcMatchupWin * 100)}%</strong>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-mc-quick"
                        onClick={() => {
                          handleTabChange('monte-carlo');
                          runMonteCarlo();
                        }}
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
                    onClick={() => handleTabChange('monte-carlo')}
                    style={{ background: 'rgba(139, 92, 246, 0.1)', borderColor: 'rgba(139, 92, 246, 0.3)', color: '#a78bfa', cursor: 'pointer' }}
                    title="Click to view Monte Carlo simulation tab"
                  >
                    🎲 Simulated: <strong>{Math.round(mcMatchupWin * 100)}%</strong> (10k trials)
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 2. Projections & Simulation Tabbed Section */}
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
                    <span className="projections-tab-badge loading">
                      Simulating…
                    </span>
                  ) : null}
                </button>
              </div>
            </div>

            {/* TAB CONTENT: Analytical Projections */}
            {activeAnalysisTab !== 'monte-carlo' && (
              <div className="tab-pane fade-in">
                <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Click any category card on the left to inspect its head-to-head probability distribution on the right
                  </span>
                </div>

                <div className="category-analysis-workspace">
                  <div className="odds-grid">
                    {odds.map(({ cat, myMu, oppMu, winProb }) => {
                      const color = winProb >= 0.6 ? 'var(--accent)'
                                  : winProb >= 0.4 ? '#fbbf24'
                                  : '#e53935';
                      return (
                        <div
                          className={`odds-card ${activeCatKey === cat.key ? 'active' : ''}`}
                          key={cat.key}
                          onClick={() => setActiveCatKey(cat.key)}
                        >
                          <div className="odds-cat">{cat.icon} {cat.label}</div>
                          <div className="odds-pct" style={{ color }}>
                            {formatPct(winProb)}
                            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600, textTransform: 'uppercase', marginTop: '2px' }}>Win Chance</span>
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
                            <span style={{ color: 'var(--text-muted)' }}>Margin:</span>
                            <span style={{ color: myMu === oppMu ? 'var(--text-muted)' : (cat.key === 'TO' ? myMu < oppMu : myMu > oppMu) ? '#4ade80' : '#f87171' }}>
                              {(() => {
                                if (cat.derived) {
                                  const diff = (myMu - oppMu) * 100;
                                  return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
                                }
                                if (cat.key === 'TO') {
                                  const diff = Math.abs(myMu - oppMu);
                                  if (myMu === oppMu) return '0.0 TO';
                                  return myMu < oppMu ? `-${diff.toFixed(1)} TO` : `+${diff.toFixed(1)} TO`;
                                }
                                const diff = myMu - oppMu;
                                return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} ${cat.key}`;
                              })()}
                            </span>
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
                      onSelectCategory={setActiveCatKey}
                    />
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: Monte Carlo Simulation */}
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

                    <div className="category-analysis-workspace">
                      <div className="odds-grid">
                        {mcCatData && mcCatData.map(({ cat, winProb, myMu, oppMu }) => {
                          const color = winProb >= 0.6 ? 'var(--accent)'
                                      : winProb >= 0.4 ? '#fbbf24'
                                      : '#e53935';
                          return (
                            <div
                              className={`odds-card ${activeCatKey === cat.key ? 'active' : ''}`}
                              key={cat.key}
                              onClick={() => setActiveCatKey(cat.key)}
                            >
                              <div className="odds-cat">{cat.icon} {cat.label}</div>
                              <div className="odds-pct" style={{ color }}>
                                {formatPct(winProb)}
                                <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600, textTransform: 'uppercase', marginTop: '2px' }}>Sim Win Chance</span>
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
                                <span style={{ color: 'var(--text-muted)' }}>Sim Margin:</span>
                                <span style={{ color: myMu === oppMu ? 'var(--text-muted)' : (cat.key === 'TO' ? myMu < oppMu : myMu > oppMu) ? '#4ade80' : '#f87171' }}>
                                  {(() => {
                                    if (cat.derived) {
                                      const diff = (myMu - oppMu) * 100;
                                      return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
                                    }
                                    if (cat.key === 'TO') {
                                      const diff = Math.abs(myMu - oppMu);
                                      if (myMu === oppMu) return '0.0 TO';
                                      return myMu < oppMu ? `-${diff.toFixed(1)} TO` : `+${diff.toFixed(1)} TO`;
                                    }
                                    const diff = myMu - oppMu;
                                    return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} ${cat.key}`;
                                  })()}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {selectedCatData && (
                        <MatchupDistributionChart
                          category={selectedCatData.cat}
                          my={{ mu: selectedMcCatData?.myMu ?? selectedCatData.myMu, sigma: selectedCatData.mySigma }}
                          opp={{ mu: selectedMcCatData?.oppMu ?? selectedCatData.oppMu, sigma: selectedCatData.oppSigma }}
                          winProb={selectedMcCatData?.winProb ?? selectedCatData.winProb}
                          onSelectCategory={setActiveCatKey}
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  /* Empty state before user has run Monte Carlo */
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
                      onClick={runMonteCarlo}
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

        {/* 3. Live Matchup Scoreboard & Accumulated Stats */}
        {oppTeam && hasAnalysisData && accumulatedStats && (() => {
          const LIVE_CATS = [
            { key: 'pts', short: 'PTS', label: 'Points' },
            { key: 'reb', short: 'REB', label: 'Rebounds' },
            { key: 'ast', short: 'AST', label: 'Assists' },
            { key: 'stl', short: 'STL', label: 'Steals' },
            { key: 'blk', short: 'BLK', label: 'Blocks' },
            { key: 'fg3m', short: '3PM', label: '3-Pointers' },
            { key: 'fg%', short: 'FG%', label: 'Field Goal %', isPct: true },
            { key: 'ft%', short: 'FT%', label: 'Free Throw %', isPct: true },
            { key: 'tov', short: 'TO',  label: 'Turnovers' },
          ];
          const s = accumulatedStats.live_score;
          const tiesCount = s?.ties ?? 0;
          const tieSuffix = tiesCount > 0 ? `–${tiesCount}` : '';
          const hasStats = accumulatedStats.has_live_stats;

          const scoreClass = !s || (!hasStats && s.team1_wins === 0 && s.team2_wins === 0)
            ? 'tied'
            : s.team1_wins > s.team2_wins
            ? 'winning'
            : s.team1_wins < s.team2_wins
            ? 'trailing'
            : 'tied';
          const scoreLabel = !s || (!hasStats && s.team1_wins === 0 && s.team2_wins === 0)
            ? '0 – 0 Tied'
            : s.team1_wins > s.team2_wins
            ? `Leading ${s.team1_wins}–${s.team2_wins}${tieSuffix}`
            : s.team1_wins < s.team2_wins
            ? `Trailing ${s.team1_wins}–${s.team2_wins}${tieSuffix}`
            : `Tied ${s.team1_wins}–${s.team2_wins}${tieSuffix}`;
          const tooltip = s
            ? `${s.team1_wins} Wins · ${s.team2_wins} Losses · ${tiesCount} Ties`
            : 'No matchup score yet';

          const formatCell = (cat, side) => {
            const cData = accumulatedStats.categories?.[cat.key];
            if (!cat.isPct) {
              return { main: accumulatedStats[side]?.[cat.key] ?? '0', sub: null };
            }
            const pctVal = side === 'team1' ? cData?.team1 : cData?.team2;
            const splitStr = side === 'team1' ? cData?.team1_split : cData?.team2_split;
            const fallbackPct = ((accumulatedStats[side]?.[cat.key.replace('%', '') + 'm'] ?? 0) /
              ((accumulatedStats[side]?.[cat.key.replace('%', '') + 'a'] || 1))) * 100;
            const pctStr = pctVal != null ? `${(pctVal * 100).toFixed(1)}%` : `${fallbackPct.toFixed(1)}%`;
            return { main: pctStr, sub: splitStr || null };
          };

          return (
            <div className="card live-scoreboard-card fade-up">
              <div className="live-scoreboard-header">
                <div className="live-scoreboard-title-group">
                  <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.02rem' }}>
                    🏆 Live Matchup Scoreboard
                    {accumulatedStats.has_live_stats && (
                      <span className="badge badge-green" style={{ fontSize: '0.68rem', padding: '1px 7px' }}>
                        ● Live
                      </span>
                    )}
                  </h3>
                  <span className="live-scoreboard-sub">
                    Week {weekNum} accumulated totals
                  </span>
                </div>

                <div className="live-score-display">
                  <div className={`live-score-pill ${scoreClass}`} title={tooltip}>
                    {scoreLabel}
                  </div>
                </div>
              </div>

              <div className="live-stats-table-wrapper">
                <table className="live-stats-table condensed">
                  <thead>
                    <tr>
                      <th className="team-col">Team</th>
                      {LIVE_CATS.map(cat => (
                        <th key={cat.key} title={cat.label}>{cat.short}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Row 1: Your Team */}
                    <tr>
                      <td className="team-col">
                        <span className="team-dot you" />
                        <span className="team-name-cell">{myTeam.name}</span>
                        <span className="team-tag-you">You</span>
                      </td>
                      {LIVE_CATS.map(cat => {
                        const cData = accumulatedStats.categories?.[cat.key];
                        const isWinning = cData?.leader === 'team1';
                        const isTrailing = cData?.leader === 'team2';
                        const { main, sub } = formatCell(cat, 'team1');
                        return (
                          <td key={cat.key} className={isWinning ? 'live-stat-win' : isTrailing ? 'live-stat-loss' : ''}>
                            <div>{main}</div>
                            {sub && <div className="live-stat-split">{sub}</div>}
                          </td>
                        );
                      })}
                    </tr>

                    {/* Row 2: Opponent */}
                    <tr>
                      <td className="team-col">
                        <span className="team-dot opp" />
                        <span className="team-name-cell">{oppTeam.name}</span>
                      </td>
                      {LIVE_CATS.map(cat => {
                        const cData = accumulatedStats.categories?.[cat.key];
                        const isWinning = cData?.leader === 'team1';
                        const isTrailing = cData?.leader === 'team2';
                        const { main, sub } = formatCell(cat, 'team2');
                        return (
                          <td key={cat.key} className={isTrailing ? 'live-stat-win' : isWinning ? 'live-stat-loss' : ''}>
                            <div>{main}</div>
                            {sub && <div className="live-stat-split">{sub}</div>}
                          </td>
                        );
                      })}
                    </tr>

                    {/* Row 3: Margin / Status */}
                    <tr className="margin-row">
                      <td className="team-col margin-label-col">Margin</td>
                      {LIVE_CATS.map(cat => {
                        const cData = accumulatedStats.categories?.[cat.key];
                        const magnitude = getCategoryMagnitude(cat.key, cat.isPct, cData?.team1, cData?.team2, cData?.leader);
                        return (
                          <td key={cat.key}>
                            <span className={`live-margin-pill ${magnitude.pillClass}`} title={magnitude.subText}>
                              {magnitude.text.replace(` ${cat.short}`, '').replace(' FG%', '%').replace(' FT%', '%')}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* 4. Weekly Games Schedule & Games Played Breakdown (Condensed, Excludes IR Slots) */}
        {oppTeam && hasAnalysisData && playerGames && (() => {
          const irSlots = new Set(['IL', 'IL+', 'IR', 'IR+', 'NA']);
          const isPlayerInIR = (p, teamKey) =>
            irSlots.has(String(p?.selected_position || '').toUpperCase().trim()) ||
            Boolean(playerGames?.[teamKey]?.[p?.name]?.is_ir);

          const t1ActivePlayers = myTeam.players.filter(p => !isPlayerInIR(p, 'team1'));
          const t2ActivePlayers = oppTeam.players.filter(p => !isPlayerInIR(p, 'team2'));

          const t1Played = t1ActivePlayers.reduce((sum, p) => sum + (playerGames?.team1?.[p.name]?.played ?? 0), 0);
          const t1Total  = t1ActivePlayers.reduce((sum, p) => sum + (playerGames?.team1?.[p.name]?.total ?? 0), 0);
          const t1Rem    = Math.max(0, t1Total - t1Played);

          const t2Played = t2ActivePlayers.reduce((sum, p) => sum + (playerGames?.team2?.[p.name]?.played ?? 0), 0);
          const t2Total  = t2ActivePlayers.reduce((sum, p) => sum + (playerGames?.team2?.[p.name]?.total ?? 0), 0);
          const t2Rem    = Math.max(0, t2Total - t2Played);

          return (
            <div className="roster-games-section card fade-up">
              <div className="roster-games-top-bar">
                <div className="roster-games-title-wrap">
                  <h3 className="roster-games-title">📅 Weekly Roster Schedule &amp; Games Played</h3>
                  <span className="roster-games-sub">Active roster games this week (IR slots excluded)</span>
                </div>
                <div className="roster-games-summary-pills">
                  <span className="rg-summary-pill you">
                    <strong>{myTeam.name}:</strong> {t1Played}/{t1Total} GP <em>({t1Rem} left)</em>
                  </span>
                  <span className="rg-summary-pill opp">
                    <strong>{oppTeam.name}:</strong> {t2Played}/{t2Total} GP <em>({t2Rem} left)</em>
                  </span>
                </div>
              </div>

              <div className="roster-games-grid">
                {/* Your Roster */}
                <div className="roster-games-card">
                  <div className="roster-games-card-header">
                    <span className="rg-team-name you">{myTeam.name}</span>
                    <span className="rg-team-totals">{t1Played}/{t1Total} GP &middot; {t1Rem} left</span>
                  </div>

                  <div className="roster-games-list">
                    {t1ActivePlayers.map(p => {
                      const gInfo = playerGames?.team1?.[p.name] || { played: 0, total: 0, remaining: 0, ratio: '0/0' };
                      const hasRemaining = gInfo.remaining > 0;
                      return (
                        <div className="player-game-item" key={p.name}>
                          <div className="player-meta-inline">
                            <span className="player-name-text" title={p.name}>{p.name}</span>
                            <span className="player-sub-text">{p.nba_team} &middot; {p.positions}</span>
                            {p.status && <span className="badge badge-orange rg-status-tag">{p.status}</span>}
                          </div>
                          <span
                            className={`games-played-badge ${hasRemaining ? 'games-badge-active' : 'games-badge-done'}`}
                            title={`${gInfo.played} played, ${gInfo.remaining} remaining (${gInfo.total} total this week)`}
                          >
                            {gInfo.ratio || `${gInfo.played}/${gInfo.total}`} GP
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Opponent Roster */}
                <div className="roster-games-card">
                  <div className="roster-games-card-header">
                    <span className="rg-team-name opp">{oppTeam.name}</span>
                    <span className="rg-team-totals">{t2Played}/{t2Total} GP &middot; {t2Rem} left</span>
                  </div>

                  <div className="roster-games-list">
                    {t2ActivePlayers.map(p => {
                      const gInfo = playerGames?.team2?.[p.name] || { played: 0, total: 0, remaining: 0, ratio: '0/0' };
                      const hasRemaining = gInfo.remaining > 0;
                      return (
                        <div className="player-game-item" key={p.name}>
                          <div className="player-meta-inline">
                            <span className="player-name-text" title={p.name}>{p.name}</span>
                            <span className="player-sub-text">{p.nba_team} &middot; {p.positions}</span>
                            {p.status && <span className="badge badge-orange rg-status-tag">{p.status}</span>}
                          </div>
                          <span
                            className={`games-played-badge ${hasRemaining ? 'games-badge-active' : 'games-badge-done'}`}
                            title={`${gInfo.played} played, ${gInfo.remaining} remaining (${gInfo.total} total this week)`}
                          >
                            {gInfo.ratio || `${gInfo.played}/${gInfo.total}`} GP
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 5. Inactive & Injured Players */}
        {oppTeam && hasAnalysisData && inactivePlayers && (
          <div className="inactive-players-section card fade-up" style={{ marginTop: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.15rem' }}>
              ⚠️ Inactive & Injured Players
            </h3>
            <p className="proj-subtitle" style={{ marginBottom: '1.25rem' }}>
              Players who are injured or projected for 0 games this week (excluded from active projections)
            </p>
            <div className="inactive-teams-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              {/* Team 1 (You) */}
              <div className="inactive-team">
                <h4 style={{ color: 'var(--accent)', marginBottom: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.25rem' }}>
                  {myTeam.name}
                </h4>
                {inactivePlayers.team1.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>No inactive or injured players</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {inactivePlayers.team1.map(p => (
                      <li key={p.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.5rem', background: 'rgba(255,255,255,0.02)', padding: '6px 10px', borderRadius: '4px' }}>
                        <span><strong>{p.name}</strong></span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Status: <span className={`badge ${p.status ? 'badge-red' : 'badge-orange'}`} style={{ marginRight: '0.5rem' }}>{p.status || 'Active (0 GP)'}</span>
                          Proj Games: <strong>{p.proj_games_played ?? 0}</strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Team 2 (Opponent) */}
              <div className="inactive-team">
                <h4 style={{ color: '#ffa726', marginBottom: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.25rem' }}>
                  {oppTeam.name}
                </h4>
                {inactivePlayers.team2.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>No inactive or injured players</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {inactivePlayers.team2.map(p => (
                      <li key={p.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.5rem', background: 'rgba(255,255,255,0.02)', padding: '6px 10px', borderRadius: '4px' }}>
                        <span><strong>{p.name}</strong></span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Status: <span className={`badge ${p.status ? 'badge-red' : 'badge-orange'}`} style={{ marginRight: '0.5rem' }}>{p.status || 'Active (0 GP)'}</span>
                          Proj Games: <strong>{p.proj_games_played ?? 0}</strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
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
