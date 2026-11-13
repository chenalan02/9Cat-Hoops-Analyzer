import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import TeamTable from '../components/TeamTable.jsx';
import CategoryToggle from '../components/CategoryToggle.jsx';
import WeeklyProjection from '../components/WeeklyProjection.jsx';
import YahooRefreshButton from '../components/common/YahooRefreshButton.jsx';
import { LoadingView, EmptyState } from '../components/common/PageStateGuard.jsx';
import './YourTeamPage.css';

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

export default function YourTeamPage() {
  const { myTeam, leagueData, loading, refreshTeam } = useContext(TeamDataContext);
  const navigate = useNavigate();
  const [puntedCats, setPuntedCats] = useState(new Set());
  const [activeTab, setActiveTab] = useState('roster');
  const [statsSource, setStatsSource] = useState('ema');

  const handleToggle = (key) => {
    setPuntedCats(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (loading) {
    return <LoadingView message="Loading your team…" />;
  }

  if (!myTeam) {
    return (
      <EmptyState
        icon="🏀"
        title="No Team Data Yet"
        description="Paste your Yahoo Fantasy link on the home page to get started."
        actionLabel="Go to Home"
        onAction={() => navigate('/')}
      />
    );
  }

  return (
    <div className="your-team-page page-wrapper fade-up">
      <div className="section">
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
            <YahooRefreshButton loading={loading} onRefresh={refreshTeam} />
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
