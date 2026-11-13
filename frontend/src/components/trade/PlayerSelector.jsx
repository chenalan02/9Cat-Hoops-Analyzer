import { useState, useMemo } from 'react';
import { zScoreClass } from '../../utils/zScore.js';
import { formatZ } from '../../utils/formatters.js';
import { isActiveSlot, playerHasPosition, getMarketRank } from '../../utils/tradeEngine.js';
import { POS_FILTERS } from './tradeFormatters.js';

export default function PlayerSelector({ label, badge, badgeClass, players, selected, onToggle, ctx, teamOptions = null }) {
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [posFilter, setPosFilter] = useState('all');
  const [sortBy, setSortBy] = useState('value');

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
