import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import './HomePage.css';

const CATEGORIES = [
  { key: 'PTS', name: 'Points', icon: '🔥', desc: 'Scorers who put up buckets every night' },
  { key: 'REB', name: 'Rebounds', icon: '🏀', desc: 'Glass-eaters dominating the boards' },
  { key: 'AST', name: 'Assists', icon: '🎯', desc: 'Playmakers distributing the rock' },
  { key: 'STL', name: 'Steals', icon: '🖐️', desc: 'Pesky defenders picking pockets' },
  { key: 'BLK', name: 'Blocks', icon: '🚫', desc: 'Rim protectors sending shots home' },
  { key: '3PM', name: '3-Pointers', icon: '🎱', desc: 'Long-range specialists raining threes' },
  { key: 'FG%', name: 'Field Goal %', icon: '📈', desc: 'Efficient scorers boosting your percentage' },
  { key: 'FT%', name: 'Free Throw %', icon: '🎯', desc: 'Clutch free-throw shooters' },
  { key: 'TO', name: 'Turnovers', icon: '⚠️', desc: 'Low-TO ball handlers protecting possessions' },
];

function isValidYahooLink(url) {
  return /basketball\.fantasysports\.yahoo\.com\/nba\/\d+(?:\/\d+)?/.test(url);
}

export default function HomePage() {
  const { fetchTeam, loading, error: fetchError } = useContext(TeamDataContext);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleAnalyze = async () => {
    const trimmed = link.trim();
    if (!trimmed) { setError('Please paste a Yahoo Fantasy Basketball team link.'); return; }
    if (!isValidYahooLink(trimmed)) {
      setError('Please enter a valid Yahoo Fantasy Basketball link (e.g. https://basketball.fantasysports.yahoo.com/nba/00000/0)');
      return;
    }
    setError('');
    await fetchTeam(trimmed);
  };

  // Navigate after a successful fetch (loading done, no errors, data exists)
  const { leagueData } = useContext(TeamDataContext);
  const [submitted, setSubmitted] = useState(false);

  const handleAnalyzeWrapped = async () => {
    setSubmitted(true);
    await handleAnalyze();
  };

  // Use effect-like pattern: if submitted, not loading, no error, and we have data → navigate
  if (submitted && !loading && !fetchError && leagueData) {
    navigate('/your-team');
  }

  const displayError = error || fetchError;

  const handleKey = (e) => { if (e.key === 'Enter') handleAnalyzeWrapped(); };

  return (
    <div className="home-page page-wrapper fade-up">
      {/* Hero */}
      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-content">
          <div className="hero-badge badge badge-green">✨ Fantasy Basketball Analytics</div>
          <h1 className="hero-title">
            Dominate Your League<br />
            with <span className="accent">Data-Driven</span> Insight
          </h1>
          <p className="hero-tagline">
            Paste your Yahoo Fantasy Basketball team link for instant 9-category z-score analysis,
            matchup odds, draft rankings, and weekly aggregates.
          </p>

          <div className={`search-bar ${displayError ? 'error' : ''}`}>
            <input
              id="team-link-input"
              type="url"
              placeholder="https://basketball.fantasysports.yahoo.com/nba/"
              value={link}
              onChange={e => { setLink(e.target.value); setError(''); }}
              onKeyDown={handleKey}
              aria-label="Yahoo Fantasy team link"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              id="analyze-btn"
              className="btn-primary search-btn"
              onClick={handleAnalyzeWrapped}
              disabled={loading}
              aria-label="Analyze team"
            >
              {loading ? <><span className="spinner" />Analyzing…</> : 'Analyze →'}
            </button>
          </div>

          {displayError && <p className="input-error" role="alert">{displayError}</p>}

          <p className="hero-hint">
            Works with public Yahoo Fantasy Basketball team links
          </p>
        </div>
      </section>

      <div className="divider" />

      {/* How It Works */}
      <section className="section">
        <h2 className="section-title">How It Works</h2>
        <p className="section-subtitle">Three steps to fantasy domination</p>
        <div className="card-grid-3">
          {[
            { icon: '🔗', title: 'Paste Your Link', body: 'Drop your public Yahoo Fantasy Basketball team link into the bar above.' },
            { icon: '📊', title: 'Crunch the Numbers', body: 'We compute z-scores across all 9 categories using exponential moving averages to weight recent performance.' },
            { icon: '🏆', title: 'Dominate Your League', body: 'See category strengths, punt strategy rankings, matchup win probabilities, and smarter draft picks.' },
          ].map(f => (
            <div className="card feature-card" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="footer">
        Built with 🏀 by <span className="accent">9Cat Hoops</span> &middot; Not affiliated with Yahoo, the NBA, or any fantasy platform.
      </footer>
    </div>
  );
}
