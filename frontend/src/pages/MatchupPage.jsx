import { useState, useMemo, useContext, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import { CATEGORIES } from '../utils/zScore.js';
import { formatMu, formatPct } from '../utils/formatters.js';
import { MOCK_MATCHUP_ANALYSIS, MOCK_STREAMER_RECOMMENDATIONS } from '../utils/mockData.js';
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
  const { myTeam, selectMyTeam, leagueData, loading } = useContext(TeamDataContext);
  const navigate = useNavigate();

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

  const hasAnalysisData = !analysisLoading && Boolean(analysisResult || mcResult || (leagueData?.league_id === '66811'));

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

  // ── Streamer Recommendations state ────────────────────
  const [streamerRecs, setStreamerRecs] = useState(() => {
    if (!myTeam || !oppTeamId) return null;
    const key = `${leagueData?.league_id || ''}-${myTeam.team_id}-${oppTeamId}-${weekNum}-${dateStart}`;
    return getCachedStreamers(key);
  });
  const [streamerLoading, setStreamerLoading] = useState(false);
  const [streamerError, setStreamerError]     = useState(null);
  const [copiedPlayer, setCopiedPlayer]       = useState(null);

  const handleCopyPlayer = useCallback((playerName) => {
    try {
      navigator.clipboard?.writeText(playerName);
      setCopiedPlayer(playerName);
      setTimeout(() => setCopiedPlayer(null), 2000);
    } catch (e) {
      console.warn('Clipboard copy failed:', e);
    }
  }, []);

  const fetchStreamers = useCallback(async (forceRefresh = false) => {
    if (!myTeam || !oppTeam || !leagueData) return;
    const cacheKey = getCacheKey(myTeam.team_id, oppTeam.team_id, weekNum, dateStart);

    if (!forceRefresh && getCachedStreamers(cacheKey)) {
      setStreamerRecs(getCachedStreamers(cacheKey));
      setStreamerError(null);
      setStreamerLoading(false);
      return;
    }

    setStreamerLoading(true);
    setStreamerError(null);

    const allNames = leagueData?.teams ? leagueData.teams.flatMap(t => t.players.map(p => p.name)) : [];

    const body = {
      league_id:        leagueData.league_id,
      team1:            myTeam,
      team2:            oppTeam,
      week_num:         weekNum,
      date_start:       dateStart,
      roster_positions: leagueData.roster_positions ?? null,
      stats_source:     'weekly_stats',
      all_rostered_names: allNames,
      limit:            6
    };

    try {
      const response = await fetch('/api/streamer-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (json.status === 'success' && json.payload) {
        setStreamerRecs(json.payload);
        setCachedStreamers(cacheKey, json.payload);
      } else {
        throw new Error(json.message || 'Streamer analysis failed');
      }
    } catch (err) {
      console.warn('Backend streamer API failed or offline, falling back to mock:', err);
      setStreamerRecs(MOCK_STREAMER_RECOMMENDATIONS);
      setCachedStreamers(cacheKey, MOCK_STREAMER_RECOMMENDATIONS);
    } finally {
      setStreamerLoading(false);
    }
  }, [myTeam, oppTeam, leagueData, weekNum, dateStart, getCacheKey]);

  useEffect(() => {
    if ((activeAnalysisTab === 'streamers' || hasAnalysisData) && !streamerRecs && !streamerLoading && myTeam && oppTeam) {
      fetchStreamers();
    }
  }, [activeAnalysisTab, hasAnalysisData, streamerRecs, streamerLoading, myTeam, oppTeam, fetchStreamers]);

  // ── Derived data from analysis result ──────────────────
  const odds = useMemo(() => {
    if (!analysisResult) return null;
    return parseAnalysisResult(analysisResult);
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
    if (leagueData?.league_id === '66811') return MOCK_MATCHUP_ANALYSIS.accumulated_stats;
    return null;
  }, [analysisResult, mcResult, leagueData]);

  const playerGames = useMemo(() => {
    if (analysisResult?.player_games) return analysisResult.player_games;
    if (mcResult?.player_games) return mcResult.player_games;
    if (leagueData?.league_id === '66811') return MOCK_MATCHUP_ANALYSIS.player_games;
    return null;
  }, [analysisResult, mcResult, leagueData]);

  const inactivePlayers = useMemo(() => {
    const backendInactive = mcResult?.inactive_players || analysisResult?.inactive_players;

    const getRosterInactive = (team, backendList) => {
      if (!team?.players) return [];
      const list = [];
      const seen = new Set();

      if (backendList && backendList.length > 0) {
        for (const p of backendList) {
          list.push(p);
          seen.add(p.name);
        }
      }

      for (const p of team.players) {
        if (!seen.has(p.name)) {
          const isInjured = Boolean(p.status && ['O', 'INJ', 'IL', 'IL+', 'OUT', 'GTD'].includes(String(p.status).toUpperCase()));
          if (isInjured) {
            list.push({
              name: p.name,
              status: p.status,
              proj_games_played: playerGames?.[team.team_id === myTeam?.team_id ? 'team1' : 'team2']?.[p.name]?.total ?? 0,
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
                    className={`btn-ghost ${activeAnalysisTab === 'streamers' ? 'active' : ''}`}
                    onClick={() => handleTabChange('streamers')}
                    style={{ padding: '8px 16px', fontSize: '0.85rem', border: '1px solid var(--border)' }}
                    title="View automated streamer recommendations for this matchup"
                  >
                    🎯 View Streamers
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
                  className={`projections-tab-btn ${activeAnalysisTab === 'analytical' ? 'active' : ''}`}
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
                <button
                  type="button"
                  className={`projections-tab-btn ${activeAnalysisTab === 'streamers' ? 'active' : ''}`}
                  onClick={() => handleTabChange('streamers')}
                >
                  <span className="tab-icon">🎯</span>
                  <span>Streamer Suggestions</span>
                  {streamerRecs && streamerRecs.recommendations?.length > 0 ? (
                    <span className="projections-tab-badge success">
                      {streamerRecs.recommendations.length} Targets
                    </span>
                  ) : streamerLoading ? (
                    <span className="projections-tab-badge loading">
                      Scanning…
                    </span>
                  ) : null}
                </button>
              </div>
            </div>

            {/* TAB CONTENT: Analytical Projections */}
            {activeAnalysisTab === 'analytical' && (
              <div className="tab-pane fade-in">
                <div style={{ marginBottom: '1rem' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Formula-based normal & ratio distributions derived from player projections, schedule volume & optimal lineup solving
                  </span>
                </div>

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
                        <div className="odds-pct" style={{ color }}>
                          {formatPct(winProb)}
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', fontWeight: 500, textTransform: 'uppercase', marginTop: '2px' }}>Estimated Win Prob</span>
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
                          <span style={{ color: 'var(--text-muted)' }}>Proj Margin:</span>
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
                  />
                )}
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

                    <div className="odds-grid">
                      {mcCatData && mcCatData.map(({ cat, winProb, myMu, oppMu }) => {
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
                            <div className="odds-pct" style={{ color }}>
                              {formatPct(winProb)}
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', fontWeight: 500, textTransform: 'uppercase', marginTop: '2px' }}>Simulated Win Prob</span>
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
                      />
                    )}
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

            {/* TAB CONTENT: Streamer Suggestions */}
            {activeAnalysisTab === 'streamers' && (
              <div className="tab-pane fade-in">
                {streamerLoading ? (
                  <div className="card streamer-loading-state" style={{ textAlign: 'center', padding: '3.5rem 1.5rem' }}>
                    <div className="spinner large" style={{ width: '40px', height: '40px', borderWidth: '3px', margin: '0 auto 1.25rem' }} />
                    <h3 style={{ margin: '0 0 0.5rem', fontWeight: 700 }}>Analyzing Free Agents &amp; Schedule Fit…</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', maxWidth: '520px', margin: '0 auto' }}>
                      Triaging contested categories, calculating daily startable games, and ranking waivers by net win probability gain.
                    </p>
                  </div>
                ) : streamerRecs && streamerRecs.recommendations ? (
                  <div className="streamer-dashboard">
                    {/* 1. Category Triage Bar */}
                    <div className="streamer-diag-card card">
                      <div className="streamer-diag-header">
                        <div>
                          <div className="streamer-diag-title">Category Matchup Diagnostics</div>
                          <div className="streamer-diag-subtitle">
                            Target contested swing categories (20%–80%) where additional streaming stats flip the matchup win.
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn-ghost streamer-refresh-btn"
                          onClick={() => fetchStreamers(true)}
                          disabled={streamerLoading}
                          title="Refresh free agent stream recommendations"
                        >
                          🔄 Refresh Streamers
                        </button>
                      </div>

                      <div className="streamer-triage-grid">
                        <div className="triage-column safe">
                          <div className="triage-column-header">
                            <span className="triage-status-dot safe" />
                            <span>Safe Leads (Protect)</span>
                          </div>
                          <div className="triage-tags">
                            {Object.entries(streamerRecs.matchup_diagnostics?.categories || {})
                              .filter(([_, d]) => d.status === 'SAFE')
                              .map(([k, d]) => (
                                <span key={k} className="triage-tag safe" title={`Win Prob: ${Math.round(d.p_win * 100)}%`}>
                                  <strong>{k.toUpperCase()}</strong> {Math.round(d.p_win * 100)}%
                                </span>
                              ))}
                          </div>
                        </div>

                        <div className="triage-column swing">
                          <div className="triage-column-header">
                            <span className="triage-status-dot swing" />
                            <span>Contested Battles (Targets)</span>
                          </div>
                          <div className="triage-tags">
                            {Object.entries(streamerRecs.matchup_diagnostics?.categories || {})
                              .filter(([_, d]) => d.status === 'SWING')
                              .map(([k, d]) => (
                                <span key={k} className="triage-tag swing" title={`Margin: ${d.margin > 0 ? '+' : ''}${d.margin}`}>
                                  <strong>{k.toUpperCase()}</strong> {Math.round(d.p_win * 100)}% ({d.margin > 0 ? '+' : ''}{d.margin})
                                </span>
                              ))}
                          </div>
                        </div>

                        <div className="triage-column doomed">
                          <div className="triage-column-header">
                            <span className="triage-status-dot doomed" />
                            <span>Punted Deficits (Ignore)</span>
                          </div>
                          <div className="triage-tags">
                            {Object.entries(streamerRecs.matchup_diagnostics?.categories || {})
                              .filter(([_, d]) => d.status === 'DOOMED')
                              .map(([k, d]) => (
                                <span key={k} className="triage-tag doomed" title={`Win Prob: ${Math.round(d.p_win * 100)}%`}>
                                  <strong>{k.toUpperCase()}</strong> {Math.round(d.p_win * 100)}%
                                </span>
                              ))}
                          </div>
                        </div>
                      </div>

                      {/* Roster Maneuver Action */}
                      {streamerRecs.roster_action && (
                        <div className={`streamer-roster-banner ${streamerRecs.roster_action.type === 'MOVE_TO_IR' ? 'ir-stash' : 'drop-swap'}`}>
                          <span className="srb-icon">
                            {streamerRecs.roster_action.type === 'MOVE_TO_IR' ? '✨' : '💡'}
                          </span>
                          <div>
                            <strong>
                              {streamerRecs.roster_action.type === 'MOVE_TO_IR' ? 'Zero-Drop Roster Move: ' : 'Recommended Bench Drop: '}
                            </strong>
                            <span>{streamerRecs.roster_action.reason}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 2. Streamer Recommendation Cards */}
                    <div className="streamer-cards-container">
                      <div className="streamer-section-label">
                        <span>Top Free Agent Streamers for Week {weekNum}</span>
                        <span className="streamer-section-sub">
                          Ranked by Net Matchup Win Probability Impact (ΔE)
                        </span>
                      </div>

                      <div className="streamer-cards-grid">
                        {streamerRecs.recommendations.map(rec => {
                          const p = rec.player;
                          const action = rec.action;
                          const sched = rec.schedule;
                          const impact = rec.impact;
                          const isCopied = copiedPlayer === p.name;

                          return (
                            <div key={p.name} className="streamer-card card">
                              {/* Card Header */}
                              <div className="sc-header">
                                <div className="sc-rank-badge">#{rec.rank}</div>
                                <div className="sc-player-info">
                                  <div className="sc-name-row">
                                    <span className="sc-name">{p.name}</span>
                                    <span className="sc-team-pos">{p.nba_team} · {p.positions}</span>
                                  </div>
                                  <div className="sc-stats-preview">
                                    <span>{p.mu_pts} PTS</span> · <span>{p.mu_reb} REB</span> · <span>{p.mu_ast} AST</span> · <span className="sc-z">Z: {p.z_total > 0 ? '+' : ''}{p.z_total?.toFixed(2) ?? '0.00'}</span>
                                  </div>
                                </div>

                                <div className="sc-delta-badge">
                                  <span className="sc-delta-val">+{impact.expected_win_delta.toFixed(2)}</span>
                                  <span className="sc-delta-lbl">Cat Win Delta</span>
                                </div>
                              </div>

                              {/* Action Callout */}
                              <div className="sc-action-row">
                                <span className={`badge ${action?.type === 'MOVE_TO_IR' ? 'badge-green' : 'badge-orange'}`}>
                                  {action?.type === 'MOVE_TO_IR' ? 'Move to IR' : 'Drop Candidate'}
                                </span>
                                <span className="sc-action-text">{action?.reason}</span>
                              </div>

                              {/* Target Categories Boosted */}
                              <div className="sc-boosts-section">
                                <div className="sc-boosts-label">Contested Categories Boosted:</div>
                                <div className="sc-boosts-grid">
                                  {impact.primary_boost_categories && impact.primary_boost_categories.length > 0 ? (
                                    impact.primary_boost_categories.map((b, idx) => (
                                      <div key={idx} className="sc-boost-item">
                                        <div className="sc-boost-cat">{b.cat}</div>
                                        <div className="sc-boost-prob">
                                          <span>{Math.round(b.before_p * 100)}%</span>
                                          <span className="sc-arrow">→</span>
                                          <span className="sc-after">{Math.round(b.after_p * 100)}%</span>
                                        </div>
                                        <div className="sc-boost-gain">{b.gain}</div>
                                      </div>
                                    ))
                                  ) : (
                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                      Provides balanced all-around depth across active categories.
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Risk Flags */}
                              {impact.risk_flags && impact.risk_flags.length > 0 && (
                                <div className="sc-risks-row">
                                  {impact.risk_flags.map((rf, rIdx) => (
                                    <span key={rIdx} className="sc-risk-chip">
                                      ⚠️ {rf}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* Schedule Grid */}
                              <div className="sc-schedule-row">
                                <div className="sc-sched-meta">
                                  <strong>{sched.startable_games} Startable Game{sched.startable_games !== 1 ? 's' : ''}</strong>
                                  {sched.clashes > 0 && (
                                    <span className="sc-clash-note">({sched.clashes} bench clash)</span>
                                  )}
                                </div>
                                <div className="sc-dates-pills">
                                  {sched.startable_dates && sched.startable_dates.map(dateStr => {
                                    const dObj = new Date(dateStr + 'T12:00:00');
                                    const dayName = dObj.toLocaleDateString('en-US', { weekday: 'short' });
                                    const dayNum = dObj.getDate();
                                    return (
                                      <span key={dateStr} className="sc-date-pill active" title={`${dateStr}: Starts in active slot`}>
                                        <span className="sc-dot" /> {dayName} {dayNum}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Card Footer */}
                              <div className="sc-footer">
                                <button
                                  type="button"
                                  className={`btn-ghost sc-copy-btn ${isCopied ? 'copied' : ''}`}
                                  onClick={() => handleCopyPlayer(p.name)}
                                >
                                  {isCopied ? '✓ Copied to Clipboard!' : '📋 Copy Name for Yahoo'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="card streamer-empty-state" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🎯</div>
                    <h3 style={{ margin: '0 0 0.5rem', fontWeight: 700 }}>Find Optimal Matchup Streamers</h3>
                    <p style={{ color: 'var(--text-secondary)', maxWidth: '480px', margin: '0 auto 1.5rem', fontSize: '0.88rem' }}>
                      Analyze free agents based on your contested categories, open roster spots, and remaining NBA schedule.
                    </p>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => fetchStreamers(true)}
                      disabled={streamerLoading}
                    >
                      Scan Free Agents Now
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 3. Live Matchup Scoreboard & Accumulated Stats */}
        {oppTeam && hasAnalysisData && accumulatedStats && (
          <div className="card live-scoreboard-card fade-up">
            <div className="live-scoreboard-header">
              <div>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '1.15rem' }}>
                  🏆 Live Matchup Scoreboard
                  {accumulatedStats.has_live_stats && (
                    <span className="badge badge-green" style={{ fontSize: '0.72rem', padding: '2px 8px' }}>
                      ● Live Stats
                    </span>
                  )}
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '3px', display: 'block' }}>
                  Stats accumulated so far in Week {weekNum}
                </span>
              </div>

              <div className="live-score-display">
                {(() => {
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

                  return (
                    <div className={`live-score-pill ${scoreClass}`} title={tooltip}>
                      {scoreLabel}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="live-stats-table-wrapper">
              <table className="live-stats-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Category</th>
                    <th>{myTeam.name} (You)</th>
                    <th>{oppTeam.name}</th>
                    <th>Lead / Margin Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: 'pts', label: 'Points (PTS)' },
                    { key: 'reb', label: 'Rebounds (REB)' },
                    { key: 'ast', label: 'Assists (AST)' },
                    { key: 'stl', label: 'Steals (STL)' },
                    { key: 'blk', label: 'Blocks (BLK)' },
                    { key: 'fg3m', label: '3-Pointers (3PM)' },
                    { key: 'fg%', label: 'Field Goal % (FG%)', isPct: true },
                    { key: 'ft%', label: 'Free Throw % (FT%)', isPct: true },
                    { key: 'tov', label: 'Turnovers (TO)' },
                  ].map(cat => {
                    const cData = accumulatedStats.categories?.[cat.key];
                    const t1Val = cat.isPct
                      ? (cData?.team1_split ? `${(cData.team1 * 100).toFixed(1)}% (${cData.team1_split})` : `${((accumulatedStats.team1?.[cat.key.replace('%', '') + 'm'] ?? 0) / ((accumulatedStats.team1?.[cat.key.replace('%', '') + 'a'] || 1)) * 100).toFixed(1)}%`)
                      : (accumulatedStats.team1?.[cat.key] ?? '0');
                    const t2Val = cat.isPct
                      ? (cData?.team2_split ? `${(cData.team2 * 100).toFixed(1)}% (${cData.team2_split})` : `${((accumulatedStats.team2?.[cat.key.replace('%', '') + 'm'] ?? 0) / ((accumulatedStats.team2?.[cat.key.replace('%', '') + 'a'] || 1)) * 100).toFixed(1)}%`)
                      : (accumulatedStats.team2?.[cat.key] ?? '0');

                    const isWinning = cData?.leader === 'team1';
                    const isTrailing = cData?.leader === 'team2';
                    const magnitude = getCategoryMagnitude(cat.key, cat.isPct, cData?.team1, cData?.team2, cData?.leader);

                    return (
                      <tr key={cat.key}>
                        <td style={{ textAlign: 'left', fontWeight: 600 }}>{cat.label}</td>
                        <td className={isWinning ? 'live-stat-win' : isTrailing ? 'live-stat-loss' : ''}>
                          {t1Val}
                        </td>
                        <td className={isTrailing ? 'live-stat-win' : isWinning ? 'live-stat-loss' : ''}>
                          {t2Val}
                        </td>
                        <td>
                          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                            <span className={`live-margin-pill ${magnitude.pillClass}`}>
                              {magnitude.text}
                            </span>
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                              {magnitude.subText}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. Weekly Games Schedule & Games Played Breakdown */}
        {oppTeam && hasAnalysisData && playerGames && (
          <div className="roster-games-section card fade-up">
            <div style={{ marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.15rem' }}>
                📅 Weekly Roster Schedule & Games Played
              </h3>
              <p className="proj-subtitle" style={{ margin: '0.25rem 0 0' }}>
                Track each player's games completed vs. total scheduled for this week (e.g. 2/3 games played)
              </p>
            </div>

            <div className="roster-games-grid">
              {/* Your Roster */}
              <div className="roster-games-card">
                <div className="roster-games-card-header">
                  <div>
                    <h4 style={{ margin: 0, color: 'var(--accent)', fontSize: '0.95rem' }}>{myTeam.name}</h4>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Total Games:{' '}
                      <strong>
                        {myTeam.players.reduce((sum, p) => sum + (playerGames?.team1?.[p.name]?.played ?? 0), 0)}
                        /
                        {myTeam.players.reduce((sum, p) => sum + (playerGames?.team1?.[p.name]?.total ?? 0), 0)}
                      </strong>{' '}
                      played
                    </span>
                  </div>
                  <span className="badge badge-green">You</span>
                </div>

                <div className="roster-games-list">
                  {myTeam.players.map(p => {
                    const gInfo = playerGames?.team1?.[p.name] || { played: 0, total: 0, remaining: 0, ratio: '0/0' };
                    const hasRemaining = gInfo.remaining > 0;
                    return (
                      <div className="player-game-item" key={p.name}>
                        <div className="player-meta-inline">
                          <span className="player-name-text">{p.name}</span>
                          <span className="player-sub-text">{p.positions} &middot; {p.nba_team}</span>
                          {p.status && <span className="badge badge-orange" style={{ fontSize: '0.65rem', padding: '1px 5px' }}>{p.status}</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span className={`games-played-badge ${hasRemaining ? 'games-badge-active' : 'games-badge-done'}`}>
                            🏀 {gInfo.ratio || `${gInfo.played}/${gInfo.total}`} games played
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Opponent Roster */}
              <div className="roster-games-card">
                <div className="roster-games-card-header">
                  <div>
                    <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{oppTeam.name}</h4>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Total Games:{' '}
                      <strong>
                        {oppTeam.players.reduce((sum, p) => sum + (playerGames?.team2?.[p.name]?.played ?? 0), 0)}
                        /
                        {oppTeam.players.reduce((sum, p) => sum + (playerGames?.team2?.[p.name]?.total ?? 0), 0)}
                      </strong>{' '}
                      played
                    </span>
                  </div>
                  <span className="badge badge-orange">Opponent</span>
                </div>

                <div className="roster-games-list">
                  {oppTeam.players.map(p => {
                    const gInfo = playerGames?.team2?.[p.name] || { played: 0, total: 0, remaining: 0, ratio: '0/0' };
                    const hasRemaining = gInfo.remaining > 0;
                    return (
                      <div className="player-game-item" key={p.name}>
                        <div className="player-meta-inline">
                          <span className="player-name-text">{p.name}</span>
                          <span className="player-sub-text">{p.positions} &middot; {p.nba_team}</span>
                          {p.status && <span className="badge badge-orange" style={{ fontSize: '0.65rem', padding: '1px 5px' }}>{p.status}</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span className={`games-played-badge ${hasRemaining ? 'games-badge-active' : 'games-badge-done'}`}>
                            🏀 {gInfo.ratio || `${gInfo.played}/${gInfo.total}`} games played
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

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
