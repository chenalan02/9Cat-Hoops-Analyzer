import { useState, useMemo, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import CategoryToggle from '../components/CategoryToggle.jsx';
import YahooRefreshButton from '../components/common/YahooRefreshButton.jsx';
import { LoadingView, EmptyState } from '../components/common/PageStateGuard.jsx';
import CategoryStandings from '../components/trade/CategoryStandings.jsx';
import IrActivationPanel from '../components/trade/IrActivationPanel.jsx';
import PlayerSelector from '../components/trade/PlayerSelector.jsx';
import TradeImpactPanel from '../components/trade/TradeImpactPanel.jsx';
import TradeSuggestionsPanel from '../components/trade/TradeSuggestionsPanel.jsx';
import FreeAgentSwapsPanel from '../components/trade/FreeAgentSwapsPanel.jsx';
import { SOURCE_OPTIONS } from '../components/trade/tradeFormatters.js';
import { searchFreeAgents } from '../services/apiClient.js';
import { readSessionJson, writeSessionJson } from '../services/storageCache.js';
import {
  ALL_CAT_KEYS,
  ALL_CAT_SET,
  OUT_STATUS_SET,
  isActiveSlot,
  applyIrSwapsToTeams,
  buildTradeContext,
  evaluateTrade,
  comparePositionImpact,
  categoryRanks,
  computeSellCandidates,
  computeTradeTargets,
  computeDropCandidates,
  computeFreeAgentSwaps,
} from '../utils/tradeEngine.js';
import './TradePage.css';

export default function TradePage() {
  const { myTeam, leagueData, loading, refreshTeam } = useContext(TeamDataContext);
  const navigate = useNavigate();

  const [tab, setTab] = useState('analyzer');
  const [statsSource, setStatsSource] = useState('ros');
  const [puntedCats, setPuntedCats] = useState(new Set());
  const [playersOut, setPlayersOut] = useState(new Set());
  const [playersIn, setPlayersIn] = useState(new Set());
  const [impactView, setImpactView] = useState('team');
  const [streamOpenSpot, setStreamOpenSpot] = useState(false);
  const [freeAgents, setFreeAgents] = useState([]);
  const [faLoading, setFaLoading] = useState(false);
  const [faError, setFaError] = useState(false);
  const [partnerPuntsMap, setPartnerPuntsMap] = useState({});
  const [giveFocus, setGiveFocus] = useState('__AUTO__');
  const [rankWindow, setRankWindow] = useState(15);
  const [tradeFormat, setTradeFormat] = useState('all');
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [posFilter, setPosFilter] = useState('all');
  const [catFilter, setCatFilter] = useState('all');
  const [winWinOnly, setWinWinOnly] = useState(false);
  const [yahooFairOnly, setYahooFairOnly] = useState(false);
  const [dropFocus, setDropFocus] = useState('__AUTO__');
  const [faPosFilter, setFaPosFilter] = useState('all');
  const [faCatFilter, setFaCatFilter] = useState('all');
  const [hideOutFas, setHideOutFas] = useState(true);
  const [irSwapsMap, setIrSwapsMap] = useState({});
  const [irStashes, setIrStashes] = useState([]);

  const togglePunt = key => setPuntedCats(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const togglePartnerPunt = (teamId, key) => setPartnerPuntsMap(prev => {
    const k = String(teamId);
    const nextSet = new Set(prev[k] || []);
    if (nextSet.has(key)) nextSet.delete(key); else nextSet.add(key);
    return { ...prev, [k]: [...nextSet] };
  });

  const toggleSet = setter => player => setter(prev => {
    const next = new Set(prev);
    if (next.has(player.name)) next.delete(player.name); else next.add(player.name);
    return next;
  });

  useEffect(() => {
    if (!leagueData?.league_id || !leagueData?.teams?.length) return;
    const cacheKey = `9cat_streamer_fa_cache_${leagueData.league_id}_${statsSource}`;
    const cached = readSessionJson(cacheKey);
    if (Array.isArray(cached)) {
      setFreeAgents(cached);
      setFaLoading(false);
      setFaError(false);
      return;
    }

    let cancelled = false;
    setFaLoading(true);
    setFaError(false);
    const allRostered = leagueData.teams.flatMap(t => (t.players || []).map(p => p.name));
    searchFreeAgents(leagueData.league_id, {
      stats_source: statsSource,
      all_rostered_names: allRostered,
      limit: 45,
    })
      .then(data => {
        if (cancelled) return;
        const agents = Array.isArray(data?.free_agents) ? data.free_agents : null;
        if (agents) {
          setFreeAgents(agents);
          writeSessionJson(cacheKey, agents);
        }
        setFaLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Fallback to synthetic bottom-10% replacement happens inside buildTradeContext.
        setFaError(true);
        setFaLoading(false);
      });

    return () => { cancelled = true; };
  }, [leagueData, statsSource]);

  const activeCats = useMemo(() => new Set(ALL_CAT_KEYS.filter(k => !puntedCats.has(k))), [puntedCats]);
  const myTeamId = myTeam?.team_id;

  useEffect(() => {
    setIrSwapsMap({});
    setIrStashes([]);
  }, [myTeamId]);

  const rawCtx = useMemo(() => {
    if (!leagueData?.teams?.length || myTeamId == null) return null;
    return buildTradeContext(leagueData.teams, statsSource, activeCats, {
      freeAgents,
      rosterPositions: leagueData.roster_positions,
      streamingBonus: streamOpenSpot ? 1.5 : 0,
    });
  }, [leagueData, statsSource, activeCats, myTeamId, freeAgents, streamOpenSpot]);

  const { irPlayers, activeRosterPlayers } = useMemo(() => {
    if (!rawCtx || myTeamId == null) return { irPlayers: [], activeRosterPlayers: [] };
    const team = rawCtx.teamById.get(myTeamId);
    const players = team?.players || [];
    const ir = players
      .filter(p => !isActiveSlot(p))
      .sort((a, b) => rawCtx.puntValue(b) - rawCtx.puntValue(a));
    const active = players
      .filter(p => isActiveSlot(p))
      .sort((a, b) => rawCtx.puntValue(a) - rawCtx.puntValue(b));
    return { irPlayers: ir, activeRosterPlayers: active };
  }, [rawCtx, myTeamId]);

  const enabledIrSwapList = useMemo(
    () =>
      Object.entries(irSwapsMap)
        .filter(([, cfg]) => cfg?.enabled)
        .map(([irPlayerName, cfg]) => ({
          irPlayerName,
          replacePlayerName: cfg.replacePlayerName || null,
        })),
    [irSwapsMap]
  );

  const stashFreeAgents = useMemo(() => {
    if (!rawCtx?.freeAgents?.length) return [];
    const isOut = (p) => OUT_STATUS_SET.has(String(p?.status || '').toUpperCase().trim());
    return [...rawCtx.freeAgents]
      .sort((a, b) => {
        const outDiff = Number(isOut(a)) - Number(isOut(b));
        if (outDiff !== 0) return outDiff;
        return rawCtx.puntValue(b) - rawCtx.puntValue(a);
      })
      .slice(0, 30);
  }, [rawCtx]);

  const resolvedIrStashes = useMemo(() => {
    if (!rawCtx || !irStashes.length) return [];
    const faByName = new Map((rawCtx.freeAgents || []).map(p => [p.name, p]));
    const claimedRealFa = new Set();
    return irStashes.map(s => {
      let replacementPlayer = null;
      if (s.replaceWith === '__BEST_FA__') {
        const best = rawCtx.replacement;
        if (best && (!best.isRealFreeAgent || !claimedRealFa.has(best.name))) {
          replacementPlayer = best;
          if (best.isRealFreeAgent) claimedRealFa.add(best.name);
        } else {
          const fallbackFa = stashFreeAgents.find(fa => !claimedRealFa.has(fa.name)) || null;
          if (fallbackFa) {
            replacementPlayer = fallbackFa;
            claimedRealFa.add(fallbackFa.name);
          }
        }
      } else if (s.replaceWith && s.replaceWith !== '__NONE__') {
        const fa = faByName.get(s.replaceWith) || null;
        if (fa && !claimedRealFa.has(fa.name)) {
          replacementPlayer = fa;
          claimedRealFa.add(fa.name);
        }
      }
      return { stashPlayerName: s.stashPlayerName, replacementPlayer };
    });
  }, [rawCtx, irStashes, stashFreeAgents]);

  const { effectiveTeams, appliedIrSwaps } = useMemo(() => {
    if (!leagueData?.teams?.length || myTeamId == null || (!enabledIrSwapList.length && !resolvedIrStashes.length)) {
      return { effectiveTeams: leagueData?.teams || [], appliedIrSwaps: [] };
    }
    const { teams, appliedSwaps } = applyIrSwapsToTeams(
      leagueData.teams,
      myTeamId,
      enabledIrSwapList,
      resolvedIrStashes
    );
    return { effectiveTeams: teams, appliedIrSwaps: appliedSwaps };
  }, [leagueData, myTeamId, enabledIrSwapList, resolvedIrStashes]);

  const ctx = useMemo(() => {
    if (!rawCtx) return null;
    if (!appliedIrSwaps.length) return rawCtx;
    return buildTradeContext(effectiveTeams, statsSource, activeCats, {
      freeAgents,
      rosterPositions: leagueData.roster_positions,
      streamingBonus: streamOpenSpot ? 1.5 : 0,
    });
  }, [rawCtx, appliedIrSwaps.length, effectiveTeams, statsSource, activeCats, freeAgents, leagueData, streamOpenSpot]);

  const myPlayers = useMemo(() => {
    if (!ctx || myTeamId == null) return [];
    const team = ctx.teamById.get(myTeamId);
    if (!team) return [];
    return [...team.players].sort((a, b) => ctx.puntValue(b) - ctx.puntValue(a));
  }, [ctx, myTeamId]);

  const handleToggleIr = (irPlayerName) => {
    const currentlyEnabled = Boolean(irSwapsMap[irPlayerName]?.enabled);
    if (currentlyEnabled) {
      setIrSwapsMap(prev => ({
        ...prev,
        [irPlayerName]: { ...prev[irPlayerName], enabled: false },
      }));
      return;
    }

    const usedByOthers = new Set([
      ...Object.entries(irSwapsMap)
        .filter(([name, cfg]) => name !== irPlayerName && cfg?.enabled && cfg?.replacePlayerName)
        .map(([, cfg]) => cfg.replacePlayerName),
      ...irStashes.map(s => s.stashPlayerName),
    ]);
    const existingChoice = irSwapsMap[irPlayerName]?.replacePlayerName;
    const validExisting = existingChoice && !usedByOthers.has(existingChoice)
      && activeRosterPlayers.some(p => p.name === existingChoice);
    const pickedReplace = validExisting
      ? existingChoice
      : (activeRosterPlayers.find(p => !usedByOthers.has(p.name))?.name ?? null);

    setIrSwapsMap(prev => ({
      ...prev,
      [irPlayerName]: { enabled: true, replacePlayerName: pickedReplace },
    }));
    if (pickedReplace) {
      setPlayersOut(prev => {
        if (!prev.has(pickedReplace)) return prev;
        const next = new Set(prev);
        next.delete(pickedReplace);
        return next;
      });
    }
  };

  const handleChangeIrReplace = (irPlayerName, rawTarget) => {
    const replaceName = !rawTarget || rawTarget === '__NONE__' ? null : rawTarget;
    setIrSwapsMap(prev => ({
      ...prev,
      [irPlayerName]: { enabled: true, replacePlayerName: replaceName },
    }));
    if (replaceName) {
      setPlayersOut(prev => {
        if (!prev.has(replaceName)) return prev;
        const next = new Set(prev);
        next.delete(replaceName);
        return next;
      });
    }
  };

  const resolveStashFaName = (replaceWith) => {
    if (!replaceWith || replaceWith === '__NONE__') return null;
    if (replaceWith === '__BEST_FA__') return rawCtx?.replacement?.name || null;
    return replaceWith;
  };

  const handleAddStash = (stashPlayerName, replaceWith = '__NONE__') => {
    if (!stashPlayerName) return;
    const claimedByYahooIr = Object.values(irSwapsMap).some(
      cfg => cfg?.enabled && cfg?.replacePlayerName === stashPlayerName
    );
    if (claimedByYahooIr || irStashes.some(s => s.stashPlayerName === stashPlayerName)) {
      return;
    }

    setIrStashes(prev => [...prev, { stashPlayerName, replaceWith }]);
    setPlayersOut(prev => {
      if (!prev.has(stashPlayerName)) return prev;
      const next = new Set(prev);
      next.delete(stashPlayerName);
      return next;
    });
    const nextFaName = resolveStashFaName(replaceWith);
    if (nextFaName) {
      setPlayersIn(prev => {
        if (!prev.has(nextFaName)) return prev;
        const next = new Set(prev);
        next.delete(nextFaName);
        return next;
      });
    }
  };

  const handleChangeStashReplace = (stashPlayerName, rawTarget) => {
    const nextReplaceWith = !rawTarget ? '__NONE__' : rawTarget;
    const existing = irStashes.find(s => s.stashPlayerName === stashPlayerName);
    const prevFaName = resolveStashFaName(existing?.replaceWith);
    const nextFaName = resolveStashFaName(nextReplaceWith);

    setIrStashes(prev => prev.map(s => (
      s.stashPlayerName === stashPlayerName
        ? { ...s, replaceWith: nextReplaceWith }
        : s
    )));

    if (nextFaName) {
      setPlayersIn(prev => {
        if (!prev.has(nextFaName)) return prev;
        const next = new Set(prev);
        next.delete(nextFaName);
        return next;
      });
    }
    if (prevFaName && prevFaName !== nextFaName) {
      setPlayersOut(prev => {
        if (!prev.has(prevFaName)) return prev;
        const next = new Set(prev);
        next.delete(prevFaName);
        return next;
      });
    }
  };

  const handleRemoveStash = (stashPlayerName) => {
    const existing = irStashes.find(s => s.stashPlayerName === stashPlayerName);
    const prevFaName = resolveStashFaName(existing?.replaceWith);
    setIrStashes(prev => prev.filter(s => s.stashPlayerName !== stashPlayerName));
    if (prevFaName) {
      setPlayersOut(prev => {
        if (!prev.has(prevFaName)) return prev;
        const next = new Set(prev);
        next.delete(prevFaName);
        return next;
      });
    }
  };

  const handleResetIr = () => {
    const stashFaNames = irStashes
      .map(s => resolveStashFaName(s.replaceWith))
      .filter(Boolean);
    setIrSwapsMap({});
    setIrStashes([]);
    if (stashFaNames.length) {
      setPlayersOut(prev => {
        const next = new Set(prev);
        let changed = false;
        for (const name of stashFaNames) {
          if (next.delete(name)) changed = true;
        }
        return changed ? next : prev;
      });
    }
  };

  const otherTeams = useMemo(
    () => (leagueData?.teams || []).filter(t => t.team_id !== myTeamId),
    [leagueData, myTeamId]
  );

  const otherPlayers = useMemo(() => {
    if (!ctx) return [];
    return otherTeams.flatMap(t => t.players).sort((a, b) => ctx.puntValue(b) - ctx.puntValue(a));
  }, [ctx, otherTeams]);

  const gettingPlayers = useMemo(() => {
    if (!ctx) return [];
    return [...otherPlayers, ...(ctx.freeAgents || [])].sort((a, b) => ctx.puntValue(b) - ctx.puntValue(a));
  }, [ctx, otherPlayers]);

  const outList = useMemo(() => myPlayers.filter(p => playersOut.has(p.name)), [myPlayers, playersOut]);
  const inList = useMemo(() => gettingPlayers.filter(p => playersIn.has(p.name)), [gettingPlayers, playersIn]);
  const hasChanges = outList.length > 0 || inList.length > 0;

  const singlePartnerId = useMemo(() => {
    if (!ctx || !inList.length) return null;
    const ids = [...new Set(inList.map(p => ctx.ownerByName.get(p.name)).filter(id => id != null && id !== myTeamId))];
    return ids.length === 1 ? ids[0] : null;
  }, [ctx, inList, myTeamId]);

  const partnerPuntsSet = useMemo(
    () => new Set(singlePartnerId != null ? (partnerPuntsMap[String(singlePartnerId)] || []) : []),
    [singlePartnerId, partnerPuntsMap]
  );
  const partnerActiveCats = useMemo(
    () => new Set(ALL_CAT_KEYS.filter(k => !partnerPuntsSet.has(k))),
    [partnerPuntsSet]
  );

  const baseRanks = useMemo(() => (ctx ? categoryRanks(myTeamId, ctx.distById) : null), [ctx, myTeamId]);

  const evaluation = useMemo(() => {
    if (!ctx || !hasChanges) return null;
    return evaluateTrade(ctx, myTeamId, outList, inList, partnerActiveCats);
  }, [ctx, hasChanges, myTeamId, outList, inList, partnerActiveCats]);

  const zSummary = useMemo(() => {
    if (!ctx || !evaluation) return null;
    const outActive = outList.filter(isActiveSlot);
    const outZ = outActive.reduce((s, p) => s + ctx.puntValue(p), 0)
      + evaluation.my.drops.reduce((s, p) => s + ctx.puntValue(p), 0);
    const inZ = inList.reduce((s, p) => s + ctx.puntValue(p), 0)
      + evaluation.my.fillers * ctx.replacement.puntZ;
    return { outZ, inZ, net: inZ - outZ };
  }, [ctx, evaluation, outList, inList]);

  const sellRows = useMemo(() => (ctx ? computeSellCandidates(ctx, myTeamId) : []), [ctx, myTeamId]);
  const autoCandidates = useMemo(() => sellRows.filter(r => r.autoEligible).slice(0, 5), [sellRows]);
  const autoSellSet = useMemo(() => new Set(autoCandidates.map(r => r.player.name)), [autoCandidates]);

  const givePlayers = useMemo(() => {
    if (giveFocus === '__AUTO__') {
      const picks = autoCandidates.length ? autoCandidates : sellRows.slice(0, 5);
      return picks.map(r => r.player);
    }
    const p = myPlayers.find(x => x.name === giveFocus);
    return p ? [p] : [];
  }, [giveFocus, autoCandidates, sellRows, myPlayers]);

  const targets = useMemo(() => {
    if (!ctx || tab !== 'suggest') return [];
    const tradeTypes = tradeFormat === 'all' ? ['1for1', '2for1', '1for2'] : [tradeFormat];
    const filteredPartnerCats = partnerFilter !== 'all' && partnerPuntsMap[String(partnerFilter)]?.length
      ? new Set(ALL_CAT_KEYS.filter(k => !partnerPuntsMap[String(partnerFilter)].includes(k)))
      : ALL_CAT_SET;
    return computeTradeTargets(ctx, myTeamId, givePlayers, {
      window: rankWindow,
      limit: 18,
      perGive: giveFocus === '__AUTO__' ? 4 : 12,
      tradeTypes,
      partnerCats: filteredPartnerCats,
      partnerFilter,
      posFilter,
      catFilter,
      winWinOnly,
      yahooFairOnly,
    });
  }, [ctx, tab, myTeamId, givePlayers, rankWindow, giveFocus, tradeFormat, partnerFilter, partnerPuntsMap, posFilter, catFilter, winWinOnly, yahooFairOnly]);

  const dropRows = useMemo(
    () => (ctx && tab === 'fa-swaps' ? computeDropCandidates(ctx, myTeamId, { hideOutFas }) : []),
    [ctx, tab, myTeamId, hideOutFas]
  );

  const faDropPlayers = useMemo(() => {
    if (dropFocus === '__AUTO__') {
      const eligible = dropRows.filter(r => r.autoDropEligible);
      return (eligible.length ? eligible : dropRows).map(r => r.player);
    }
    const p = myPlayers.find(x => x.name === dropFocus);
    return p ? [p] : [];
  }, [dropFocus, dropRows, myPlayers]);

  const faSwaps = useMemo(() => {
    if (!ctx || tab !== 'fa-swaps') return [];
    const isAuto = dropFocus === '__AUTO__';
    return computeFreeAgentSwaps(ctx, myTeamId, faDropPlayers, {
      limit: 18,
      perDrop: isAuto ? 3 : 12,
      posFilter: faPosFilter,
      catFilter: faCatFilter,
      hideOutFas,
      onlyPositive: isAuto,
    });
  }, [ctx, tab, myTeamId, dropFocus, faDropPlayers, faPosFilter, faCatFilter, hideOutFas]);

  const loadIntoAnalyzer = t => {
    const gives = t.gives || [t.give];
    const gets = t.gets || [t.get];
    setPlayersOut(new Set(gives.map(p => p.name)));
    setPlayersIn(new Set(gets.map(p => p.name)));
    setImpactView('team');
    setTab('analyzer');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return <LoadingView message="Loading your team…" />;
  }

  if (!myTeam || !ctx) {
    return (
      <EmptyState
        icon="🔄"
        title="No Team Data"
        description="Analyze your team first to use the trade analyzer."
        actionLabel="Analyze My Team"
        onAction={() => navigate('/')}
      />
    );
  }

  const baseWins = ctx.baseWins.get(myTeamId);
  const rawWins = rawCtx ? rawCtx.baseWins.get(myTeamId) : null;
  const rawRanks = rawCtx ? categoryRanks(myTeamId, rawCtx.distById) : null;
  let irDelta = null;
  if (appliedIrSwaps.length > 0 && rawWins) {
    const inZ = appliedIrSwaps
      .map(s => s.irPlayer)
      .filter(Boolean)
      .reduce((sum, p) => sum + rawCtx.puntValue(p), 0);
    const outZ = appliedIrSwaps
      .map(s => s.replacePlayer)
      .filter(Boolean)
      .reduce((sum, p) => sum + rawCtx.puntValue(p), 0);
    const rawTeam = rawCtx.teamById.get(myTeamId);
    const effTeam = ctx.teamById.get(myTeamId);
    const posWarnings = (rawTeam && effTeam)
      ? comparePositionImpact(rawTeam.players, effTeam.players, ctx.rosterPositions)
      : [];
    irDelta = {
      delta: baseWins.total - rawWins.total,
      beforeTotal: rawWins.total,
      afterTotal: baseWins.total,
      activeCount: activeCats.size,
      inZ,
      outZ,
      netZ: inZ - outZ,
      posWarnings,
    };
  }
  const numTeams = leagueData.teams.length;
  const activeCount = activeCats.size;
  const sourceMeta = SOURCE_OPTIONS.find(s => s.key === statsSource);
  const partnerTeam = evaluation?.partner ? ctx.teamById.get(evaluation.partner.teamId) : null;

  return (
    <div className="trade-page page-wrapper fade-up">
      <div className="section">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <h1 className="section-title" style={{ textAlign: 'left' }}>Trade Center</h1>
            <p className="section-subtitle" style={{ textAlign: 'left' }}>
              Trades are scored by how they change your expected head-to-head category wins against the league — so roster fit and punts matter, not just raw value.
            </p>
          </div>
          <YahooRefreshButton
            loading={loading}
            onRefresh={refreshTeam}
            title="Reload latest team and league data from Yahoo Fantasy"
          />
        </div>

        <div className="trade-controls-bar">
          <div className="mode-toggle trade-mode-tabs" role="tablist" aria-label="Trade Center views">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'analyzer'}
              className={`trade-mode-btn ${tab === 'analyzer' ? 'active' : ''}`}
              onClick={() => setTab('analyzer')}
            >
              Trade Analyzer
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'suggest'}
              className={`trade-mode-btn ${tab === 'suggest' ? 'active' : ''}`}
              onClick={() => setTab('suggest')}
            >
              Trade Suggestions
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'fa-swaps'}
              className={`trade-mode-btn ${tab === 'fa-swaps' ? 'active' : ''}`}
              onClick={() => setTab('fa-swaps')}
            >
              Free Agent Swaps
            </button>
            <button
              type="button"
              className="trade-mode-btn external"
              onClick={() => navigate('/streamers')}
              title="Daily schedule streaming lives on the Streamers page"
            >
              Streamers ↗
            </button>
          </div>
          <div className="trade-source-group">
            <span className="trade-source-label">Projection:</span>
            <div className="trade-source-toggle">
              {SOURCE_OPTIONS.map(s => (
                <button
                  key={s.key}
                  type="button"
                  className={`trade-source-btn ${statsSource === s.key ? 'active' : ''}`}
                  onClick={() => setStatsSource(s.key)}
                  title={s.desc}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="trade-source-desc">{sourceMeta?.desc}</div>

        <CategoryToggle puntedCats={puntedCats} onToggle={togglePunt} label="Punt Build" />

        <IrActivationPanel
          irPlayers={irPlayers}
          activePlayers={activeRosterPlayers}
          irSwaps={irSwapsMap}
          irStashes={irStashes}
          freeAgents={stashFreeAgents}
          waiverReplacement={rawCtx.replacement}
          onToggleIr={handleToggleIr}
          onChangeReplace={handleChangeIrReplace}
          onAddStash={handleAddStash}
          onChangeStashReplace={handleChangeStashReplace}
          onRemoveStash={handleRemoveStash}
          onReset={handleResetIr}
          rawCtx={rawCtx}
          statsSource={statsSource}
          irDelta={irDelta}
        />

        <CategoryStandings
          wins={baseWins}
          ranks={baseRanks}
          numTeams={numTeams}
          puntedCats={puntedCats}
          activeCount={activeCount}
          rawWins={rawWins}
          rawRanks={rawRanks}
          irActiveCount={appliedIrSwaps.length}
        />

        {tab === 'analyzer' ? (
          <div className="trade-layout">
            <div className="trade-selectors">
              <PlayerSelector
                label="Players you give up"
                badge="Giving"
                badgeClass="badge-red"
                players={myPlayers}
                selected={playersOut}
                onToggle={toggleSet(setPlayersOut)}
                ctx={ctx}
              />
              <PlayerSelector
                label="Players you receive"
                badge="Getting"
                badgeClass="badge-green"
                players={gettingPlayers}
                selected={playersIn}
                onToggle={toggleSet(setPlayersIn)}
                ctx={ctx}
                teamOptions={otherTeams}
                includeFreeAgents
                faLoading={faLoading}
              />
              {hasChanges && (
                <button
                  type="button"
                  className="btn-ghost trade-clear-btn"
                  onClick={() => { setPlayersOut(new Set()); setPlayersIn(new Set()); }}
                >
                  Clear trade
                </button>
              )}
            </div>

            <TradeImpactPanel
              ctx={ctx}
              myTeamId={myTeamId}
              statsSource={statsSource}
              puntedCats={puntedCats}
              activeCount={activeCount}
              baseWins={baseWins}
              baseRanks={baseRanks}
              outList={outList}
              inList={inList}
              hasChanges={hasChanges}
              evaluation={evaluation}
              zSummary={zSummary}
              impactView={impactView}
              setImpactView={setImpactView}
              streamOpenSpot={streamOpenSpot}
              setStreamOpenSpot={setStreamOpenSpot}
              partnerTeam={partnerTeam}
              partnerPuntsSet={partnerPuntsSet}
              partnerActiveCats={partnerActiveCats}
              onTogglePartnerPunt={togglePartnerPunt}
              appliedIrSwaps={appliedIrSwaps}
              onResetIr={handleResetIr}
            />
          </div>
        ) : tab === 'suggest' ? (
          <TradeSuggestionsPanel
            ctx={ctx}
            puntedCats={puntedCats}
            sellRows={sellRows}
            autoSellSet={autoSellSet}
            giveFocus={giveFocus}
            setGiveFocus={setGiveFocus}
            rankWindow={rankWindow}
            setRankWindow={setRankWindow}
            tradeFormat={tradeFormat}
            setTradeFormat={setTradeFormat}
            partnerFilter={partnerFilter}
            setPartnerFilter={setPartnerFilter}
            posFilter={posFilter}
            setPosFilter={setPosFilter}
            catFilter={catFilter}
            setCatFilter={setCatFilter}
            winWinOnly={winWinOnly}
            setWinWinOnly={setWinWinOnly}
            yahooFairOnly={yahooFairOnly}
            setYahooFairOnly={setYahooFairOnly}
            streamOpenSpot={streamOpenSpot}
            setStreamOpenSpot={setStreamOpenSpot}
            otherTeams={otherTeams}
            targets={targets}
            onLoadTrade={loadIntoAnalyzer}
          />
        ) : (
          <FreeAgentSwapsPanel
            ctx={ctx}
            puntedCats={puntedCats}
            dropRows={dropRows}
            dropFocus={dropFocus}
            setDropFocus={setDropFocus}
            posFilter={faPosFilter}
            setPosFilter={setFaPosFilter}
            catFilter={faCatFilter}
            setCatFilter={setFaCatFilter}
            hideOutFas={hideOutFas}
            setHideOutFas={setHideOutFas}
            swaps={faSwaps}
            faLoading={faLoading}
            faError={faError}
            onLoadSwap={loadIntoAnalyzer}
          />
        )}
      </div>
    </div>
  );
}
