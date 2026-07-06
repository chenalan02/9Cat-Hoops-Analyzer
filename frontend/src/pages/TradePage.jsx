import { useState, useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import { CATEGORIES, getPlayerMu, computeTeamWeeklyProjection, computeLeagueZScores, zScoreClass, zScoreBgClass } from '../utils/zScore.js';
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

function computeCatDelta(before, after) {
  const result = {};
  for (const cat of CATEGORIES) {
    const b = before[cat.key] ?? null;
    const a = after[cat.key]  ?? null;
    if (b === null || a === null) { result[cat.key] = null; continue; }
    result[cat.key] = cat.lowerBetter ? b - a : a - b; // positive = improvement
  }
  return result;
}

// ─── Category Bar Component ───────────────────────────

function CatBar({ label, before, after, catKey, lowerBetter }) {
  const delta  = after  != null && before != null ? after - before : null;
  const isGood = delta == null ? null : lowerBetter ? delta < 0 : delta > 0;
  const maxVal = Math.max(Math.abs(before ?? 0), Math.abs(after ?? 0), 0.001);
  const bFill  = ((before ?? 0) / maxVal) * 100;
  const aFill  = ((after  ?? 0) / maxVal) * 100;

  const catMeta = CATEGORIES.find(c => c.key === catKey);

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

// ─── Player Selector ──────────────────────────────────

function PlayerSelector({ label, badge, allPlayers, selected, onToggle, badge_class = 'badge-orange' }) {
  const [search, setSearch] = useState('');
  const filtered = allPlayers.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="player-selector">
      <div className="selector-header">
        <span className={`badge ${badge_class}`}>{badge}</span>
        <span className="selector-label">{label}</span>
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
          return (
            <button
              key={p.name}
              className={`selector-player ${isSelected ? 'selected' : ''}`}
              onClick={() => onToggle(p)}
            >
              <span className="sp-name">{p.name}</span>
              <span className="sp-meta">{p.nba_team} · {p.selected_position ?? p.positions?.split(',')[0]}</span>
              {isSelected && <span className="sp-check">✓</span>}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="selector-empty">No players found</p>
        )}
      </div>
      {selected.size > 0 && (
        <div className="selector-chips">
          {[...selected].map(name => (
            <span key={name} className="selector-chip">
              {name}
              <button onClick={() => onToggle(allPlayers.find(p => p.name === name))} className="chip-remove">×</button>
            </span>
          ))}
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

  // Current roster (before)
  const currentRoster = useMemo(() => {
    if (!myTeam?.players) return [];
    return myTeam.players.filter(
      p => p.selected_position !== 'IL' && p.selected_position !== 'NA'
    );
  }, [myTeam]);

  // Hypothetical roster (after trade/stream)
  const hypotheticalRoster = useMemo(() => {
    let roster = [...currentRoster.filter(p => !playersOut.has(p.name))];
    const inPlayers = allLeaguePlayers.filter(p => playersIn.has(p.name));
    roster = [...roster, ...inPlayers];
    return roster;
  }, [currentRoster, playersOut, playersIn, allLeaguePlayers]);

  // Category values before/after
  const beforeCats = useMemo(() => computeTeamCatValues(currentRoster), [currentRoster]);
  const afterCats  = useMemo(() => computeTeamCatValues(hypotheticalRoster), [hypotheticalRoster]);

  // Z-score summary: compute aggregate z-sums for before/after
  const beforeZSum = useMemo(() =>
    currentRoster.reduce((s, p) => s + (p.zSum ?? 0), 0),
  [currentRoster]);

  const afterZSum = useMemo(() => {
    const inPlayers = allLeaguePlayers.filter(p => playersIn.has(p.name));
    const outSet = playersOut;
    const afterRoster = [
      ...currentRoster.filter(p => !outSet.has(p.name)),
      ...inPlayers,
    ];
    return afterRoster.reduce((s, p) => s + (p.zSum ?? 0), 0);
  }, [currentRoster, playersOut, playersIn, allLeaguePlayers]);

  const zDelta = afterZSum - beforeZSum;

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
              Simulate how trades or free agent pickups affect your team
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
            />
            <PlayerSelector
              label={mode === 'trade' ? 'Players you receive' : 'Free agents to pick up'}
              badge="Gaining"
              badge_class="badge-green"
              allPlayers={mode === 'trade' ? allLeaguePlayers.filter(p => !new Set(myTeam.players.map(x => x.name)).has(p.name)) : freeAgents}
              selected={playersIn}
              onToggle={toggleIn}
            />
          </div>

          {/* Right: impact panel */}
          <div className="trade-impact">
            {/* Overall z-score delta */}
            <div className={`impact-summary card ${hasChanges ? (zDelta >= 0 ? 'impact-positive' : 'impact-negative') : ''}`}>
              <div className="impact-label">Overall Z-Score Impact</div>
              {hasChanges ? (
                <>
                  <div className={`impact-delta ${zDelta >= 0 ? 'z-elite' : 'z-bad'}`}>
                    {zDelta >= 0 ? '+' : ''}{zDelta.toFixed(2)}
                  </div>
                  <div className="impact-sub">
                    {beforeZSum.toFixed(2)} → {afterZSum.toFixed(2)}
                  </div>
                  <div className={`impact-verdict ${zDelta >= 0 ? 'good' : 'bad'}`}>
                    {zDelta >= 0.5 ? '✓ Strongly Recommended' :
                     zDelta >= 0   ? '✓ Slightly Favorable' :
                     zDelta >= -0.5? '✗ Slightly Unfavorable' :
                                     '✗ Avoid This Trade'}
                  </div>
                </>
              ) : (
                <div className="impact-placeholder">
                  Select players to see impact
                </div>
              )}
            </div>

            {/* Category breakdown */}
            <div className="impact-cats card">
              <div className="impact-cats-header">
                <span>Category Breakdown</span>
                <span className="legend-row">
                  <span className="legend-dot before" /> Before &nbsp;
                  <span className="legend-dot after" /> After
                </span>
              </div>
              <div className="cat-bar-list">
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
            </div>

            {/* Player z-score cards */}
            {hasChanges && (
              <div className="player-delta-panel card">
                <div className="impact-cats-header">Player Z-Score Details</div>
                <div className="player-delta-grid">
                  {[...playersOut].map(name => {
                    const p = allLeaguePlayers.find(x => x.name === name);
                    if (!p) return null;
                    return (
                      <div key={name} className="player-delta-card losing">
                        <span className="pd-badge badge badge-red">Out</span>
                        <span className="pd-name">{p.name}</span>
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
                        <div className="pd-zsum z-bad">ΣZ: {(p.zSum ?? 0).toFixed(2)}</div>
                      </div>
                    );
                  })}
                  {[...playersIn].map(name => {
                    const p = allLeaguePlayers.find(x => x.name === name);
                    if (!p) return null;
                    return (
                      <div key={name} className="player-delta-card gaining">
                        <span className="pd-badge badge badge-green">In</span>
                        <span className="pd-name">{p.name}</span>
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
                        <div className="pd-zsum z-elite">ΣZ: {(p.zSum ?? 0).toFixed(2)}</div>
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
