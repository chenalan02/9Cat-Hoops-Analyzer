import { useState, useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import { CATEGORIES, getPlayerMu, zScoreClass, zScoreBgClass } from '../utils/zScore.js';
import { formatZ, formatMu } from '../utils/formatters.js';
import CategoryToggle from '../components/CategoryToggle.jsx';
import './DraftPage.css';

/**
 * Draft Rankings page.
 * Uses all players from the user's league (fetched via backend).
 * Computes per-player z-scores and average-z ranking.
 * Supports category punt toggles.
 */
function buildDraftPool(leagueTeams) {
  // Deduplicate by player name
  const seen = new Set();
  const players = [];
  for (const team of leagueTeams) {
    for (const player of team.players) {
      if (!seen.has(player.name)) {
        seen.add(player.name);
        players.push({ ...player, fantasyTeam: team.name });
      }
    }
  }
  return players;
}

function computeDraftZScores(players) {
  // League-wide z-scores (same methodology as main)
  const stats = {};
  for (const cat of CATEGORIES) {
    const vals = players.map(p => getPlayerMu(p, cat)).filter(v => v !== null && !isNaN(v));
    const m    = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    const variance = vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1 || 1);
    stats[cat.key] = { mean: m, std: Math.sqrt(variance) || 1 };
  }

  return players.map(player => {
    const zScores = {};
    for (const cat of CATEGORIES) {
      const mu = getPlayerMu(player, cat);
      if (mu === null) { zScores[cat.key] = null; continue; }
      let z = (mu - stats[cat.key].mean) / stats[cat.key].std;
      if (cat.lowerBetter) z = -z;
      zScores[cat.key] = z;
    }
    return { ...player, zScores };
  });
}

export default function DraftPage() {
  const { leagueData, loading } = useContext(TeamDataContext);
  const navigate = useNavigate();
  const [puntedCats, setPuntedCats]   = useState(new Set());
  const [sortKey, setSortKey]         = useState('avgZ');
  const [sortDir, setSortDir]         = useState('desc');
  const [posFilter, setPosFilter]     = useState('ALL');

  const handleToggle = (key) => {
    setPuntedCats(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const activeCats = useMemo(
    () => CATEGORIES.filter(c => !puntedCats.has(c.key)),
    [puntedCats]
  );

  const allPlayers = useMemo(
    () => leagueData?.teams ? computeDraftZScores(buildDraftPool(leagueData.teams)) : [],
    [leagueData]
  );

  const rankedPlayers = useMemo(() => {
    return allPlayers.map(p => {
      const activeZs = activeCats.map(c => p.zScores[c.key]).filter(z => z !== null);
      const avgZ = activeZs.length ? activeZs.reduce((a, b) => a + b, 0) / activeZs.length : -999;
      return { ...p, avgZ };
    });
  }, [allPlayers, activeCats]);

  const POSITIONS = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'];

  const filtered = useMemo(() => {
    return rankedPlayers.filter(p =>
      posFilter === 'ALL' || (p.positions ?? '').includes(posFilter)
    );
  }, [rankedPlayers, posFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av, bv;
      if (sortKey === 'name') { av = a.name; bv = b.name; }
      else if (sortKey === 'avgZ') { av = a.avgZ; bv = b.avgZ; }
      else {
        const cat = CATEGORIES.find(c => c.key === sortKey);
        av = cat ? (a.zScores[cat.key] ?? -999) : 0;
        bv = cat ? (b.zScores[cat.key] ?? -999) : 0;
      }
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [filtered, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="sort-icon">⇅</span>;
    return <span className="sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  if (loading) return (
    <div className="page-wrapper center-content">
      <div className="spinner" style={{ width: 36, height: 36 }} />
    </div>
  );

  if (!leagueData) return (
    <div className="page-wrapper center-content">
      <div className="empty-state">
        <h2 style={{ marginBottom: '0.5rem' }}>No League Data</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Analyze your team first to view draft rankings.
        </p>
        <button className="btn-primary" onClick={() => navigate('/')}>Analyze My Team</button>
      </div>
    </div>
  );

  return (
    <div className="draft-page page-wrapper fade-up">
      <div className="section">
        <h1 className="section-title" style={{ textAlign: 'left' }}>Draft Rankings</h1>
        <p className="section-subtitle" style={{ textAlign: 'left' }}>
          Players ranked by average z-score across active categories
        </p>

        <CategoryToggle puntedCats={puntedCats} onToggle={handleToggle} label="Punt Strategy" />

        {/* Position Filter */}
        <div className="pos-filter-bar">
          {POSITIONS.map(pos => (
            <button
              key={pos}
              className={`btn-ghost ${posFilter === pos ? 'active' : ''}`}
              onClick={() => setPosFilter(pos)}
            >
              {pos}
            </button>
          ))}
        </div>

        <div className="data-table-wrapper">
          <table className="data-table draft-table" aria-label="Draft player rankings">
            <thead>
              <tr>
                <th style={{ textAlign: 'center', width: 50 }}>#</th>
                <th
                  className={sortKey === 'name' ? 'sort-active' : ''}
                  onClick={() => handleSort('name')}
                  style={{ textAlign: 'left' }}
                >
                  Player <SortIcon col="name" />
                </th>
                <th>Pos</th>
                <th>Team</th>
                {CATEGORIES.map(cat => (
                  <th
                    key={cat.key}
                    className={`${sortKey === cat.key ? 'sort-active' : ''} ${puntedCats.has(cat.key) ? 'punted-col' : ''}`}
                    onClick={() => handleSort(cat.key)}
                    title={cat.label}
                  >
                    {cat.key} <SortIcon col={cat.key} />
                  </th>
                ))}
                <th
                  className={sortKey === 'avgZ' ? 'sort-active' : ''}
                  onClick={() => handleSort('avgZ')}
                >
                  Avg Z <SortIcon col="avgZ" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((player, idx) => (
                <tr key={player.name}>
                  <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text-muted)' }}>{idx + 1}</td>
                  <td>
                    <div className="player-cell">
                      <span className="player-name">{player.name}</span>
                    </div>
                  </td>
                  <td><span className="pos-badge">{player.positions?.split(',')[0]}</span></td>
                  <td className="team-abbr">{player.nba_team}</td>
                  {CATEGORIES.map(cat => {
                    const z      = player.zScores[cat.key];
                    const punted = puntedCats.has(cat.key);
                    return (
                      <td
                        key={cat.key}
                        className={`${zScoreBgClass(z)} ${punted ? 'punted-col' : ''}`}
                        title={`μ = ${formatMu(getPlayerMu(player, cat), cat.key)}`}
                      >
                        <span className={zScoreClass(z)}>{formatZ(z)}</span>
                      </td>
                    );
                  })}
                  <td style={{ fontWeight: 800 }}>
                    <span className={player.avgZ >= 0 ? 'z-good' : 'z-poor'}>
                      {player.avgZ !== -999 ? formatZ(player.avgZ) : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
