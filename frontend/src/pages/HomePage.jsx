import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import './HomePage.css';

const DEMO_TEAM_URL = 'https://basketball.fantasysports.yahoo.com/nba/94646/3';

function isValidYahooLink(url) {
  return /basketball\.fantasysports\.yahoo\.com\/nba\/\d+\/\d+/.test(url);
}

const PLATFORM_TOOLS = [
  {
    path: '/your-team',
    icon: '📊',
    title: 'Your Team & Punt Lab',
    description:
      'Sortable 9-category Z-score table with volume-weighted FG%/FT%, instant punt toggles, and 3.5-game weekly projections.',
    requiresLeague: true,
  },
  {
    path: '/matchup',
    icon: '⚔️',
    title: 'Matchup Simulator',
    description:
      'Combines live Yahoo scoreboard totals with remaining games, optimal daily lineups, and Monte Carlo win probabilities.',
    requiresLeague: true,
  },
  {
    path: '/streamers',
    icon: '🔥',
    title: 'Streamer Finder',
    description:
      'Finds waiver pickups that maximize usable active starts on light schedule days and swing close categories.',
    requiresLeague: true,
  },
  {
    path: '/trade',
    icon: '🔄',
    title: 'Trade Analyzer',
    description:
      'Compare multi-player trades with waiver replacement slots, category Z-score shifts, and simulated league-wide win rates.',
    requiresLeague: true,
  },
  {
    path: '/league-rankings',
    icon: '🏆',
    title: 'League Rankings',
    description:
      'Benchmark every team in your league across all 9 categories with confidence intervals and category rank breakdowns.',
    requiresLeague: true,
  },
  {
    path: '/draft',
    icon: '🎯',
    title: 'Live Draft Assistant',
    description:
      'Standalone snake or linear draft room with a Mid-Draft Punt Advisor, positional scarcity alerts, and pick suggestions.',
    requiresLeague: false,
  },
];

const WORKFLOW_STEPS = [
  {
    icon: '🔗',
    title: '1. Paste Your Team Link',
    body: 'Enter your public Yahoo Fantasy Basketball team link above—or load the sample team in one click to explore.',
  },
  {
    icon: '📈',
    title: '2. Customize Your Build',
    body: 'Switch between recent game form (EMA) and Rest-of-Season (ROS) projections, and toggle punt categories on the fly.',
  },
  {
    icon: '🏆',
    title: '3. Win Your Matchup',
    body: 'Simulate weekly category odds, find the best waiver streamers for remaining games, and evaluate trades.',
  },
];

export default function HomePage() {
  const { fetchTeam, loading, error: fetchError, leagueData, myTeam, fantasyLink } = useContext(TeamDataContext);
  const [link, setLink] = useState(() => fantasyLink || '');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const runAnalysis = async (targetUrl, destination = '/your-team') => {
    const trimmed = targetUrl.trim();
    if (!trimmed) {
      setError('Please paste a Yahoo Fantasy Basketball team link.');
      return;
    }
    if (!isValidYahooLink(trimmed)) {
      setError('Please enter a valid Yahoo Fantasy Basketball link (e.g. https://basketball.fantasysports.yahoo.com/nba/94646/3)');
      return;
    }
    setError('');
    const result = await fetchTeam(trimmed);
    if (result) {
      navigate(destination);
    }
  };

  const handleAnalyze = () => {
    runAnalysis(link, '/your-team');
  };

  const handleUseDemoLink = (destination = '/your-team') => {
    setLink(DEMO_TEAM_URL);
    runAnalysis(DEMO_TEAM_URL, destination);
  };

  const handleToolClick = (tool) => {
    if (!tool.requiresLeague || leagueData) {
      navigate(tool.path);
      return;
    }
    handleUseDemoLink(tool.path);
  };

  const displayError = error || fetchError;

  const handleKey = (e) => {
    if (e.key === 'Enter') handleAnalyze();
  };

  return (
    <div className="home-page page-wrapper fade-up">
      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-content">
          <div className="hero-badge badge badge-green">
            🏀 Fantasy Basketball Analytics
          </div>

          <h1 className="hero-title">
            Dominate Your League<br />
            with <span className="accent">Data-Driven</span> Insight
          </h1>

          <p className="hero-tagline">
            Paste your Yahoo Fantasy Basketball team link for instant 9-category Z-score rankings,
            punt build analysis, weekly matchup odds, waiver streamers, and trade evaluations.
          </p>

          <div className={`search-bar ${displayError ? 'error' : ''}`}>
            <input
              id="team-link-input"
              type="url"
              placeholder="https://basketball.fantasysports.yahoo.com/nba/94646/3"
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setError('');
              }}
              onKeyDown={handleKey}
              aria-label="Yahoo Fantasy team link"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              id="analyze-btn"
              className="btn-primary search-btn"
              onClick={handleAnalyze}
              disabled={loading}
              aria-label="Analyze team"
            >
              {loading ? (
                <>
                  <span className="spinner" />
                  Analyzing…
                </>
              ) : (
                'Analyze →'
              )}
            </button>
          </div>

          {displayError && (
            <p className="input-error" role="alert">
              {displayError}
            </p>
          )}

          <div className="demo-banner">
            <div className="demo-banner-left">
              <span className="demo-banner-tag">Demo Mode</span>
              <span className="demo-banner-text">
                <strong>Don&apos;t have a Yahoo link?</strong> Explore the app with a live sample team:
              </span>
            </div>
            <div className="demo-banner-actions">
              <button
                type="button"
                className="sample-link-btn"
                onClick={() => handleUseDemoLink('/your-team')}
                disabled={loading}
                title={DEMO_TEAM_URL}
              >
                {loading ? 'Loading…' : '⚡ Load Sample Team'}
              </button>
              <button
                type="button"
                className="sample-draft-btn"
                onClick={() => navigate('/draft')}
              >
                🎯 Try Draft Room
              </button>
            </div>
          </div>

          {leagueData && myTeam && (
            <div className="active-session-pill">
              <span className="active-dot" />
              <span>
                Active: <strong>{leagueData.name}</strong> ({myTeam.name})
              </span>
              <button type="button" onClick={() => navigate('/your-team')}>
                View Team →
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="divider" />

      <section className="section">
        <h2 className="section-title">Included Tools</h2>
        <p className="section-subtitle">
          Everything you need to manage your 9-category roster from draft night to the playoffs
        </p>

        <div className="card-grid-3">
          {PLATFORM_TOOLS.map((tool) => (
            <button
              type="button"
              className="card tool-card"
              key={tool.title}
              onClick={() => handleToolClick(tool)}
              disabled={loading}
            >
              <div className="tool-card-header">
                <span className="tool-icon">{tool.icon}</span>
                <span className="tool-arrow">→</span>
              </div>
              <h3 className="tool-title">{tool.title}</h3>
              <p className="tool-desc">{tool.description}</p>
            </button>
          ))}
        </div>
      </section>

      <div className="divider" />

      <section className="section">
        <h2 className="section-title">How It Works</h2>
        <p className="section-subtitle">Three steps to smarter weekly lineup and roster moves</p>

        <div className="card-grid-3">
          {WORKFLOW_STEPS.map((f) => (
            <div className="card feature-card" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>

        <div className="info-cta-bar">
          <div className="info-cta-content">
            <h3 className="info-cta-title">Under the Hood: Statistical Methodology</h3>
            <p className="info-cta-text">
              Explore the math behind EMA projections, volume-weighted Z-scores, Hungarian lineup optimization, and Monte Carlo matchup simulations.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary info-cta-btn"
            onClick={() => navigate('/info')}
          >
            Read Full Methodology & Info →
          </button>
        </div>
      </section>

      <footer className="footer">
        Built with 🏀 by <span className="accent">9Cat Hoops</span> &middot; Not affiliated with Yahoo, the NBA, or any fantasy platform.
      </footer>
    </div>
  );
}
