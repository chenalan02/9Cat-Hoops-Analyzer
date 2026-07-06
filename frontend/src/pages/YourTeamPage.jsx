import { useState, useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import TeamTable from '../components/TeamTable.jsx';
import CategoryToggle from '../components/CategoryToggle.jsx';
import WeeklyProjection from '../components/WeeklyProjection.jsx';
import TeamZScoreChart from '../components/TeamZScoreChart.jsx';
import { rankPlayers } from '../utils/zScore.js';
import './YourTeamPage.css';

export default function YourTeamPage() {
  const { myTeam, leagueData, loading } = useContext(TeamDataContext);
  const navigate = useNavigate();
  const [puntedCats, setPuntedCats] = useState(new Set());
  const [activeTab, setActiveTab]   = useState('roster');

  const handleToggle = (key) => {
    setPuntedCats(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Baseline ranking (no punts) for delta calculation
  const baselinePlayers = useMemo(() => {
    if (!myTeam?.players) return [];
    return rankPlayers(myTeam.players);
  }, [myTeam]);

  if (loading) {
    return (
      <div className="page-wrapper center-content">
        <div className="spinner" style={{ width: 36, height: 36 }} />
        <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>Loading your team…</p>
      </div>
    );
  }

  if (!myTeam) {
    return (
      <div className="page-wrapper center-content">
        <div className="empty-state">
          <div style={{ fontSize: '4rem' }}>🏀</div>
          <h2 style={{ marginBottom: '0.5rem' }}>No Team Data Yet</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Paste your Yahoo Fantasy link on the home page to get started.
          </p>
          <button className="btn-primary" onClick={() => navigate('/')}>
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  const activePlayers = myTeam.players.filter(
    p => p.selected_position !== 'IL' && p.selected_position !== 'NA'
  );

  return (
    <div className="your-team-page page-wrapper fade-up">
      <div className="section">
        {/* Header */}
        <div className="team-header">
          <div>
            <h1 className="team-name">{myTeam.name}</h1>
            <div className="team-meta">
              <span className="badge badge-green">League Rank #{myTeam.rank}</span>
              <span className="badge badge-blue">
                {myTeam.record?.wins ?? '?'}W–{myTeam.record?.losses ?? '?'}L–{myTeam.record?.ties ?? '?'}T
              </span>
              {leagueData?.name && (
                <span className="badge badge-orange">📋 {leagueData.name}</span>
              )}
            </div>
          </div>
          <button className="btn-secondary" onClick={() => navigate('/')}>← New Search</button>
        </div>



        {/* Z-Score Strength & Variance Chart */}
        <TeamZScoreChart activePlayers={activePlayers} />

        <div className="tab-bar">
          <button
            className={`tab-btn ${activeTab === 'roster' ? 'active' : ''}`}
            onClick={() => setActiveTab('roster')}
          >
            Roster Rankings
          </button>
          <button
            className={`tab-btn ${activeTab === 'weekly' ? 'active' : ''}`}
            onClick={() => setActiveTab('weekly')}
          >
            Weekly Aggregate
          </button>
        </div>

        {activeTab === 'roster' && (
          <>
            <CategoryToggle puntedCats={puntedCats} onToggle={handleToggle} />
            <TeamTable
              players={myTeam.players}
              puntedCats={puntedCats}
              allTeams={leagueData?.teams ?? []}
              baselinePlayers={baselinePlayers}
            />
          </>
        )}

        {activeTab === 'weekly' && (
          <WeeklyProjection
            players={myTeam.players}
            leagueTeams={leagueData?.teams ?? []}
          />
        )}
      </div>
    </div>
  );
}
