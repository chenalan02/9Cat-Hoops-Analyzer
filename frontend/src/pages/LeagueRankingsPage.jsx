import { useState, useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import { CATEGORIES, getPlayerMu, computeTeamWeeklyProjection, zScoreClass, zScoreBgClass } from '../utils/zScore.js';
import { formatMu, ordinal } from '../utils/formatters.js';
import './LeagueRankingsPage.css';

export default function LeagueRankingsPage() {
  const { leagueData, myTeam, loading } = useContext(TeamDataContext);
  const navigate = useNavigate();
  const [sortKey, setSortKey]   = useState('overall');
  const [sortDir, setSortDir]   = useState('asc');

  // Compute team-level category μ for all teams
  const teamStats = useMemo(() => {
    if (!leagueData?.teams) return [];
    return leagueData.teams.map(team => {
      const activePlayers = team.players.filter(
        p => p.selected_position !== 'IL' && p.selected_position !== 'NA'
      );
      const catMus = {};
      CATEGORIES.forEach(cat => {
        const vals = activePlayers.map(p => getPlayerMu(p, cat)).filter(v => v !== null && !isNaN(v));
        catMus[cat.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
      const zSum = activePlayers.reduce((s, p) => s + (p.zSum ?? 0), 0);
      return { team, catMus, zSum };
    });
  }, [leagueData]);

  // Rank each team per category
  const withRanks = useMemo(() => {
    return teamStats.map(ts => {
      const catRanks = {};
      CATEGORIES.forEach(cat => {
        const vals = teamStats.map(t => t.catMus[cat.key] ?? (cat.lowerBetter ? Infinity : -Infinity));
        const sorted = [...vals].sort((a, b) => cat.lowerBetter ? a - b : b - a);
        catRanks[cat.key] = sorted.indexOf(ts.catMus[cat.key]) + 1;
      });
      const overallRank = [...teamStats]
        .sort((a, b) => b.zSum - a.zSum)
        .findIndex(t => t.team.team_id === ts.team.team_id) + 1;
      return { ...ts, catRanks, overallRank };
    });
  }, [teamStats]);

  // Sort
  const sorted = useMemo(() => {
    return [...withRanks].sort((a, b) => {
      const av = sortKey === 'overall' ? a.overallRank : (a.catRanks[sortKey] ?? 999);
      const bv = sortKey === 'overall' ? b.overallRank : (b.catRanks[sortKey] ?? 999);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [withRanks, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="sort-icon">⇅</span>;
    return <span className="sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const totalTeams = sorted.length;

  // Rank-based z approximation for coloring (rank 1 = best)
  const rankZ = (rank, total) => {
    if (!rank || !total) return 0;
    return (total - rank) / (total - 1) * 3 - 1.5;
  };

  if (loading) {
    return (
      <div className="page-wrapper center-content">
        <div className="spinner" style={{ width: 36, height: 36 }} />
      </div>
    );
  }

  if (!leagueData) {
    return (
      <div className="page-wrapper center-content">
        <div className="empty-state">
          <div style={{ fontSize: '4rem' }}>🏆</div>
          <h2 style={{ marginBottom: '0.5rem' }}>No League Data</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Analyze your team first to unlock league rankings.
          </p>
          <button className="btn-primary" onClick={() => navigate('/')}>Analyze My Team</button>
        </div>
      </div>
    );
  }

  return (
    <div className="league-page page-wrapper fade-up">
      <div className="section">
        <div className="page-header">
          <div>
            <h1 className="section-title" style={{ textAlign: 'left' }}>🏆 League Rankings</h1>
            <p className="section-subtitle" style={{ textAlign: 'left' }}>
              {leagueData.name} — {leagueData.season} Season
            </p>
          </div>
        </div>

        <p className="table-hint">
          Rankings based on team-average category μ. Click column headers to sort.
          Color = your rank in that category.
        </p>

        <div className="data-table-wrapper">
          <table className="data-table league-table" aria-label="League team rankings">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}
                  className={sortKey === 'overall' ? 'sort-active' : ''}
                  onClick={() => handleSort('overall')}
                >
                  Team <SortIcon col="overall" />
                </th>
                <th className={sortKey === 'overall' ? 'sort-active' : ''}
                    onClick={() => handleSort('overall')} style={{ textAlign: 'center' }}>
                  Overall <SortIcon col="overall" />
                </th>
                {CATEGORIES.map(cat => (
                  <th
                    key={cat.key}
                    className={sortKey === cat.key ? 'sort-active' : ''}
                    onClick={() => handleSort(cat.key)}
                  >
                    {cat.key} <SortIcon col={cat.key} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ team, catMus, catRanks, overallRank }) => {
                const isMyTeam = team.team_id === myTeam?.team_id;
                return (
                  <tr key={team.team_id} className={isMyTeam ? 'my-team-row' : ''}>
                    <td>
                      <div className="league-team-cell">
                        <span className="league-team-name">{team.name}</span>
                        {isMyTeam && <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>You</span>}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 800 }}>
                      <span className={zScoreClass(rankZ(overallRank, totalTeams))}>
                        #{overallRank}
                      </span>
                    </td>
                    {CATEGORIES.map(cat => {
                      const rank = catRanks[cat.key];
                      const z    = rankZ(rank, totalTeams);
                      return (
                        <td
                          key={cat.key}
                          className={zScoreBgClass(z)}
                          title={`${cat.label}: ${formatMu(catMus[cat.key], cat.key)}`}
                        >
                          <span className={zScoreClass(z)}>
                            #{rank}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="table-legend">
          <span className="z-elite">■</span> Top third &nbsp;
          <span className="z-avg">■</span> Middle &nbsp;
          <span className="z-bad">■</span> Bottom third
        </p>
      </div>
    </div>
  );
}
