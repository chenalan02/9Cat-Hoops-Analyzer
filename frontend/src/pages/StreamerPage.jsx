import { useState, useMemo, useContext, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import CategoryToggle from '../components/CategoryToggle.jsx';
import YahooRefreshButton from '../components/common/YahooRefreshButton.jsx';
import { LoadingView, EmptyState } from '../components/common/PageStateGuard.jsx';
import StreamerDropSelectorCard from '../components/streamer/StreamerDropSelectorCard.jsx';
import StreamerDiagnosticsCard from '../components/streamer/StreamerDiagnosticsCard.jsx';
import StreamerFilterToolbar from '../components/streamer/StreamerFilterToolbar.jsx';
import StreamerRecommendationCard from '../components/streamer/StreamerRecommendationCard.jsx';
import playerPositionsFallback from '../utils/playerPositionsFallback.json';
import { fetchStreamerRecommendations } from '../services/apiClient.js';
import { readSessionString, todayLocalDateString } from '../services/storageCache.js';
import {
  MATCHUP_OPP_STORAGE_KEY,
  MATCHUP_WEEK_STORAGE_KEY,
  IR_SLOTS,
  OUT_STATUS_TAGS,
  Q_STATUS_TAGS,
  ANY_INJ_TAGS,
  loadSavedPunts,
  savePunts,
  getCachedAnalysis,
  hasAnyCachedAnalysisForTeam,
  getCachedStreamers,
  setCachedStreamers,
} from '../utils/streamerHelpers.js';
import './MatchupPage.css';

export default function StreamerPage() {
  const { myTeam, leagueData, loading, refreshTeam } = useContext(TeamDataContext);
  const navigate = useNavigate();

  const opponents = useMemo(
    () => leagueData?.teams?.filter(t => t.team_id !== myTeam?.team_id) ?? [],
    [leagueData, myTeam]
  );

  const scheduledOppId = useMemo(
    () => myTeam?.current_opponent_id || leagueData?.weekly_matchups?.[String(myTeam?.team_id)] || null,
    [myTeam, leagueData]
  );

  const [oppTeamId, setOppTeamId] = useState(() => {
    const saved = readSessionString(MATCHUP_OPP_STORAGE_KEY, '');
    if (saved) return saved;
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

  const [weekNum] = useState(() => {
    const saved = readSessionString(MATCHUP_WEEK_STORAGE_KEY, '');
    if (saved) return parseInt(saved, 10) || leagueData?.week_num || 1;
    return leagueData?.week_num ?? 1;
  });

  const dateStart = useMemo(() => todayLocalDateString(), []);

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

  // Cache excludes selectedDropPlayer because recommendations_by_target bundles every candidate for 0ms switching.
  const streamerCacheKey = useMemo(() => {
    if (!matchupCacheKey) return '';
    return `${matchupCacheKey}-${pickupMode}-${sortedPuntsKey}`;
  }, [matchupCacheKey, pickupMode, sortedPuntsKey]);

  const matchupAnalysisData = useMemo(
    () => (matchupCacheKey ? getCachedAnalysis(matchupCacheKey) : null),
    [matchupCacheKey]
  );

  const hasRunMatchupAnalyzer = useMemo(() => {
    if (matchupAnalysisData) return true;
    const marker = readSessionString('9cat_matchup_has_run', '');
    if (marker && marker === `${leagueData?.league_id || ''}-${myTeam?.team_id || ''}`) {
      return true;
    }
    return hasAnyCachedAnalysisForTeam(leagueData?.league_id, myTeam?.team_id);
  }, [matchupAnalysisData, leagueData?.league_id, myTeam?.team_id]);

  const localRosterMeta = useMemo(() => {
    if (!myTeam) return { openSlots: 0, activeRoster: [] };
    const activeRoster = (myTeam.players || []).filter(
      p => !IR_SLOTS.has(String(p.selected_position || '').toUpperCase())
    );

    let standardCap = 13;
    if (Array.isArray(leagueData?.roster_positions) && leagueData.roster_positions.length > 0) {
      let count = 0;
      for (const pos of leagueData.roster_positions) {
        const pObj = pos?.roster_position || pos;
        const pName = String(pObj?.position || '').toUpperCase().trim();
        const pCount = Number(pObj?.count || 0);
        if (pName && !IR_SLOTS.has(pName)) count += pCount;
      }
      if (count > 0) standardCap = count;
    }

    const openSlots = Math.max(0, standardCap - activeRoster.length);
    return { openSlots, activeRoster };
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
    if (player?.positions && player.positions !== 'Util') return player.positions;
    const name = player?.name?.trim();
    if (name) {
      if (allKnownPositions[name]) return allKnownPositions[name];
      if (allKnownPositions[name.toLowerCase()]) return allKnownPositions[name.toLowerCase()];
      if (playerPositionsFallback?.[name]) return playerPositionsFallback[name];
      if (playerPositionsFallback?.[name.toLowerCase()]) return playerPositionsFallback[name.toLowerCase()];
    }
    return '';
  }, [allKnownPositions]);

  const [streamerRecs, setStreamerRecs] = useState(() => getCachedStreamers(streamerCacheKey));
  const [streamerLoading, setStreamerLoading] = useState(false);
  const [streamerError, setStreamerError] = useState(null);
  const [copiedPlayer, setCopiedPlayer] = useState(null);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopyPlayer = useCallback((playerName) => {
    try {
      navigator.clipboard?.writeText(playerName);
      setCopiedPlayer(playerName);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedPlayer(null), 2000);
    } catch {
      // Clipboard API may be blocked in unprivileged frames.
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
      team1: myTeam,
      team2: oppTeam,
      date_start: dateStart,
      roster_positions: leagueData.roster_positions ?? [],
      stats_source: 'weekly_stats',
      all_rostered_names: allNames,
      limit: 20,
      target_drop_player: null,
      pickup_mode: pickupMode,
      punted_cats: sortedPuntsKey ? sortedPuntsKey.split(',') : [],
    };

    try {
      let payload;
      try {
        payload = await fetchStreamerRecommendations(leagueData.league_id, weekNum, body);
      } catch (firstErr) {
        if (firstErr?.status && firstErr.status < 500) throw firstErr;
        // Retry once on transient network or 5xx responses while backend workers restart.
        await new Promise((r) => setTimeout(r, 600));
        payload = await fetchStreamerRecommendations(leagueData.league_id, weekNum, body);
      }

      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid streamer payload');
      }
      setStreamerRecs(payload);
      setCachedStreamers(streamerCacheKey, payload);
    } catch (err) {
      setStreamerError(err.message || 'Failed to fetch streamer recommendations.');
    } finally {
      setStreamerLoading(false);
    }
  }, [myTeam, oppTeam, leagueData, weekNum, dateStart, streamerCacheKey, pickupMode, sortedPuntsKey]);

  useEffect(() => {
    if (!hasRunMatchupAnalyzer || !myTeam || !oppTeam) return;
    const cached = getCachedStreamers(streamerCacheKey);
    if (cached) {
      setStreamerRecs(cached);
    } else {
      fetchStreamers(false);
    }
  }, [hasRunMatchupAnalyzer, myTeam, oppTeam, streamerCacheKey, fetchStreamers]);

  const candidateOptions = useMemo(() => {
    if (streamerRecs?.roster_candidates?.length > 0) {
      return streamerRecs.roster_candidates;
    }
    const mapped = localRosterMeta.activeRoster.map(p => {
      const statusUpper = String(p.status || '').toUpperCase().trim();
      const isTagged = OUT_STATUS_TAGS.has(statusUpper) || Q_STATUS_TAGS.has(statusUpper);
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

    // Sort priority matches backend: O/INJ tagged -> Q/GTD tagged -> fewest starts -> lowest Z-score.
    mapped.sort((a, b) => {
      const aTagRank = a.is_tagged ? (OUT_STATUS_TAGS.has(String(a.status || '').toUpperCase().trim()) ? 0 : 1) : 2;
      const bTagRank = b.is_tagged ? (OUT_STATUS_TAGS.has(String(b.status || '').toUpperCase().trim()) ? 0 : 1) : 2;
      if (aTagRank !== bTagRank) return aTagRank - bTagRank;
      const aStarts = typeof a.starts_in_window === 'number' ? a.starts_in_window : 99;
      const bStarts = typeof b.starts_in_window === 'number' ? b.starts_in_window : 99;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return Number(a.z_total) - Number(b.z_total);
    });

    return mapped;
  }, [streamerRecs?.roster_candidates, localRosterMeta.activeRoster, matchupAnalysisData]);

  const openRosterSpots = streamerRecs?.open_roster_spots ?? localRosterMeta.openSlots;
  const openIlSlots = streamerRecs?.open_il_slots ?? 0;
  const suggestedAction = streamerRecs?.suggested_action || streamerRecs?.roster_action;

  const recommendedTargetKey = useMemo(() => {
    if (openRosterSpots > 0) return '__OPEN_SLOT__';
    if (suggestedAction?.target_player) return suggestedAction.target_player;
    const firstSuggested = candidateOptions.find(c => c.is_suggested);
    return firstSuggested ? firstSuggested.name : null;
  }, [openRosterSpots, suggestedAction, candidateOptions]);

  const effectiveSelectedKey = useMemo(() => {
    if (selectedDropPlayer === '__AUTO__') return recommendedTargetKey || '';
    if (selectedDropPlayer === '__OPEN_SLOT__' && openRosterSpots <= 0) {
      return recommendedTargetKey || candidateOptions[0]?.name || '';
    }
    return selectedDropPlayer;
  }, [selectedDropPlayer, openRosterSpots, recommendedTargetKey, candidateOptions]);

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
  const isHoldRecommended = Boolean(activeBundle?.hold_recommended || activeAction?.type === 'HOLD');
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

  const contestedCatSet = useMemo(() => new Set(
    Object.entries(streamerRecs?.matchup_diagnostics?.categories || {})
      .filter(([, d]) => d.status === 'SWING' || d.target === true)
      .flatMap(([k]) => {
        const u = k.toUpperCase();
        const norm = u === 'FG3M' ? '3PM' : (u === 'TOV' ? 'TO' : u);
        return [u, norm];
      })
  ), [streamerRecs]);

  if (loading) {
    return <LoadingView message="Loading your team…" />;
  }

  if (!myTeam) {
    return (
      <EmptyState
        icon="🎯"
        title="No Team Data"
        description="Analyze your team and run the Matchup Analyzer first to get streamer recommendations."
        actionLabel="Analyze My Team"
        onAction={() => navigate('/')}
      />
    );
  }

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
            <YahooRefreshButton
              loading={loading}
              onRefresh={refreshTeam}
              title="Reload latest team and league data from Yahoo Fantasy"
            />
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

        <StreamerDropSelectorCard
          openRosterSpots={openRosterSpots}
          openIlSlots={openIlSlots}
          pickupMode={pickupMode}
          setPickupMode={setPickupMode}
          effectiveSelectedKey={effectiveSelectedKey}
          recommendedTargetKey={recommendedTargetKey}
          visibleCandidateCards={visibleCandidateCards}
          candidateOptions={candidateOptions}
          selectedDropPlayer={selectedDropPlayer}
          setSelectedDropPlayer={setSelectedDropPlayer}
          isHoldRecommended={isHoldRecommended}
          activeAction={activeAction}
          showAllRoster={showAllRoster}
          setShowAllRoster={setShowAllRoster}
          getPlayerPositions={getPlayerPositions}
        />

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
            <StreamerDiagnosticsCard
              categories={streamerRecs.matchup_diagnostics?.categories}
              streamerLoading={streamerLoading}
              onRefresh={() => fetchStreamers(true)}
            />

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

              {rawRecs.length > 0 && (
                <StreamerFilterToolbar
                  posFilter={posFilter}
                  setPosFilter={setPosFilter}
                  boostCatFilter={boostCatFilter}
                  setBoostCatFilter={setBoostCatFilter}
                  sortBy={sortBy}
                  setSortBy={setSortBy}
                  healthyOnly={healthyOnly}
                  setHealthyOnly={setHealthyOnly}
                  dismissedCount={dismissedPlayers.size}
                  onRestoreDismissed={() => setDismissedPlayers(new Set())}
                />
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
              ) : (
                <div className="streamer-results-wrap">
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
                        {visibleRecs.map(rec => (
                          <StreamerRecommendationCard
                            key={rec.player.name}
                            rec={rec}
                            pickupMode={pickupMode}
                            contestedCatSet={contestedCatSet}
                            copiedPlayer={copiedPlayer}
                            getPlayerPositions={getPlayerPositions}
                            onCopyPlayer={handleCopyPlayer}
                            onDismissPlayer={toggleDismissPlayer}
                          />
                        ))}
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
              )}
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
