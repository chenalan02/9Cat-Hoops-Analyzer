import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { CATEGORIES } from '../utils/zScore.js';
import fallbackPositions from '../utils/playerPositionsFallback.json';
import { fetchDraftPool } from '../services/apiClient.js';
import { readSessionJson, writeSessionJson } from '../services/storageCache.js';
import { LoadingView, EmptyState } from '../components/common/PageStateGuard.jsx';
import {
  DEFAULT_ROSTER_SLOTS,
  PRIMARY_POSITIONS,
  prepareDraftPool,
  rankDraftPool,
  getTeamIdxForPick,
  getUserTurnInfo,
  assignRosterSlots,
  computeDraftRecommendations,
  computeMidDraftPuntSuggestions,
  computePuntSleepers,
  pickBestCpuCandidate,
  playerHasPosition,
} from '../utils/draftEngine.js';
import {
  DRAFT_POOL_CACHE_KEY,
  DRAFT_ROOM_STATE_KEY,
  OUT_STATUS_TAGS,
  buildDefaultTeamNames,
} from '../components/draft/draftConstants.js';
import DraftSetupView from '../components/draft/DraftSetupView.jsx';
import DraftHeaderBar from '../components/draft/DraftHeaderBar.jsx';
import DraftPuntSidebar from '../components/draft/DraftPuntSidebar.jsx';
import DraftRosterSidebar from '../components/draft/DraftRosterSidebar.jsx';
import DraftRecommendationsPanel from '../components/draft/DraftRecommendationsPanel.jsx';
import DraftBoardTable from '../components/draft/DraftBoardTable.jsx';
import './DraftPage.css';

export default function DraftPage() {
  const saved = useMemo(() => readSessionJson(DRAFT_ROOM_STATE_KEY), []);

  const [poolPayload, setPoolPayload] = useState(() => readSessionJson(DRAFT_POOL_CACHE_KEY));
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolError, setPoolError] = useState(null);

  const [draftStarted, setDraftStarted] = useState(() => Boolean(saved?.draftStarted));
  const [numTeams, setNumTeams] = useState(() => saved?.numTeams || 12);
  const [userTeamId, setUserTeamId] = useState(() => saved?.userTeamId || 1);
  const [draftType, setDraftType] = useState(() => saved?.draftType || 'snake');
  const [statsSource, setStatsSource] = useState(() => saved?.statsSource || 'preseason');
  const [teamNames, setTeamNames] = useState(() =>
    buildDefaultTeamNames(saved?.numTeams || 12, saved?.teamNames || [])
  );
  const [rosterSlots, setRosterSlots] = useState(() => saved?.rosterSlots || DEFAULT_ROSTER_SLOTS);

  const [draftHistory, setDraftHistory] = useState(() => saved?.draftHistory || []);
  const [queuedNames, setQueuedNames] = useState(() => saved?.queuedNames || []);
  const [puntedCats, setPuntedCats] = useState(() => new Set(saved?.puntedCats || []));

  const [searchQuery, setSearchQuery] = useState('');
  const [posFilter, setPosFilter] = useState('ALL');
  const [hideInjured, setHideInjured] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const [sortKey, setSortKey] = useState('activeZSum');
  const [sortDir, setSortDir] = useState('desc');
  const [selectedRosterTeamIdx, setSelectedRosterTeamIdx] = useState(() =>
    Math.max(0, (saved?.userTeamId || 1) - 1)
  );

  // Skip re-fetching the 350-player draft pool across StrictMode double-mounts or tab switches
  const hasFetchedPoolRef = useRef(Boolean(poolPayload?.players?.length));

  const loadDraftPool = useCallback(async (force = false) => {
    if (!force && hasFetchedPoolRef.current) return;
    hasFetchedPoolRef.current = true;
    setPoolLoading(true);
    setPoolError(null);
    try {
      const payload = await fetchDraftPool(350);
      if (!payload?.players) {
        throw new Error('Could not load draft pool.');
      }
      setPoolPayload(payload);
      writeSessionJson(DRAFT_POOL_CACHE_KEY, payload);
      if (!saved?.statsSource && payload.default_source) {
        setStatsSource(payload.default_source);
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

  useEffect(() => {
    writeSessionJson(DRAFT_ROOM_STATE_KEY, {
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
    });
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

  const effectiveSource = useMemo(() => {
    if (availableSources.includes(statsSource)) return statsSource;
    return poolPayload?.default_source || availableSources[0] || 'preseason';
  }, [availableSources, statsSource, poolPayload?.default_source]);

  const totalRosterSpotsPerTeam = useMemo(
    () => Object.values(rosterSlots).reduce((s, c) => s + Math.max(0, Number(c) || 0), 0),
    [rosterSlots]
  );
  const totalDraftPicks = numTeams * totalRosterSpotsPerTeam;

  const preparedData = useMemo(() => {
    // Anchor z-score normalization to draftable league depth instead of letting replacement-level scrubs dilute variance
    const cutoff = Math.max(120, Math.min(260, totalDraftPicks));
    return prepareDraftPool(rawPlayers, effectiveSource, cutoff, fallbackPositions);
  }, [rawPlayers, effectiveSource, totalDraftPicks]);

  const activeCats = useMemo(
    () => CATEGORIES.filter(c => !puntedCats.has(c.key)),
    [puntedCats]
  );

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

  const queuedNameSet = useMemo(() => new Set(queuedNames), [queuedNames]);

  const undraftedPlayers = useMemo(
    () => rankedPlayers.filter(p => !draftedNameSet.has(p.name)),
    [rankedPlayers, draftedNameSet]
  );

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
  const userRoster = (teamRosters[userTeamId - 1] || { players: [] }).players;

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

  const puntSleepers = useMemo(
    () => computePuntSleepers(undraftedPlayers, puntedCats, totalDraftPicks, 5),
    [undraftedPlayers, puntedCats, totalDraftPicks]
  );

  const queuedTargets = useMemo(() => {
    return queuedNames
      .map(name => playerByName.get(name))
      .filter(p => p && !draftedNameSet.has(p.name));
  }, [queuedNames, playerByName, draftedNameSet]);

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
    const simHistory = [...draftHistory];
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

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'name' || key === 'baseRank' ? 'asc' : 'desc');
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
        if (OUT_STATUS_TAGS.has(st)) return false;
        if (preparedData.poolMaxProjGp >= 25 && p.projGp !== null && p.projGp / preparedData.poolMaxProjGp < 0.7) {
          return false;
        }
      }
      return true;
    });
  }, [undraftedPlayers, searchQuery, posFilter, hideInjured, preparedData.poolMaxProjGp]);

  const sortedList = useMemo(() => {
    const sorted = [...filteredList].sort((a, b) => {
      let av;
      let bv;
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

  if (poolLoading && rawPlayers.length === 0) {
    return <LoadingView message="Loading NBA player projections…" />;
  }

  if (poolError && rawPlayers.length === 0) {
    return (
      <EmptyState
        icon="📡"
        title="Draft Pool Unavailable"
        description={poolError}
        actionLabel="Retry Loading Projections"
        onAction={() => loadDraftPool(true)}
      />
    );
  }

  if (!draftStarted) {
    return (
      <DraftSetupView
        playerCount={rawPlayers.length}
        numTeams={numTeams}
        userTeamId={userTeamId}
        draftType={draftType}
        effectiveSource={effectiveSource}
        availableSources={availableSources}
        teamNames={teamNames}
        rosterSlots={rosterSlots}
        onLeagueSizeChange={handleLeagueSizeChange}
        onUserTeamChange={setUserTeamId}
        onDraftTypeChange={setDraftType}
        onStatsSourceChange={setStatsSource}
        onRosterSlotChange={handleRosterSlotChange}
        onApplyRosterPreset={handleApplyRosterPreset}
        onTeamNameChange={handleTeamNameChange}
        onStartDraft={handleStartDraft}
      />
    );
  }

  const viewedRosterObj = teamRosters[selectedRosterTeamIdx] || teamRosters[0];
  const viewedOpenPrimary = viewedRosterObj?.fit
    ? PRIMARY_POSITIONS.filter(pos => (viewedRosterObj.fit.openStarterCounts[pos] || 0) > 0)
    : [];

  return (
    <div className="draft-page page-wrapper fade-up">
      <div className="section">
        <DraftHeaderBar
          numTeams={numTeams}
          draftType={draftType}
          totalRosterSpotsPerTeam={totalRosterSpotsPerTeam}
          effectiveSource={effectiveSource}
          availableSources={availableSources}
          onStatsSourceChange={setStatsSource}
          isDraftComplete={isDraftComplete}
          isUserTurn={isUserTurn}
          onAutoPick={handleAutoPickCurrent}
          onSimToUserTurn={handleSimToUserTurn}
          onUndoPick={handleUndoPick}
          onResetDraft={handleResetDraft}
          canUndo={draftHistory.length > 0}
          recentPicks={recentPicks}
          userTeamId={userTeamId}
        />

        <div className="draft-dashboard-grid">
          <div className="draft-sidebar">
            <DraftPuntSidebar
              isDraftComplete={isDraftComplete}
              currentPick={currentPick}
              totalDraftPicks={totalDraftPicks}
              round={round}
              indexInRound={indexInRound}
              draftHistoryCount={draftHistory.length}
              isUserTurn={isUserTurn}
              onClockTeamName={onClockTeamName}
              turnInfo={turnInfo}
              puntedCats={puntedCats}
              onTogglePunt={handleTogglePunt}
              onApplyPuntSet={handleApplyPuntSet}
              userRosterCount={userRoster.length}
              midDraftPuntAnalysis={midDraftPuntAnalysis}
              onSelectPlayerName={setSearchQuery}
            />

            <DraftRosterSidebar
              queuedTargets={queuedTargets}
              isUserTurn={isUserTurn}
              turnInfo={turnInfo}
              isDraftComplete={isDraftComplete}
              onDraftPlayer={handleDraftPlayer}
              onToggleQueue={handleToggleQueue}
              onSelectPlayerName={setSearchQuery}
              puntedCatsCount={puntedCats.size}
              puntSleepers={puntSleepers}
              teamNames={teamNames}
              selectedRosterTeamIdx={selectedRosterTeamIdx}
              onSelectRosterTeamIdx={setSelectedRosterTeamIdx}
              userTeamId={userTeamId}
              viewedRosterObj={viewedRosterObj}
              viewedOpenPrimary={viewedOpenPrimary}
            />
          </div>

          <div className="draft-main-col">
            <DraftRecommendationsPanel
              isUserTurn={isUserTurn}
              recommendations={recommendations}
              puntedCats={puntedCats}
              turnInfo={turnInfo}
              queuedNameSet={queuedNameSet}
              isDraftComplete={isDraftComplete}
              onClockTeamName={onClockTeamName}
              onToggleQueue={handleToggleQueue}
              onDraftPlayer={handleDraftPlayer}
              onSelectPlayerName={setSearchQuery}
            />

            <DraftBoardTable
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              posFilter={posFilter}
              onPosFilterChange={setPosFilter}
              hideInjured={hideInjured}
              onHideInjuredChange={setHideInjured}
              showAllRows={showAllRows}
              onToggleShowAllRows={() => setShowAllRows(v => !v)}
              filteredCount={filteredList.length}
              sortedList={sortedList}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              puntedCats={puntedCats}
              recommendedNameSet={recommendedNameSet}
              queuedNameSet={queuedNameSet}
              isDraftComplete={isDraftComplete}
              onToggleQueue={handleToggleQueue}
              onDraftPlayer={handleDraftPlayer}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
