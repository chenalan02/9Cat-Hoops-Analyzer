import { useState, useMemo } from 'react';
import { CATEGORIES, computeLeagueZScores, rankPlayers, getPlayerMu, zScoreClass, zScoreBgClass } from '../utils/zScore.js';
import { formatMu, formatZ, formatDelta } from '../utils/formatters.js';
import './TeamTable.css';

/**
 * Sortable, color-coded player table with z-scores, rank, and rank delta.
 *
 * Props:
 *   players:     Player[]  — already enriched with .zScores, .zSum
 *   puntedCats:  Set<string>
 *   allTeams:    Team[]    — full league for z-score recompute on punt
 *   baselinePlayers: Player[] — players ranked without punt (for delta)
 */
export default function TeamTable({ players, puntedCats, allTeams, baselinePlayers }) {
  const [sortKey, setSortKey] = useState('rank');
  const [sortDir, setSortDir] = useState('asc');

  const activeCats = useMemo(
    () => CATEGORIES.filter(c => !puntedCats.has(c.key)),
    [puntedCats]
  );

  // Re-rank players given active categories
  const rankedPlayers = useMemo(() => {
    if (!players) return [];
    // Recompute zSum for active cats
    const withNewZSum = players.map(p => ({
      ...p,
      zSum: activeCats.reduce((sum, cat) => sum + (p.zScores?.[cat.key] ?? 0), 0),
    }));
    return rankPlayers(withNewZSum);
  }, [players, activeCats]);

  // Build baseline rank map for delta
  const baselineRankMap = useMemo(() => {
    const map = {};
    if (!baselinePlayers) return map;
    baselinePlayers.forEach(p => { map[p.name] = p.rank; });
    return map;
  }, [baselinePlayers]);

  // Sort
  const sorted = useMemo(() => {
    return [...rankedPlayers].sort((a, b) => {
      let av, bv;
      if (sortKey === 'rank') { av = a.rank; bv = b.rank; }
      else if (sortKey === 'name') { av = a.name; bv = b.name; }
      else if (sortKey === 'gp') { av = a.ema_stats?.games_played ?? 0; bv = b.ema_stats?.games_played ?? 0; }
      else if (sortKey === 'proj_gp') { av = a.ema_stats?.mu_min > 0 ? (a.ema_stats?.games_played ?? 0) / 82 * 7 : 0; bv = b.ema_stats?.mu_min > 0 ? (b.ema_stats?.games_played ?? 0) / 82 * 7 : 0; }
      else if (sortKey === 'zscore') { av = a.zSum; bv = b.zSum; }
      else {
        // category mu
        const cat = CATEGORIES.find(c => c.key === sortKey);
        av = cat ? (getPlayerMu(a, cat) ?? -999) : 0;
        bv = cat ? (getPlayerMu(b, cat) ?? -999) : 0;
      }
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [rankedPlayers, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  };

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="sort-icon">⇅</span>;
    return <span className="sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const Th = ({ col, label }) => (
    <th
      className={sortKey === col ? 'sort-active' : ''}
      onClick={() => handleSort(col)}
      title={`Sort by ${label}`}
    >
      {label} <SortIcon col={col} />
    </th>
  );

  return (
    <div className="data-table-wrapper">
      <table className="data-table team-table" aria-label="Team player statistics">
        <thead>
          <tr>
            <th className={sortKey === 'rank' ? 'sort-active' : ''} onClick={() => handleSort('rank')} style={{ textAlign: 'center' }}>
              # <SortIcon col="rank" />
            </th>
            <Th col="name" label="Player" />
            <th>Pos</th>
            <th>Team</th>
            <Th col="gp" label="GP" />
            <Th col="proj_gp" label="Proj GP" />
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
            <Th col="zscore" label="ΣZ" />
          </tr>
        </thead>
        <tbody>
          {sorted.map(player => {
            const baseRank = baselineRankMap[player.name];
            const delta = baseRank ? baseRank - player.rank : 0;
            const { symbol, cls } = formatDelta(delta);

            const projGp = player.ema_stats?.mu_min > 0
              ? ((player.ema_stats?.games_played ?? 0) / 82 * 7).toFixed(1)
              : '—';

            return (
              <tr key={player.name}>
                <td style={{ textAlign: 'center', fontWeight: 800 }}>
                  <span className="rank-num">{player.rank}</span>
                  {puntedCats.size > 0 && baseRank && (
                    <span className={`delta ${cls}`}> {symbol}</span>
                  )}
                </td>
                <td>
                  <div className="player-cell">
                    <span className="player-name">{player.name}</span>
                  </div>
                </td>
                <td>
                  <span className="pos-badge">{player.selected_position}</span>
                </td>
                <td className="team-abbr">{player.nba_team}</td>
                <td>{player.ema_stats?.games_played ?? '—'}</td>
                <td>{projGp}</td>
                {CATEGORIES.map(cat => {
                  const mu = getPlayerMu(player, cat);
                  const z = player.zScores?.[cat.key] ?? null;
                  const punted = puntedCats.has(cat.key);
                  return (
                    <td
                      key={cat.key}
                      className={`${zScoreBgClass(z)} ${punted ? 'punted-col' : ''}`}
                      title={`z = ${formatZ(z)}`}
                    >
                      <span className={zScoreClass(z)}>
                        {formatMu(mu, cat.key)}
                      </span>
                    </td>
                  );
                })}
                <td style={{ fontWeight: 700 }}>
                  <span className={player.zSum >= 0 ? 'z-good' : 'z-poor'}>
                    {player.zSum?.toFixed(2) ?? '—'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
