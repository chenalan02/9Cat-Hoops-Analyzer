import { useState, useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import { CATEGORIES, getPlayerMu, computeTeamWeeklyProjection, zScoreClass, zScoreBgClass } from '../utils/zScore.js';
import { formatMu, formatZ } from '../utils/formatters.js';
import './TradePage.css';

// ─── Helpers ──────────────────────────────────────────

const PROJ_GAMES = 3.5;

/**
 * Compute weekly-level category values for a roster.
 * Multiplies each player's per-game μ by 3.5 games/week so the
 * category bars show expected weekly totals (matchup-level numbers).
 */
function computeTeamCatValues(players) {
  const proj = computeTeamWeeklyProjection(players, PROJ_GAMES);
  const result = {};
  for (const cat of CATEGORIES) {
    result[cat.key] = proj[cat.key]?.mu ?? null;
  }
  return result;
}

// ─── Category Bar Component (Full Team View) ──────────

function CatBar({ label, before, after, catKey, lowerBetter }) {
  const delta  = after != null && before != null ? after - before : null;
  const isGood = delta == null ? null : lowerBetter ? delta < 0 : delta > 0;
  const maxVal = Math.max(Math.abs(before ?? 0), Math.abs(after ?? 0), 0.001);
  const bFill  = ((before ?? 0) / maxVal) * 100;
  const aFill  = ((after  ?? 0) / maxVal) * 100;

  return (
    <div className="cat-bar-row">
      <div className="cat-bar-label">
        <span className="cat-bar-key">{label}</span>
        <span className="cat-bar-vals">
          <span className="cat-val-before">{formatMu(before, catKey)}</span>
          <span className="cat-arrow">{delta != null ? (isGood ? ' ▲ ' : ' ▼ ') : ' → '}</span>
          <span className={`cat-val-after ${delta != null ? (isGood ? 'z-elite' : 'z-bad') : ''}`}>
            {formatMu(after, catKey)}
          </span>
          {delta != null && (
            <span className={`cat-delta-chip ${isGood ? 'good' : 'bad'}`}>
              {isGood ? '+' : ''}{formatMu(delta, catKey)}
            </span>
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
              className={`cat-bar-fill after ${delta != null ? (isGood ? 'positive' : 'negative') : ''}`}
              style={{ width: `${aFill}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Direct Asset Exchange Grid ───────────────────────

function AssetExchangeGrid({ stats }) {
  return (
    <div className="asset-grid">
      {CATEGORIES.map(cat => {
        const item = stats[cat.key];
        if (!item) return null;
        const { inVal, outVal, delta } = item;
        const isRate = cat.derived === 'fg' || cat.derived === 'ft';
        const isGood = delta == null ? null : cat.lowerBetter ? delta < 0 : delta > 0;

        return (
          <div key={cat.key} className="asset-card">
            <div className="asset-card-header">
              <span>{cat.key}</span>
              <span className="asset-card-title-sub">{cat.label}</span>
            </div>
            <div className="asset-card-body">
              <div className={`asset-card-delta ${delta != null ? (isGood ? 'z-elite' : 'z-bad') : ''}`}>
                {delta != null ? (
                  <>
                    {delta > 0 ? '+' : ''}
                    {isRate ? `${(delta * 100).toFixed(1)}%` : delta.toFixed(1)}
                    <span className="asset-unit">{isRate ? '' : ' /gm'}</span>
                  </>
                ) : '—'}
              </div>
              {!isRate && delta != null && (
                <div className="asset-card-sub">
                  {(delta * PROJ_GAMES > 0 ? '+' : '') + (delta * PROJ_GAMES).toFixed(1)} /week
                </div>
              )}
              <div className="asset-card-exchange-vals">
                <span>In: {isRate ? `${((inVal ?? 0) * 100).toFixed(1)}%` : formatMu(inVal, cat.key)}</span>
                <span className="asset-sep">·</span>
                <span>Out: {isRate ? `${((outVal ?? 0) * 100).toFixed(1)}%` : formatMu(outVal, cat.key)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Player Selector ──────────────────────────────────

function PlayerSelector({ label, badge, allPlayers, selected, onToggle, badge_class = 'badge-orange', faBaselineZ = null }) {
  const [search, setSearch] = useState('');
  const filtered = allPlayers.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="player-selector">
      <div className="selector-header">
        <span className={`badge ${badge_class}`}>{badge}</span>
        <span className="selector-label">{label} ({selected.size})</span>
      </div>
      <input
        className="selector-search"
        placeholder="Search player…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div className="selector-list">
        {filtered.slice(0, 30).map(p => {
          const isSelected = selected.has(p.name);
          const zVal = p.z_total ?? p.zSum;
          const vorp = zVal != null && faBaselineZ != null ? zVal - faBaselineZ : null;
          return (
            <button
              key={p.name}
              className={`selector-player ${isSelected ? 'selected' : ''}`}
              onClick={() => onToggle(p)}
            >
              <div className="sp-info">
                <span className="sp-name">{p.name}</span>
                <span className="sp-meta">{p.nba_team} · {p.selected_position ?? p.positions?.split(',')[0]}</span>
              </div>
              <div className="sp-right">
                {zVal != null && (
                  <span
                    className={`sp-z ${vorp != null ? (vorp >= 0 ? zScoreClass(Math.max(0.1, zVal)) : 'z-bad') : zScoreClass(zVal)}`}
                    title={vorp != null ? `Raw Z: ${formatZ(zVal)} | Value vs Free Agent (${formatZ(faBaselineZ)} Z): ${vorp >= 0 ? '+' : ''}${vorp.toFixed(2)} Z` : 'Total Z-Score'}
                  >
                    Z: {formatZ(zVal)}{vorp != null ? ` (${vorp >= 0 ? '+' : ''}${vorp.toFixed(1)} vs FA)` : ''}
                  </span>
                )}
                {isSelected && <span className="sp-check">✓</span>}
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="selector-empty">No players found</p>
        )}
      </div>
      {selected.size > 0 && (
        <div className="selector-chips">
          {[...selected].map(name => {
            const p = allPlayers.find(x => x.name === name);
            const zVal = p?.z_total ?? p?.zSum;
            return (
              <span key={name} className="selector-chip">
                {name} {zVal != null && `(Z: ${formatZ(zVal)})`}
                <button onClick={() => onToggle(p || { name })} className="chip-remove">×</button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────

export default function TradePage() {
  const { myTeam, leagueData, loading } = useContext(TeamDataContext);
  const navigate = useNavigate();

  // Trade mode: players going out, players coming in
  const [playersOut, setPlayersOut] = useState(new Set()); // names
  const [playersIn,  setPlayersIn]  = useState(new Set());
  const [mode, setMode]             = useState('trade'); // 'trade' | 'stream'
  const [impactView, setImpactView] = useState('exchange'); // 'exchange' | 'team'

  const toggleOut = (player) => {
    setPlayersOut(prev => {
      const next = new Set(prev);
      if (next.has(player.name)) next.delete(player.name); else next.add(player.name);
      return next;
    });
  };

  const toggleIn = (player) => {
    setPlayersIn(prev => {
      const next = new Set(prev);
      if (next.has(player.name)) next.delete(player.name); else next.add(player.name);
      return next;
    });
  };

  // All available players from league
  const allLeaguePlayers = useMemo(() => {
    if (!leagueData?.teams) return [];
    return leagueData.teams.flatMap(t => t.players);
  }, [leagueData]);

  // Free agents = not on my team (for stream mode)
  const freeAgents = useMemo(() => {
    if (!myTeam || !allLeaguePlayers.length) return [];
    const myNames = new Set(myTeam.players.map(p => p.name));
    return allLeaguePlayers.filter(p => !myNames.has(p.name));
  }, [myTeam, allLeaguePlayers]);

  // Current active roster (before)
  const currentRoster = useMemo(() => {
    if (!myTeam?.players) return [];
    return myTeam.players.filter(
      p => p.selected_position !== 'IL' && p.selected_position !== 'NA'
    );
  }, [myTeam]);

  // Direct lists of traded players
  const outList = useMemo(() => {
    return currentRoster.filter(p => playersOut.has(p.name));
  }, [currentRoster, playersOut]);

  const inList = useMemo(() => {
    return allLeaguePlayers.filter(p => playersIn.has(p.name));
  }, [allLeaguePlayers, playersIn]);

  // Free Agent / Waiver replacement baseline Z-score
  // Standardized league Z-scores have mean 0.00 (avg starter ~Rank #65),
  // so bottom-of-bench players (~Rank #110–150) have negative raw Z-scores (-1.5 to -3.5)
  // while still holding positive value above Free Agent replacement level.
  const faBaseline = useMemo(() => {
    const activePool = allLeaguePlayers.filter(
      p => p.selected_position !== 'IL' && p.selected_position !== 'NA'
    );
    const sorted = [...activePool].sort(
      (a, b) => (a.z_total ?? a.zSum ?? 0) - (b.z_total ?? b.zSum ?? 0)
    );
    const bottomCount = Math.max(5, Math.floor(sorted.length * 0.1));
    const bottomSlice = sorted.slice(0, bottomCount);

    const avgBottomZ = bottomSlice.length
      ? bottomSlice.reduce((s, p) => s + (p.z_total ?? p.zSum ?? 0), 0) / bottomSlice.length
      : -3.5;

    const minRosterZ = currentRoster.length
      ? Math.min(...currentRoster.map(p => p.z_total ?? p.zSum ?? 0))
      : -3.0;

    // Waiver replacement baseline sits below the bottom rostered fringe
    const z = Math.min(avgBottomZ - 0.35, minRosterZ - 0.5, -2.5);

    return {
      z,
      ema_stats: {
        mu_min: 22,
        games_played: 62,
        mu_pts: 9.5,
        mu_reb: 4.2,
        mu_ast: 2.0,
        mu_stl: 0.7,
        mu_blk: 0.4,
        mu_tov: 1.2,
        mu_fg3m: 1.1,
        mu_fgm: 3.5,
        mu_fga: 8.0,
        mu_ftm: 1.1,
        mu_fta: 1.5,
      },
    };
  }, [allLeaguePlayers, currentRoster]);

  // Uneven roster management
  const sizeDiff = inList.length - outList.length;

  // Remaining players on roster not being traded
  const remainingRoster = useMemo(() => {
    return currentRoster.filter(p => !playersOut.has(p.name));
  }, [currentRoster, playersOut]);

  // If receiving more than giving (sizeDiff > 0), determine drop candidates (lowest z_total / zSum)
  const dropCandidates = useMemo(() => {
    if (sizeDiff <= 0) return [];
    return [...remainingRoster]
      .sort((a, b) => (a.z_total ?? a.zSum ?? 0) - (b.z_total ?? b.zSum ?? 0))
      .slice(0, sizeDiff);
  }, [remainingRoster, sizeDiff]);

  const dropCandidateNames = useMemo(() => {
    return new Set(dropCandidates.map(p => p.name));
  }, [dropCandidates]);

  // If giving more than receiving (sizeDiff < 0), fill open roster spot(s) with Free Agent replacement level
  const streamerFillers = useMemo(() => {
    if (sizeDiff >= 0) return [];
    const needed = Math.abs(sizeDiff);
    return Array.from({ length: needed }, (_, i) => ({
      name: `Waiver / Streamer Slot ${needed > 1 ? i + 1 : ''}`.trim(),
      selected_position: 'Util',
      z_total: faBaseline.z,
      zSum: faBaseline.z,
      ema_stats: faBaseline.ema_stats,
    }));
  }, [sizeDiff, faBaseline]);

  // Raw selected Z-scores
  const rawOutZ = useMemo(() => {
    return outList.reduce((s, p) => s + (p.z_total ?? p.zSum ?? 0), 0);
  }, [outList]);

  const rawInZ = useMemo(() => {
    return inList.reduce((s, p) => s + (p.z_total ?? p.zSum ?? 0), 0);
  }, [inList]);

  // Value Over Free Agent Replacement (VORP = Z - Z_FA)
  const totalOutVorp = useMemo(() => {
    const selectedVorp = outList.reduce((s, p) => s + ((p.z_total ?? p.zSum ?? 0) - faBaseline.z), 0);
    const dropVorp = sizeDiff > 0
      ? dropCandidates.reduce((s, p) => s + ((p.z_total ?? p.zSum ?? faBaseline.z) - faBaseline.z), 0)
      : 0;
    return selectedVorp + dropVorp;
  }, [outList, dropCandidates, sizeDiff, faBaseline.z]);

  const totalInVorp = useMemo(() => {
    return inList.reduce((s, p) => s + ((p.z_total ?? p.zSum ?? 0) - faBaseline.z), 0);
  }, [inList, faBaseline.z]);

  // Balanced slot Z-scores (comparing equal roster slots against FA baseline / forced drops)
  const totalOutZ = useMemo(() => {
    const dropZ = sizeDiff > 0
      ? dropCandidates.reduce((s, p) => s + (p.z_total ?? p.zSum ?? faBaseline.z), 0)
      : 0;
    return rawOutZ + dropZ;
  }, [rawOutZ, sizeDiff, dropCandidates, faBaseline.z]);

  const totalInZ = useMemo(() => {
    const waiverZ = sizeDiff < 0 ? Math.abs(sizeDiff) * faBaseline.z : 0;
    return rawInZ + waiverZ;
  }, [rawInZ, sizeDiff, faBaseline.z]);

  // Net Asset Delta (Balanced exchange value vs Free Agent replacement)
  const directZDelta = totalInZ - totalOutZ;

  // Balanced hypothetical roster (exactly matching currentRoster.length)
  const balancedHypotheticalRoster = useMemo(() => {
    let roster = currentRoster.filter(
      p => !playersOut.has(p.name) && !dropCandidateNames.has(p.name)
    );
    roster = [...roster, ...inList, ...streamerFillers];
    return roster;
  }, [currentRoster, playersOut, dropCandidateNames, inList, streamerFillers]);

  // Full team weekly category totals (equal roster sizes)
  const beforeCats = useMemo(() => computeTeamCatValues(currentRoster), [currentRoster]);
  const afterCats  = useMemo(() => computeTeamCatValues(balancedHypotheticalRoster), [balancedHypotheticalRoster]);

  // Direct category stat differential between traded assets
  const directAssetStats = useMemo(() => {
    const res = {};
    for (const cat of CATEGORIES) {
      if (cat.derived === 'fg') {
        const inFGM = inList.reduce((s, p) => s + (p.ema_stats?.mu_fgm ?? 0), 0);
        const inFGA = inList.reduce((s, p) => s + (p.ema_stats?.mu_fga ?? 0), 0);
        const outFGM = outList.reduce((s, p) => s + (p.ema_stats?.mu_fgm ?? 0), 0);
        const outFGA = outList.reduce((s, p) => s + (p.ema_stats?.mu_fga ?? 0), 0);
        const inPct = inFGA > 0 ? inFGM / inFGA : null;
        const outPct = outFGA > 0 ? outFGM / outFGA : null;
        res[cat.key] = { inVal: inPct, outVal: outPct, delta: inPct !== null && outPct !== null ? inPct - outPct : null };
      } else if (cat.derived === 'ft') {
        const inFTM = inList.reduce((s, p) => s + (p.ema_stats?.mu_ftm ?? 0), 0);
        const inFTA = inList.reduce((s, p) => s + (p.ema_stats?.mu_fta ?? 0), 0);
        const outFTM = outList.reduce((s, p) => s + (p.ema_stats?.mu_ftm ?? 0), 0);
        const outFTA = outList.reduce((s, p) => s + (p.ema_stats?.mu_fta ?? 0), 0);
        const inPct = inFTA > 0 ? inFTM / inFTA : null;
        const outPct = outFTA > 0 ? outFTM / outFTA : null;
        res[cat.key] = { inVal: inPct, outVal: outPct, delta: inPct !== null && outPct !== null ? inPct - outPct : null };
      } else {
        const inVal = inList.reduce((s, p) => s + (getPlayerMu(p, cat) ?? 0), 0);
        const outVal = outList.reduce((s, p) => s + (getPlayerMu(p, cat) ?? 0), 0);
        const delta = cat.lowerBetter ? outVal - inVal : inVal - outVal; // positive = better
        res[cat.key] = { inVal, outVal, delta: cat.lowerBetter ? inVal - outVal : delta };
      }
    }
    return res;
  }, [inList, outList]);

  const hasChanges = playersOut.size > 0 || playersIn.size > 0;

  if (loading) return (
    <div className="page-wrapper center-content">
      <div className="spinner" style={{ width: 36, height: 36 }} />
    </div>
  );

  if (!myTeam) return (
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

  return (
    <div className="trade-page page-wrapper fade-up">
      <div className="section">
        <div className="page-header">
          <div>
            <h1 className="section-title" style={{ textAlign: 'left' }}>Trade &amp; Stream Analyzer</h1>
            <p className="section-subtitle" style={{ textAlign: 'left' }}>
              Evaluate trades and pickups using standardized Z-scores and balanced roster projections
            </p>
          </div>
        </div>

        {/* Mode toggle */}
        <div className="mode-toggle">
          <button
            className={`btn-ghost ${mode === 'trade' ? 'active' : ''}`}
            onClick={() => setMode('trade')}
          >Trade Analyzer</button>
          <button
            className={`btn-ghost ${mode === 'stream' ? 'active' : ''}`}
            onClick={() => setMode('stream')}
          >Stream / Add-Drop</button>
        </div>

        {mode === 'stream' && (
          <div className="trade-balance-alert info" style={{ marginBottom: '1.25rem' }}>
            <span className="tba-icon">🎯</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <strong>Automated Matchup Streamer Assistant:</strong>
                <span> Looking for optimal free agents based on your active matchup's swing categories and schedule fit?</span>
              </div>
              <button
                type="button"
                className="btn-primary"
                style={{ padding: '6px 14px', fontSize: '0.8rem' }}
                onClick={() => {
                  try { sessionStorage.setItem('9cat_matchup_active_tab', 'streamers'); } catch {}
                  navigate('/matchup');
                }}
              >
                Go to Matchup Streamer Suggestions →
              </button>
            </div>
          </div>
        )}

        <div className="trade-layout">
          {/* Left: player selectors */}
          <div className="trade-selectors">
            <PlayerSelector
              label={mode === 'trade' ? 'Players you give up' : 'Players to drop / rest'}
              badge="Losing"
              badge_class="badge-red"
              allPlayers={currentRoster}
              selected={playersOut}
              onToggle={toggleOut}
              faBaselineZ={faBaseline.z}
            />
            <PlayerSelector
              label={mode === 'trade' ? 'Players you receive' : 'Free agents to pick up'}
              badge="Gaining"
              badge_class="badge-green"
              allPlayers={mode === 'trade' ? allLeaguePlayers.filter(p => !new Set(myTeam.players.map(x => x.name)).has(p.name)) : freeAgents}
              selected={playersIn}
              onToggle={toggleIn}
              faBaselineZ={faBaseline.z}
            />
          </div>

          {/* Right: impact panel */}
          <div className="trade-impact">
            {/* Uneven roster notices */}
            {hasChanges && sizeDiff > 0 && (
              <div className="trade-balance-alert warning">
                <span className="tba-icon">⚠️</span>
                <div>
                  <strong>Uneven Roster ({inList.length} in, {outList.length} out):</strong>
                  <span> Receiving {inList.length} players for {outList.length} requires dropping {sizeDiff} player{sizeDiff > 1 ? 's' : ''} to meet the {currentRoster.length}-player roster limit.</span>
                  <div className="tba-sub">
                    Projected drop candidate: <strong>{dropCandidates.map(p => `${p.name} (Z: ${formatZ(p.z_total ?? p.zSum)})`).join(', ')}</strong>
                  </div>
                </div>
              </div>
            )}

            {hasChanges && sizeDiff < 0 && (
              <div className="trade-balance-alert info">
                <span className="tba-icon">💡</span>
                <div>
                  <strong>{inList.length === 0 ? `Unpaired Drop (${outList.length} out, 0 in):` : `Consolidation Trade (${outList.length} out, ${inList.length} in):`}</strong>
                  <span> Giving {outList.length} player{outList.length > 1 ? 's' : ''} for {inList.length} leaves {Math.abs(sizeDiff)} open roster spot{Math.abs(sizeDiff) > 1 ? 's' : ''} filled at the Free Agent replacement baseline.</span>
                  <div className="tba-sub">
                    Compared against Free Agent replacement baseline ({Math.abs(sizeDiff)} spot{Math.abs(sizeDiff) > 1 ? 's' : ''}, Z: {formatZ(faBaseline.z)} each) so rostered players above waiver level retain positive value.
                  </div>
                </div>
              </div>
            )}

            {/* Direct Z-Score Impact */}
            <div className={`impact-summary card ${hasChanges ? (directZDelta >= 0 ? 'impact-positive' : 'impact-negative') : ''}`}>
              <div className="impact-label">Net Exchange Value (vs. Free Agent Baseline)</div>
              {hasChanges ? (
                <>
                  <div className={`impact-delta ${directZDelta >= 0 ? 'z-elite' : 'z-bad'}`}>
                    {directZDelta >= 0 ? '+' : ''}{directZDelta.toFixed(2)} Z
                  </div>
                  <div className="impact-sub">
                    <span>
                      Gaining: <strong>+{totalInVorp.toFixed(2)} vs FA</strong> (Raw: {rawInZ.toFixed(2)} Z{sizeDiff < 0 ? ` + ${Math.abs(sizeDiff)} FA @ ${formatZ(faBaseline.z)}` : ''})
                    </span>
                    <span className="impact-sub-sep">·</span>
                    <span>
                      Giving: <strong>+{totalOutVorp.toFixed(2)} vs FA</strong> (Raw: {rawOutZ.toFixed(2)} Z{sizeDiff > 0 ? ` + ${sizeDiff} Drop` : ''})
                    </span>
                  </div>
                  <div className={`impact-verdict ${directZDelta >= 0 ? 'good' : 'bad'}`}>
                    {inList.length === 0 && outList.length > 0
                      ? `✗ Losing +${totalOutVorp.toFixed(2)} Z above Free Agent level — Select an incoming player or FA to compare`
                      : directZDelta >= 2.5 ? '🌟 Strongly Recommended (Major Win)' :
                        directZDelta >= 0.5 ? '✓ Favorable Exchange (Solid Upgrade)' :
                        directZDelta >= -0.5? '⚖️ Fair / Even Exchange (Balanced Value)' :
                        directZDelta >= -2.5? '✗ Unfavorable Exchange (Losing Value)' :
                                              '⛔ Avoid This Move (Heavy Value Loss)'}
                  </div>
                </>
              ) : (
                <div className="impact-placeholder">Select players to analyze trade impact</div>
              )}
            </div>

            {/* Category breakdown */}
            <div className="impact-cats card">
              <div className="impact-cats-header">
                <span>Category Impact</span>
                <div className="impact-view-tabs">
                  <button
                    className={`impact-tab-btn ${impactView === 'exchange' ? 'active' : ''}`}
                    onClick={() => setImpactView('exchange')}
                  >
                    Direct Asset Exchange
                  </button>
                  <button
                    className={`impact-tab-btn ${impactView === 'team' ? 'active' : ''}`}
                    onClick={() => setImpactView('team')}
                  >
                    Full Team Weekly Totals
                  </button>
                </div>
              </div>

              {impactView === 'exchange' ? (
                hasChanges ? (
                  <AssetExchangeGrid stats={directAssetStats} />
                ) : (
                  <div className="impact-placeholder">Select players to see category differentials</div>
                )
              ) : (
                <div className="cat-bar-list">
                  <div className="cat-legend-bar">
                    <span className="legend-dot before" /> Current Roster &nbsp;
                    <span className="legend-dot after" /> Projected Roster
                  </div>
                  {CATEGORIES.map(cat => (
                    <CatBar
                      key={cat.key}
                      label={cat.key}
                      catKey={cat.key}
                      lowerBetter={cat.lowerBetter}
                      before={beforeCats[cat.key]}
                      after={hasChanges ? afterCats[cat.key] : beforeCats[cat.key]}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Player z-score cards */}
            {hasChanges && (
              <div className="player-delta-panel card">
                <div className="impact-cats-header">Player Z-Score Breakdown (FA Baseline: {formatZ(faBaseline.z)} Z)</div>
                <div className="player-delta-grid">
                  {outList.map(p => {
                    const rawZ = p.z_total ?? p.zSum ?? 0;
                    const vorp = rawZ - faBaseline.z;
                    return (
                      <div key={p.name} className="player-delta-card losing">
                        <div className="pd-top">
                          <span className="pd-badge badge badge-red">Giving Up</span>
                          <span className="pd-zsum z-bad" title={`Raw Z: ${formatZ(rawZ)} | Value vs Free Agent: ${vorp >= 0 ? '+' : ''}${vorp.toFixed(2)} Z`}>
                            {vorp >= 0 ? '+' : ''}{vorp.toFixed(2)} vs FA (Z: {formatZ(rawZ)})
                          </span>
                        </div>
                        <span className="pd-name">{p.name}</span>
                        <span className="pd-team-pos">{p.nba_team} · {p.selected_position ?? p.positions}</span>
                        <div className="pd-cats">
                          {CATEGORIES.map(cat => {
                            const z = p.zScores?.[cat.key] ?? null;
                            return (
                              <span key={cat.key} className={`pd-cat-z ${zScoreClass(z)}`} title={cat.label}>
                                {cat.key}: {z !== null ? formatZ(z) : '—'}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {inList.map(p => {
                    const rawZ = p.z_total ?? p.zSum ?? 0;
                    const vorp = rawZ - faBaseline.z;
                    return (
                      <div key={p.name} className="player-delta-card gaining">
                        <div className="pd-top">
                          <span className="pd-badge badge badge-green">Receiving</span>
                          <span className="pd-zsum z-elite" title={`Raw Z: ${formatZ(rawZ)} | Value vs Free Agent: ${vorp >= 0 ? '+' : ''}${vorp.toFixed(2)} Z`}>
                            {vorp >= 0 ? '+' : ''}{vorp.toFixed(2)} vs FA (Z: {formatZ(rawZ)})
                          </span>
                        </div>
                        <span className="pd-name">{p.name}</span>
                        <span className="pd-team-pos">{p.nba_team} · {p.selected_position ?? p.positions}</span>
                        <div className="pd-cats">
                          {CATEGORIES.map(cat => {
                            const z = p.zScores?.[cat.key] ?? null;
                            return (
                              <span key={cat.key} className={`pd-cat-z ${zScoreClass(z)}`} title={cat.label}>
                                {cat.key}: {z !== null ? formatZ(z) : '—'}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
