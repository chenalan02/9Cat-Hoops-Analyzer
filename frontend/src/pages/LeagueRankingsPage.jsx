import { useState, useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import { CATEGORIES, getPlayerMu, computeLeagueZScores, zScoreClass, zScoreBgClass } from '../utils/zScore.js';
import { formatMu } from '../utils/formatters.js';
import LeagueWeeklyProjectionsChart from '../components/LeagueWeeklyProjectionsChart.jsx';
import YahooRefreshButton from '../components/common/YahooRefreshButton.jsx';
import { LoadingView, EmptyState } from '../components/common/PageStateGuard.jsx';
import SortIcon from '../components/common/SortIcon.jsx';
import './LeagueRankingsPage.css';

const IR_SLOTS = new Set(['IL', 'IL+', 'IR', 'IR+', 'NA']);

function rankZ(rank, total) {
  if (!rank || !total) return 0;
  return ((total - rank) / (total - 1)) * 3 - 1.5;
}

export default function LeagueRankingsPage() {
  const { leagueData, myTeam, loading, refreshTeam } = useContext(TeamDataContext);
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState('overall');
  const [sortDir, setSortDir] = useState('asc');

  const rosLeagueTeams = useMemo(() => {
    if (!leagueData?.teams) return [];
    // Clone teams so ROS Z-score computation does not mutate EMA-scored data in other tabs.
    const cloned = leagueData.teams.map(t => ({
      ...t,
      players: (t.players || []).map(p => ({ ...p })),
    }));
    return computeLeagueZScores(cloned, CATEGORIES.map(c => c.key), 'ros');
  }, [leagueData]);

  const teamStats = useMemo(() => {
    if (!rosLeagueTeams.length) return [];
    return rosLeagueTeams.map(team => {
      const activePlayers = team.players.filter(
        p => !IR_SLOTS.has(String(p.selected_position || '').toUpperCase().trim())
      );
      const catMus = {};
      CATEGORIES.forEach(cat => {
        const vals = activePlayers.map(p => getPlayerMu(p, cat, 'ros')).filter(v => v !== null && !isNaN(v));
        catMus[cat.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
      const zSum = activePlayers.reduce((s, p) => s + (p.zSum ?? 0), 0);
      return { team, catMus, zSum };
    });
  }, [rosLeagueTeams]);

  const withRanks = useMemo(() => {
    return teamStats.map(ts => {
      const catRanks = {};
      CATEGORIES.forEach(cat => {
        const vals = teamStats.map(t => t.catMus[cat.key] ?? (cat.lowerBetter ? Infinity : -Infinity));
        const rankOrder = [...vals].sort((a, b) => (cat.lowerBetter ? a - b : b - a));
        catRanks[cat.key] = rankOrder.indexOf(ts.catMus[cat.key]) + 1;
      });
      const overallRank = [...teamStats]
        .sort((a, b) => b.zSum - a.zSum)
        .findIndex(t => t.team.team_id === ts.team.team_id) + 1;
      return { ...ts, catRanks, overallRank };
    });
  }, [teamStats]);

  const sorted = useMemo(() => {
    return [...withRanks].sort((a, b) => {
      const av = sortKey === 'overall' ? a.overallRank : (a.catRanks[sortKey] ?? 999);
      const bv = sortKey === 'overall' ? b.overallRank : (b.catRanks[sortKey] ?? 999);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [withRanks, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  if (loading) {
    return <LoadingView message="Loading your team…" />;
  }

  if (!leagueData) {
    return (
      <EmptyState
        icon="🏆"
        title="No League Data"
        description="Analyze your team first to unlock league power rankings."
        actionLabel="Analyze My Team"
        onAction={() => navigate('/')}
      />
    );
  }

  const totalTeams = sorted.length;

  return (
    <div className="league-page page-wrapper fade-up">
      <div className="section">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <h1 className="section-title" style={{ textAlign: 'left' }}>🏆 League Power Rankings</h1>
            <p className="section-subtitle" style={{ textAlign: 'left' }}>
              {leagueData.name} — {leagueData.season} Season &middot; Rest of Season (ROS)
            </p>
          </div>
          <YahooRefreshButton
            loading={loading}
            onRefresh={refreshTeam}
            title="Reload latest team and league data from Yahoo Fantasy"
          />
        </div>

        <p className="table-hint">
          Rankings based on team-average category &mu; using Rest of Season (ROS) projections. Click column headers to sort.
          Color = your rank in that category.
        </p>

        <div className="data-table-wrapper">
          <table className="data-table league-table" aria-label="League team rankings">
            <thead>
              <tr>
                <th
                  style={{ textAlign: 'left' }}
                  className={sortKey === 'overall' ? 'sort-active' : ''}
                  onClick={() => handleSort('overall')}
                >
                  Team <SortIcon active={sortKey === 'overall'} dir={sortDir} />
                </th>
                <th
                  className={sortKey === 'overall' ? 'sort-active' : ''}
                  onClick={() => handleSort('overall')}
                  style={{ textAlign: 'center' }}
                >
                  Overall <SortIcon active={sortKey === 'overall'} dir={sortDir} />
                </th>
                {CATEGORIES.map(cat => (
                  <th
                    key={cat.key}
                    className={sortKey === cat.key ? 'sort-active' : ''}
                    onClick={() => handleSort(cat.key)}
                  >
                    {cat.key} <SortIcon active={sortKey === cat.key} dir={sortDir} />
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
                      const z = rankZ(rank, totalTeams);
                      return (
                        <td
                          key={cat.key}
                          className={zScoreBgClass(z)}
                          title={`${cat.label}: ${formatMu(catMus[cat.key], cat.key)}`}
                        >
                          <span className={zScoreClass(z)}>#{rank}</span>
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

        <LeagueWeeklyProjectionsChart
          leagueTeams={rosLeagueTeams}
          myTeam={myTeam}
          statsSource="ros"
        />
      </div>
    </div>
  );
}
