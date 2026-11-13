import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { CATEGORIES, zScoreClass, zScoreBgClass } from '../utils/zScore.js';
import { formatZ, formatMu } from '../utils/formatters.js';
import CategoryToggle from '../components/CategoryToggle.jsx';
import fallbackPositions from '../utils/playerPositionsFallback.json';
import {
  DEFAULT_ROSTER_SLOTS,
  ROSTER_PRESETS,
  PUNT_PRESETS,
  PRIMARY_POSITIONS,
  prepareDraftPool,
  rankDraftPool,
  getTeamIdxForPick,
  getUserTurnInfo,
  assignRosterSlots,
  computeTeamCategoryProfile,
  computeDraftRecommendations,
  computeMidDraftPuntSuggestions,
  computePuntSleepers,
  pickBestCpuCandidate,
  playerHasPosition,
} from '../utils/draftEngine.js';
import './DraftPage.css';

const DRAFT_POOL_CACHE_KEY = '9cat_draft_pool_cache_v1';
const DRAFT_ROOM_STATE_KEY = '9cat_draft_room_v2';
const POS_FILTER_LIST = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C', 'G', 'F'];

const SOURCE_OPTIONS = [
  { key: 'preseason', label: 'Preseason', hint: 'Preseason fantasy draft projections' },
  { key: 'ros', label: 'ROS', hint: 'Rest-of-season projections' },
  { key: 'ema', label: 'EMA', hint: 'Recent form exponential moving average' },
];

function buildDefaultTeamNames(count, prevNames = []) {
  return Array.from({ length: count }, (_, idx) => {
    const existing = prevNames[idx];
    return existing && existing.trim() ? existing : `Team ${idx + 1}`;
  });
}

function loadSavedRoomState() {
  try {
    const raw = sessionStorage.getItem(DRAFT_ROOM_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function DraftPage() {
  const saved = useMemo(() => loadSavedRoomState(), []);

  // Backend standalone draft pool state (no Yahoo link required)
  const [poolPayload, setPoolPayload] = useState(() => {
    try {
      const cached = sessionStorage.getItem(DRAFT_POOL_CACHE_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolError, setPoolError] = useState(null);

  // Room setup state
  const [draftStarted, setDraftStarted] = useState(() => Boolean(saved?.draftStarted));
  const [numTeams, setNumTeams] = useState(() => saved?.numTeams || 12);
  const [userTeamId, setUserTeamId] = useState(() => saved?.userTeamId || 1);
  const [draftType, setDraftType] = useState(() => saved?.draftType || 'snake');
  const [statsSource, setStatsSource] = useState(() => saved?.statsSource || 'preseason');
  const [teamNames, setTeamNames] = useState(() =>
    buildDefaultTeamNames(saved?.numTeams || 12, saved?.teamNames || [])
  );
  const [rosterSlots, setRosterSlots] = useState(() => saved?.rosterSlots || DEFAULT_ROSTER_SLOTS);

  // Active draft state
  const [draftHistory, setDraftHistory] = useState(() => saved?.draftHistory || []); // [{ playerName, teamId, teamName, pickNumber }]
  const [queuedNames, setQueuedNames] = useState(() => saved?.queuedNames || []);
  const [puntedCats, setPuntedCats] = useState(() => new Set(saved?.puntedCats || []));

  // Board UI controls
  const [searchQuery, setSearchQuery] = useState('');
  const [posFilter, setPosFilter] = useState('ALL');
  const [hideInjured, setHideInjured] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const [sortKey, setSortKey] = useState('activeZSum');
  const [sortDir, setSortDir] = useState('desc');
  const [selectedRosterTeamIdx, setSelectedRosterTeamIdx] = useState(() =>
    Math.max(0, (saved?.userTeamId || 1) - 1)
  );

  const hasFetchedPoolRef = useRef(Boolean(poolPayload?.players?.length));

  // Fetch Databricks draft pool independently on mount
  const loadDraftPool = useCallback(async (force = false) => {
    if (!force && hasFetchedPoolRef.current) return;
    hasFetchedPoolRef.current = true;
    setPoolLoading(true);
    setPoolError(null);
    try {
      const resp = await fetch('/api/draft-pool?limit=350');
      if (!resp.ok) throw new Error(`Server error ${resp.status}`);
      const json = await resp.json();
      if (json.status !== 'success' || !json.payload?.players) {
        throw new Error(json.message || 'Could not load draft pool.');
      }
      setPoolPayload(json.payload);
      sessionStorage.setItem(DRAFT_POOL_CACHE_KEY, JSON.stringify(json.payload));
      if (!saved?.statsSource && json.payload.default_source) {
        setStatsSource(json.payload.default_source);
      }
    } catch (err) {
      setPoolError(err.message || 'Failed to load NBA draft projections.');
    } finally {
      setPoolLoading(false);
    }
  }, [saved?.statsSource]);

  useEffect(() => {
    loadDraftPool(false);
  }, [loadDraftPool]);

  // Persist draft room & picks across route navigation
  useEffect(() => {
    try {
      sessionStorage.setItem(
        DRAFT_ROOM_STATE_KEY,
        JSON.stringify({
          draftStarted,
          numTeams,
          userTeamId,
          draftType,
          statsSource,
          teamNames,
          rosterSlots,
          draftHistory,
          queuedNames,
          puntedCats: [...puntedCats],
        })
      );
    } catch {}
  }, [
    draftStarted,
    numTeams,
    userTeamId,
    draftType,
    statsSource,
    teamNames,
    rosterSlots,
    draftHistory,
    queuedNames,
    puntedCats,
  ]);

  const rawPlayers = poolPayload?.players || [];
  const availableSources = poolPayload?.sources_available || ['preseason', 'ros', 'ema'];

  // Ensure selected statsSource actually exists in backend payload
  const effectiveSource = useMemo(() => {
    if (availableSources.includes(statsSource)) return statsSource;
    return poolPayload?.default_source || availableSources[0] || 'preseason';
  }, [availableSources, statsSource, poolPayload?.default_source]);

  const totalRosterSpotsPerTeam = useMemo(
    () => Object.values(rosterSlots).reduce((s, c) => s + (Math.max(0, Number(c) || 0)), 0),
    [rosterSlots]
  );
  const totalDraftPicks = numTeams * totalRosterSpotsPerTeam;

  // Prepare normalized pool for active projection source
  const preparedData = useMemo(() => {
    const cutoff = Math.max(120, Math.min(260, totalDraftPicks));
    return prepareDraftPool(rawPlayers, effectiveSource, cutoff, fallbackPositions);
  }, [rawPlayers, effectiveSource, totalDraftPicks]);

  const activeCats = useMemo(
    () => CATEGORIES.filter(c => !puntedCats.has(c.key)),
    [puntedCats]
  );

  // Rank players dynamically according to punted categories
  const rankedPlayers = useMemo(
    () => rankDraftPool(preparedData.players, activeCats),
    [preparedData.players, activeCats]
  );

  const playerByName = useMemo(() => {
    const map = new Map();
    for (const p of rankedPlayers) map.set(p.name, p);
    return map;
  }, [rankedPlayers]);

  const draftedNameSet = useMemo(
    () => new Set(draftHistory.map(h => h.playerName)),
    [draftHistory]
  );

  const undraftedPlayers = useMemo(
    () => rankedPlayers.filter(p => !draftedNameSet.has(p.name)),
    [rankedPlayers, draftedNameSet]
  );

  // Reconstruct live rosters with bipartite optimal starter matching
  const teamRosters = useMemo(() => {
    const grouped = teamNames.map((name, idx) => ({
      teamId: idx + 1,
      name,
      rawPlayers: [],
    }));

    for (const pick of draftHistory) {
      const team = grouped[pick.teamId - 1];
      const livePlayer = playerByName.get(pick.playerName);
      if (team && livePlayer) {
        team.rawPlayers.push({ ...livePlayer, pickNumber: pick.pickNumber });
      }
    }

    return grouped.map(t => {
      const fit = assignRosterSlots(t.rawPlayers, rosterSlots);
      const playersWithSlots = t.rawPlayers.map(p => ({
        ...p,
        rosterSlot: fit.assignments[p.name] || 'Bench',
      }));
      return {
        teamId: t.teamId,
        name: t.name,
        players: playersWithSlots,
        fit,
      };
    });
  }, [draftHistory, teamNames, playerByName, rosterSlots]);

  const currentPick = draftHistory.length + 1;
  const isDraftComplete = totalDraftPicks > 0 && currentPick > totalDraftPicks;
  const round = Math.ceil(currentPick / (numTeams || 1));
  const indexInRound = (currentPick - 1) % (numTeams || 1);
  const turnInfo = useMemo(
    () => getUserTurnInfo(currentPick, totalDraftPicks, numTeams, draftType, userTeamId),
    [currentPick, totalDraftPicks, numTeams, draftType, userTeamId]
  );

  const onClockTeamName = teamNames[turnInfo.onClockTeamIdx] || `Team ${turnInfo.onClockTeamId}`;
  const isUserTurn = !isDraftComplete && turnInfo.isUserNow;

  const userTeamEntry = teamRosters[userTeamId - 1] || { players: [], fit: null };
  const userRoster = userTeamEntry.players;

  // Smart recommendations for YOUR team
  const recommendations = useMemo(() => {
    if (!draftStarted || undraftedPlayers.length === 0) return [];
    return computeDraftRecommendations({
      undraftedPlayers,
      userRoster,
      teamRosters,
      rosterSlots,
      activeCats,
      puntedCats,
      currentPick,
      totalPicks: totalDraftPicks,
      numTeams,
      draftType,
      userTeamId,
      poolMaxProjGp: preparedData.poolMaxProjGp,
      leagueAvgFgPct: preparedData.leagueAvgFgPct,
      leagueAvgFtPct: preparedData.leagueAvgFtPct,
      limit: 4,
    });
  }, [
    draftStarted,
    undraftedPlayers,
    userRoster,
    teamRosters,
    rosterSlots,
    activeCats,
    puntedCats,
    currentPick,
    totalDraftPicks,
    numTeams,
    draftType,
    userTeamId,
    preparedData.poolMaxProjGp,
    preparedData.leagueAvgFgPct,
    preparedData.leagueAvgFtPct,
  ]);

  const recommendedNameSet = useMemo(
    () => new Set(recommendations.map(r => r.player.name)),
    [recommendations]
  );

  // Mid-draft Punt Suggestion Tool (strictly locks until userRoster.length >= 1)
  const midDraftPuntAnalysis = useMemo(
    () =>
      computeMidDraftPuntSuggestions({
        userRoster,
        undraftedPlayers,
        currentPunts: puntedCats,
        currentPick,
        numTeams,
        leagueAvgFgPct: preparedData.leagueAvgFgPct,
        leagueAvgFtPct: preparedData.leagueAvgFtPct,
      }),
    [
      userRoster,
      undraftedPlayers,
      puntedCats,
      currentPick,
      numTeams,
      preparedData.leagueAvgFgPct,
      preparedData.leagueAvgFtPct,
    ]
  );

  // Fast Punt Risers / Sleepers
  const puntSleepers = useMemo(
    () => computePuntSleepers(undraftedPlayers, puntedCats, totalDraftPicks, 5),
    [undraftedPlayers, puntedCats, totalDraftPicks]
  );

  // Active queued targets
  const queuedTargets = useMemo(() => {
    return queuedNames
      .map(name => playerByName.get(name))
      .filter(p => p && !draftedNameSet.has(p.name));
  }, [queuedNames, playerByName, draftedNameSet]);

  // Handlers
  const handleTogglePunt = (key) => {
    setPuntedCats(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleApplyPuntSet = (catKeys) => {
    setPuntedCats(new Set(catKeys));
  };

  const handleLeagueSizeChange = (newCount) => {
    const count = parseInt(newCount, 10) || 12;
    setNumTeams(count);
    setTeamNames(prev => buildDefaultTeamNames(count, prev));
    if (userTeamId > count) setUserTeamId(1);
    if (selectedRosterTeamIdx >= count) setSelectedRosterTeamIdx(0);
  };

  const handleTeamNameChange = (idx, value) => {
    setTeamNames(prev => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  const handleRosterSlotChange = (slot, value) => {
    const val = Math.max(0, Math.min(10, parseInt(value, 10) || 0));
    setRosterSlots(prev => ({ ...prev, [slot]: val }));
  };

  const handleApplyRosterPreset = (presetSlots) => {
    setRosterSlots({ ...presetSlots });
  };

  const handleStartDraft = () => {
    setDraftHistory([]);
    setSelectedRosterTeamIdx(Math.max(0, userTeamId - 1));
    setDraftStarted(true);
  };

  const handleDraftPlayer = (player) => {
    if (isDraftComplete || draftedNameSet.has(player.name)) return;
    setDraftHistory(prev => [
      ...prev,
      {
        playerName: player.name,
        teamId: turnInfo.onClockTeamId,
        teamName: onClockTeamName,
        pickNumber: prev.length + 1,
      },
    ]);
  };

  const handleAutoPickCurrent = () => {
    if (isDraftComplete || isUserTurn || undraftedPlayers.length === 0) return;
    const cpuTeam = teamRosters[turnInfo.onClockTeamIdx];
    const pick = pickBestCpuCandidate(
      undraftedPlayers,
      cpuTeam?.players || [],
      rosterSlots,
      preparedData.poolMaxProjGp
    );
    if (pick) handleDraftPlayer(pick);
  };

  const handleSimToUserTurn = () => {
    if (isDraftComplete || isUserTurn || undraftedPlayers.length === 0) return;
    let simHistory = [...draftHistory];
    let simPick = simHistory.length + 1;
    let available = [...undraftedPlayers];

    const tempRosters = teamRosters.map(t => [...t.players]);

    let guard = 0;
    while (simPick <= totalDraftPicks && available.length > 0 && guard < 40) {
      const tIdx = getTeamIdxForPick(simPick, numTeams, draftType);
      if (tIdx + 1 === userTeamId) break;
      const pick = pickBestCpuCandidate(available, tempRosters[tIdx], rosterSlots, preparedData.poolMaxProjGp);
      if (!pick) break;

      simHistory.push({
        playerName: pick.name,
        teamId: tIdx + 1,
        teamName: teamNames[tIdx] || `Team ${tIdx + 1}`,
        pickNumber: simPick,
      });
      tempRosters[tIdx].push(pick);
      available = available.filter(p => p.name !== pick.name);
      simPick++;
      guard++;
    }

    setDraftHistory(simHistory);
  };

  const handleUndoPick = () => {
    if (draftHistory.length === 0) return;
    setDraftHistory(prev => prev.slice(0, -1));
  };

  const handleResetDraft = () => {
    if (draftHistory.length === 0 || window.confirm('Reset draft room and return to settings?')) {
      setDraftStarted(false);
      setDraftHistory([]);
      setQueuedNames([]);
    }
  };

  const handleToggleQueue = (name) => {
    setQueuedNames(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  // Board sorting & filtering
  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'baseRank' ? 'asc' : 'desc');
    }
  };

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="sort-icon">⇅</span>;
    return <span className="sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return undraftedPlayers.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) && !(p.nba_team || '').toLowerCase().includes(q)) {
        return false;
      }
      if (!playerHasPosition(p, posFilter)) return false;
      if (hideInjured) {
        const st = String(p.status || '').toUpperCase().trim();
        if (['O', 'INJ', 'OUT', 'IL', 'IL+', 'NA'].includes(st)) return false;
        if (preparedData.poolMaxProjGp >= 25 && p.projGp !== null && p.projGp / preparedData.poolMaxProjGp < 0.7) {
          return false;
        }
      }
      return true;
    });
  }, [undraftedPlayers, searchQuery, posFilter, hideInjured, preparedData.poolMaxProjGp]);

  const sortedList = useMemo(() => {
    const sorted = [...filteredList].sort((a, b) => {
      let av, bv;
      if (sortKey === 'name') {
        av = a.name;
        bv = b.name;
      } else if (sortKey === 'activeZSum') {
        av = a.activeZSum;
        bv = b.activeZSum;
      } else if (sortKey === 'baseRank') {
        av = a.baseRank ?? 9999;
        bv = b.baseRank ?? 9999;
      } else if (sortKey === 'projGp') {
        av = a.projGp ?? -1;
        bv = b.projGp ?? -1;
      } else {
        av = a.zScores?.[sortKey] ?? -999;
        bv = b.zScores?.[sortKey] ?? -999;
      }
      if (typeof av === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return showAllRows ? sorted : sorted.slice(0, 100);
  }, [filteredList, sortKey, sortDir, showAllRows]);

  const recentPicks = useMemo(
    () => [...draftHistory].slice(-6).reverse(),
    [draftHistory]
  );

  // Loading & Error screens for standalone Draft Pool
  if (poolLoading && rawPlayers.length === 0) {
    return (
      <div className="page-wrapper center-content">
        <div className="spinner" style={{ width: 36, height: 36 }} />
        <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>
          Loading NBA player projections…
        </p>
      </div>
    );
  }

  if (poolError && rawPlayers.length === 0) {
    return (
      <div className="page-wrapper center-content">
        <div className="empty-state">
          <div style={{ fontSize: '3.5rem' }}>📡</div>
          <h2 style={{ marginBottom: '0.5rem' }}>Draft Pool Unavailable</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>{poolError}</p>
          <button className="btn-primary" onClick={() => loadDraftPool(true)}>
            Retry Loading Projections
          </button>
        </div>
      </div>
    );
  }

  // RENDER 1: Standalone Setup Screen
  if (!draftStarted) {
    const slotSum = Object.values(rosterSlots).reduce((s, v) => s + (Number(v) || 0), 0);
    return (
      <div className="draft-setup-page page-wrapper fade-up">
        <div className="section">
          <h1 className="section-title">🏀 Draft Assistant Setup</h1>
          <p className="section-subtitle">
            Standalone 9-Cat live draft & mock room — powered by Databricks projections ({rawPlayers.length} NBA players loaded)
          </p>

          <div className="setup-container">
            <div className="setup-card card">
              <h3>League & Projection Settings</h3>

              <div className="setup-row-2col">
                <div className="form-group">
                  <label>Teams in League:</label>
                  <select
                    value={numTeams}
                    onChange={(e) => handleLeagueSizeChange(e.target.value)}
                    className="setup-select"
                  >
                    {[8, 10, 12, 14, 16].map(cnt => (
                      <option key={cnt} value={cnt}>{cnt} Teams</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Your Draft Slot:</label>
                  <select
                    value={userTeamId}
                    onChange={(e) => setUserTeamId(parseInt(e.target.value, 10))}
                    className="setup-select"
                  >
                    {teamNames.map((t, idx) => (
                      <option key={idx} value={idx + 1}>
                        Pick #{idx + 1} — {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="setup-row-2col">
                <div className="form-group">
                  <label>Draft Type:</label>
                  <select
                    value={draftType}
                    onChange={(e) => setDraftType(e.target.value)}
                    className="setup-select"
                  >
                    <option value="snake">Snake Draft</option>
                    <option value="3rr">3rd-Round Reversal (3RR)</option>
                    <option value="linear">Linear Draft</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Rankings Source:</label>
                  <select
                    value={effectiveSource}
                    onChange={(e) => setStatsSource(e.target.value)}
                    className="setup-select"
                  >
                    {SOURCE_OPTIONS.filter(opt => availableSources.includes(opt.key)).map(opt => (
                      <option key={opt.key} value={opt.key}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <div className="slot-header-row">
                  <label>Roster Slots ({slotSum} Rounds · {slotSum * numTeams} Picks):</label>
                  <div className="roster-preset-pills">
                    {ROSTER_PRESETS.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        className="preset-mini-btn"
                        onClick={() => handleApplyRosterPreset(p.slots)}
                      >
                        {p.label.split(' (')[0]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="roster-slots-grid">
                  {Object.keys(rosterSlots).map(slot => (
                    <div key={slot} className="roster-slot-input">
                      <span>{slot}</span>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={rosterSlots[slot]}
                        onChange={(e) => handleRosterSlotChange(slot, e.target.value)}
                        aria-label={`${slot} slot count`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="setup-card card">
              <h3>Draft Order (Picks #1 – #{numTeams})</h3>
              <p className="roster-hint">Customize manager names in Round 1 pick order</p>
              <div className="team-names-list">
                {teamNames.map((name, idx) => (
                  <div key={idx} className={`team-name-row ${idx + 1 === userTeamId ? 'is-you' : ''}`}>
                    <span className="team-order-badge">#{idx + 1}</span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => handleTeamNameChange(idx, e.target.value)}
                      placeholder={`Team ${idx + 1}`}
                      aria-label={`Team ${idx + 1} name`}
                    />
                    {idx + 1 === userTeamId && <span className="you-pill">YOU</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="setup-launch-bar">
            <button className="btn-primary start-draft-btn" onClick={handleStartDraft}>
              🚀 Enter Draft Room
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Selected roster in viewer + open starter needs text
  const viewedRosterObj = teamRosters[selectedRosterTeamIdx] || teamRosters[0];
  const viewedOpenPrimary = viewedRosterObj?.fit
    ? PRIMARY_POSITIONS.filter(pos => (viewedRosterObj.fit.openStarterCounts[pos] || 0) > 0)
    : [];

  // RENDER 2: Active Draft Assistant
  return (
    <div className="draft-page page-wrapper fade-up">
      <div className="section">
        {/* Header Bar */}
        <div className="draft-header-bar">
          <div>
            <div className="draft-title-row">
              <h1 className="section-title" style={{ textAlign: 'left', margin: 0 }}>
                Draft Assistant
              </h1>
              <span className="draft-meta-pill">
                {numTeams}T · {draftType === '3rr' ? '3RR' : draftType === 'snake' ? 'Snake' : 'Linear'} · {totalRosterSpotsPerTeam} Rds
              </span>
            </div>
            <p className="section-subtitle" style={{ textAlign: 'left', margin: '0.2rem 0 0 0' }}>
              {SOURCE_OPTIONS.find(s => s.key === effectiveSource)?.hint || 'Live 9-Cat draft optimizer'}
            </p>
          </div>

          <div className="draft-header-actions">
            <div className="draft-source-pills" role="group" aria-label="Projection source">
              {SOURCE_OPTIONS.filter(opt => availableSources.includes(opt.key)).map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  className={`source-pill-btn ${effectiveSource === opt.key ? 'active' : ''}`}
                  onClick={() => setStatsSource(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {!isDraftComplete && !isUserTurn && (
              <>
                <button
                  type="button"
                  className="btn-secondary sim-btn"
                  onClick={handleAutoPickCurrent}
                  title="Let CPU make a realistic pick for the team on the clock"
                >
                  ⚡ Auto-Pick
                </button>
                <button
                  type="button"
                  className="btn-primary sim-btn"
                  onClick={handleSimToUserTurn}
                  title="Simulate picks automatically up to your next turn"
                >
                  ⏩ Sim to My Turn
                </button>
              </>
            )}

            <button
              type="button"
              className="btn-secondary"
              onClick={handleUndoPick}
              disabled={draftHistory.length === 0}
            >
              ↩️ Undo
            </button>
            <button type="button" className="btn-secondary reset-draft-btn" onClick={handleResetDraft}>
              🔄 Reset
            </button>
          </div>
        </div>

        {/* Recent Picks Ticker */}
        {recentPicks.length > 0 && (
          <div className="recent-picks-bar" aria-label="Recent picks">
            <span className="ticker-label">Recent:</span>
            <div className="ticker-pills">
              {recentPicks.map(pk => {
                const rNum = Math.ceil(pk.pickNumber / numTeams);
                const rSlot = ((pk.pickNumber - 1) % numTeams) + 1;
                const pickCode = `${rNum}.${String(rSlot).padStart(2, '0')}`;
                const isMine = pk.teamId === userTeamId;
                return (
                  <span key={pk.pickNumber} className={`ticker-pill ${isMine ? 'mine' : ''}`}>
                    <strong>{pickCode}</strong> {pk.playerName}{' '}
                    <span className="ticker-team">({isMine ? 'You' : pk.teamName})</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Main 2-Column Dashboard Grid */}
        <div className="draft-dashboard-grid">
          {/* LEFT SIDEBAR */}
          <div className="draft-sidebar">
            {/* Widget 1: Pick Clock */}
            <div className="sidebar-card card status-card">
              <div className="status-top-row">
                <span className="status-label">
                  {isDraftComplete ? 'Draft Complete' : `Overall Pick #${currentPick}`}
                </span>
                <span className="status-sub-pick">
                  {isDraftComplete
                    ? `${draftHistory.length}/${totalDraftPicks}`
                    : `Rd ${round}.${String(indexInRound + 1).padStart(2, '0')}`}
                </span>
              </div>

              <div className={`clock-alert ${isUserTurn ? 'user-turn' : ''}`}>
                <div className="clock-sub">
                  {isDraftComplete ? 'All Rounds Completed' : 'On the Clock'}
                </div>
                <div className="clock-team">
                  {isDraftComplete ? 'League Draft Complete 🎉' : onClockTeamName}
                </div>
                {isUserTurn && <span className="your-turn-badge">Your Turn!</span>}
              </div>

              {!isDraftComplete && (
                <div className="turn-countdown">
                  {isUserTurn ? (
                    turnInfo.nextUserPick ? (
                      <>Following pick: <strong>#{turnInfo.nextUserPick}</strong> ({turnInfo.picksUntilNext} away)</>
                    ) : (
                      <>Final pick of your draft</>
                    )
                  ) : turnInfo.nextUserPick ? (
                    <>Your next pick: <strong>#{turnInfo.nextUserPick}</strong> (in {turnInfo.picksUntilNext} pick{turnInfo.picksUntilNext === 1 ? '' : 's'})</>
                  ) : (
                    <>You have completed your picks</>
                  )}
                </div>
              )}

              <div className="draft-progress-track">
                <div
                  className="draft-progress-fill"
                  style={{ width: `${Math.min(100, (draftHistory.length / Math.max(1, totalDraftPicks)) * 100)}%` }}
                />
              </div>
            </div>

            {/* Widget 2: Punt Selector Tool */}
            <div className="sidebar-card card punt-selector-card">
              <div className="sidebar-head-row">
                <h4>🎯 Punt Selector Tool</h4>
                {puntedCats.size > 0 && (
                  <button
                    type="button"
                    className="clear-punts-link"
                    onClick={() => handleApplyPuntSet([])}
                  >
                    Clear ({puntedCats.size})
                  </button>
                )}
              </div>

              <CategoryToggle
                puntedCats={puntedCats}
                onToggle={handleTogglePunt}
                label="Click Categories to Punt"
              />

              <div className="punt-presets-wrap">
                <span className="punt-presets-label">Quick Presets:</span>
                <div className="punt-preset-pills">
                  {PUNT_PRESETS.map(preset => {
                    const active =
                      puntedCats.size === preset.cats.length &&
                      preset.cats.every(c => puntedCats.has(c));
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`punt-preset-btn ${active ? 'active' : ''}`}
                        onClick={() => handleApplyPuntSet(preset.cats)}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live Drafted Team 9-Cat Profile */}
              {userRoster.length > 0 && (
                <div className="live-team-profile">
                  <div className="ltp-header">
                    <span>Your Drafted Profile ({userRoster.length} pick{userRoster.length > 1 ? 's' : ''})</span>
                    <span className="ltp-sub">Avg σ / pick</span>
                  </div>
                  <div className="ltp-grid">
                    {CATEGORIES.map(cat => {
                      const avg = midDraftPuntAnalysis.teamProfile.cats[cat.key]?.avgZ ?? 0;
                      const isPunted = puntedCats.has(cat.key);
                      return (
                        <button
                          key={cat.key}
                          type="button"
                          className={`ltp-chip ${isPunted ? 'punted' : avg >= 0.4 ? 'strong' : avg <= -0.35 ? 'weak' : 'neutral'}`}
                          onClick={() => handleTogglePunt(cat.key)}
                          title={`Click to ${isPunted ? 'un-punt' : 'punt'} ${cat.label} (${formatZ(avg)} avg Z)`}
                        >
                          <span className="ltp-cat">{cat.key}</span>
                          <span className="ltp-val">{avg >= 0 ? `+${avg.toFixed(1)}` : avg.toFixed(1)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Widget 3: Mid-Draft Punt Suggestion Tool (Activates ONLY after 1st user pick) */}
            <div className={`sidebar-card card punt-advisor-card ${midDraftPuntAnalysis.activated ? 'unlocked' : 'locked'}`}>
              <div className="sidebar-head-row">
                <h4>🧠 Mid-Draft Punt Advisor</h4>
                <span className={`advisor-state-badge ${midDraftPuntAnalysis.activated ? 'active' : 'locked'}`}>
                  {midDraftPuntAnalysis.activated ? `Active (${userRoster.length} picks)` : 'After Pick 1'}
                </span>
              </div>

              {!midDraftPuntAnalysis.activated ? (
                <div className="advisor-locked-box">
                  <div className="locked-icon">🔒</div>
                  <p>
                    <strong>Inactive until after your 1st pick.</strong> Draft your cornerstone first so the engine can analyze your core build and suggest the strongest punt paths.
                  </p>
                </div>
              ) : midDraftPuntAnalysis.isBalancedCore && midDraftPuntAnalysis.suggestions.length === 0 ? (
                <div className="advisor-balanced-box">
                  <p>
                    <strong>Balanced Start:</strong> Your drafted core has no major category drag yet. Stay flexible (9-cat) until your next 1–2 picks reveal a natural punt.
                  </p>
                </div>
              ) : (
                <div className="punt-suggestions-list">
                  {midDraftPuntAnalysis.suggestions.map((sug, idx) => (
                    <div
                      key={sug.id}
                      className={`punt-sug-card ${sug.isCurrentlyApplied ? 'applied' : ''} ${idx === 0 ? 'top-pick' : ''}`}
                    >
                      <div className="ps-top">
                        <div>
                          <span className="ps-title">{sug.label}</span>
                          <span className="ps-lift">+{sug.coreLift.toFixed(2)}σ/cat</span>
                        </div>
                        <button
                          type="button"
                          className={`ps-apply-btn ${sug.isCurrentlyApplied ? 'active' : ''}`}
                          onClick={() => handleApplyPuntSet(sug.cats)}
                        >
                          {sug.isCurrentlyApplied ? '✓ Active' : 'Apply'}
                        </button>
                      </div>
                      <div className="ps-weak-cats">Core drag: {sug.weakSummary}</div>
                      {sug.topTargets.length > 0 && (
                        <div className="ps-targets">
                          Targets:{' '}
                          {sug.topTargets.map((t, ti) => (
                            <span key={t.name} className="ps-target-link" onClick={() => setSearchQuery(t.name)}>
                              {t.name}{ti < sug.topTargets.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Widget 4: Draft Queue (Bookmarks) */}
            <div className="sidebar-card card queue-card">
              <div className="sidebar-head-row">
                <h4>★ Draft Queue ({queuedTargets.length})</h4>
              </div>
              {queuedTargets.length > 0 ? (
                <div className="queue-list">
                  {queuedTargets.map(p => {
                    const riskGone =
                      !isUserTurn &&
                      turnInfo.nextUserPick &&
                      p.baseRank <= turnInfo.nextUserPick - 2;
                    return (
                      <div key={p.name} className="queue-row">
                        <div className="q-info">
                          <span className="q-name" onClick={() => setSearchQuery(p.name)}>
                            #{p.overallRank} {p.name}
                          </span>
                          <span className="q-meta">
                            {p.positions} {riskGone && <span className="q-risk" title="Likely drafted before your next pick">· Run risk</span>}
                          </span>
                        </div>
                        <div className="q-actions">
                          <button
                            type="button"
                            className="btn-primary q-draft-btn"
                            onClick={() => handleDraftPlayer(p)}
                            disabled={isDraftComplete}
                          >
                            Draft
                          </button>
                          <button
                            type="button"
                            className="q-remove-btn"
                            onClick={() => handleToggleQueue(p.name)}
                            aria-label={`Remove ${p.name} from queue`}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="no-data-text" style={{ margin: 0 }}>
                  Click ☆ on any player in the board to queue targets between turns.
                </p>
              )}
            </div>

            {/* Widget 5: Punt Risers / Sleepers */}
            {puntedCats.size > 0 && (
              <div className="sidebar-card card sleepers-card">
                <h4>🚀 Punt Risers</h4>
                <p className="roster-hint" style={{ marginBottom: '0.6rem' }}>
                  Undrafted players gaining the most ranks under active punts
                </p>
                <div className="sleepers-list">
                  {puntSleepers.length > 0 ? (
                    puntSleepers.map(({ player, baselineRank, puntRank, rankGain }) => (
                      <div key={player.name} className="sleeper-row">
                        <span className="sl-name" onClick={() => setSearchQuery(player.name)}>
                          {player.name}
                        </span>
                        <span className="sl-change">
                          #{baselineRank} ➔ <strong className="z-good">#{puntRank}</strong> (+{rankGain})
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="no-data-text">No notable risers left in range.</p>
                  )}
                </div>
              </div>
            )}

            {/* Widget 6: Optimal Bipartite Team Roster Viewer */}
            <div className="sidebar-card card rosters-card">
              <div className="roster-view-header">
                <h4>📋 Team Roster</h4>
                <select
                  value={selectedRosterTeamIdx}
                  onChange={(e) => setSelectedRosterTeamIdx(parseInt(e.target.value, 10))}
                  className="roster-team-select"
                >
                  {teamNames.map((name, idx) => (
                    <option key={idx} value={idx}>
                      {name} {idx + 1 === userTeamId ? '(You)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {viewedRosterObj?.fit && (
                <div className="roster-fit-summary">
                  <span>
                    Starters: <strong>{viewedRosterObj.fit.filledStarterCount}/{viewedRosterObj.fit.totalStarterCount}</strong>
                  </span>
                  {viewedOpenPrimary.length > 0 && (
                    <span className="open-slots-note">Open: {viewedOpenPrimary.join(', ')}</span>
                  )}
                </div>
              )}

              <div className="roster-slots-display">
                {(viewedRosterObj?.fit?.slotRows || []).map((row, rIdx) => (
                  <div key={`${row.slot}-${row.index}-${rIdx}`} className="roster-slot-row">
                    <span className="r-slot-label">{row.slot}</span>
                    <span className={`r-slot-value ${row.player ? 'filled' : 'empty'}`}>
                      {row.player ? (
                        <>
                          <span className="r-player-name">{row.player.name}</span>
                          <span className="pick-indicator">#{row.player.pickNumber}</span>
                        </>
                      ) : (
                        '— Empty —'
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT MAIN COLUMN */}
          <div className="draft-main-col">
            {/* Smart Pick Recommendations Panel */}
            <div className={`card recommendations-panel ${isUserTurn ? 'your-turn-active' : ''}`}>
              <div className="rec-panel-header">
                <div>
                  <h3>
                    {isUserTurn ? '🎯 Recommended Picks for Your Turn' : '💡 Projected Targets for Your Build'}
                  </h3>
                  <p className="rec-panel-sub">
                    Ranked by active punt value, bipartite slot fit, category balance, and{' '}
                    {turnInfo.nextUserPick ? `scarcity before Pick #${turnInfo.nextUserPick}` : 'roster depth'}.
                  </p>
                </div>
                {puntedCats.size > 0 && (
                  <span className="active-punt-pill">
                    Punting: {[...puntedCats].join(', ')}
                  </span>
                )}
              </div>

              <div className="rec-cards-grid">
                {recommendations.length > 0 ? (
                  recommendations.map(({ player, reasons, warnings, boostedCats }) => {
                    const isQueued = queuedNames.includes(player.name);
                    return (
                      <div key={player.name} className="smart-rec-card">
                        <div className="src-top">
                          <div className="src-ranks">
                            <span className="src-rank-main" title="Active build rank">
                              #{player.overallRank}
                            </span>
                            {puntedCats.size > 0 && player.rankDelta !== 0 && (
                              <span
                                className={`src-rank-base ${player.rankDelta > 0 ? 'up' : 'down'}`}
                                title={`9-Cat rank #${player.baseRank}`}
                              >
                                {player.rankDelta > 0 ? `▲${player.rankDelta}` : `▼${Math.abs(player.rankDelta)}`}
                              </span>
                            )}
                          </div>
                          <div className="src-actions">
                            <button
                              type="button"
                              className={`star-queue-btn ${isQueued ? 'active' : ''}`}
                              onClick={() => handleToggleQueue(player.name)}
                              title={isQueued ? 'Remove from queue' : 'Add to queue'}
                            >
                              {isQueued ? '★' : '☆'}
                            </button>
                            <button
                              type="button"
                              className="btn-primary rec-draft-btn"
                              onClick={() => handleDraftPlayer(player)}
                              disabled={isDraftComplete}
                              title={`Draft ${player.name} to ${onClockTeamName}`}
                            >
                              Draft
                            </button>
                          </div>
                        </div>

                        <div className="src-name" onClick={() => setSearchQuery(player.name)}>
                          {player.name}
                        </div>
                        <div className="src-meta">
                          <span>{player.positions}</span>
                          <span>· {player.nba_team || 'NBA'}</span>
                          {player.projGp != null && <span>· {Math.round(player.projGp)} GP</span>}
                        </div>

                        <div className="src-tags">
                          {reasons.map((r, i) => (
                            <span key={i} className={`src-reason-tag kind-${r.kind}`}>
                              {r.label}
                            </span>
                          ))}
                          {warnings.map((w, i) => (
                            <span key={`w-${i}`} className="src-warning-tag">
                              ⚠ {w}
                            </span>
                          ))}
                        </div>

                        {boostedCats.length > 0 && (
                          <div className="src-cats">
                            {boostedCats.map(c => (
                              <span key={c.key} className="src-cat-chip">
                                {c.key} +{c.z.toFixed(1)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="no-data-text">No undrafted recommendations remaining.</p>
                )}
              </div>
            </div>

            {/* Interactive Draft Board */}
            <div className="draft-main-board card">
              <div className="board-toolbar">
                <div className="search-box-wrapper">
                  <input
                    type="text"
                    placeholder="🔍 Search player or NBA team..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="board-search-input"
                    aria-label="Search players by name"
                  />
                  {searchQuery && (
                    <button className="clear-search-btn" onClick={() => setSearchQuery('')}>✕</button>
                  )}
                </div>

                <div className="pos-filter-bar" style={{ marginBottom: 0 }}>
                  {POS_FILTER_LIST.map(pos => (
                    <button
                      key={pos}
                      type="button"
                      className={`btn-ghost ${posFilter === pos ? 'active' : ''}`}
                      onClick={() => setPosFilter(pos)}
                    >
                      {pos}
                    </button>
                  ))}
                </div>

                <div className="board-extra-toggles">
                  <label className="board-check-label">
                    <input
                      type="checkbox"
                      checked={hideInjured}
                      onChange={(e) => setHideInjured(e.target.checked)}
                    />
                    Healthy only
                  </label>
                  <button
                    type="button"
                    className="toggle-rows-btn"
                    onClick={() => setShowAllRows(v => !v)}
                  >
                    {showAllRows ? `Showing ${filteredList.length}` : `Top 100 / ${filteredList.length}`}
                  </button>
                </div>
              </div>

              <div className="data-table-wrapper">
                <table className="data-table draft-table" aria-label="Available player rankings">
                  <thead>
                    <tr>
                      <th
                        className={sortKey === 'activeZSum' ? 'sort-active' : ''}
                        onClick={() => handleSort('activeZSum')}
                        style={{ textAlign: 'center', width: 58 }}
                        title="Rank under active punt strategy"
                      >
                        Rank <SortIcon col="activeZSum" />
                      </th>
                      {puntedCats.size > 0 && (
                        <th
                          className={sortKey === 'baseRank' ? 'sort-active' : ''}
                          onClick={() => handleSort('baseRank')}
                          style={{ textAlign: 'center', width: 52 }}
                          title="Baseline 9-Cat Rank"
                        >
                          9-Cat <SortIcon col="baseRank" />
                        </th>
                      )}
                      <th style={{ width: 28, textAlign: 'center' }} title="Queue target">★</th>
                      <th
                        className={sortKey === 'name' ? 'sort-active' : ''}
                        onClick={() => handleSort('name')}
                        style={{ textAlign: 'left' }}
                      >
                        Player <SortIcon col="name" />
                      </th>
                      <th>Pos</th>
                      <th>Team</th>
                      <th
                        className={sortKey === 'projGp' ? 'sort-active' : ''}
                        onClick={() => handleSort('projGp')}
                        title="Projected Games Played"
                      >
                        PGP <SortIcon col="projGp" />
                      </th>
                      {CATEGORIES.map(cat => (
                        <th
                          key={cat.key}
                          className={`${sortKey === cat.key ? 'sort-active' : ''} ${puntedCats.has(cat.key) ? 'punted-col' : ''}`}
                          onClick={() => handleSort(cat.key)}
                          title={`${cat.label} — click to sort`}
                        >
                          {cat.key} <SortIcon col={cat.key} />
                        </th>
                      ))}
                      <th
                        className={sortKey === 'activeZSum' ? 'sort-active' : ''}
                        onClick={() => handleSort('activeZSum')}
                        title="Sum of Z-scores across active categories"
                      >
                        ΣZ <SortIcon col="activeZSum" />
                      </th>
                      <th style={{ textAlign: 'center' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedList.length > 0 ? (
                      sortedList.map(player => {
                        const isRec = recommendedNameSet.has(player.name);
                        const isQueued = queuedNames.includes(player.name);
                        const isOut = ['O', 'INJ', 'OUT', 'IL', 'IL+', 'NA'].includes(
                          String(player.status || '').toUpperCase().trim()
                        );
                        return (
                          <tr key={player.name} className={isRec ? 'rec-highlight-row' : ''}>
                            <td style={{ textAlign: 'center', fontWeight: 700, whiteSpace: 'nowrap' }}>
                              <span style={{ color: 'var(--text-muted)' }}>#{player.overallRank}</span>
                              {puntedCats.size > 0 && player.rankDelta !== 0 && (
                                <span
                                  className={`board-delta ${player.rankDelta > 0 ? 'z-good' : 'z-bad'}`}
                                  title={`9-Cat #${player.baseRank} → Build #${player.overallRank}`}
                                >
                                  {player.rankDelta > 0 ? `+${player.rankDelta}` : player.rankDelta}
                                </span>
                              )}
                            </td>
                            {puntedCats.size > 0 && (
                              <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                                #{player.baseRank}
                              </td>
                            )}
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                className={`table-star-btn ${isQueued ? 'active' : ''}`}
                                onClick={() => handleToggleQueue(player.name)}
                                title={isQueued ? 'Remove from Queue' : 'Add to Queue'}
                              >
                                {isQueued ? '★' : '☆'}
                              </button>
                            </td>
                            <td>
                              <div className="player-cell">
                                <span className="player-name" title={player.name}>{player.name}</span>
                                {isRec && <span className="rec-mini-pill">REC</span>}
                                {player.status && (
                                  <span className={`status-mini-pill ${isOut ? 'out' : 'q'}`}>
                                    {player.status}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              <span className="pos-badge" title={player.positions}>
                                {player.positions}
                              </span>
                            </td>
                            <td className="team-abbr">{player.nba_team || '—'}</td>
                            <td style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                              {player.projGp != null ? Math.round(player.projGp) : '—'}
                            </td>
                            {CATEGORIES.map(cat => {
                              const z = player.zScores?.[cat.key];
                              const rawVal = player.mus?.[cat.key];
                              const punted = puntedCats.has(cat.key);
                              return (
                                <td
                                  key={cat.key}
                                  className={`${zScoreBgClass(z)} ${punted ? 'punted-col' : ''}`}
                                  title={`Z-Score: ${formatZ(z)}`}
                                >
                                  <span className={zScoreClass(z)}>{formatMu(rawVal, cat.key)}</span>
                                </td>
                              );
                            })}
                            <td style={{ fontWeight: 800 }}>
                              <span className={player.activeZSum >= 0 ? 'z-good' : 'z-poor'}>
                                {player.activeZSum !== -999 ? formatZ(player.activeZSum) : '—'}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                className="btn-primary draft-action-btn"
                                onClick={() => handleDraftPlayer(player)}
                                disabled={isDraftComplete}
                              >
                                Draft
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td
                          colSpan={CATEGORIES.length + (puntedCats.size > 0 ? 9 : 8)}
                          style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}
                        >
                          No available players match your search or filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
