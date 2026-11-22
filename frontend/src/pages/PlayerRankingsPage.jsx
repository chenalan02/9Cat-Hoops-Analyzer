import { useState, useEffect, useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import { fetchPlayerRankings } from '../services/apiClient.js';
import {
  CATEGORIES,
  getPlayerStatsObject,
  getPlayerMu,
  getPlayerZScore,
  buildLeagueMuMap,
  zScoreClass,
  zScoreBgClass,
} from '../utils/zScore.js';
import { formatMu, formatZ, formatDelta } from '../utils/formatters.js';
import CategoryToggle from '../components/CategoryToggle.jsx';
import SortIcon from '../components/common/SortIcon.jsx';
import YahooRefreshButton from '../components/common/YahooRefreshButton.jsx';
import PlayerGameLogModal from '../components/PlayerGameLogModal.jsx';
import './PlayerRankingsPage.css';

const PAGE_STEP = 75;
const OUT_STATUSES = new Set(['O', 'OUT', 'INJ', 'INJ_OUT', 'IL', 'IL+', 'IR', 'IR+', 'SUSP', 'OFS']);
const IR_SLOTS = new Set(['IL', 'IL+', 'IR', 'IR+', 'NA']);

const SOURCE_OPTIONS = [
  { key: 'ema', label: 'EMA', desc: 'Recent NBA form blended with preseason priors' },
  { key: 'ros', label: 'ROS', desc: 'Rest-of-season consensus projections' },
  { key: 'weekly', label: 'Weekly', desc: "50/50 blend calibrated for this week's matchups" },
  { key: 'preseason', label: 'Preseason', desc: 'Preseason zero-state baseline projections' },
];

const POS_FILTERS = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'];
const MIN_GP_FILTERS = [
  { value: 0, label: 'Any GP' },
  { value: 5, label: '5+ GP' },
  { value: 10, label: '10+ GP' },
];

let _rankingsCache = null;

function hasPosToken(positionsStr, targetPos) {
  if (!targetPos || targetPos === 'ALL') return true;
  if (!positionsStr) return false;
  const tokens = String(positionsStr)
    .toUpperCase()
    .split(/[,/|]+/)
    .map(t => t.trim());
  return tokens.includes(targetPos);
}

export default function PlayerRankingsPage() {
  const { leagueData, myTeam, loading: leagueLoading, refreshTeam } = useContext(TeamDataContext) || {};
  const navigate = useNavigate();

  const [rankingsData, setRankingsData] = useState(_rankingsCache);
  const [fetching, setFetching] = useState(!_rankingsCache);
  const [fetchError, setFetchError] = useState('');

  const [statsSource, setStatsSource] = useState('ema');
  const [displayMode, setDisplayMode] = useState('stats'); // 'stats' | 'z'
  const [puntedCats, setPuntedCats] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [ownershipFilter, setOwnershipFilter] = useState('all'); // 'all' | 'mine' | 'rostered' | 'fa'
  const [managerFilter, setManagerFilter] = useState('all');
  const [posFilter, setPosFilter] = useState('ALL');
  const [minGp, setMinGp] = useState(0);
  const [hideOutIl, setHideOutIl] = useState(false);

  const [sortKey, setSortKey] = useState('rank');
  const [sortDir, setSortDir] = useState('asc');
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  useEffect(() => {
    if (_rankingsCache) {
      setRankingsData(_rankingsCache);
      setFetching(false);
      return;
    }
    let cancelled = false;
    setFetching(true);
    fetchPlayerRankings()
      .then(data => {
        if (cancelled) return;
        _rankingsCache = data;
        setRankingsData(data);
        if (data?.sources_available?.length && !data.sources_available.includes('ema')) {
          setStatsSource(data.sources_available[0]);
        }
      })
      .catch(err => {
        if (cancelled) return;
        setFetchError(err?.message || 'Unable to load league-wide player rankings.');
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasLeague = Boolean(leagueData?.teams?.length);

  const rosterLookup = useMemo(() => {
    const exact = new Map();
    const lower = new Map();
    if (!leagueData?.teams) return { exact, lower };
    for (const team of leagueData.teams) {
      const isMine = myTeam && String(team.team_id) === String(myTeam.team_id);
      for (const p of team.players || []) {
        if (!p?.name) continue;
        const entry = {
          teamId: team.team_id,
          teamName: team.name,
          isMyTeam: Boolean(isMine),
          status: p.status || null,
          selected_position: p.selected_position || null,
          positions: p.positions || null,
          photo_url: p.photo_url || null,
          yahoo_rank: p.yahoo_rank ?? null,
          yahoo_orank: p.yahoo_orank ?? null,
        };
        exact.set(p.name, entry);
        lower.set(p.name.toLowerCase(), entry);
      }
    }
    return { exact, lower };
  }, [leagueData, myTeam]);

  const activeCats = useMemo(
    () => CATEGORIES.filter(c => !puntedCats.has(c.key)),
    [puntedCats]
  );

  const { rankedPlayers, myTeamCount } = useMemo(() => {
    const rawPlayers = rankingsData?.players || [];
    if (!rawPlayers.length) {
      return { rankedPlayers: [], myTeamCount: 0 };
    }

    const merged = rawPlayers.map(p => {
      const rInfo = rosterLookup.exact.get(p.name) || rosterLookup.lower.get(p.name.toLowerCase()) || null;
      const isMyTeam = Boolean(rInfo?.isMyTeam);
      const ownerType = hasLeague ? (isMyTeam ? 'mine' : (rInfo ? 'rostered' : 'fa')) : null;
      const ownerName = hasLeague ? (rInfo?.teamName || 'Free Agent') : null;
      const yahooRank = rInfo?.yahoo_rank ?? rInfo?.yahoo_orank ?? null;

      return {
        ...p,
        positions: (rInfo?.positions && rInfo.positions.toUpperCase() !== 'UTIL') ? rInfo.positions : p.positions,
        status: rInfo?.status ?? p.status ?? null,
        selected_position: rInfo?.selected_position ?? null,
        photo_url: rInfo?.photo_url ?? null,
        yahoo_rank: rInfo?.yahoo_rank ?? null,
        yahoo_orank: rInfo?.yahoo_orank ?? null,
        yahooSortRank: yahooRank,
        isMyTeam,
        ownerType,
        ownerName,
        ownerTeamId: rInfo?.teamId ?? null,
      };
    });

    const leagueMuMap = buildLeagueMuMap(merged, statsSource);
    const catStats = {};
    for (const cat of CATEGORIES) {
      const vals = leagueMuMap[cat.key] || [];
      const m = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const variance = vals.length > 1
        ? vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1)
        : 1;
      catStats[cat.key] = { mean: m, std: Math.sqrt(variance) || 1 };
    }

    const sourceExactZKey = {
      ema: 'ema_stats',
      ros: 'ros_stats',
      weekly: 'weekly_stats',
      preseason: 'preseason_stats',
    }[statsSource];

    const enriched = merged.map(p => {
      const s = getPlayerStatsObject(p, statsSource);
      const zScores = {};
      for (const cat of CATEGORIES) {
        zScores[cat.key] = getPlayerZScore(
          p,
          cat,
          statsSource,
          catStats[cat.key]?.mean,
          catStats[cat.key]?.std,
        );
      }

      const rawExactStats = sourceExactZKey ? p[sourceExactZKey] : null;
      const hasNativeTotal = activeCats.length === CATEGORIES.length
        && rawExactStats?.z_total != null
        && !Number.isNaN(rawExactStats.z_total);

      const zSumBase = rawExactStats?.z_total != null && !Number.isNaN(rawExactStats.z_total)
        ? Number(rawExactStats.z_total)
        : CATEGORIES.reduce((sum, cat) => sum + (zScores[cat.key] ?? 0), 0);

      const zSumActive = hasNativeTotal
        ? Number(rawExactStats.z_total)
        : activeCats.reduce((sum, cat) => sum + (zScores[cat.key] ?? 0), 0);

      const gpVal = s?.games_played ?? p.recent_form?.games_logged ?? null;
      const minVal = s?.mu_min != null && !Number.isNaN(s.mu_min) ? Number(s.mu_min) : null;

      return {
        ...p,
        activeStats: s,
        zScores,
        zSumBase,
        zSum: zSumActive,
        gpVal,
        minVal,
      };
    });

    const baseSorted = [...enriched].sort((a, b) => {
      if (Math.abs(b.zSumBase - a.zSumBase) > 1e-5) return b.zSumBase - a.zSumBase;
      return a.name.localeCompare(b.name);
    });
    const baseRankMap = new Map();
    baseSorted.forEach((p, idx) => baseRankMap.set(p.name, idx + 1));

    const activeSorted = [...enriched].sort((a, b) => {
      if (Math.abs(b.zSum - a.zSum) > 1e-5) return b.zSum - a.zSum;
      return a.name.localeCompare(b.name);
    });
    const withRanks = activeSorted.map((p, idx) => {
      const rank = idx + 1;
      const baseRank = baseRankMap.get(p.name) ?? rank;
      return {
        ...p,
        rank,
        baseRank,
        rankDelta: baseRank - rank,
      };
    });

    const mineCount = withRanks.reduce((acc, p) => acc + (p.isMyTeam ? 1 : 0), 0);
    return { rankedPlayers: withRanks, myTeamCount: mineCount };
  }, [rankingsData, rosterLookup, hasLeague, statsSource, activeCats]);

  const filteredPlayers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rankedPlayers.filter(p => {
      if (hasLeague) {
        if (ownershipFilter === 'mine' && !p.isMyTeam) return false;
        if (ownershipFilter === 'rostered' && p.ownerType === 'fa') return false;
        if (ownershipFilter === 'fa' && p.ownerType !== 'fa') return false;
        if (managerFilter !== 'all' && String(p.ownerTeamId) !== String(managerFilter)) return false;
      }
      if (!hasPosToken(p.positions, posFilter)) return false;
      if (minGp > 0 && (Number(p.gpVal) || 0) < minGp) return false;
      if (hideOutIl) {
        const st = String(p.status || '').toUpperCase().trim();
        const sel = String(p.selected_position || '').toUpperCase().trim();
        if (OUT_STATUSES.has(st) || IR_SLOTS.has(sel)) return false;
      }
      if (q) {
        const hay = `${p.name} ${p.nba_team || ''} ${p.ownerName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rankedPlayers, hasLeague, ownershipFilter, managerFilter, posFilter, minGp, hideOutIl, searchQuery]);

  const sortedPlayers = useMemo(() => {
    return [...filteredPlayers].sort((a, b) => {
      let av;
      let bv;
      if (sortKey === 'rank') {
        av = a.rank;
        bv = b.rank;
      } else if (sortKey === 'yahoo_rank') {
        av = a.yahooSortRank ?? 9999;
        bv = b.yahooSortRank ?? 9999;
      } else if (sortKey === 'name') {
        av = a.name;
        bv = b.name;
      } else if (sortKey === 'owner') {
        av = a.isMyTeam ? `0_${a.ownerName}` : a.ownerType === 'rostered' ? `1_${a.ownerName}` : '2_FA';
        bv = b.isMyTeam ? `0_${b.ownerName}` : b.ownerType === 'rostered' ? `1_${b.ownerName}` : '2_FA';
      } else if (sortKey === 'gp') {
        av = a.gpVal ?? -1;
        bv = b.gpVal ?? -1;
      } else if (sortKey === 'min') {
        av = a.minVal ?? -1;
        bv = b.minVal ?? -1;
      } else if (sortKey === 'zscore') {
        av = a.zSum ?? -999;
        bv = b.zSum ?? -999;
      } else {
        const cat = CATEGORIES.find(c => c.key === sortKey);
        if (!cat) return 0;
        if (displayMode === 'z') {
          av = a.zScores[cat.key] ?? -999;
          bv = b.zScores[cat.key] ?? -999;
        } else {
          av = getPlayerMu(a, cat, statsSource) ?? (cat.lowerBetter ? 999 : -999);
          bv = getPlayerMu(b, cat, statsSource) ?? (cat.lowerBetter ? 999 : -999);
        }
      }

      if (typeof av === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [filteredPlayers, sortKey, sortDir, displayMode, statsSource]);

  const visiblePlayers = useMemo(
    () => sortedPlayers.slice(0, visibleCount),
    [sortedPlayers, visibleCount]
  );

  const summaryInsights = useMemo(() => {
    const mine = rankedPlayers.filter(p => p.isMyTeam);
    const fas = rankedPlayers.filter(p => p.ownerType === 'fa');
    const avgRank = mine.length
      ? Math.round(mine.reduce((s, p) => s + p.rank, 0) / mine.length)
      : null;
    const bestMine = mine[0] || null;
    const topFa = fas[0] || null;
    return { mineCount: mine.length, avgRank, bestMine, topFa };
  }, [rankedPlayers]);

  const handleTogglePunt = (key) => {
    setPuntedCats(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      const ascDefault = key === 'rank' || key === 'yahoo_rank' || key === 'name' || key === 'owner'
        || (key === 'TO' && displayMode === 'stats');
      setSortDir(ascDefault ? 'asc' : 'desc');
    }
  };

  const Th = ({ col, label, title }) => (
    <th
      className={sortKey === col ? 'sort-active' : ''}
      onClick={() => handleSort(col)}
      title={title || `Sort by ${label}`}
    >
      {label} <SortIcon active={sortKey === col} dir={sortDir} />
    </th>
  );

  const availableSources = SOURCE_OPTIONS.filter(
    opt => !rankingsData?.sources_available?.length || rankingsData.sources_available.includes(opt.key)
  );
  const currentSourceDesc = SOURCE_OPTIONS.find(s => s.key === statsSource)?.desc || '';

  return (
    <div className="pr-page page-wrapper fade-up">
      <div className="section">
        <div className="pr-header">
          <div>
            <h1 className="section-title" style={{ textAlign: 'left', margin: 0 }}>📋 NBA Player Rankings</h1>
            <p className="section-subtitle" style={{ textAlign: 'left', margin: '4px 0 0' }}>
              Full-league 9-category rankings, punt re-ranking, and click-through NBA game logs
            </p>
          </div>
          {hasLeague && (
            <YahooRefreshButton
              loading={leagueLoading}
              onRefresh={refreshTeam}
              title="Reload latest team & free-agent ownership from Yahoo Fantasy"
            />
          )}
        </div>

        {!hasLeague && (
          <div className="pr-league-banner card">
            <span>
              Showing all ranked NBA players. Paste your Yahoo Fantasy link to highlight <strong>your roster</strong>, compare <strong>Yahoo ranks</strong>, and filter <strong>Free Agents</strong>.
            </span>
            <button type="button" className="btn-secondary pr-banner-btn" onClick={() => navigate('/')}>
              Load Yahoo League →
            </button>
          </div>
        )}

        {/* Controls & Filters */}
        <div className="pr-controls-card card">
          <div className="pr-top-toggles">
            <div className="source-toggle-group" style={{ marginBottom: 0 }}>
              <span className="source-toggle-label">Projection:</span>
              <div className="source-toggle">
                {availableSources.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    className={`source-toggle-btn ${statsSource === opt.key ? 'active' : ''}`}
                    onClick={() => setStatsSource(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="source-toggle-group" style={{ marginBottom: 0 }}>
              <span className="source-toggle-label">Display:</span>
              <div className="source-toggle">
                <button
                  type="button"
                  className={`source-toggle-btn ${displayMode === 'stats' ? 'active' : ''}`}
                  onClick={() => setDisplayMode('stats')}
                >
                  Per-Game Stats
                </button>
                <button
                  type="button"
                  className={`source-toggle-btn ${displayMode === 'z' ? 'active' : ''}`}
                  onClick={() => setDisplayMode('z')}
                >
                  Z-Scores
                </button>
              </div>
            </div>
          </div>

          <div className="pr-source-hint">
            <span className="source-desc-dot" />
            <span>{currentSourceDesc}</span>
            {rankingsData?.latest_game_date && (
              <span className="pr-log-date"> · Box scores through <strong>{rankingsData.latest_game_date}</strong></span>
            )}
          </div>

          <div className="pr-filter-row">
            <input
              type="search"
              className="pr-search-input"
              placeholder="Search player, NBA team, or manager…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setVisibleCount(PAGE_STEP);
              }}
              aria-label="Search players"
            />

            {hasLeague && (
              <div className="pr-pill-group" role="group" aria-label="Ownership filter">
                {[
                  { key: 'all', label: 'All' },
                  { key: 'mine', label: `My Team (${myTeamCount})` },
                  { key: 'rostered', label: 'Rostered' },
                  { key: 'fa', label: 'Free Agents' },
                ].map(item => (
                  <button
                    key={item.key}
                    type="button"
                    className={`pr-pill-btn ${ownershipFilter === item.key ? 'active' : ''}`}
                    onClick={() => {
                      setOwnershipFilter(item.key);
                      if (item.key !== 'all') setManagerFilter('all');
                      setVisibleCount(PAGE_STEP);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            {hasLeague && (
              <select
                className="pr-select"
                value={managerFilter}
                onChange={(e) => {
                  setManagerFilter(e.target.value);
                  if (e.target.value !== 'all') setOwnershipFilter('all');
                  setVisibleCount(PAGE_STEP);
                }}
                aria-label="Filter by fantasy team"
              >
                <option value="all">All Fantasy Teams</option>
                {leagueData.teams.map(t => (
                  <option key={t.team_id} value={t.team_id}>
                    {t.name}{myTeam && String(t.team_id) === String(myTeam.team_id) ? ' (You)' : ''}
                  </option>
                ))}
              </select>
            )}

            <div className="pr-pill-group" role="group" aria-label="Position filter">
              {POS_FILTERS.map(pos => (
                <button
                  key={pos}
                  type="button"
                  className={`pr-pill-btn ${posFilter === pos ? 'active' : ''}`}
                  onClick={() => {
                    setPosFilter(pos);
                    setVisibleCount(PAGE_STEP);
                  }}
                >
                  {pos === 'ALL' ? 'All Pos' : pos}
                </button>
              ))}
            </div>

            <select
              className="pr-select"
              value={minGp}
              onChange={(e) => {
                setMinGp(Number(e.target.value) || 0);
                setVisibleCount(PAGE_STEP);
              }}
              aria-label="Minimum games played"
            >
              {MIN_GP_FILTERS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>

            <label className="pr-checkbox-lbl">
              <input
                type="checkbox"
                checked={hideOutIl}
                onChange={(e) => {
                  setHideOutIl(e.target.checked);
                  setVisibleCount(PAGE_STEP);
                }}
              />
              <span>Hide OUT / IL</span>
            </label>
          </div>
        </div>

        {/* Punt Filter Chips */}
        <CategoryToggle puntedCats={puntedCats} onToggle={handleTogglePunt} />

        {/* Summary Insights Strip */}
        <div className="pr-summary-strip">
          <div className="pr-summary-chip">
            Showing <strong>{visiblePlayers.length}</strong> of <strong>{sortedPlayers.length}</strong> players
            {sortedPlayers.length !== rankedPlayers.length && ` (filtered from ${rankedPlayers.length})`}
          </div>

          {hasLeague && summaryInsights.bestMine && (
            <div className="pr-summary-chip mine">
              ★ My Team Avg Rank: <strong>#{summaryInsights.avgRank}</strong> · Top:{' '}
              <strong>#{summaryInsights.bestMine.rank} {summaryInsights.bestMine.name}</strong>
            </div>
          )}

          {hasLeague && summaryInsights.topFa && (
            <div className="pr-summary-chip fa">
              Best Available FA:{' '}
              <button
                type="button"
                className="pr-chip-player-btn"
                onClick={() => setSelectedPlayer(summaryInsights.topFa)}
              >
                #{summaryInsights.topFa.rank} {summaryInsights.topFa.name} →
              </button>
            </div>
          )}

          <div className="pr-summary-hint">Click any row to inspect box scores &amp; recent splits</div>
        </div>

        {/* Table State / Data Table */}
        {fetching ? (
          <div className="card pr-state-card">
            <span className="spinner" style={{ width: 28, height: 28 }} />
            <span>Loading NBA player rankings…</span>
          </div>
        ) : fetchError ? (
          <div className="card pr-state-card error">
            <span>⚠️ {fetchError}</span>
          </div>
        ) : sortedPlayers.length === 0 ? (
          <div className="card pr-state-card">
            <span>No players match your current filters.</span>
          </div>
        ) : (
          <>
            <div className="data-table-wrapper">
              <table className="data-table team-table pr-table" aria-label="NBA player rankings">
                <thead>
                  <tr>
                    <Th col="rank" label="#" title="Overall rank across all NBA players under active punts" />
                    {hasLeague && (
                      <Th col="yahoo_rank" label="Y! #" title="Yahoo Fantasy season / O-Rank" />
                    )}
                    <Th col="name" label="Player" />
                    {hasLeague && <Th col="owner" label="Owner" />}
                    <th>Pos</th>
                    <th>Team</th>
                    <Th col="gp" label="GP" title="Games played" />
                    <Th col="min" label="MIN" title="Projected / average minutes per game" />
                    {CATEGORIES.map(cat => (
                      <th
                        key={cat.key}
                        className={`${sortKey === cat.key ? 'sort-active' : ''} ${puntedCats.has(cat.key) ? 'punted-col' : ''}`}
                        onClick={() => handleSort(cat.key)}
                        title={`${cat.label} — click to sort`}
                      >
                        {cat.key} <SortIcon active={sortKey === cat.key} dir={sortDir} />
                      </th>
                    ))}
                    <Th col="zscore" label="ΣZ" />
                  </tr>
                </thead>
                <tbody>
                  {visiblePlayers.map(player => {
                    const { symbol, cls } = formatDelta(player.rankDelta);
                    const minTrend = player.recent_form?.min_trend ?? 0;
                    const showTrend = Math.abs(minTrend) >= 2.5;
                    const yRank = player.yahooSortRank;
                    const isYahooGem = yRank != null && (yRank - player.rank) >= 15;
                    const stUpper = String(player.status || '').toUpperCase();
                    const isOut = OUT_STATUSES.has(stUpper);

                    return (
                      <tr
                        key={player.name}
                        className={`pr-row ${player.isMyTeam ? 'pr-row-mine' : ''}`}
                        onClick={() => setSelectedPlayer(player)}
                        title={`Click to view ${player.name}'s game logs & recent splits`}
                      >
                        <td className="pr-rank-cell">
                          <span className="rank-num">#{player.rank}</span>
                          {puntedCats.size > 0 && player.rankDelta !== 0 && (
                            <span
                              className={`delta ${cls}`}
                              style={{ marginLeft: '5px' }}
                              title={`9-cat #${player.baseRank} → Punted #${player.rank}`}
                            >
                              {symbol}
                            </span>
                          )}
                        </td>

                        {hasLeague && (
                          <td
                            className={`pr-yahoo-cell ${isYahooGem ? 'gem' : ''}`}
                            title={
                              yRank != null
                                ? `Yahoo Rank #${yRank}${isYahooGem ? ` (+${yRank - player.rank} value vs model!)` : ''}`
                                : 'No Yahoo rank'
                            }
                          >
                            {yRank != null ? `#${yRank}` : '—'}
                          </td>
                        )}

                        <td>
                          <div className="player-cell">
                            <span className="player-name pr-player-link">{player.name}</span>
                            {player.status && (
                              <span className={`status-tag ${isOut ? 'status-il' : 'status-q'}`}>
                                {player.status}
                              </span>
                            )}
                            {showTrend && (
                              <span
                                className={`pr-min-trend ${minTrend > 0 ? 'up' : 'down'}`}
                                title={`Last 5 GP avg ${player.recent_form.l5_min} MIN vs ${player.recent_form.season_min} season avg`}
                              >
                                {minTrend > 0 ? `▲ +${minTrend.toFixed(1)}m` : `▼ ${minTrend.toFixed(1)}m`}
                              </span>
                            )}
                          </div>
                        </td>

                        {hasLeague && (
                          <td className="pr-owner-cell">
                            {player.isMyTeam ? (
                              <span className="pr-owner-tag mine" title={player.ownerName}>YOU</span>
                            ) : player.ownerType === 'fa' ? (
                              <span className="pr-owner-tag fa">FA</span>
                            ) : (
                              <span className="pr-owner-text" title={player.ownerName}>{player.ownerName}</span>
                            )}
                          </td>
                        )}

                        <td>
                          <span className="pr-pos-text">{player.positions || '—'}</span>
                        </td>
                        <td className="team-abbr">{player.nba_team || '—'}</td>
                        <td>{player.gpVal ?? '—'}</td>
                        <td>{player.minVal != null ? player.minVal.toFixed(1) : '—'}</td>

                        {CATEGORIES.map(cat => {
                          const mu = getPlayerMu(player, cat, statsSource);
                          const z = player.zScores[cat.key];
                          const punted = puntedCats.has(cat.key);
                          return (
                            <td
                              key={cat.key}
                              className={`${zScoreBgClass(z)} ${punted ? 'punted-col' : ''}`}
                              title={`${cat.label}: ${formatMu(mu, cat.key)} (z = ${formatZ(z)})`}
                            >
                              <span className={zScoreClass(z)}>
                                {displayMode === 'z' ? formatZ(z) : formatMu(mu, cat.key)}
                              </span>
                            </td>
                          );
                        })}

                        <td style={{ fontWeight: 700 }}>
                          <span className={player.zSum >= 0 ? 'z-good' : 'z-poor'}>
                            {player.zSum != null ? player.zSum.toFixed(2) : '—'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {visiblePlayers.length < sortedPlayers.length && (
              <div className="pr-pagination">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setVisibleCount(c => c + PAGE_STEP)}
                >
                  Show More (+{Math.min(PAGE_STEP, sortedPlayers.length - visiblePlayers.length)})
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setVisibleCount(sortedPlayers.length)}
                >
                  Show All ({sortedPlayers.length})
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selectedPlayer && (
        <PlayerGameLogModal
          player={selectedPlayer}
          statsSource={statsSource}
          puntedCats={puntedCats}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  );
}
