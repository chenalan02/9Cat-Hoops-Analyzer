import { useState, useMemo, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import CategoryToggle from '../components/CategoryToggle.jsx';
import YahooRefreshButton from '../components/common/YahooRefreshButton.jsx';
import { LoadingView, EmptyState } from '../components/common/PageStateGuard.jsx';
import CategoryStandings from '../components/trade/CategoryStandings.jsx';
import PlayerSelector from '../components/trade/PlayerSelector.jsx';
import TradeImpactPanel from '../components/trade/TradeImpactPanel.jsx';
import TradeSuggestionsPanel from '../components/trade/TradeSuggestionsPanel.jsx';
import { SOURCE_OPTIONS } from '../components/trade/tradeFormatters.js';
import { searchFreeAgents } from '../services/apiClient.js';
import { readSessionJson, writeSessionJson } from '../services/storageCache.js';
import {
  ALL_CAT_KEYS,
  ALL_CAT_SET,
  isActiveSlot,
  buildTradeContext,
  evaluateTrade,
  categoryRanks,
  computeSellCandidates,
  computeTradeTargets,
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
  const [partnerPuntsMap, setPartnerPuntsMap] = useState({});
  const [giveFocus, setGiveFocus] = useState('__AUTO__');
  const [rankWindow, setRankWindow] = useState(15);
  const [tradeFormat, setTradeFormat] = useState('all');
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [posFilter, setPosFilter] = useState('all');
  const [catFilter, setCatFilter] = useState('all');
  const [winWinOnly, setWinWinOnly] = useState(false);

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
      return;
    }

    let cancelled = false;
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
      })
      .catch(() => {
        // Fallback to synthetic bottom-10% replacement happens inside buildTradeContext.
      });

    return () => { cancelled = true; };
  }, [leagueData, statsSource]);

  const activeCats = useMemo(() => new Set(ALL_CAT_KEYS.filter(k => !puntedCats.has(k))), [puntedCats]);
  const myTeamId = myTeam?.team_id;

  const ctx = useMemo(() => {
    if (!leagueData?.teams?.length || myTeamId == null) return null;
    return buildTradeContext(leagueData.teams, statsSource, activeCats, {
      freeAgents,
      rosterPositions: leagueData.roster_positions,
      streamingBonus: streamOpenSpot ? 1.5 : 0,
    });
  }, [leagueData, statsSource, activeCats, myTeamId, freeAgents, streamOpenSpot]);

  const myPlayers = useMemo(() => {
    if (!ctx || !myTeam) return [];
    return [...myTeam.players].sort((a, b) => ctx.puntValue(b) - ctx.puntValue(a));
  }, [ctx, myTeam]);

  const otherTeams = useMemo(
    () => (leagueData?.teams || []).filter(t => t.team_id !== myTeamId),
    [leagueData, myTeamId]
  );

  const otherPlayers = useMemo(() => {
    if (!ctx) return [];
    return otherTeams.flatMap(t => t.players).sort((a, b) => ctx.puntValue(b) - ctx.puntValue(a));
  }, [ctx, otherTeams]);

  const outList = useMemo(() => myPlayers.filter(p => playersOut.has(p.name)), [myPlayers, playersOut]);
  const inList = useMemo(() => otherPlayers.filter(p => playersIn.has(p.name)), [otherPlayers, playersIn]);
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
    });
  }, [ctx, tab, myTeamId, givePlayers, rankWindow, giveFocus, tradeFormat, partnerFilter, partnerPuntsMap, posFilter, catFilter, winWinOnly]);

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
          <div className="mode-toggle">
            <button className={`btn-ghost ${tab === 'analyzer' ? 'active' : ''}`} onClick={() => setTab('analyzer')}>
              Trade Analyzer
            </button>
            <button className={`btn-ghost ${tab === 'suggest' ? 'active' : ''}`} onClick={() => setTab('suggest')}>
              Trade Suggestions
            </button>
            <button className="btn-ghost" onClick={() => navigate('/streamers')} title="Free-agent streaming lives on the Streamers page">
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

        <CategoryStandings
          wins={baseWins}
          ranks={baseRanks}
          numTeams={numTeams}
          puntedCats={puntedCats}
          activeCount={activeCount}
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
                players={otherPlayers}
                selected={playersIn}
                onToggle={toggleSet(setPlayersIn)}
                ctx={ctx}
                teamOptions={otherTeams}
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
            />
          </div>
        ) : (
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
            streamOpenSpot={streamOpenSpot}
            setStreamOpenSpot={setStreamOpenSpot}
            otherTeams={otherTeams}
            targets={targets}
            onLoadTrade={loadIntoAnalyzer}
          />
        )}
      </div>
    </div>
  );
}
