import { useState, useMemo } from 'react';
import { CATEGORIES, getPlayerMu, zScoreClass, zScoreBgClass } from '../utils/zScore.js';
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

  // 1. Dynamic league-wide ranking & baseline calculation
  const { rankedPlayers, baselineRankMap } = useMemo(() => {
    if (!players || players.length === 0) {
      return { rankedPlayers: [], baselineRankMap: {} };
    }

    // Collect all unique rostered players across the entire league
    const leaguePlayers = (() => {
      if (!allTeams || allTeams.length === 0) return players;
      const map = new Map();
      for (const team of allTeams) {
        if (team.players) {
          for (const p of team.players) {
            if (p?.name && !map.has(p.name)) {
              map.set(p.name, p);
            }
          }
        }
      }
      return map.size > 0 ? Array.from(map.values()) : players;
    })();

    // Helper: calculate Z-score sum across specified categories
    const getZForCats = (p, cats) => {
      if (cats.length === CATEGORIES.length) {
        const rawZ = p.z_total ?? p.ema_stats?.z_total;
        if (rawZ != null && !isNaN(rawZ)) return Number(rawZ);
      }
      return cats.reduce((sum, cat) => sum + (p.zScores?.[cat.key] ?? 0), 0);
    };

    // 2. Baseline League Ranking (all 9 categories active)
    const baselineSorted = [...leaguePlayers].sort((a, b) => {
      const bZ = getZForCats(b, CATEGORIES);
      const aZ = getZForCats(a, CATEGORIES);
      if (Math.abs(bZ - aZ) > 0.00001) return bZ - aZ;
      return (a.name || '').localeCompare(b.name || '');
    });

    const bMap = {};
    baselineSorted.forEach((p, idx) => {
      bMap[p.name] = idx + 1;
    });

    // 3. Current League Ranking (with activeCats / punts applied)
    const currentSorted = [...leaguePlayers].sort((a, b) => {
      const bZ = getZForCats(b, activeCats);
      const aZ = getZForCats(a, activeCats);
      if (Math.abs(bZ - aZ) > 0.00001) return bZ - aZ;
      return (a.name || '').localeCompare(b.name || '');
    });

    const cMap = {};
    const cZSumMap = {};
    currentSorted.forEach((p, idx) => {
      cMap[p.name] = idx + 1;
      cZSumMap[p.name] = getZForCats(p, activeCats);
    });

    // 4. Augment YOUR team's players with their league rank & delta
    const teamRanked = players.map(p => {
      const leagueRank = cMap[p.name] ?? (p.rank || 999);
      const baseRank = bMap[p.name] ?? leagueRank;
      const zSum = cZSumMap[p.name] ?? getZForCats(p, activeCats);
      const delta = baseRank - leagueRank; // e.g. base #20, now #12 => delta +8 (improved!)
      return {
        ...p,
        rank: leagueRank,
        baseRank,
        zSum,
        rankDelta: delta,
      };
    });

    return { rankedPlayers: teamRanked, baselineRankMap: bMap };
  }, [players, allTeams, activeCats]);

  // Sort
  const sorted = useMemo(() => {
    return [...rankedPlayers].sort((a, b) => {
      let av, bv;
      if (sortKey === 'rank') { av = a.rank; bv = b.rank; }
      else if (sortKey === 'name') { av = a.name; bv = b.name; }
      else if (sortKey === 'gp') { av = a.ema_stats?.games_played ?? 0; bv = b.ema_stats?.games_played ?? 0; }
      else if (sortKey === 'proj_gp') {
        const aVal = Number(a.ema_stats?.proj_games_preseason ?? a.preseason_stats?.proj_games_preseason ?? a.ros_stats?.proj_games_played ?? a.proj_games_preseason ?? a.proj_games_played ?? 0) || 0;
        const bVal = Number(b.ema_stats?.proj_games_preseason ?? b.preseason_stats?.proj_games_preseason ?? b.ros_stats?.proj_games_played ?? b.proj_games_preseason ?? b.proj_games_played ?? 0) || 0;
        av = aVal;
        bv = bVal;
      }
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
    else { setSortKey(key); setSortDir(key === 'name' || key === 'rank' ? 'asc' : 'desc'); }
  };

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="sort-icon">⇅</span>;
    return <span className="sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const Th = ({ col, label, title }) => (
    <th
      className={sortKey === col ? 'sort-active' : ''}
      onClick={() => handleSort(col)}
      title={title || `Sort by ${label}`}
    >
      {label} <SortIcon col={col} />
    </th>
  );

  return (
    <div className="data-table-wrapper">
      <table className="data-table team-table" aria-label="Team player statistics">
        <thead>
          <tr>
            <th
              className={sortKey === 'rank' ? 'sort-active' : ''}
              onClick={() => handleSort('rank')}
              style={{ textAlign: 'center', whiteSpace: 'nowrap' }}
              title="League Rank (dynamically calculated across all rostered players in the league)"
            >
              # League <SortIcon col="rank" />
            </th>
            <Th col="name" label="Player" />
            <th>Pos</th>
            <th>Team</th>
            <Th col="gp" label="GP" title="Games played in stats sample" />
            <Th col="proj_gp" label="Proj GP" title="Total projected games played for the season" />
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

            return (
              <tr key={player.name}>
                <td style={{ textAlign: 'center', fontWeight: 800, whiteSpace: 'nowrap' }}>
                  <span className="rank-num">#{player.rank}</span>
                  {puntedCats.size > 0 && baseRank && (
                    <span
                      className={`delta ${cls}`}
                      style={{ marginLeft: '5px' }}
                      title={`Baseline League Rank: #${baseRank} → Punted: #${player.rank} (${delta > 0 ? '+' : ''}${delta})`}
                    >
                      {symbol}
                    </span>
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
                <td>
                  {(() => {
                    const raw = player.ema_stats?.proj_games_preseason
                      ?? player.preseason_stats?.proj_games_preseason
                      ?? player.ros_stats?.proj_games_played
                      ?? player.ros_stats?.proj_games
                      ?? player.proj_games_preseason
                      ?? player.proj_games_played;
                    return raw != null && !isNaN(raw) ? Math.round(Number(raw)) : '—';
                  })()}
                </td>
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
