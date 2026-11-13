import { useState, useMemo, useContext, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import CategoryToggle from '../components/CategoryToggle.jsx';
import playerPositionsFallback from '../utils/playerPositionsFallback.json';
import './MatchupPage.css';

const MATCHUP_CACHE_STORAGE_KEY  = '9cat_matchup_analysis_cache';
const STREAMER_CACHE_STORAGE_KEY = '9cat_matchup_streamer_cache_v29';
const STREAMER_PUNTS_STORAGE_KEY = '9cat_matchup_streamer_punts';
const MATCHUP_OPP_STORAGE_KEY    = '9cat_matchup_selected_opp';
const MATCHUP_WEEK_STORAGE_KEY   = '9cat_matchup_selected_week';

const STREAMER_POS_FILTERS = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'];
const STREAMER_CAT_FILTERS = ['ALL', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'TO'];
const ANY_INJ_TAGS = new Set(['O', 'INJ', 'OUT', 'IL', 'INJURED', 'SUSP', 'Q', 'GTD', 'DTD', 'DOUBTFUL']);

function loadSavedPunts(teamKey) {
  if (!teamKey) return new Set();
  try {
    const raw = sessionStorage.getItem(STREAMER_PUNTS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.[teamKey]) ? new Set(parsed[teamKey]) : new Set();
  } catch {
    return new Set();
  }
}

function savePunts(teamKey, puntsSet) {
  if (!teamKey) return;
  try {
    const raw = sessionStorage.getItem(STREAMER_PUNTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[teamKey] = [...puntsSet];
    sessionStorage.setItem(STREAMER_PUNTS_STORAGE_KEY, JSON.stringify(parsed));
  } catch { /* ignore */ }
}

function todayString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getCachedAnalysis(key) {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(MATCHUP_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.[key] || null;
  } catch {
    return null;
  }
}

function hasAnyCachedAnalysisForTeam(leagueId, myTeamId) {
  if (!myTeamId) return false;
  try {
    const raw = sessionStorage.getItem(MATCHUP_CACHE_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    const prefix = `${leagueId || ''}-${myTeamId}-`;
    return Object.keys(parsed).some(k => k.startsWith(prefix) && parsed[k]);
  } catch {
    return false;
  }
}

function getCachedStreamers(key) {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(STREAMER_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.[key] || null;
  } catch {
    return null;
  }
}

function setCachedStreamers(key, data) {
  if (!key || !data) return;
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

export default function StreamerPage() {
  const { myTeam, leagueData, loading, refreshTeam } = useContext(TeamDataContext);
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

  const opponents = useMemo(
    () => leagueData?.teams?.filter(t => t.team_id !== myTeam?.team_id) ?? [],
    [leagueData, myTeam]
  );

  const scheduledOppId = useMemo(() => {
    return myTeam?.current_opponent_id || leagueData?.weekly_matchups?.[String(myTeam?.team_id)] || null;
  }, [myTeam, leagueData]);

  const [oppTeamId, setOppTeamId] = useState(() => {
    try {
      const saved = sessionStorage.getItem(MATCHUP_OPP_STORAGE_KEY);
      if (saved) return saved;
    } catch {}
    return scheduledOppId ? String(scheduledOppId) : '';
  });

  useEffect(() => {
    if (!oppTeamId && scheduledOppId) {
      setOppTeamId(String(scheduledOppId));
    } else if (!oppTeamId && opponents[0]) {
      setOppTeamId(String(opponents[0].team_id));
    }
  }, [oppTeamId, scheduledOppId, opponents]);

  const oppTeam = useMemo(
    () => opponents.find(t => String(t.team_id) === String(oppTeamId)) ?? null,
    [opponents, oppTeamId]
  );

  const [weekNum, setWeekNum] = useState(() => {
    try {
      const saved = sessionStorage.getItem(MATCHUP_WEEK_STORAGE_KEY);
      if (saved) return parseInt(saved) || leagueData?.week_num || 1;
    } catch {}
    return leagueData?.week_num ?? 1;
  });

  const dateStart = useMemo(() => todayString(), []);

  // Streamer configuration controls:
  // pickupMode: 'week' (rest of week) | 'today' (current day only)
  // selectedDropPlayer: '__AUTO__' | '__OPEN_SLOT__' | '<Player Name>'
  const [pickupMode, setPickupMode] = useState('week');
  const [selectedDropPlayer, setSelectedDropPlayer] = useState('__AUTO__');
  const [showAllRoster, setShowAllRoster] = useState(false);

  const teamPuntKey = useMemo(() => (
    leagueData?.league_id && myTeam?.team_id ? `${leagueData.league_id}-${myTeam.team_id}` : ''
  ), [leagueData?.league_id, myTeam?.team_id]);

  const [puntedCats, setPuntedCats] = useState(() => loadSavedPunts(teamPuntKey));
  useEffect(() => {
    setPuntedCats(loadSavedPunts(teamPuntKey));
  }, [teamPuntKey]);

  const togglePunt = useCallback((catKey) => {
    setPuntedCats(prev => {
      const next = new Set(prev);
      if (next.has(catKey)) next.delete(catKey); else next.add(catKey);
      savePunts(teamPuntKey, next);
      return next;
    });
  }, [teamPuntKey]);

  // Client-side FA browse controls
  const [posFilter, setPosFilter] = useState('ALL');
  const [boostCatFilter, setBoostCatFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('delta_e');
  const [healthyOnly, setHealthyOnly] = useState(false);
  const [dismissedPlayers, setDismissedPlayers] = useState(() => new Set());
  const [visibleLimit, setVisibleLimit] = useState(6);

  useEffect(() => {
    setVisibleLimit(6);
  }, [selectedDropPlayer, pickupMode]);

  const sortedPuntsKey = useMemo(() => [...puntedCats].sort().join(','), [puntedCats]);

  const matchupCacheKey = useMemo(() => {
    if (!myTeam || !oppTeamId) return '';
    return `${leagueData?.league_id || ''}-${myTeam.team_id}-${oppTeamId}-${weekNum}-${dateStart}`;
  }, [leagueData?.league_id, myTeam, oppTeamId, weekNum, dateStart]);

  // Cache excludes selectedDropPlayer because recommendations_by_target bundles every candidate for 0ms switching
  const streamerCacheKey = useMemo(() => {
    if (!matchupCacheKey) return '';
    return `${matchupCacheKey}-${pickupMode}-${sortedPuntsKey}`;
  }, [matchupCacheKey, pickupMode, sortedPuntsKey]);

  // Check if the Matchup Analyzer has been run for this matchup (or any matchup for this team)
  const matchupAnalysisData = useMemo(() => {
    if (!matchupCacheKey) return null;
    return getCachedAnalysis(matchupCacheKey);
  }, [matchupCacheKey]);

  const hasRunMatchupAnalyzer = useMemo(() => {
    if (matchupAnalysisData) return true;
    try {
      const marker = sessionStorage.getItem('9cat_matchup_has_run');
      if (marker && marker === `${leagueData?.league_id || ''}-${myTeam?.team_id || ''}`) {
        return true;
      }
    } catch {}
    return hasAnyCachedAnalysisForTeam(leagueData?.league_id, myTeam?.team_id);
  }, [matchupAnalysisData, leagueData?.league_id, myTeam?.team_id]);

  // Compute client-side roster breakdown (open slots & Q/O tagged players not in IR)
  const localRosterMeta = useMemo(() => {
    if (!myTeam) return { openSlots: 0, taggedNotInIr: [], activeRoster: [] };
    const activeRoster = (myTeam.players || []).filter(
      p => !['IL', 'IL+', 'IR', 'IR+', 'NA'].includes(String(p.selected_position || '').toUpperCase())
    );
    const outOrQTags = new Set(['O', 'INJ', 'OUT', 'IL', 'INJURED', 'SUSP', 'Q', 'GTD', 'DTD', 'DOUBTFUL']);
    const outOnlyTags = new Set(['O', 'INJ', 'OUT', 'IL', 'INJURED', 'SUSP']);

    const taggedNotInIr = activeRoster
      .filter(p => outOrQTags.has(String(p.status || '').toUpperCase().trim()))
      .sort((a, b) => {
        const aOut = outOnlyTags.has(String(a.status || '').toUpperCase().trim()) ? 0 : 1;
        const bOut = outOnlyTags.has(String(b.status || '').toUpperCase().trim()) ? 0 : 1;
        if (aOut !== bOut) return aOut - bOut;
        return (a.z_total ?? 0) - (b.z_total ?? 0);
      });

    // Standard capacity from leagueData.roster_positions
    let standardCap = 13;
    if (Array.isArray(leagueData?.roster_positions) && leagueData.roster_positions.length > 0) {
      let count = 0;
      for (const pos of leagueData.roster_positions) {
        const pObj = pos?.roster_position || pos;
        const pName = String(pObj?.position || '').toUpperCase().trim();
        const pCount = Number(pObj?.count || 0);
        if (pName && !['IL', 'IL+', 'IR', 'IR+', 'NA'].includes(pName)) {
          count += pCount;
        }
      }
      if (count > 0) standardCap = count;
    }

    const openSlots = Math.max(0, standardCap - activeRoster.length);
    return { openSlots, standardCap, taggedNotInIr, activeRoster };
  }, [myTeam, leagueData?.roster_positions]);

  const allKnownPositions = useMemo(() => {
    const map = {};
    if (leagueData?.teams) {
      for (const t of leagueData.teams) {
        for (const p of t.players || []) {
          if (p.name && p.positions && p.positions !== 'Util') {
            map[p.name.trim()] = p.positions;
            map[p.name.trim().toLowerCase()] = p.positions;
          }
        }
      }
    }
    return map;
  }, [leagueData]);

  const getPlayerPositions = useCallback((player) => {
    if (player?.positions && player.positions !== 'Util') {
      return player.positions;
    }
    const name = player?.name?.trim();
    if (name) {
      if (allKnownPositions[name]) return allKnownPositions[name];
      if (allKnownPositions[name.toLowerCase()]) return allKnownPositions[name.toLowerCase()];
      if (playerPositionsFallback?.[name]) return playerPositionsFallback[name];
      if (playerPositionsFallback?.[name.toLowerCase()]) return playerPositionsFallback[name.toLowerCase()];
    }
    return (player?.positions && player.positions !== 'Util') ? player.positions : '';
  }, [allKnownPositions]);

  const [streamerRecs, setStreamerRecs] = useState(() => getCachedStreamers(streamerCacheKey));
  const [streamerLoading, setStreamerLoading] = useState(false);
  const [streamerError, setStreamerError] = useState(null);
  const [copiedPlayer, setCopiedPlayer] = useState(null);

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

    if (!forceRefresh && getCachedStreamers(streamerCacheKey)) {
      setStreamerRecs(getCachedStreamers(streamerCacheKey));
      setStreamerError(null);
      setStreamerLoading(false);
      return;
    }

    setStreamerLoading(true);
    setStreamerError(null);

    const allNames = leagueData?.teams ? leagueData.teams.flatMap(t => t.players.map(p => p.name)) : [];

    const body = {
      league_id:          String(leagueData.league_id || ''),
      team1:              myTeam,
      team2:              oppTeam,
      week_num:           weekNum,
      date_start:         dateStart,
      roster_positions:   leagueData.roster_positions ?? [],
      stats_source:       'weekly_stats',
      all_rostered_names: allNames,
      limit:              20,
      target_drop_player: null,
      pickup_mode:        pickupMode,
      punted_cats:        sortedPuntsKey ? sortedPuntsKey.split(',') : [],
    };

    try {
      let response = await fetch('/api/streamer-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      // If backend was mid-reload, retry once after a short delay
      if (!response.ok) {
        await new Promise(r => setTimeout(r, 600));
        response = await fetch('/api/streamer-recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (json.status === 'success' && json.payload) {
        setStreamerRecs(json.payload);
        setCachedStreamers(streamerCacheKey, json.payload);
      } else {
        throw new Error(json.message || 'Invalid streamer payload');
      }
    } catch (err) {
      console.error('Streamer recommendations request failed:', err);
      setStreamerError(err.message || 'Failed to fetch streamer recommendations.');
    } finally {
      setStreamerLoading(false);
    }
  }, [myTeam, oppTeam, leagueData, weekNum, dateStart, streamerCacheKey, pickupMode, sortedPuntsKey]);

  // Refetch automatically whenever streamerCacheKey (mode or selected player) changes
  useEffect(() => {
    if (!hasRunMatchupAnalyzer || !myTeam || !oppTeam) return;
    const cached = getCachedStreamers(streamerCacheKey);
    if (cached) {
      setStreamerRecs(cached);
    } else {
      fetchStreamers(false);
    }
  }, [hasRunMatchupAnalyzer, myTeam, oppTeam, streamerCacheKey, fetchStreamers]);

  // Merge backend roster_candidates with local roster metadata for the selector
  const candidateOptions = useMemo(() => {
    if (streamerRecs?.roster_candidates && streamerRecs.roster_candidates.length > 0) {
      return streamerRecs.roster_candidates;
    }
    const outSet = new Set(['O', 'INJ', 'OUT', 'IL', 'INJURED', 'SUSP']);
    const qSet = new Set(['Q', 'GTD', 'DTD', 'DOUBTFUL']);
    const mapped = localRosterMeta.activeRoster.map(p => {
      const statusUpper = String(p.status || '').toUpperCase().trim();
      const isTagged = outSet.has(statusUpper) || qSet.has(statusUpper);
      const remGames = matchupAnalysisData?.player_games?.team1?.[p.name]?.remaining;
      return {
        name: p.name,
        nba_team: p.nba_team,
        positions: p.positions,
        selected_position: p.selected_position,
        status: p.status || null,
        is_tagged: isTagged,
        z_total: Number(p.z_total ?? p.zSum ?? 0).toFixed(2),
        starts_week: remGames ?? '—',
        starts_today: '—',
        starts_in_window: remGames ?? '—',
        is_suggested: false,
      };
    });

    // Sort local fallback identically to backend: O/INJ tagged -> Q/GTD tagged -> fewest starts -> lowest Z-score (never put SGA first!)
    mapped.sort((a, b) => {
      const aTagRank = a.is_tagged ? (outSet.has(String(a.status || '').toUpperCase().trim()) ? 0 : 1) : 2;
      const bTagRank = b.is_tagged ? (outSet.has(String(b.status || '').toUpperCase().trim()) ? 0 : 1) : 2;
      if (aTagRank !== bTagRank) return aTagRank - bTagRank;
      const aStarts = typeof a.starts_in_window === 'number' ? a.starts_in_window : 99;
      const bStarts = typeof b.starts_in_window === 'number' ? b.starts_in_window : 99;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return Number(a.z_total) - Number(b.z_total);
    });

    return mapped;
  }, [streamerRecs?.roster_candidates, localRosterMeta.activeRoster, matchupAnalysisData]);

  const taggedCandidates = useMemo(
    () => candidateOptions.filter(c => c.is_tagged),
    [candidateOptions]
  );

  const openRosterSpots = streamerRecs?.open_roster_spots ?? localRosterMeta.openSlots;
  const openIlSlots = streamerRecs?.open_il_slots ?? 0;
  const suggestedAction = streamerRecs?.suggested_action || streamerRecs?.roster_action;

  // Determine recommended target key under Auto mode
  const recommendedTargetKey = useMemo(() => {
    if (openRosterSpots > 0) return '__OPEN_SLOT__';
    if (suggestedAction?.target_player) return suggestedAction.target_player;
    const firstSuggested = candidateOptions.find(c => c.is_suggested);
    if (firstSuggested) return firstSuggested.name;
    return null;
  }, [openRosterSpots, suggestedAction, candidateOptions]);

  const effectiveSelectedKey = useMemo(() => {
    if (selectedDropPlayer === '__AUTO__') {
      return recommendedTargetKey || '';
    }
    if (selectedDropPlayer === '__OPEN_SLOT__' && openRosterSpots <= 0) {
      return recommendedTargetKey || candidateOptions[0]?.name || '';
    }
    return selectedDropPlayer;
  }, [selectedDropPlayer, openRosterSpots, recommendedTargetKey, candidateOptions]);

  // Instant 0ms bundle lookup for the active target drop / open spot
  const activeBundle = useMemo(() => {
    if (!streamerRecs) return null;
    const byTarget = streamerRecs.recommendations_by_target;
    if (byTarget && effectiveSelectedKey && byTarget[effectiveSelectedKey]) {
      return byTarget[effectiveSelectedKey];
    }
    return {
      roster_action: streamerRecs.roster_action || suggestedAction,
      drop_player: streamerRecs.drop_player,
      has_beneficial_streamers: streamerRecs.has_beneficial_streamers,
      hold_recommended: streamerRecs.hold_recommended,
      hold_reason: streamerRecs.hold_reason,
      recommendations: streamerRecs.recommendations || [],
    };
  }, [streamerRecs, effectiveSelectedKey, suggestedAction]);

  const activeAction = activeBundle?.roster_action || suggestedAction;
  const isHoldRecommended = Boolean(
    activeBundle?.hold_recommended ||
    activeAction?.type === 'HOLD'
  );

  const rawRecs = activeBundle?.recommendations || [];
  const filteredRecs = useMemo(() => {
    const list = rawRecs.filter(rec => {
      const p = rec.player || {};
      if (dismissedPlayers.has(p.name)) return false;
      if (healthyOnly && ANY_INJ_TAGS.has(String(p.status || '').toUpperCase().trim())) return false;
      if (posFilter !== 'ALL') {
        const posStr = String(getPlayerPositions(p) || p.positions || '').toUpperCase();
        const tokens = posStr.split(/[,/|]+/).map(s => s.trim()).filter(Boolean);
        if (!tokens.includes(posFilter)) return false;
      }
      if (boostCatFilter !== 'ALL') {
        const catObj = (rec.impact?.primary_boost_categories || []).find(b => {
          const disp = b.cat === 'FG3M' ? '3PM' : b.cat;
          return disp === boostCatFilter || b.cat === boostCatFilter;
        });
        if (!catObj || (catObj.delta_p ?? 0) < 0.01) return false;
      }
      return true;
    });

    const sorted = [...list];
    if (sortBy === 'games') {
      sorted.sort((a, b) => (b.schedule?.startable_games ?? 0) - (a.schedule?.startable_games ?? 0) || (b.impact?.expected_win_delta ?? 0) - (a.impact?.expected_win_delta ?? 0));
    } else if (sortBy === 'ros_rank') {
      sorted.sort((a, b) => (a.player?.ros_rank ?? 999) - (b.player?.ros_rank ?? 999) || (b.impact?.expected_win_delta ?? 0) - (a.impact?.expected_win_delta ?? 0));
    } else if (['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m'].includes(sortBy)) {
      const key = `mu_${sortBy}`;
      sorted.sort((a, b) => (b.player?.[key] ?? 0) - (a.player?.[key] ?? 0));
    }
    return sorted;
  }, [rawRecs, dismissedPlayers, healthyOnly, posFilter, boostCatFilter, sortBy, getPlayerPositions]);

  const visibleRecs = useMemo(() => filteredRecs.slice(0, visibleLimit), [filteredRecs, visibleLimit]);

  const toggleDismissPlayer = useCallback((name) => {
    setDismissedPlayers(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const visibleCandidateCards = useMemo(() => {
    if (showAllRoster) return candidateOptions;
    const initialLimit = openRosterSpots > 0 ? 4 : 5;
    return candidateOptions.slice(0, initialLimit);
  }, [candidateOptions, showAllRoster, openRosterSpots]);

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
          <div style={{ fontSize: '4rem' }}>🎯</div>
          <h2 style={{ marginBottom: '0.5rem' }}>No Team Data</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Analyze your team and run the Matchup Analyzer first to get streamer recommendations.
          </p>
          <button className="btn-primary" onClick={() => navigate('/')}>Analyze My Team</button>
        </div>
      </div>
    );
  }

  // Gate: Require Matchup Analyzer to be run first
  if (!hasRunMatchupAnalyzer) {
    return (
      <div className="page-wrapper center-content fade-up">
        <div className="card empty-state" style={{ maxWidth: '540px', padding: '3rem 2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '0.75rem' }}>⚔️</div>
          <h2 style={{ marginBottom: '0.5rem' }}>Run Matchup Analyzer First</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: 1.55, fontSize: '0.92rem' }}>
            Streamer recommendations are tailored to your active weekly matchup&apos;s contested swing categories, open roster/IL spots, and daily starting lineup schedule. Run the Matchup Analyzer first to generate your matchup baseline.
          </p>
          <button
            type="button"
            className="btn-primary"
            style={{ padding: '10px 22px', fontSize: '0.95rem' }}
            onClick={() => navigate('/matchup')}
          >
            ⚔️ Run Matchup Analyzer First
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="matchup-page page-wrapper fade-up">
      <div className="section">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <h1 className="section-title" style={{ textAlign: 'left' }}>🎯 Streamer Suggestions</h1>
            <p className="section-subtitle" style={{ textAlign: 'left' }}>
              Optimal free agent pickups ranked by net category win probability impact (ΔE) and schedule fit
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {oppTeam && (
              <div className="matchup-pill highlight" style={{ padding: '8px 14px', fontSize: '0.85rem' }}>
                ⚔️ <strong>{myTeam.name}</strong> vs. <strong>{oppTeam.name}</strong> &middot; Week {weekNum}
              </div>
            )}
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
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '8px 14px', fontSize: '0.82rem' }}
              onClick={() => navigate('/matchup')}
            >
              ← Back to Matchup Analyzer
            </button>
          </div>
        </div>

        <CategoryToggle
          puntedCats={puntedCats}
          onToggle={togglePunt}
          label="Punt Build (Ignored in Streamer Scoring)"
        />

        {/* Streamer Setup Card: Visual Player Selector + Pickup Window Toggle */}
        <div className="card streamer-controls-card">
          {/* Header Row: Step Title + Pickup Window Toggle */}
          <div className="streamer-setup-header">
            <div className="streamer-setup-title-group">
              <div className="streamer-setup-title">
                Who Are You Replacing to Open a Streamer Spot?
              </div>
              <div className="streamer-setup-subtitle">
                {openRosterSpots > 0
                  ? 'You have an open roster spot — or click a player below to compare replacing them.'
                  : 'Click a player below so we compare incoming free agent games against the exact starts you give up.'}
              </div>
            </div>

            <div className="streamer-horizon-box">
              <span className="streamer-horizon-label">Pickup Window</span>
              <div className="streamer-mode-toggle" role="group" aria-label="Pickup evaluation horizon">
                <button
                  type="button"
                  className={`mode-toggle-btn ${pickupMode === 'week' ? 'active' : ''}`}
                  onClick={() => setPickupMode('week')}
                >
                  📅 Rest of Week
                </button>
                <button
                  type="button"
                  className={`mode-toggle-btn ${pickupMode === 'today' ? 'active' : ''}`}
                  onClick={() => setPickupMode('today')}
                >
                  ⚡ Today Only
                </button>
              </div>
            </div>
          </div>

          {/* Visual Player Selection Grid */}
          <div className="streamer-player-grid">
            {/* Option 0: Open Roster Spot — ONLY shown when the team actually has an open roster spot */}
            {openRosterSpots > 0 && (() => {
              const isSelected = effectiveSelectedKey === '__OPEN_SLOT__';
              const isRec = recommendedTargetKey === '__OPEN_SLOT__';
              return (
                <button
                  type="button"
                  className={`streamer-player-option-card open-slot-card ${isSelected ? 'selected' : ''} ${isRec ? 'is-recommended' : ''}`}
                  onClick={() => setSelectedDropPlayer('__OPEN_SLOT__')}
                >
                  <div className="sp-card-top">
                    <span className="sp-player-name">➕ Open Roster Spot</span>
                    <span className="sp-status-pill rec">
                      {isRec ? 'Recommended' : `${openRosterSpots} Open`}
                    </span>
                  </div>
                  <div className="sp-card-meta">
                    You have {openRosterSpots} unfilled roster spot{openRosterSpots !== 1 ? 's' : ''}
                  </div>
                  <div className="sp-card-chips">
                    <span className="sp-chip zero-starts">🏀 0 starts lost</span>
                    <span className="sp-chip">Pure addition</span>
                  </div>
                </button>
              );
            })()}

            {/* Roster Candidate Mini-Cards */}
            {visibleCandidateCards.map(c => {
              const isSelected = effectiveSelectedKey === c.name;
              const isRec = !isHoldRecommended && recommendedTargetKey === c.name;
              const statusUpper = String(c.status || '').toUpperCase().trim();
              const isOut = ['O', 'INJ', 'OUT', 'IL', 'INJURED', 'SUSP'].includes(statusUpper);
              const startsCount = pickupMode === 'today' ? c.starts_today : c.starts_week;
              const numericStarts = Number(startsCount);
              const isZeroStarts = !Number.isNaN(numericStarts) && numericStarts === 0;
              const zVal = Number(c.z_total ?? 0);

              return (
                <button
                  key={c.name}
                  type="button"
                  className={`streamer-player-option-card ${isSelected ? 'selected' : ''} ${c.is_tagged ? 'is-tagged' : ''} ${isRec ? 'is-recommended' : ''}`}
                  onClick={() => setSelectedDropPlayer(c.name)}
                >
                  <div className="sp-card-top">
                    <span className="sp-player-name" title={c.name}>{c.name}</span>
                    <div className="sp-badges">
                      {c.status && (
                        <span className={`sp-status-pill ${isOut ? 'out' : 'q'}`}>
                          {c.status}
                        </span>
                      )}
                      {isRec && (
                        <span className="sp-status-pill rec">
                          {isOut && openIlSlots > 0 ? 'IR Move' : 'Suggested'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="sp-card-meta">
                    <span>{c.nba_team} &middot; {getPlayerPositions(c) || c.positions}</span>
                    {c.selected_position && (
                      <span className="sp-slot-tag">{c.selected_position}</span>
                    )}
                  </div>

                  <div className="sp-card-chips">
                    <span
                      className={`sp-chip ${isZeroStarts ? 'zero-starts' : ''}`}
                      title={
                        pickupMode === 'today'
                          ? 'Active lineup starts today'
                          : 'Remaining active lineup starts this week'
                      }
                    >
                      🏀 {startsCount} {pickupMode === 'today' ? 'start today' : `start${startsCount === 1 ? '' : 's'} left`}
                    </span>
                    <span className="sp-chip" title="Weekly per-game Z-score sum">
                      Z: {zVal > 0 ? `+${c.z_total}` : c.z_total}
                    </span>
                    {c.hold_tier === 'MUST_HOLD' ? (
                      <span
                        className="sp-chip ros-hold"
                        title={`Top Rest-of-Season value (${c.ros_rank ? `ROS #${c.ros_rank}` : 'Core ROS'}) — protected from automatic drops`}
                      >
                        🔒 {c.ros_rank ? `ROS #${c.ros_rank}` : 'ROS Hold'}
                      </span>
                    ) : c.ros_rank ? (
                      <span className="sp-chip ros-rank" title="Rest-of-season market rank">
                        ROS #{c.ros_rank}
                      </span>
                    ) : null}
                    {typeof c.max_delta_e === 'number' && (
                      <span
                        className={`sp-chip ${c.max_delta_e > 0 ? 'gain-pos' : 'gain-neg'}`}
                        title="Maximum category win probability delta achievable by streaming for this player"
                      >
                        {c.max_delta_e > 0 ? `Max Gain: +${c.max_delta_e.toFixed(2)} ΔE` : `Max Gain: ${c.max_delta_e.toFixed(2)} ΔE`}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footer Bar: Active Summary on Left + Expand/Collapse Full Roster on Right */}
          <div className="streamer-setup-footer">
            <div className={`streamer-active-summary ${activeAction?.type === 'HOLD_WARNING' ? 'is-hold-warn' : ''}`}>
              <span className="sas-dot" />
              {activeAction?.reason ? (
                <span>{activeAction.reason}</span>
              ) : effectiveSelectedKey === '__OPEN_SLOT__' ? (
                <span>Evaluating Free Agents into an <strong>Open Roster / IR Spot</strong> (0 starts lost).</span>
              ) : (
                <span>Evaluating Free Agents replacing <strong>{effectiveSelectedKey}</strong>.</span>
              )}
              {selectedDropPlayer !== '__AUTO__' && (
                <button
                  type="button"
                  className="streamer-reset-auto-btn"
                  onClick={() => setSelectedDropPlayer('__AUTO__')}
                >
                  Reset to Auto
                </button>
              )}
            </div>

            {candidateOptions.length > (openRosterSpots > 0 ? 4 : 5) && (
              <button
                type="button"
                className="streamer-expand-btn"
                onClick={() => setShowAllRoster(prev => !prev)}
              >
                {showAllRoster
                  ? 'Show Top Candidates Only ▴'
                  : `Show All ${candidateOptions.length} Roster Players ▾`}
              </button>
            )}
          </div>
        </div>

        {streamerLoading ? (
          <div className="card streamer-loading-state" style={{ textAlign: 'center', padding: '3.5rem 1.5rem' }}>
            <div className="spinner large" style={{ width: '40px', height: '40px', borderWidth: '3px', margin: '0 auto 1.25rem' }} />
            <h3 style={{ margin: '0 0 0.5rem', fontWeight: 700 }}>
              Analyzing {pickupMode === 'today' ? "Today's Single-Game Streamers" : 'Rest-of-Week Streamers'}…
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', maxWidth: '520px', margin: '0 auto' }}>
              Triaging contested categories, comparing net lineup starts, and calculating category win probability changes.
            </p>
          </div>
        ) : streamerRecs && rawRecs ? (
          <div className="streamer-dashboard">
            {/* 1. Category Triage Bar */}
            {(() => {
              const catDiagEntries = Object.entries(streamerRecs.matchup_diagnostics?.categories || {});
              const puntedDiagEntries = catDiagEntries.filter(([_, d]) => d.status === 'PUNTED' || d.is_punted);
              return (
                <div className="streamer-diag-card card">
                  <div className="streamer-diag-header">
                    <div>
                      <div className="streamer-diag-title">Category Matchup Diagnostics</div>
                      <div className="streamer-diag-subtitle">
                        Prioritizes contested swing categories (15%–85%) while skipping your punted categories.
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

                  <div className={`streamer-triage-grid ${puntedDiagEntries.length > 0 ? 'has-punts' : ''}`}>
                    <div className="triage-column safe">
                      <div className="triage-column-header">
                        <span className="triage-status-dot safe" />
                        <span>Safe Leads (Protect)</span>
                      </div>
                      <div className="triage-tags">
                        {catDiagEntries
                          .filter(([_, d]) => d.status === 'SAFE')
                          .map(([k, d]) => (
                            <span key={k} className="triage-tag safe" title={`Win Prob: ${Math.round(d.p_win * 100)}%`}>
                              <strong>{k === 'fg3m' ? '3PM' : k.toUpperCase()}</strong> {Math.round(d.p_win * 100)}%
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
                        {catDiagEntries
                          .filter(([_, d]) => d.status === 'SWING')
                          .map(([k, d]) => (
                            <span key={k} className="triage-tag swing" title={`Margin: ${d.margin > 0 ? '+' : ''}${d.margin}`}>
                              <strong>{k === 'fg3m' ? '3PM' : k.toUpperCase()}</strong> {Math.round(d.p_win * 100)}% ({d.margin > 0 ? '+' : ''}{d.margin})
                            </span>
                          ))}
                      </div>
                    </div>

                    <div className="triage-column doomed">
                      <div className="triage-column-header">
                        <span className="triage-status-dot doomed" />
                        <span>Trailing / Longshots</span>
                      </div>
                      <div className="triage-tags">
                        {catDiagEntries
                          .filter(([_, d]) => d.status === 'DOOMED')
                          .map(([k, d]) => (
                            <span key={k} className="triage-tag doomed" title={`Win Prob: ${Math.round(d.p_win * 100)}%`}>
                              <strong>{k === 'fg3m' ? '3PM' : k.toUpperCase()}</strong> {Math.round(d.p_win * 100)}%
                            </span>
                          ))}
                      </div>
                    </div>

                    {puntedDiagEntries.length > 0 && (
                      <div className="triage-column punted">
                        <div className="triage-column-header">
                          <span className="triage-status-dot punted" />
                          <span>Punted by You</span>
                        </div>
                        <div className="triage-tags">
                          {puntedDiagEntries.map(([k]) => (
                            <span key={k} className="triage-tag punted" title="Excluded from streamer ΔE calculation">
                              <strong>{k === 'fg3m' ? '3PM' : k.toUpperCase()}</strong> PUNT
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 2. Streamer Recommendation Cards */}
            <div className="streamer-cards-container">
              <div className="streamer-section-label">
                <span>
                  {pickupMode === 'today'
                    ? `Top Single-Day Streamers for Today (${dateStart})`
                    : `Top Rest-of-Week Streamers for Week ${weekNum}`}
                </span>
                <span className="streamer-section-sub">
                  Ranked by swing-weighted Expected Categories Gained (ΔE) across {9 - puntedCats.size} active categories
                </span>
              </div>

              {/* Filter & Sort Toolbar */}
              {rawRecs.length > 0 && (
                <div className="streamer-filter-bar card">
                  <div className="sf-pills">
                    {STREAMER_POS_FILTERS.map(pos => (
                      <button
                        key={pos}
                        type="button"
                        className={`sf-pill ${posFilter === pos ? 'active' : ''}`}
                        onClick={() => setPosFilter(pos)}
                      >
                        {pos === 'ALL' ? 'All Pos' : pos}
                      </button>
                    ))}
                  </div>

                  <div className="sf-controls">
                    <select className="sf-select" value={boostCatFilter} onChange={e => setBoostCatFilter(e.target.value)} aria-label="Filter by category boost">
                      <option value="ALL">Boosts Any Cat</option>
                      {STREAMER_CAT_FILTERS.filter(c => c !== 'ALL').map(c => (
                        <option key={c} value={c}>Boosts {c}</option>
                      ))}
                    </select>

                    <select className="sf-select" value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Sort streamers">
                      <option value="delta_e">Sort: Impact (ΔE)</option>
                      <option value="games">Sort: Startable Games</option>
                      <option value="ros_rank">Sort: ROS Rank</option>
                      <option value="pts">Sort: PTS / gm</option>
                      <option value="reb">Sort: REB / gm</option>
                      <option value="ast">Sort: AST / gm</option>
                      <option value="stl">Sort: STL / gm</option>
                      <option value="blk">Sort: BLK / gm</option>
                      <option value="fg3m">Sort: 3PM / gm</option>
                    </select>

                    <label className="sf-check" title="Hide GTD / Q / Doubtful / Out players">
                      <input type="checkbox" checked={healthyOnly} onChange={e => setHealthyOnly(e.target.checked)} />
                      <span>Healthy only</span>
                    </label>

                    {dismissedPlayers.size > 0 && (
                      <button
                        type="button"
                        className="sf-reset-hidden-btn"
                        onClick={() => setDismissedPlayers(new Set())}
                      >
                        Restore {dismissedPlayers.size} hidden
                      </button>
                    )}
                  </div>
                </div>
              )}

              {rawRecs.length === 0 ? (
                <div className="card streamer-empty-state" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📅</div>
                  <h3 style={{ margin: '0 0 0.4rem', fontWeight: 700 }}>
                    No Startable Free Agents Found for {pickupMode === 'today' ? 'Today' : 'This Window'}
                  </h3>
                  <p style={{ color: 'var(--text-secondary)', maxWidth: '520px', margin: '0 auto', fontSize: '0.86rem' }}>
                    {pickupMode === 'today'
                      ? 'Either your active starting slots are already full today or the selected player is not occupying an active slot today. Try selecting a player who starts today or switch to Rest of Week.'
                      : 'Your active starting lineup slots are full on remaining game days for the selected replacement option.'}
                  </p>
                </div>
              ) : (() => {
                const contestedCatSet = new Set(
                  Object.entries(streamerRecs?.matchup_diagnostics?.categories || {})
                    .filter(([_, d]) => d.status === 'SWING' || d.target === true)
                    .flatMap(([k]) => {
                      const u = k.toUpperCase();
                      const norm = u === 'FG3M' ? '3PM' : (u === 'TOV' ? 'TO' : u);
                      return [u, norm];
                    })
                );

                return (
                <div className="streamer-results-wrap">
                  {/* Hold Recommendation Banner when dropping this player hurts matchup odds or sacrifices ROS value */}
                  {(isHoldRecommended || (!activeBundle?.has_beneficial_streamers && rawRecs.length > 0)) && (
                    <div className="sc-hold-banner">
                      <div className="sc-hold-icon">🛡️</div>
                      <div className="sc-hold-body">
                        <h4 className="sc-hold-title">Hold Recommended — No Positive Pickup Found</h4>
                        <p className="sc-hold-text">
                          {activeBundle?.hold_reason || `Dropping ${activeBundle?.drop_player?.name || activeAction?.target_player || 'your current option'} for any available waiver option results in a net expected category loss (ΔE ≤ 0). Keeping your current roster is the higher expected value move.`}
                        </p>
                      </div>
                    </div>
                  )}

                  {visibleRecs.length === 0 ? (
                    <div className="card streamer-empty-state" style={{ textAlign: 'center', padding: '2rem 1.5rem' }}>
                      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                        No free agents match the active filters ({rawRecs.length} evaluated).
                      </p>
                    </div>
                  ) : (
                    <>
                <div className="streamer-cards-grid">
                  {visibleRecs.map(rec => {
                    const p = rec.player;
                    const action = rec.action;
                    const sched = rec.schedule;
                    const impact = rec.impact;
                    const isCopied = copiedPlayer === p.name;
                    const isTopBeneficial = rec.rank === 1 && rec.is_beneficial !== false && impact.expected_win_delta > 0;
                    const isNegativeNet = rec.is_negative || impact.expected_win_delta <= 0;

                    const dropStarts = Number(action?.drop_starts ?? 0);
                    const netStarts = sched.net_team_starts ?? (sched.startable_games - dropStarts);
                    const vsDrop = rec.vs_drop;
                    const dropStats = vsDrop?.stats;
                    const pLastName = p.name ? p.name.split(' ').slice(-1)[0] : 'Pick';
                    const dropLastName = vsDrop?.drop_name ? vsDrop.drop_name.split(' ').slice(-1)[0] : 'drop';
                    const formatStat = (v) => typeof v === 'number' ? v.toFixed(1) : (v ?? '0.0');
                    const formatDiff = (d) => typeof d === 'number' ? (d > 0 ? `+${d.toFixed(1)}` : d.toFixed(1)) : '0.0';

                    const fgStreamerFgm = dropStats?.fg_pct?.streamer_fgm ?? p.mu_fgm ?? 0;
                    const fgStreamerFga = dropStats?.fg_pct?.streamer_fga ?? p.mu_fga ?? 0;
                    const fgDropFgm = dropStats?.fg_pct?.drop_fgm ?? 0;
                    const fgDropFga = dropStats?.fg_pct?.drop_fga ?? 0;
                    const fgDiffFga = dropStats?.fg_pct?.diff_fga ?? Math.round((fgStreamerFga - fgDropFga) * 10) / 10;
                    const fgDiffPct = dropStats?.fg_pct?.diff ?? 0;

                    const ftStreamerFtm = dropStats?.ft_pct?.streamer_ftm ?? p.mu_ftm ?? 0;
                    const ftStreamerFta = dropStats?.ft_pct?.streamer_fta ?? p.mu_fta ?? 0;
                    const ftDropFtm = dropStats?.ft_pct?.drop_ftm ?? 0;
                    const ftDropFta = dropStats?.ft_pct?.drop_fta ?? 0;
                    const ftDiffFta = dropStats?.ft_pct?.diff_fta ?? Math.round((ftStreamerFta - ftDropFta) * 10) / 10;
                    const ftDiffPct = dropStats?.ft_pct?.diff ?? 0;

                    const statCategories = [
                      { key: 'PTS', label: 'PTS', pVal: p.mu_pts, dropVal: dropStats?.pts?.drop_pg, diff: dropStats?.pts?.diff_pg, netWk: dropStats?.pts?.net_weekly },
                      { key: 'REB', label: 'REB', pVal: p.mu_reb, dropVal: dropStats?.reb?.drop_pg, diff: dropStats?.reb?.diff_pg, netWk: dropStats?.reb?.net_weekly },
                      { key: 'AST', label: 'AST', pVal: p.mu_ast, dropVal: dropStats?.ast?.drop_pg, diff: dropStats?.ast?.diff_pg, netWk: dropStats?.ast?.net_weekly },
                      { key: 'STL', label: 'STL', pVal: p.mu_stl, dropVal: dropStats?.stl?.drop_pg, diff: dropStats?.stl?.diff_pg, netWk: dropStats?.stl?.net_weekly },
                      { key: 'BLK', label: 'BLK', pVal: p.mu_blk, dropVal: dropStats?.blk?.drop_pg, diff: dropStats?.blk?.diff_pg, netWk: dropStats?.blk?.net_weekly },
                      { key: 'FG3M', label: '3PM', pVal: p.mu_fg3m, dropVal: dropStats?.fg3m?.drop_pg, diff: dropStats?.fg3m?.diff_pg, netWk: dropStats?.fg3m?.net_weekly },
                      { key: 'TO', label: 'TO', lowerBetter: true, pVal: p.mu_tov, dropVal: dropStats?.tov?.drop_pg, diff: dropStats?.tov?.diff_pg, netWk: dropStats?.tov?.net_weekly },
                    ];

                    return (
                      <div key={p.name} className={`streamer-card card ${isTopBeneficial ? 'top-rank' : ''} ${isNegativeNet ? 'is-net-loss' : ''}`}>
                        {/* 1. Card Header: Rank, Player Identity, Quick Copy, Dismiss & Net Expected Cats Gained */}
                        <div className="sc-header">
                          <div
                            className="sc-rank-badge"
                            title={p.rank ? `Weekly Projection Rank: #${p.rank}${p.ros_rank ? ` · ROS Rank: #${p.ros_rank}` : ''}` : 'Unranked in Top Tier'}
                          >
                            <span className="sc-rank-num">{p.rank ? `#${p.rank}` : 'NR'}</span>
                            <span className="sc-rank-sub">WK RNK</span>
                          </div>

                          <div className="sc-player-info">
                            <div className="sc-name-row">
                              <span className="sc-name" title={p.name}>{p.name}</span>
                              {p.status && (
                                <span
                                  className="sp-status-pill q"
                                  title={`Status: ${p.status}${p.play_prob != null && p.play_prob < 1 ? ` (~${Math.round(p.play_prob * 100)}% play weight)` : ''}`}
                                >
                                  {p.status}
                                </span>
                              )}
                              <button
                                type="button"
                                className={`sc-inline-copy-btn ${isCopied ? 'copied' : ''}`}
                                onClick={() => handleCopyPlayer(p.name)}
                                title="Copy player name for Yahoo Fantasy search"
                              >
                                {isCopied ? '✓ Copied' : '📋 Copy'}
                              </button>
                              <button
                                type="button"
                                className="sc-dismiss-btn"
                                onClick={() => toggleDismissPlayer(p.name)}
                                title="Hide player (e.g. already picked up in your league)"
                                aria-label={`Hide ${p.name}`}
                              >
                                ✕
                              </button>
                            </div>
                            <div className="sc-meta-row">
                              <span className="sc-team-pos-pill">
                                {p.nba_team}{getPlayerPositions(p) ? ` · ${getPlayerPositions(p)}` : ''}
                              </span>
                              <span className="sc-z-pill" title="Active-category Z-score sum">
                                Z: {p.z_total > 0 ? '+' : ''}{p.z_total?.toFixed(2) ?? '0.00'}
                              </span>
                              {(p.ros_rank || p.is_ros_hold) && (
                                <span
                                  className={`sc-ros-pill ${p.is_ros_hold ? 'hold' : ''}`}
                                  title="Rest-of-season value rank (multi-week hold upside)"
                                >
                                  {p.is_ros_hold ? '⭐ ' : ''}ROS #{p.ros_rank ?? 'Core'}
                                </span>
                              )}
                              {p.fg_pct > 0 && (
                                <span className="sc-eff-meta">
                                  {p.fg_pct}% FG &middot; {p.ft_pct}% FT
                                </span>
                              )}
                            </div>
                          </div>

                          <div
                            className={`sc-delta-box ${impact.expected_win_delta < 0 ? 'neg' : ''}`}
                            title="Expected Categories Gained (Cat Win Delta / ΔE): Swing-weighted sum of win probability gains across your active categories."
                          >
                            <span className={`sc-delta-val ${impact.expected_win_delta < 0 ? 'neg' : ''}`}>
                              {impact.expected_win_delta >= 0 ? '+' : ''}{impact.expected_win_delta.toFixed(2)}
                            </span>
                            <span className={`sc-delta-lbl ${impact.expected_win_delta < 0 ? 'neg' : ''}`}>
                              {impact.expected_win_delta < 0 ? 'Net Loss' : 'Exp. Cats'}
                            </span>
                          </div>
                        </div>

                        {/* 2. Pickup vs Drop Comparison Banner */}
                        {vsDrop ? (
                          <div className="sc-compare-bar" title={`Replacement plan: Pickup ${p.name}, drop ${vsDrop.drop_name}`}>
                            <div className="sc-compare-bar-main">
                              <div className="sc-compare-target-info">
                                <span className="sc-compare-badge">⇄ REPLACING</span>
                                <span className="sc-compare-name">{vsDrop.drop_name}</span>
                                <span className="sc-compare-sub">
                                  ({vsDrop.drop_team || 'Bench'} &middot; {vsDrop.drop_starts} start{vsDrop.drop_starts !== 1 ? 's' : ''})
                                </span>
                              </div>
                              <div className="sc-compare-pills">
                                <span
                                  className={`sc-diff-pill ${netStarts >= 0 ? 'pos' : 'neg'}`}
                                  title={`Net team starting slots gained${sched.bench_backfill_games > 0 ? ` (includes +${sched.bench_backfill_games} bench backfill)` : ''}`}
                                >
                                  {netStarts >= 0 ? `+${netStarts}` : netStarts} starts
                                </span>
                                <span
                                  className={`sc-diff-pill ${vsDrop.z_diff >= 0 ? 'pos' : 'neg'}`}
                                  title={`Z-score quality difference: ${p.z_total?.toFixed(2)} vs ${action?.drop_z > 0 ? '+' : ''}${action?.drop_z ?? 0}`}
                                >
                                  {vsDrop.z_diff >= 0 ? `+${vsDrop.z_diff.toFixed(2)}` : vsDrop.z_diff.toFixed(2)} Z
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : action?.type === 'OPEN_SLOT' ? (
                          <div className="sc-compare-bar open-slot">
                            <div className="sc-compare-bar-main">
                              <div className="sc-compare-target-info">
                                <span className="sc-compare-badge open">➕ OPEN SPOT</span>
                                <span className="sc-compare-name">No Player Dropped</span>
                                <span className="sc-compare-sub">({sched.startable_games} starts added directly)</span>
                              </div>
                              <div className="sc-compare-pills">
                                <span className="sc-diff-pill pos">0 Drops</span>
                                <span className="sc-diff-pill pos">+{sched.startable_games} starts</span>
                              </div>
                            </div>
                          </div>
                        ) : action?.type === 'HOLD' ? (
                          <div className="sc-compare-bar hold">
                            <div className="sc-compare-bar-main">
                              <div className="sc-compare-target-info">
                                <span className="sc-compare-badge hold">🛡️ HOLD ROSTER</span>
                                <span className="sc-compare-name">Keep Current Roster</span>
                                <span className="sc-compare-sub">(No drop recommended &middot; all options ΔE ≤ 0)</span>
                              </div>
                              <div className="sc-compare-pills">
                                <span className="sc-diff-pill neg">Net Category Loss</span>
                                <span className="sc-diff-pill pos">0 Drops Needed</span>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {/* 3. Statline Comparison: 7 Sculpted Counting Tiles (incl. lower-is-better TO) */}
                        <div className="sc-stat-comparison-wrap">
                          {vsDrop && (
                            <div className="sc-tiles-legend">
                              <span className="sc-leg-item pick">
                                <span className="sc-leg-dot pick" /> {pLastName} (pickup)
                              </span>
                              <span className="sc-leg-item drop">
                                <span className="sc-leg-dot drop" /> {dropLastName} (drop)
                              </span>
                              <span className="sc-leg-item diff">
                                &Delta; Net / gm
                              </span>
                            </div>
                          )}

                          <div className="sc-stat-tiles-grid">
                            {statCategories.map(st => {
                              const diff = st.diff ?? 0;
                              const isGoodDiff = st.lowerBetter ? diff < 0 : diff > 0;
                              const isBadDiff = st.lowerBetter ? diff > 0 : diff < 0;
                              const isAdvantage = vsDrop ? isGoodDiff : (st.lowerBetter ? false : (st.pVal || 0) > 0);
                              const isDisadvantage = vsDrop && isBadDiff;
                              const isContested = contestedCatSet.has(st.key) || contestedCatSet.has(st.label);
                              return (
                                <div
                                  key={st.label}
                                  className={`sc-stat-tile ${isAdvantage ? 'advantage' : ''} ${isDisadvantage ? 'disadvantage' : ''} ${isContested ? 'contested' : ''}`}
                                  title={`${st.label}${st.lowerBetter ? ' (lower is better)' : ''}: ${p.name} (${formatStat(st.pVal)}) vs ${vsDrop ? vsDrop.drop_name : 'none'} (${vsDrop ? formatStat(st.dropVal) : '-'})${isContested ? ' · Contested Swing Battle' : ''}`}
                                >
                                  <div className="sc-tile-cat-row">
                                    <span className={`sc-tile-cat ${isAdvantage ? 'advantage' : isDisadvantage ? 'disadvantage' : ''}`}>{st.label}</span>
                                    {isContested && <span className="sc-tile-swing-dot" title="Contested Swing Battle (15%–85% win prob)">⚡</span>}
                                  </div>
                                  <div className="sc-tile-values">
                                    <span className="sc-tile-pick-val">{formatStat(st.pVal)}</span>
                                    {vsDrop && (
                                      <span className="sc-tile-drop-val" title={`Drop (${dropLastName}): ${formatStat(st.dropVal)}`}>
                                        <span className="sc-tile-vs">vs</span> {formatStat(st.dropVal)}
                                      </span>
                                    )}
                                  </div>
                                  {vsDrop && (
                                    <div
                                      className={`sc-tile-diff-pill ${isGoodDiff ? 'pos' : isBadDiff ? 'neg' : 'neutral'}`}
                                      title={`${st.label} net weekly: ${st.netWk >= 0 ? '+' : ''}${st.netWk ?? 0}`}
                                    >
                                      {formatDiff(st.diff)}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* 4. Dual Efficiency Comparison Cards: FG% & FT% with Volume Impact */}
                          {(() => {
                            const isFgContested = contestedCatSet.has('FG%');
                            const isFtContested = contestedCatSet.has('FT%');
                            return (
                          <div className="sc-efficiency-dual-grid">
                            {/* Card A: Field Goal Efficiency */}
                            <div className={`sc-eff-tile ${isFgContested ? 'contested' : ''}`}>
                              <div className="sc-eff-tile-hdr">
                                <div className="sc-eff-hdr-left">
                                  <span className="sc-eff-tile-name">Field Goals (FG%)</span>
                                  {isFgContested && <span className="sc-eff-swing-bolt" title="Contested Matchup Category">⚡</span>}
                                </div>
                                {vsDrop && (
                                  <span className={`sc-eff-badge ${fgDiffPct >= 0 ? 'pos' : 'neg'}`}>
                                    {fgDiffPct >= 0 ? `+${fgDiffPct}%` : `${fgDiffPct}%`}
                                  </span>
                                )}
                              </div>
                              <div className="sc-eff-tile-body">
                                <div className="sc-eff-col pick">
                                  <span className="sc-eff-pct">{p.fg_pct}%</span>
                                  <span className="sc-eff-vol">{fgStreamerFgm}/{fgStreamerFga} FGA</span>
                                </div>
                                {vsDrop && (
                                  <>
                                    <span className="sc-eff-sep">vs</span>
                                    <div className="sc-eff-col drop">
                                      <span className="sc-eff-pct">{dropStats ? dropStats.fg_pct.drop : 0}%</span>
                                      <span className="sc-eff-vol">{fgDropFgm}/{fgDropFga} FGA</span>
                                    </div>
                                  </>
                                )}
                              </div>
                              {vsDrop ? (
                                <div className="sc-eff-tile-footer">
                                  <span>Shooting volume:</span>
                                  <strong className={fgDiffFga >= 0 ? 'vol-pos' : 'vol-neg'}>
                                    {fgDiffFga >= 0 ? `+${fgDiffFga}` : fgDiffFga} FGA / gm
                                  </strong>
                                </div>
                              ) : (
                                <div className="sc-eff-tile-footer">
                                  <span>Added directly to team</span>
                                </div>
                              )}
                            </div>

                            {/* Card B: Free Throw Efficiency */}
                            <div className={`sc-eff-tile ${isFtContested ? 'contested' : ''}`}>
                              <div className="sc-eff-tile-hdr">
                                <div className="sc-eff-hdr-left">
                                  <span className="sc-eff-tile-name">Free Throws (FT%)</span>
                                  {isFtContested && <span className="sc-eff-swing-bolt" title="Contested Matchup Category">⚡</span>}
                                </div>
                                {vsDrop && (
                                  <span className={`sc-eff-badge ${ftDiffPct >= 0 ? 'pos' : 'neg'}`}>
                                    {ftDiffPct >= 0 ? `+${ftDiffPct}%` : `${ftDiffPct}%`}
                                  </span>
                                )}
                              </div>
                              <div className="sc-eff-tile-body">
                                <div className="sc-eff-col pick">
                                  <span className="sc-eff-pct">{p.ft_pct}%</span>
                                  <span className="sc-eff-vol">{ftStreamerFtm}/{ftStreamerFta} FTA</span>
                                </div>
                                {vsDrop && (
                                  <>
                                    <span className="sc-eff-sep">vs</span>
                                    <div className="sc-eff-col drop">
                                      <span className="sc-eff-pct">{dropStats ? dropStats.ft_pct.drop : 0}%</span>
                                      <span className="sc-eff-vol">{ftDropFtm}/{ftDropFta} FTA</span>
                                    </div>
                                  </>
                                )}
                              </div>
                              {vsDrop ? (
                                <div className="sc-eff-tile-footer">
                                  <span>Shooting volume:</span>
                                  <strong className={ftDiffFta >= 0 ? 'vol-pos' : 'vol-neg'}>
                                    {ftDiffFta >= 0 ? `+${ftDiffFta}` : ftDiffFta} FTA / gm
                                  </strong>
                                </div>
                              ) : (
                                <div className="sc-eff-tile-footer">
                                  <span>Added directly to team</span>
                                </div>
                              )}
                            </div>
                          </div>
                            );
                          })()}
                        </div>

                        {/* 3. Category Win Probability Impact Bars */}
                        <div className="sc-boosts-section">
                          <div className="sc-section-hdr">
                            <span className="sc-boosts-label">Category Win Chance Impact</span>
                            <span className="sc-boosts-sub">Before → After Pickup</span>
                          </div>

                          {impact.primary_boost_categories && impact.primary_boost_categories.length > 0 ? (
                            <div className="sc-impact-rows">
                              {impact.primary_boost_categories.map((b, idx) => {
                                const beforePct = Math.round(b.before_p * 100);
                                const afterPct = Math.round(b.after_p * 100);
                                const rawDelta = afterPct - beforePct;
                                const isZero = rawDelta === 0;
                                const isNeg = rawDelta < 0;
                                const deltaPct = rawDelta;
                                const displayCat = b.cat === 'FG3M' ? '3PM' : b.cat;
                                const isContested = Boolean(!b.is_punted && (b.is_target || contestedCatSet.has(displayCat) || contestedCatSet.has(b.cat)));
                                const displayGain = String(b.gain || '').replace(/\s*(FG3M|3PM|PTS|REB|AST|STL|BLK|TOV|TO)\b/gi, '').trim();
                                const minPct = Math.min(beforePct, afterPct);
                                const spanPct = isZero ? 0 : Math.max(1.5, Math.abs(deltaPct));
                                return (
                                  <div
                                    key={displayCat || idx}
                                    className={`sc-impact-row ${b.is_punted ? 'is-punted' : ''} ${isNeg ? 'is-neg' : isZero ? 'is-zero' : 'is-pos'} ${isContested ? 'is-contested' : ''}`}
                                  >
                                    <div className="sc-impact-left">
                                      <div className="sc-cat-badge-wrap">
                                        <span className={`sc-impact-cat ${isNeg ? 'neg' : isZero ? 'zero' : ''}`}>{displayCat}</span>
                                        {isContested && (
                                          <span
                                            className="sc-contested-bolt"
                                            title="Contested Matchup Category (15%–85% win probability)"
                                          >
                                            ⚡
                                          </span>
                                        )}
                                      </div>
                                      <span className="sc-impact-stat-gain">{displayGain}</span>
                                    </div>

                                    <div
                                      className="sc-impact-bar-track"
                                      title={`${displayCat}: ${beforePct}% → ${afterPct}% (${deltaPct > 0 ? '+' : ''}${deltaPct}%)${b.is_punted ? ' [Punted]' : ''}`}
                                    >
                                      <div
                                        className="sc-impact-bar-before"
                                        style={{ width: `${Math.min(100, Math.max(0, minPct))}%` }}
                                      />
                                      {spanPct > 0 && (
                                        <div
                                          className={`sc-impact-bar-gain ${isNeg ? 'neg' : ''}`}
                                          style={{
                                            left: `${Math.min(100, Math.max(0, minPct))}%`,
                                            width: `${Math.min(100 - minPct, spanPct)}%`,
                                          }}
                                        />
                                      )}
                                    </div>

                                    <div className="sc-impact-right">
                                      <span className="sc-prob-before">{beforePct}%</span>
                                      <span className="sc-arrow">→</span>
                                      <span className="sc-prob-after">{afterPct}%</span>
                                      <span className={`sc-prob-delta ${isNeg ? 'neg' : isZero ? 'zero' : ''}`}>
                                        {b.is_punted ? 'PUNT' : (deltaPct > 0 ? `+${deltaPct}%` : `${deltaPct}%`)}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="sc-balanced-note">
                              Provides balanced all-around depth across active categories.
                            </div>
                          )}

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
                        </div>

                        {/* 4. Schedule & Active Starts Footer */}
                        <div className="sc-schedule-row">
                          <div className="sc-sched-meta">
                            <span className="sc-starts-badge">
                              🏀 {sched.startable_games} Startable Game{sched.startable_games !== 1 ? 's' : ''}
                              {pickupMode === 'today' ? ' Today' : ''}
                            </span>
                            {sched.back_to_back_pairs?.length > 0 && (
                              <span className="sc-b2b-badge" title={`Back-to-back games on ${sched.back_to_back_pairs.map(pr => pr.join('/')).join(', ')}`}>
                                ⚡ B2B
                              </span>
                            )}
                            {pickupMode === 'today' && sched.rest_of_week_dates?.length > 0 && (
                              <span className="sc-row-more-hint" title="Additional team games remaining later this week">
                                (+{sched.rest_of_week_dates.length} more this wk)
                              </span>
                            )}
                            {dropStarts > 0 && (
                              <span className={`sc-net-games ${netStarts >= 0 ? 'pos' : 'neg'}`}>
                                ({netStarts >= 0 ? `+${netStarts}` : netStarts} net vs. {dropLastName})
                              </span>
                            )}
                            {sched.bench_backfill_games > 0 && (
                              <span className="sc-backfill-note" title="Your bench players fill starting slots freed by dropping the replaced player">
                                · +{sched.bench_backfill_games} bench backfill
                              </span>
                            )}
                            {sched.clashes > 0 && (
                              <span className="sc-clash-note">· {sched.clashes} bench clash</span>
                            )}
                          </div>

                          <div className="sc-dates-pills">
                            {(sched.all_game_dates || sched.startable_dates || []).map(dateStr => {
                              const dObj = new Date(dateStr + 'T12:00:00');
                              const dayName = dObj.toLocaleDateString('en-US', { weekday: 'short' });
                              const dayNum = dObj.getDate();
                              const isClashed = sched.clashed_dates?.includes(dateStr);
                              return (
                                <span
                                  key={dateStr}
                                  className={`sc-date-pill ${isClashed ? 'clash' : 'active'}`}
                                  title={isClashed ? `${dateStr}: Roster full / no eligible starting slot` : `${dateStr}: Fits in an open active starting slot`}
                                >
                                  <span className="sc-dot" /> {dayName} {dayNum}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                      {filteredRecs.length > visibleLimit && (
                        <div className="streamer-show-more-wrap">
                          <button
                            type="button"
                            className="btn-secondary streamer-show-more-btn"
                            onClick={() => setVisibleLimit(prev => (prev < 12 ? 12 : filteredRecs.length))}
                          >
                            {visibleLimit < 12 && filteredRecs.length > 12
                              ? `Show Top 12 (${filteredRecs.length} available)`
                              : `Show All ${filteredRecs.length} Evaluated Free Agents`}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ); })()}
            </div>
          </div>
        ) : streamerError ? (
          <div className="card streamer-empty-state" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⚠️</div>
            <h3 style={{ margin: '0 0 0.5rem', fontWeight: 700 }}>Could Not Load Streamer Recommendations</h3>
            <p style={{ color: '#f87171', maxWidth: '520px', margin: '0 auto 1.25rem', fontSize: '0.86rem' }}>
              {streamerError}
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => fetchStreamers(true)}
              disabled={streamerLoading}
            >
              Retry Scan
            </button>
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
    </div>
  );
}
