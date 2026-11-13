import { useState, useMemo, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import CategoryToggle from '../components/CategoryToggle.jsx';
import { CATEGORIES, getPlayerMu, zScoreClass } from '../utils/zScore.js';
import { formatMu, formatZ, formatPct, ordinal } from '../utils/formatters.js';
import {
  PROJ_GAMES,
  ALL_CAT_KEYS,
  ALL_CAT_SET,
  isActiveSlot,
  playerHasPosition,
  buildTradeContext,
  evaluateTrade,
  categoryRanks,
  computeSellCandidates,
  computeTradeTargets,
  getMarketRank,
} from '../utils/tradeEngine.js';
import './TradePage.css';

// ─── Constants & helpers ──────────────────────────────

const SOURCE_OPTIONS = [
  { key: 'ros',    label: 'ROS',    desc: 'Rest-of-season projections — recommended for trades (long-term value).' },
  { key: 'ema',    label: 'EMA',    desc: 'Recent-form weighted averages — captures current role and usage.' },
  { key: 'weekly', label: 'Weekly', desc: "This week's per-game projections — short-term only." },
];

const signed = (v, d = 2) => (v == null || isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}`);
const isRateCat = cat => cat.derived === 'fg' || cat.derived === 'ft';

function fmtCatDelta(cat, delta) {
  if (delta == null || isNaN(delta)) return '—';
  if (isRateCat(cat)) return `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`;
}

function verdictFor(delta) {
  if (delta >= 0.3)   return { text: '🌟 Strongly Recommended — major category gain', cls: 'good' };
  if (delta >= 0.08)  return { text: '✓ Favorable — improves your weekly category odds', cls: 'good' };
  if (delta > -0.08)  return { text: '⚖️ Roughly Neutral — little change in category odds', cls: 'neutral' };
  if (delta > -0.3)   return { text: '✗ Unfavorable — lowers your weekly category odds', cls: 'bad' };
  return { text: '⛔ Avoid — significant category loss', cls: 'bad' };
}

function partnerVerdict(delta) {
  if (delta >= 0.05)  return { text: 'Likely to accept — it improves their team too', cls: 'good' };
  if (delta > -0.05)  return { text: 'Neutral for them — plausible accept', cls: 'neutral' };
  return { text: 'Hurts their team — expect pushback', cls: 'bad' };
}

// ─── Category standings strip ─────────────────────────

function CategoryStandings({ wins, ranks, numTeams, puntedCats, activeCount }) {
  const puntHints = CATEGORIES
    .filter(c => !puntedCats.has(c.key) && wins.perCat[c.key] < 0.3)
    .sort((a, b) => wins.perCat[a.key] - wins.perCat[b.key])
    .slice(0, 2);

  return (
    <div className="cat-standings card">
      <div className="cs-header">
        <span className="cs-title">Your Category Standing vs League</span>
        <span className="cs-total">
          Expected cat wins / week: <strong>{wins.total.toFixed(2)}</strong> of {activeCount}
        </span>
      </div>
      <div className="cs-grid">
        {CATEGORIES.map(cat => {
          const punted = puntedCats.has(cat.key);
          const r = ranks[cat.key];
          const tier = r <= Math.ceil(numTeams / 3) ? 'strong' : r > Math.floor((numTeams * 2) / 3) ? 'weak' : 'mid';
          return (
            <div key={cat.key} className={`cs-cell ${tier} ${punted ? 'punted' : ''}`} title={`${cat.label}: ${ordinal(r)} of ${numTeams}, ${formatPct(wins.perCat[cat.key])} avg H2H win chance`}>
              <span className="cs-cat">{cat.key}</span>
              <span className="cs-rank">{ordinal(r)}</span>
              <span className="cs-prob">{punted ? 'PUNT' : `${formatPct(wins.perCat[cat.key])} win`}</span>
            </div>
          );
        })}
      </div>
      {puntHints.length > 0 && (
        <div className="cs-hint">
          💡 Weakest categories: {puntHints.map(c => `${c.key} (${formatPct(wins.perCat[c.key])})`).join(', ')} — consider punting
          {puntHints.length > 1 ? ' one of them' : ' it'} to surface players who don't fit your build.
        </div>
      )}
    </div>
  );
}

// ─── Category bar (full team view) ────────────────────

function CatBar({ cat, before, after, probBefore, probAfter, rankBefore, rankAfter, punted, showChange }) {
  const delta = showChange && after != null && before != null ? after - before : null;
  const meaningful = delta != null && Math.abs(delta) > (isRateCat(cat) ? 0.0001 : 0.05);
  const isGood = !meaningful ? null : cat.lowerBetter ? delta < 0 : delta > 0;
  const maxVal = Math.max(Math.abs(before ?? 0), Math.abs(after ?? 0), 0.001);
  const bFill = ((before ?? 0) / maxVal) * 100;
  const aFill = ((after ?? 0) / maxVal) * 100;
  const probDelta = showChange ? (probAfter ?? 0) - (probBefore ?? 0) : 0;

  return (
    <div className={`cat-bar-row ${punted ? 'punted' : ''}`}>
      <div className="cat-bar-label">
        <span className="cat-bar-key">
          {cat.key}
          {punted && <span className="cat-punt-tag">PUNT</span>}
        </span>
        <span className="cat-bar-vals">
          <span className="cat-val-before">{formatMu(before, cat.key)}</span>
          <span className="cat-arrow">{meaningful ? (isGood ? ' ▲ ' : ' ▼ ') : ' → '}</span>
          <span className={`cat-val-after ${meaningful ? (isGood ? 'z-elite' : 'z-bad') : ''}`}>
            {formatMu(showChange ? after : before, cat.key)}
          </span>
          {meaningful && (
            <span className={`cat-delta-chip ${isGood ? 'good' : 'bad'}`}>{fmtCatDelta(cat, delta)}</span>
          )}
        </span>
      </div>
      <div className="cat-bars-wrap">
        <div className="cat-bars">
          <div className="cat-bar-track">
            <div className="cat-bar-fill before" style={{ width: `${bFill}%` }} />
          </div>
          <div className="cat-bar-track">
            <div
              className={`cat-bar-fill after ${meaningful ? (isGood ? 'positive' : 'negative') : ''}`}
              style={{ width: `${showChange ? aFill : bFill}%` }}
            />
          </div>
        </div>
        <div className="cat-bar-meta">
          <span>
            Win {formatPct(probBefore)}
            {showChange && Math.abs(probDelta) >= 0.005 && (
              <> → <strong className={probDelta > 0 ? 'z-elite' : 'z-bad'}>{formatPct(probAfter)}</strong></>
            )}
          </span>
          <span>
            Rank {ordinal(rankBefore)}
            {showChange && rankAfter !== rankBefore && (
              <> → <strong className={rankAfter < rankBefore ? 'z-elite' : 'z-bad'}>{ordinal(rankAfter)}</strong></>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Direct asset exchange grid ───────────────────────

function AssetExchangeGrid({ inList, outList, source, puntedCats }) {
  const sumStat = (list, key) => list.reduce((s, p) => {
    const st = p.isReplacement ? p.ema_stats : (source === 'ros' ? p.ros_stats : source === 'weekly' ? p.weekly_stats : p.ema_stats);
    const fallback = p.ema_stats;
    const v = st && st[key] != null ? st[key] : fallback?.[key];
    return s + (Number(v) || 0);
  }, 0);

  return (
    <div className="asset-grid">
      {CATEGORIES.map(cat => {
        let inVal, outVal, delta;
        if (isRateCat(cat)) {
          const m = cat.derived === 'fg' ? 'mu_fgm' : 'mu_ftm';
          const a = cat.derived === 'fg' ? 'mu_fga' : 'mu_fta';
          const inA = sumStat(inList, a), outA = sumStat(outList, a);
          inVal = inA > 0 ? sumStat(inList, m) / inA : null;
          outVal = outA > 0 ? sumStat(outList, m) / outA : null;
          delta = inVal != null && outVal != null ? inVal - outVal : null;
        } else {
          inVal = inList.reduce((s, p) => s + (getPlayerMu(p, cat, source) ?? 0), 0);
          outVal = outList.reduce((s, p) => s + (getPlayerMu(p, cat, source) ?? 0), 0);
          delta = inVal - outVal;
        }
        const isGood = delta == null ? null : cat.lowerBetter ? delta < 0 : delta > 0;
        const punted = puntedCats.has(cat.key);

        return (
          <div key={cat.key} className={`asset-card ${punted ? 'punted' : ''}`}>
            <div className="asset-card-header">
              <span>{cat.key}{punted && <span className="cat-punt-tag">PUNT</span>}</span>
              <span className="asset-card-title-sub">{cat.label}</span>
            </div>
            <div className="asset-card-body">
              <div className={`asset-card-delta ${delta != null ? (isGood ? 'z-elite' : 'z-bad') : ''}`}>
                {delta != null ? (
                  <>
                    {fmtCatDelta(cat, delta)}
                    <span className="asset-unit">{isRateCat(cat) ? '' : ' /gm'}</span>
                  </>
                ) : '—'}
              </div>
              {!isRateCat(cat) && delta != null && (
                <div className="asset-card-sub">{fmtCatDelta(cat, delta * PROJ_GAMES)} /week</div>
              )}
              <div className="asset-card-exchange-vals">
                <span>In: {isRateCat(cat) ? (inVal != null ? `${(inVal * 100).toFixed(1)}%` : '—') : formatMu(inVal, cat.key)}</span>
                <span className="asset-sep">·</span>
                <span>Out: {isRateCat(cat) ? (outVal != null ? `${(outVal * 100).toFixed(1)}%` : '—') : formatMu(outVal, cat.key)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Player selector ──────────────────────────────────

const POS_FILTERS = ['all', 'PG', 'SG', 'SF', 'PF', 'C'];

function PlayerSelector({ label, badge, badgeClass, players, selected, onToggle, ctx, teamOptions = null }) {
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [posFilter, setPosFilter] = useState('all');
  const [sortBy, setSortBy] = useState('value'); // 'value' | 'rank'

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = players.filter(p =>
      p.name.toLowerCase().includes(q) &&
      (teamFilter === 'all' || String(ctx.ownerByName.get(p.name)) === teamFilter) &&
      playerHasPosition(p, posFilter)
    );
    if (sortBy === 'rank') {
      return [...list].sort((a, b) => (getMarketRank(ctx, a.name) ?? 999) - (getMarketRank(ctx, b.name) ?? 999));
    }
    return list;
  }, [players, search, teamFilter, posFilter, sortBy, ctx]);

  return (
    <div className="player-selector">
      <div className="selector-header">
        <span className={`badge ${badgeClass}`}>{badge}</span>
        <span className="selector-label">{label} ({selected.size})</span>
        <div className="selector-sort-group" title="Sort players">
          <button type="button" className={`sel-sort-btn ${sortBy === 'value' ? 'active' : ''}`} onClick={() => setSortBy('value')}>
            Value
          </button>
          <button type="button" className={`sel-sort-btn ${sortBy === 'rank' ? 'active' : ''}`} onClick={() => setSortBy('rank')}>
            Rank
          </button>
        </div>
      </div>
      <div className="selector-filters">
        <input
          className="selector-search"
          placeholder="Search player…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {teamOptions && (
          <select className="selector-team-filter" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
            <option value="all">All teams</option>
            {teamOptions.map(t => (
              <option key={t.team_id} value={String(t.team_id)}>{t.name}</option>
            ))}
          </select>
        )}
      </div>
      <div className="selector-pos-bar">
        {POS_FILTERS.map(pos => (
          <button
            key={pos}
            type="button"
            className={`sel-pos-pill ${posFilter === pos ? 'active' : ''}`}
            onClick={() => setPosFilter(pos)}
          >
            {pos === 'all' ? 'All Pos' : pos}
          </button>
        ))}
      </div>
      <div className="selector-list">
        {filtered.slice(0, 120).map(p => {
          const isSelected = selected.has(p.name);
          const z = ctx.puntValue(p);
          const rank = getMarketRank(ctx, p.name);
          const ownerName = teamOptions ? ctx.teamById.get(ctx.ownerByName.get(p.name))?.name : null;
          const onIl = !isActiveSlot(p);
          return (
            <button
              key={p.name}
              className={`selector-player ${isSelected ? 'selected' : ''}`}
              onClick={() => onToggle(p)}
            >
              <div className="sp-info">
                <span className="sp-name">
                  {p.name}
                  {onIl && <span className="sp-il-tag">IL</span>}
                  {p.status && !onIl && <span className="sp-status-tag">{p.status}</span>}
                </span>
                <span className="sp-meta">
                  {p.nba_team} · {p.positions}{ownerName ? ` · ${ownerName}` : ''}
                </span>
              </div>
              <div className="sp-right">
                {rank != null && <span className="sp-rank" title="Overall projection rank">#{rank}</span>}
                <span className={`sp-z ${zScoreClass(z / Math.max(1, ctx.activeList.length / 3))}`} title="Punt-adjusted Z (sum over active categories)">
                  Z {formatZ(z)}
                </span>
                {isSelected && <span className="sp-check">✓</span>}
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && <p className="selector-empty">No players found</p>}
      </div>
      {selected.size > 0 && (
        <div className="selector-chips">
          {[...selected].map(name => {
            const p = players.find(x => x.name === name);
            return (
              <span key={name} className="selector-chip">
                {name}
                <button onClick={() => onToggle(p || { name })} className="chip-remove">×</button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Player breakdown card ────────────────────────────

function PlayerBreakdownCard({ p, kind, ctx, puntedCats }) {
  const z = ctx.zTable.get(p.name) || {};
  const rank = getMarketRank(ctx, p.name);
  const puntZ = ctx.puntValue(p);
  const vsRep = puntZ - ctx.replacement.puntZ;
  return (
    <div className={`player-delta-card ${kind === 'out' ? 'losing' : 'gaining'}`}>
      <div className="pd-top">
        <span className={`pd-badge badge ${kind === 'out' ? 'badge-red' : 'badge-green'}`}>
          {kind === 'out' ? 'Giving Up' : 'Receiving'}
        </span>
        <span className={`pd-zsum ${kind === 'out' ? 'z-bad' : 'z-elite'}`} title={`Punt-adjusted Z ${formatZ(puntZ)} · ${signed(vsRep)} vs waiver replacement`}>
          Z {formatZ(puntZ)} ({signed(vsRep, 1)} vs FA)
        </span>
      </div>
      <span className="pd-name">{p.name}</span>
      <span className="pd-team-pos">
        {p.nba_team} · {p.positions}{rank != null ? ` · Rank #${rank}` : ''}
        {!isActiveSlot(p) ? ' · IL (no weekly impact)' : ''}
      </span>
      <div className="pd-cats">
        {CATEGORIES.map(cat => (
          <span
            key={cat.key}
            className={`pd-cat-z ${puntedCats.has(cat.key) ? 'punted' : zScoreClass(z[cat.key])}`}
            title={cat.label}
          >
            {cat.key}: {formatZ(z[cat.key])}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Trade target card ────────────────────────────────

const FORMAT_LABELS = {
  '1for1': '1-for-1',
  '2for1': '2-for-1 Upgrade',
  '1for2': '1-for-2 Depth',
};

function TradeTargetCard({ t, ctx, puntedCats, onLoad }) {
  const gives = t.gives || [t.give];
  const gets = t.gets || [t.get];
  const formatLabel = FORMAT_LABELS[t.type] || '1-for-1';

  return (
    <div className={`target-card ${t.winWin ? 'win-win' : ''}`}>
      <div className="tc-format-row">
        <span className={`tc-format-pill fmt-${t.type || '1for1'}`}>{formatLabel}</span>
        {t.type === '2for1' && ctx?.replacement?.name && (
          <span className="tc-spot-note" title={`Open roster spot filled by ${ctx.replacement.name}`}>
            + opens spot ({ctx.replacement.isRealFreeAgent ? ctx.replacement.name : 'waiver add'})
          </span>
        )}
        {t.type === '1for2' && t.myDrops?.[0] && (
          <span className="tc-spot-note drop" title="Lowest active roster player assumed dropped to fit 2 incoming players">
            − drops {t.myDrops[0].name}
          </span>
        )}
      </div>

      <div className="tc-top">
        <div className="tc-swap">
          <div className="tc-player give">
            <span className="tc-label">Give</span>
            {gives.map(p => {
              const r = getMarketRank(ctx, p.name);
              return (
                <div key={p.name} className="tc-player-item">
                  <span className="tc-name" title={p.name}>{p.name}</span>
                  <span className="tc-meta">#{r ?? '—'} · {p.nba_team} · {p.positions}</span>
                </div>
              );
            })}
          </div>
          <span className="tc-arrow">⇄</span>
          <div className="tc-player get">
            <span className="tc-label">Get</span>
            {gets.map(p => {
              const r = getMarketRank(ctx, p.name);
              return (
                <div key={p.name} className="tc-player-item">
                  <span className="tc-name" title={p.name}>
                    {p.name}
                    {p.status && <span className="sp-status-tag">{p.status}</span>}
                  </span>
                  <span className="tc-meta">#{r ?? '—'} · {p.nba_team} · {p.positions}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="tc-delta" title="Change in your expected H2H category wins per week vs the league">
          <span className="tc-delta-val">{signed(t.myDelta)}</span>
          <span className="tc-delta-lbl">cat wins / wk</span>
        </div>
      </div>

      <div className="tc-badges">
        <span className="tc-owner">with <strong>{t.partnerName}</strong></span>
        <span className={`tc-badge ${t.winWin ? 'good' : 'bad'}`} title="Change in the partner's expected 9-cat category wins">
          {t.winWin ? '🤝 Win-win' : 'Partner 9-cat'} {signed(t.partnerDelta)}
        </span>
        <span className={`tc-badge ${t.fairness === 'Fair value' ? 'neutral' : t.fairness === 'Reach' ? 'warn' : 'info'}`} title="Market value comparison">
          {t.fairness}{t.type === '1for1' && t.rankGap !== 0 ? ` (${t.rankGap > 0 ? '+' : ''}${t.rankGap} ranks)` : ''}
        </span>
      </div>

      {t.posWarnings?.length > 0 && (
        <div className="tc-pos-warn">⚠️ {t.posWarnings[0].text}</div>
      )}

      <div className="tc-cats">
        {CATEGORIES.map(cat => {
          const c = t.catChanges[cat.key];
          const punted = puntedCats.has(cat.key);
          const cls = punted ? 'punted' : c.probDelta > 0.005 ? 'pos' : c.probDelta < -0.005 ? 'neg' : 'flat';
          return (
            <span
              key={cat.key}
              className={`tc-cat ${cls}`}
              title={`${cat.label}: weekly ${fmtCatDelta(cat, c.muDelta)} · win chance ${signed(c.probDelta * 100, 1)} pts`}
            >
              <span className="tc-cat-key">{cat.key}</span>
              <span className="tc-cat-val">{fmtCatDelta(cat, c.muDelta)}</span>
            </span>
          );
        })}
      </div>

      <button type="button" className="tc-load-btn" onClick={() => onLoad(t)}>
        Open in Trade Analyzer →
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────

export default function TradePage() {
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

  const [tab, setTab]                 = useState('analyzer'); // 'analyzer' | 'suggest'
  const [statsSource, setStatsSource] = useState('ros');
  const [puntedCats, setPuntedCats]   = useState(new Set());
  const [playersOut, setPlayersOut]   = useState(new Set());
  const [playersIn, setPlayersIn]     = useState(new Set());
  const [impactView, setImpactView]   = useState('team'); // 'team' | 'exchange'
  const [streamOpenSpot, setStreamOpenSpot] = useState(false);
  const [freeAgents, setFreeAgents]   = useState([]);
  const [partnerPuntsMap, setPartnerPuntsMap] = useState({});
  const [giveFocus, setGiveFocus]     = useState('__AUTO__');
  const [rankWindow, setRankWindow]   = useState(15);
  const [tradeFormat, setTradeFormat] = useState('all'); // 'all' | '1for1' | '2for1' | '1for2'
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [posFilter, setPosFilter]     = useState('all');
  const [catFilter, setCatFilter]     = useState('all');
  const [winWinOnly, setWinWinOnly]   = useState(false);

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

  // Fetch league's real top free agents for realistic waiver replacement & 2-for-1 consolidation modeling
  useEffect(() => {
    if (!leagueData?.league_id || !leagueData?.teams?.length) return;
    const cacheKey = `9cat_streamer_fa_cache_${leagueData.league_id}_${statsSource}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setFreeAgents(parsed);
          return;
        }
      }
    } catch { /* ignore storage errors */ }

    let cancelled = false;
    const allRostered = leagueData.teams.flatMap(t => (t.players || []).map(p => p.name));
    fetch('/api/free-agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        league_id: leagueData.league_id,
        stats_source: statsSource,
        all_rostered_names: allRostered,
        limit: 45,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data?.status === 'success' && Array.isArray(data.payload)) {
          setFreeAgents(data.payload);
          try { sessionStorage.setItem(cacheKey, JSON.stringify(data.payload)); } catch { /* ignore */ }
        }
      })
      .catch(() => { /* graceful fallback to synthetic bottom-10% replacement */ });

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
  const inList  = useMemo(() => otherPlayers.filter(p => playersIn.has(p.name)), [otherPlayers, playersIn]);
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

  // Punt-adjusted Z exchange (secondary metric, includes forced drops / waiver fillers)
  const zSummary = useMemo(() => {
    if (!ctx || !evaluation) return null;
    const outActive = outList.filter(isActiveSlot);
    const outZ = outActive.reduce((s, p) => s + ctx.puntValue(p), 0)
      + evaluation.my.drops.reduce((s, p) => s + ctx.puntValue(p), 0);
    const inZ = inList.reduce((s, p) => s + ctx.puntValue(p), 0)
      + evaluation.my.fillers * ctx.replacement.puntZ;
    return { outZ, inZ, net: inZ - outZ };
  }, [ctx, evaluation, outList, inList]);

  // ── Suggestions ──
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
    return (
      <div className="page-wrapper center-content">
        <div className="spinner" style={{ width: 36, height: 36 }} />
        <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>Loading your team…</p>
      </div>
    );
  }

  if (!myTeam || !ctx) return (
    <div className="page-wrapper center-content">
      <div className="empty-state">
        <div style={{ fontSize: '4rem' }}>🔄</div>
        <h2 style={{ marginBottom: '0.5rem' }}>No Team Data</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Analyze your team first to use the trade analyzer.
        </p>
        <button className="btn-primary" onClick={() => navigate('/')}>Analyze My Team</button>
      </div>
    </div>
  );

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

        {/* Controls: tabs + data source */}
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
            {/* Left: player selectors */}
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

            {/* Right: impact panel */}
            <div className="trade-impact">
              {evaluation && evaluation.my.drops.length > 0 && (
                <div className="trade-balance-alert warning">
                  <span className="tba-icon">⚠️</span>
                  <div>
                    <strong>Uneven trade ({inList.length} in, {outList.filter(isActiveSlot).length} out):</strong>
                    <span> you'll need to drop {evaluation.my.drops.length} player{evaluation.my.drops.length > 1 ? 's' : ''} to stay at roster size.</span>
                    <div className="tba-sub">
                      Assumed drop (lowest punt-adjusted value): <strong>{evaluation.my.drops.map(p => `${p.name} (Z ${formatZ(ctx.puntValue(p))})`).join(', ')}</strong>
                    </div>
                  </div>
                </div>
              )}
              {evaluation && evaluation.my.fillers > 0 && (
                <div className="trade-balance-alert info">
                  <span className="tba-icon">💡</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <strong>{inList.length === 0 ? 'Unpaired drop' : 'Consolidation trade'}:</strong>
                        <span> {evaluation.my.fillers} open spot{evaluation.my.fillers > 1 ? 's' : ''} filled with <strong>{ctx.replacement.name}</strong>{ctx.replacement.isRealFreeAgent ? ` (best FA${ctx.replacement.rank ? `, #${ctx.replacement.rank}` : ''})` : ' (waiver proxy)'} at {ctx.replacement.streamingGames.toFixed(1)} gm/wk.</span>
                      </div>
                      <label className="stream-spot-toggle" title="Model active streaming out of the open roster spot (+1.5 games/wk over standard 3.5 gm/wk)">
                        <input type="checkbox" checked={streamOpenSpot} onChange={e => setStreamOpenSpot(e.target.checked)} />
                        <span>Stream open spot (+1.5 gm)</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
              {evaluation?.myPosWarnings?.length > 0 && (
                <div className={`trade-balance-alert ${evaluation.myPosWarnings.some(w => w.severity === 'error') ? 'danger' : 'warning'}`}>
                  <span className="tba-icon">🧩</span>
                  <div>
                    <strong>Positional coverage:</strong>{' '}
                    {evaluation.myPosWarnings.map(w => w.text).join(' · ')}
                  </div>
                </div>
              )}

              {/* Headline impact */}
              <div className={`impact-summary card ${evaluation ? (evaluation.my.delta >= 0.08 ? 'impact-positive' : evaluation.my.delta <= -0.08 ? 'impact-negative' : '') : ''}`}>
                <div className="impact-label">Δ Expected Category Wins / Week (vs league)</div>
                {evaluation ? (
                  <>
                    <div className={`impact-delta ${evaluation.my.delta >= 0 ? 'z-elite' : 'z-bad'}`}>
                      {signed(evaluation.my.delta)}
                    </div>
                    <div className="impact-sub">
                      <span>{evaluation.my.before.total.toFixed(2)} → <strong>{evaluation.my.after.total.toFixed(2)}</strong> of {activeCount} cats</span>
                      <span className="impact-sub-sep">·</span>
                      <span title="Sum of punt-adjusted Z of incoming minus outgoing (incl. forced drops / waiver fillers)">
                        Punt-adj. Z: <strong className={zSummary.net >= 0 ? 'z-elite' : 'z-bad'}>{signed(zSummary.net)}</strong>
                        {' '}({signed(zSummary.inZ, 1)} in / {signed(zSummary.outZ, 1)} out)
                      </span>
                    </div>
                    {(() => {
                      const v = verdictFor(evaluation.my.delta);
                      return <div className={`impact-verdict ${v.cls}`}>{v.text}</div>;
                    })()}
                    {Math.sign(evaluation.my.delta) !== Math.sign(zSummary.net) && Math.abs(zSummary.net) > 0.5 && Math.abs(evaluation.my.delta) > 0.05 && (
                      <div className="impact-note">
                        {zSummary.net > 0
                          ? 'You gain raw value, but it lands in categories you already win, lose comfortably, or punt.'
                          : 'You give up raw value, but the stats you gain land in your competitive categories — a fit-driven win.'}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="impact-placeholder">Select players to analyze trade impact — or try the Trade Suggestions tab.</div>
                )}
              </div>

              {/* Partner perspective */}
              {evaluation?.partner && partnerTeam && (() => {
                const pCatArr = CATEGORIES
                  .map(cat => ({ cat, d: evaluation.partner.catChanges?.[cat.key]?.probDelta ?? 0 }))
                  .filter(x => !partnerPuntsSet.has(x.cat.key));
                const topGains = pCatArr.filter(x => x.d >= 0.008).sort((a, b) => b.d - a.d).slice(0, 2);
                const topLosses = pCatArr.filter(x => x.d <= -0.008).sort((a, b) => a.d - b.d).slice(0, 2);
                return (
                  <div className="partner-card card">
                    <div className="partner-card-top">
                      <div className="partner-card-left">
                        <span className="impact-label" style={{ marginBottom: 2 }}>Partner perspective</span>
                        <span className="partner-name">{partnerTeam.name}</span>
                        <span className="partner-sub">
                          {evaluation.partner.before.total.toFixed(2)} → {evaluation.partner.after.total.toFixed(2)} wins
                          {' '}({partnerPuntsSet.size === 0 ? 'all 9 cats' : `${partnerActiveCats.size} cats`})
                          {evaluation.partner.drops.length > 0 && ` · would drop ${evaluation.partner.drops.map(p => p.name).join(', ')}`}
                        </span>
                        {(topGains.length > 0 || topLosses.length > 0) && (
                          <div className="partner-cat-movers">
                            {topGains.map(({ cat, d }) => (
                              <span key={cat.key} className="pcm-chip good">+{cat.key} {signed(d * 100, 1)}%</span>
                            ))}
                            {topLosses.map(({ cat, d }) => (
                              <span key={cat.key} className="pcm-chip bad">{cat.key} {signed(d * 100, 1)}%</span>
                            ))}
                          </div>
                        )}
                        {evaluation.partner.posWarnings?.length > 0 && (
                          <span className="partner-pos-warn">⚠️ Partner fit: {evaluation.partner.posWarnings[0].text}</span>
                        )}
                      </div>
                      <div className="partner-card-right">
                        <span className={`partner-delta ${evaluation.partner.delta >= 0 ? 'z-elite' : 'z-bad'}`}>{signed(evaluation.partner.delta)}</span>
                        {(() => {
                          const v = partnerVerdict(evaluation.partner.delta);
                          return <span className={`partner-verdict ${v.cls}`}>{v.text}</span>;
                        })()}
                      </div>
                    </div>
                    <div className="partner-punt-bar">
                      <span className="partner-punt-lbl">Model partner punts:</span>
                      <div className="partner-punt-pills">
                        {CATEGORIES.map(c => {
                          const isPunted = partnerPuntsSet.has(c.key);
                          return (
                            <button
                              key={c.key}
                              type="button"
                              className={`partner-punt-btn ${isPunted ? 'punted' : ''}`}
                              onClick={() => togglePartnerPunt(partnerTeam.team_id, c.key)}
                              title={isPunted ? `Un-punt ${c.key} for ${partnerTeam.name}` : `Model ${partnerTeam.name} punting ${c.key}`}
                            >
                              {c.key}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}
              {evaluation && evaluation.partnerIds.length > 1 && (
                <div className="trade-balance-alert info">
                  <span className="tba-icon">🔀</span>
                  <div>Multi-team trade — partner acceptance can't be estimated because it's unclear which team receives your players.</div>
                </div>
              )}

              {/* Category breakdown */}
              <div className="impact-cats card">
                <div className="impact-cats-header">
                  <span>Category Impact</span>
                  <div className="impact-view-tabs">
                    <button className={`impact-tab-btn ${impactView === 'team' ? 'active' : ''}`} onClick={() => setImpactView('team')}>
                      Full Team Weekly Totals
                    </button>
                    <button className={`impact-tab-btn ${impactView === 'exchange' ? 'active' : ''}`} onClick={() => setImpactView('exchange')}>
                      Direct Asset Exchange
                    </button>
                  </div>
                </div>

                {impactView === 'exchange' ? (
                  hasChanges ? (
                    <AssetExchangeGrid
                      inList={[...inList, ...Array.from({ length: evaluation?.my.fillers || 0 }, () => ctx.replacement)]}
                      outList={[...outList.filter(isActiveSlot), ...(evaluation?.my.drops || [])]}
                      source={statsSource}
                      puntedCats={puntedCats}
                    />
                  ) : (
                    <div className="impact-placeholder">Select players to see category differentials</div>
                  )
                ) : (
                  <div className="cat-bar-list">
                    <div className="cat-legend-bar">
                      <span className="legend-dot before" /> Current roster &nbsp;
                      <span className="legend-dot after" /> After trade
                      <span className="cat-legend-note">Weekly totals assume {PROJ_GAMES} games per active player</span>
                    </div>
                    {CATEGORIES.map(cat => (
                      <CatBar
                        key={cat.key}
                        cat={cat}
                        before={ctx.distById.get(myTeamId)[cat.key].mu}
                        after={evaluation?.distAfter[cat.key].mu}
                        probBefore={baseWins.perCat[cat.key]}
                        probAfter={evaluation?.my.after.perCat[cat.key]}
                        rankBefore={baseRanks[cat.key]}
                        rankAfter={evaluation?.ranksAfter[cat.key]}
                        punted={puntedCats.has(cat.key)}
                        showChange={!!evaluation}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Player cards */}
              {hasChanges && (
                <div className="player-delta-panel card">
                  <div className="impact-cats-header">
                    <span>
                      Player Breakdown ({ctx.replacement.isRealFreeAgent ? `waiver benchmark: ${ctx.replacement.name}, ` : 'waiver replacement: '}Z {formatZ(ctx.replacement.puntZ)})
                    </span>
                  </div>
                  <div className="player-delta-grid">
                    {outList.map(p => <PlayerBreakdownCard key={p.name} p={p} kind="out" ctx={ctx} puntedCats={puntedCats} />)}
                    {inList.map(p => <PlayerBreakdownCard key={p.name} p={p} kind="in" ctx={ctx} puntedCats={puntedCats} />)}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── Trade Suggestions ── */
          <div className="suggest-layout">
            <div className="sell-panel card">
              <div className="impact-cats-header" style={{ marginBottom: '0.5rem' }}>
                <span>Players to Shop</span>
              </div>
              <p className="suggest-help">
                Surfaces players whose stats sit in your punted or already-saturated categories, while protecting un-punted core stars from Auto-scan.
              </p>

              <button
                type="button"
                className={`sell-row auto ${giveFocus === '__AUTO__' ? 'selected' : ''}`}
                onClick={() => setGiveFocus('__AUTO__')}
              >
                <span className="sell-name">⚡ Auto — scan top 5 candidates</span>
              </button>

              {sellRows.map(r => (
                <button
                  key={r.player.name}
                  type="button"
                  className={`sell-row ${giveFocus === r.player.name ? 'selected' : ''} ${giveFocus === '__AUTO__' && autoSellSet.has(r.player.name) ? 'in-auto' : ''}`}
                  onClick={() => setGiveFocus(r.player.name)}
                >
                  <div className="sell-row-top">
                    <span className="sell-name" title={r.player.name}>{r.player.name}</span>
                    {r.marketRank != null && (
                      <span className="sp-rank" title={`Projection rank (#${r.marketRank})`}>#{r.marketRank}</span>
                    )}
                  </div>
                  <div className="sell-row-stats">
                    <span
                      title={
                        puntedCats.size > 0
                          ? `League 9-cat Z-rank (${r.overallRank}) vs rank under your punt build (${r.puntRank}). Blue badge is projection rank.`
                          : `9-cat Z-rank across rostered players (#${r.overallRank}); blue badge is projection rank (#${r.marketRank ?? '—'}).`
                      }
                    >
                      {puntedCats.size > 0 ? (
                        <>
                          Build Rank {r.overallRank} → {r.puntRank}
                          {r.rankShift !== 0 && (
                            <strong className={r.rankShift > 0 ? 'z-bad' : 'z-elite'}>
                              {' '}({r.rankShift > 0 ? '▼' : '▲'}{Math.abs(r.rankShift)})
                            </strong>
                          )}
                        </>
                      ) : (
                        <>9-Cat Rank #{r.overallRank}</>
                      )}
                    </span>
                    <span title="Expected category wins per week this player adds over waiver replacement">
                      {r.marginal >= 0 ? `+${r.marginal.toFixed(2)}` : `−${Math.abs(r.marginal).toFixed(2)}`} wins/wk
                    </span>
                  </div>
                  {(r.tags.length > 0 || r.isCornerstone) && (
                    <div className="sell-tags">
                      {r.isCornerstone && <span className="sell-tag cornerstone" title="Protected from Auto-scan; click manually to explore offers">🔒 Cornerstone</span>}
                      {r.tags.map(tag => <span key={tag} className="sell-tag">{tag}</span>)}
                    </div>
                  )}
                </button>
              ))}
            </div>

            <div className="targets-panel">
              <div className="targets-header card">
                <div>
                  <div className="targets-title">
                    Trade Targets {giveFocus === '__AUTO__' ? 'for your top sell candidates' : `for ${giveFocus}`}
                  </div>
                  <div className="suggest-help" style={{ margin: 0 }}>
                    Realistic 1-for-1 swaps (±{rankWindow} ranks), 2-for-1 upgrades{streamOpenSpot ? ' (with +1.5 gm open-spot streaming)' : ''}, and 1-for-2 depth splits — partner evaluated over 9-cat.
                  </div>
                </div>
                <div className="targets-header-controls">
                  <label className="stream-spot-toggle" title="Credit open 2-for-1 roster spot with +1.5 games/wk from active waiver streaming">
                    <input type="checkbox" checked={streamOpenSpot} onChange={e => setStreamOpenSpot(e.target.checked)} />
                    <span>Stream open spot (+1.5 gm)</span>
                  </label>
                  <label className="window-control">
                    <span>1-for-1 window ±{rankWindow}</span>
                    <input
                      type="range"
                      min="5"
                      max="40"
                      step="5"
                      value={rankWindow}
                      onChange={e => setRankWindow(Number(e.target.value))}
                    />
                  </label>
                </div>
              </div>

              <div className="targets-filter-bar card">
                <div className="tf-group">
                  {[
                    { key: 'all', label: 'All Deals' },
                    { key: '1for1', label: '1-for-1' },
                    { key: '2for1', label: '2-for-1 Upgrade' },
                    { key: '1for2', label: '1-for-2 Depth' },
                  ].map(f => (
                    <button
                      key={f.key}
                      type="button"
                      className={`tf-pill ${tradeFormat === f.key ? 'active' : ''}`}
                      onClick={() => setTradeFormat(f.key)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="tf-group">
                  {POS_FILTERS.map(pos => (
                    <button
                      key={pos}
                      type="button"
                      className={`tf-pill ${posFilter === pos ? 'active' : ''}`}
                      onClick={() => setPosFilter(pos)}
                    >
                      {pos === 'all' ? 'Any Pos' : pos}
                    </button>
                  ))}
                </div>

                <div className="tf-selects">
                  <select className="tf-select" value={partnerFilter} onChange={e => setPartnerFilter(e.target.value)} aria-label="Filter by trade partner">
                    <option value="all">All Partners</option>
                    {otherTeams.map(t => (
                      <option key={t.team_id} value={String(t.team_id)}>{t.name}</option>
                    ))}
                  </select>

                  <select className="tf-select" value={catFilter} onChange={e => setCatFilter(e.target.value)} aria-label="Filter by category boost">
                    <option value="all">Boosts Any Cat</option>
                    {CATEGORIES.map(c => (
                      <option key={c.key} value={c.key}>Boosts {c.key}</option>
                    ))}
                  </select>

                  <label className="tf-check">
                    <input type="checkbox" checked={winWinOnly} onChange={e => setWinWinOnly(e.target.checked)} />
                    <span>🤝 Win-win only</span>
                  </label>
                </div>
              </div>

              {targets.length === 0 ? (
                <div className="card impact-placeholder" style={{ textAlign: 'center', padding: '2rem' }}>
                  No upgrades found matching these filters. Try widening the rank window, clearing filters, or picking another shop candidate.
                </div>
              ) : (
                <div className="targets-grid">
                  {targets.map(t => (
                    <TradeTargetCard
                      key={t.id}
                      t={t}
                      ctx={ctx}
                      puntedCats={puntedCats}
                      onLoad={loadIntoAnalyzer}
                    />
                  ))}
                </div>
              )}

              <div className="method-note">
                <strong>How this works:</strong> each team's weekly distribution per category is built from its active players' projected
                per-game means and variances × {PROJ_GAMES} games. For every opponent and non-punted category we compute the probability you
                win that category; summed and averaged across the league that gives <em>expected category wins per week</em>.
                Partners are scored on standard 9-cat (unless you model their punts in the Analyzer), and 2-for-1 open spots use {ctx.replacement.name} ({ctx.replacement.streamingGames.toFixed(1)} gm/wk).
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
