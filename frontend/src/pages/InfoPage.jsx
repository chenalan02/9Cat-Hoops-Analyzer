import './InfoPage.css';

const SECTIONS = [
  {
    icon: '',
    title: 'Exponential Moving Average (EMA) Stats',
    content: `Player statistics are computed using an Exponential Moving Average over their game logs,
    giving more weight to recent performance. This means a hot streak or a slump will be reflected
    faster than in a simple season average. Each stat stores both a μ (mean) and σ² (variance)
    to capture both expected output and uncertainty.`,
  },
  {
    icon: '',
    title: 'Z-Score Methodology',
    content: `For each of the 9 fantasy categories, we compute a z-score for every rostered player
    across the league: z = (player_μ - league_mean) / league_std. This normalizes all categories
    to a common scale, allowing you to directly compare a player's rebounding value to their
    3-pointer value. For Turnovers (lower is better), the z-score is inverted so that a lower
    TO rate still results in a positive z-score contribution.`,
  },
  {
    icon: '',
    title: 'Punt Strategy & Category Toggling',
    content: `The ranking on My Team is computed as the sum of z-scores across all active (non-punted)
    categories. By toggling a category off (punting), you're telling the ranker to ignore that
    category entirely — useful when your league strategy intentionally sacrifices one or two
    categories (e.g., punting FT% and FG% for a "counting stats" team). The rank delta shown
    beside each player's rank indicates how their ranking changes vs. the baseline (all categories active).`,
  },
  {
    icon: '',
    title: 'Weekly Aggregates & Confidence Intervals',
    content: `Team weekly aggregates multiply each active player's per-game μ by the number of
    projected games in the week (default 3.5). The confidence interval uses the Central Limit
    Theorem: since each player's output is approximately normally distributed, team totals
    have variance equal to the sum of individual player variances. We report both 95% CI
    (±1.96σ) and 68% CI (±1σ). FG% and FT% variances are derived using the delta method.`,
  },
  {
    icon: '',
    title: 'Matchup Win Probabilities',
    content: `For each category, we model the difference between your team total and your opponent's
    team total as a normal distribution. The win probability is P(myTotal > oppTotal), computed
    via the normal CDF. The Monte Carlo simulation samples 5,000 hypothetical weeks using
    Box-Muller transforms to generate realistic game-by-game variation, then tallies wins,
    losses, and ties across all 9 categories.`,
  },
  {
    icon: '',
    title: 'Draft Rankings',
    content: `Draft rankings are computed using the same z-score methodology — each player is
    ranked by the sum of their z-scores across active categories. Toggling categories on the
    Draft page re-ranks players instantly, showing you the best available at each position
    for your specific punt strategy. Future versions will include a live draft assistant
    that tracks picks in real time.`,
  },
];

export default function InfoPage() {
  return (
    <div className="info-page page-wrapper fade-up">
      <div className="section">
        <h1 className="section-title">ℹ️ How It Works</h1>
        <p className="section-subtitle">The methodology behind 9Cat Hoops Analyzer</p>

        <div className="info-grid">
          {SECTIONS.map((s, i) => (
            <div className="info-card card" key={i}>
              <h2 className="info-title">{s.title}</h2>
              <p className="info-body">{s.content}</p>
            </div>
          ))}
        </div>


      </div>
      <footer className="footer">
        Built with 🏀 by <span className="accent">9Cat Hoops</span> &middot; Not affiliated with Yahoo, the NBA, or any fantasy platform.
      </footer>
    </div>
  );
}
