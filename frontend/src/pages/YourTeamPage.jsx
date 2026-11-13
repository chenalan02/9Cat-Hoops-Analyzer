import { useState, useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import TeamTable from '../components/TeamTable.jsx';
import CategoryToggle from '../components/CategoryToggle.jsx';
import WeeklyProjection from '../components/WeeklyProjection.jsx';
import './YourTeamPage.css';

export default function YourTeamPage() {
  const { myTeam, leagueData, loading, refreshTeam } = useContext(TeamDataContext);
  const navigate = useNavigate();
  const [puntedCats, setPuntedCats]   = useState(new Set());
  const [activeTab, setActiveTab]     = useState('roster');
  const [statsSource, setStatsSource] = useState('ema'); // 'ema' | 'weekly' | 'ros'
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

  const SOURCE_LABELS = {
    ema: {
      title: 'Exponential Moving Average (EMA)',
      desc: 'Weights recent form to capture true underlying player talent.',
    },
    weekly: {
      title: 'Weekly Projections',
      desc: "Per-game expectations tailored to this week's scheduled matchups.",
    },
    ros: {
      title: 'Rest of Season (ROS)',
      desc: 'Long-term forward-looking projections through season end.',
    },
  };

  const handleToggle = (key) => {
    setPuntedCats(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-secondary refresh-btn"
              onClick={handleRefresh}
              disabled={loading}
              title="Reload latest team roster, matchups, and league data from Yahoo Fantasy"
            >
              <span className={`refresh-icon ${loading ? 'spinning' : ''}`}>🔄</span>
              <span>{loading ? 'Reloading…' : justRefreshed ? 'Updated!' : 'Reload from Yahoo'}</span>
            </button>
            <button className="btn-secondary" onClick={() => navigate('/')}>← New Search</button>
          </div>
        </div>





        <div className="yt-controls-bar">
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

          <div className="source-toggle-group">
            <span className="source-toggle-label">Data Source:</span>
            <div className="source-toggle">
              <button
                type="button"
                className={`source-toggle-btn ${statsSource === 'ema' ? 'active' : ''}`}
                onClick={() => setStatsSource('ema')}
                title="EMA: Recent form & true player baseline"
              >
                EMA
              </button>
              <button
                type="button"
                className={`source-toggle-btn ${statsSource === 'weekly' ? 'active' : ''}`}
                onClick={() => setStatsSource('weekly')}
                title="Weekly Projections: This week's per-game expectations"
              >
                Weekly Projections
              </button>
              <button
                type="button"
                className={`source-toggle-btn ${statsSource === 'ros' ? 'active' : ''}`}
                onClick={() => setStatsSource('ros')}
                title="Rest of Season (ROS): Value through season end"
              >
                ROS
              </button>
            </div>
          </div>
        </div>

        <div className="source-desc-pill">
          <span className="source-desc-dot" />
          <strong>{SOURCE_LABELS[statsSource]?.title}:</strong>&nbsp;{SOURCE_LABELS[statsSource]?.desc}
        </div>

        {activeTab === 'roster' && (
          <>
            <CategoryToggle puntedCats={puntedCats} onToggle={handleToggle} />
            <TeamTable
              players={myTeam.players}
              puntedCats={puntedCats}
              allTeams={leagueData?.teams ?? []}
              statsSource={statsSource}
            />
          </>
        )}

        {activeTab === 'weekly' && (
          <WeeklyProjection
            players={myTeam.players}
            leagueTeams={leagueData?.teams ?? []}
            statsSource={statsSource}
          />
        )}
      </div>
    </div>
  );
}
