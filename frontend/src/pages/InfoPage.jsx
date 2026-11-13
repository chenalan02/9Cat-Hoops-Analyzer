import './InfoPage.css';

const PROJECTION_SOURCES = [
  {
    badge: 'EMA',
    badgeClass: 'badge-green',
    name: 'Exponential Moving Average',
    bestFor: 'In-season form, breakouts & role changes',
    description:
      'Updated daily from completed NBA box scores. Recent games carry higher weight (μ_t = (1 − α)μ_{t−1} + αx_t) while blending with preseason priors early in the season so small sample sizes do not overreact to a single outlier night.',
  },
  {
    badge: 'ROS',
    badgeClass: 'badge-blue',
    name: 'Rest of Season Projections',
    bestFor: 'Trade evaluation & long-term roster value',
    description:
      'Forward-looking consensus projections paired with log-linear ML variance estimates. Less reactive to short-term shooting slumps or temporary injury fill-in streaks, making it ideal for evaluating buy-low and sell-high trades.',
  },
  {
    badge: 'Weekly Blend',
    badgeClass: 'badge-orange',
    name: '50/50 EMA + Weekly Projections',
    bestFor: 'Matchup Simulator & Streamer Finder',
    description:
      'Blends current EMA form with weekly projections and applies credibility-weighted variance (Z = N / (N + K)) based on games played. Used automatically by the matchup and streaming engines to project remaining games in the current week.',
  },
  {
    badge: 'Preseason',
    badgeClass: 'badge-green',
    name: 'Zero-State Baseline',
    bestFor: 'Draft Assistant & preseason preparation',
    description:
      'Combines prior-season baselines with preseason projections and ML-predicted category variances before a single regular-season game is played, accounting for offseason team changes, age curves, and projected minutes.',
  },
];

const Z_SCORE_SCALE = [
  { label: 'Elite', range: '> +1.50 z', className: 'z-elite z-bg-elite', desc: 'Category anchor (1st–2nd round impact in this stat)' },
  { label: 'Above Avg', range: '+0.50 to +1.50 z', className: 'z-good z-bg-good', desc: 'Strong positive contributor above league baseline' },
  { label: 'League Avg', range: '-0.50 to +0.50 z', className: 'z-avg z-bg-avg', desc: 'Neutral category impact around replacement level' },
  { label: 'Below Avg', range: '-1.50 to -0.50 z', className: 'z-poor z-bg-poor', desc: 'Mild category drag that requires cover elsewhere' },
  { label: 'Weak / Punt', range: '< -1.50 z', className: 'z-bad z-bg-bad', desc: 'Heavy category deficit — prime candidate to punt' },
];

const METHODOLOGY_CARDS = [
  {
    tag: 'Rankings & Valuation',
    title: 'Iterative Z-Scores & Volume-Weighted Percentages',
    summary:
      'Raw per-game averages cannot be added together directly because 25 PPG and 1.8 SPG live on different scales. Every category is standardized into a Z-score relative to the active league pool.',
    bullets: [
      'Counting Categories (PTS, REB, AST, STL, BLK, 3PM): Standardized as z = (μ_player − μ_league) / σ_league across the top rostered player pool using iterative convergence so rankings stabilize around true starter value.',
      'FG% and FT% Volume Impact: A player shooting 90% FT on 1 attempt per game helps your team far less than a star shooting 86% on 9 attempts. Efficiency categories are weighted by attempt volume before standardization: Impact = (FG%_player − FG%_league) × FGA_player.',
      'Turnovers (TOV): Inverted so fewer turnovers produce a positive Z-score, and weighted at 0.25× in composite rankings so high-usage playmakers are not over-penalized for having the ball in their hands.',
    ],
    formula: 'Impact_FG% = (FG%_i − FG%_league) × FGA_i   |   Z_total = Σ Z_cat (active)',
  },
  {
    tag: 'Roster Strategy',
    title: 'Punt Builds & Dynamic Re-Ranking',
    summary:
      'In 9-category head-to-head leagues, you only need 5 categories to win a week. Intentionally sacrificing ("punting") 1 or 2 weak categories often unlocks massive value in specialists.',
    bullets: [
      'Instant Category Toggles: Clicking any category chip on Your Team, Trade Analyzer, or Draft Assistant excludes that stat from the total Z-score sum and immediately recalculates every player’s rank.',
      'Rank Delta Indicators (▲ / ▼): Shows how many spots a player rises or falls under your active punt build compared to a balanced 9-category baseline (e.g., high-volume guards surging when punting FG% and TOV).',
      'Weekly Confidence Intervals: Team projections scale per-game means and variances to a 3.5-game week and display 68% (±1σ) and 95% (±1.96σ) confidence bands using the delta method for FG% and FT% ratios.',
    ],
    formula: 'ΔRank = Rank_baseline − Rank_punt   |   95% CI = μ_week ± 1.96 × √(Σ σ²_i)',
  },
  {
    tag: 'Matchup Simulator',
    title: 'Hungarian Lineup Solver & Live Mid-Week Projections',
    summary:
      'Instead of assuming every rostered player starts every game, the matchup engine simulates your exact daily starting lineup for each remaining day of the Yahoo scoring week.',
    bullets: [
      'Bipartite Slot Optimization: On busy NBA nights where more than 10 players on your roster have games, the backend runs the Hungarian algorithm (SciPy linear_sum_assignment) to assign players to eligible slots (PG, SG, G, SF, PF, F, C, Util) to maximize active category value while benching excess players.',
      'Live Yahoo Scoreboard Merging: Mid-week projections pull your actual accumulated stats from Yahoo for completed days and add projected distributions only for remaining unplayed games.',
      'Injury & Status Filtering: Players marked OUT, INJ, IL, or OFS are excluded from active slot assignments so projections reflect realistic lineups.',
    ],
    formula: 'Total_week = Actual_completed (Yahoo Live) + Σ OptimalLineup_day (Remaining)',
  },
  {
    tag: 'Win Probability Engines',
    title: 'Analytical Normal CDF vs. 10,000-Trial Monte Carlo',
    summary:
      'You can toggle between two statistical engines on the Matchup page depending on whether you want instant closed-form density curves or discrete distribution sampling.',
    bullets: [
      'Analytical Engine (Default): Models each category’s net differential (Team A − Team B) as a Normal distribution N(μ_A − μ_B, σ²_A + σ²_B), using the delta method to approximate variance for FG% (FGM/FGA) and FT% (FTM/FTA). Renders interactive probability density overlays for any category.',
      '10,000-Trial Monte Carlo Simulator: Simulates 10,000 full matchup weeks game-by-game using Normal distributions (floored at 0) for high-volume stats, Poisson / Negative Binomial distributions for discrete low-volume stats (STL, BLK, 3PM, TOV), and Beta-Binomial sampling for shooting makes and attempts.',
      'Expected Category Score: Both engines compute individual category win probabilities and overall matchup win/tie/loss odds (e.g., projected 5.4 – 3.6 category result).',
    ],
    formula: 'P(Win_cat) = Φ((μ_you − μ_opp) / √(σ²_you + σ²_opp))',
  },
  {
    tag: 'Waiver Wire Optimization',
    title: 'Schedule-Aware Streamer Finder',
    summary:
      'Evaluates free agents in your Yahoo league to find short-term pickups that swing toss-up categories without accidentally dropping a valuable rest-of-season player.',
    bullets: [
      'Usable Starts vs. Raw Schedule: A 4-game week does not help if 3 of those games fall on overcrowded Wednesday/Friday slates where the streamer sits on your bench. The solver checks how many games a candidate will actually start in your lineup, weighting low-volume NBA "off-days" (Tue/Thu/Sun).',
      'Swing Category Targeting: Automatically highlights battleground categories (30%–70% win probability) or lets you lock in custom target categories and punt filters.',
      'Drop Slot & Injury Protection: Evaluates every candidate against your droppable bench spots, applying GTD/questionable availability discounts and guarding high-ROS-rank players from being suggested as drops.',
    ],
    formula: 'ΔE[Wins] = E[Wins | Add Streamer, Drop Bench] − E[Wins | Current Roster]',
  },
  {
    tag: 'Trades & Draft Prep',
    title: 'Trade Analyzer & Standalone Draft Assistant',
    summary:
      'Tools for long-term roster construction both before the season starts and ahead of your league trade deadline.',
    bullets: [
      'Multi-Player Trade Analyzer: Supports balanced (1-for-1, 2-for-2) and uneven (2-for-1, 3-for-2) trades. For uneven deals, you can attach the best available waiver pickup to the receiving side so roster sizes stay equal, then inspect before/after Z-scores and simulated win rates against every team in the league.',
      'Standalone Draft Board: Runs independently of a Yahoo league link with customizable team count, snake/linear format, and roster slots.',
      'Mid-Draft Punt Advisor & Pick Engine: After your first pick, analyzes your roster’s category profile to recommend natural punt builds (flagging deficits below −0.40z), surfaces Punt Sleepers with the largest rank jumps, and scores available picks by active Z-value, unfilled positional slots, and cross-position stat scarcity (e.g., shot-blocking guards or passing centers).',
    ],
    formula: 'PickScore = Z_active + PosNeedBonus + ScarcityBonus',
  },
];

const PIPELINE_STEPS = [
  {
    time: '03:00 AM ET',
    stage: '1. NBA Box Score & Schedule Ingestion',
    detail: 'Completed daily NBA game logs, weekly schedule updates, and player bio data are extracted via nba_api and uploaded as Parquet files to Databricks Unity Catalog Volumes.',
  },
  {
    time: '03:15 AM ET',
    stage: '2. Databricks Medallion ETL (Bronze → Silver → Gold)',
    detail: 'Auto Loader streams new game logs into Silver tables, updates intra-season EMA means and variances, blends FantasyPros projections, and runs iterative Z-score convergence for Gold tables.',
  },
  {
    time: '03:30 AM ET',
    stage: '3. FastAPI In-Memory Cache Sync',
    detail: 'The backend refreshes its in-memory Gold projection and schedule caches from Databricks SQL so all matchup, trade, draft, and streamer requests run with sub-second latency.',
  },
];

export default function InfoPage() {
  return (
    <div className="info-page page-wrapper fade-up">
      <div className="section">
        <h1 className="section-title">How 9Cat Hoops Works</h1>
        <p className="section-subtitle">
          Statistical modeling, lineup optimization, and decision tools for 9-category head-to-head fantasy basketball
        </p>

        {/* 1. Projection Sources Guide */}
        <div className="info-block">
          <div className="info-block-header">
            <h2 className="info-block-title">Choosing a Projection Source</h2>
            <p className="info-block-desc">
              Across the app, you can switch between projection models depending on whether you are making a short-term weekly move or a long-term roster decision.
            </p>
          </div>
          <div className="source-grid">
            {PROJECTION_SOURCES.map((src) => (
              <div className="source-card card" key={src.badge}>
                <div className="source-card-top">
                  <span className={`badge ${src.badgeClass}`}>{src.badge}</span>
                  <span className="source-best-for">{src.bestFor}</span>
                </div>
                <h3 className="source-name">{src.name}</h3>
                <p className="source-desc">{src.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 2. Z-Score Color Key */}
        <div className="info-block">
          <div className="info-block-header">
            <h2 className="info-block-title">Reading the Z-Score Color Scale</h2>
            <p className="info-block-desc">
              Every player and team stat cell is color-coded by its standard deviation distance (z-score) from the league starter average.
            </p>
          </div>
          <div className="z-scale-strip">
            {Z_SCORE_SCALE.map((item) => (
              <div className={`z-scale-card ${item.className}`} key={item.label}>
                <div className="z-scale-top">
                  <span className="z-scale-label">{item.label}</span>
                  <span className="z-scale-range">{item.range}</span>
                </div>
                <p className="z-scale-desc">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Deep-Dive Methodology Cards */}
        <div className="info-block">
          <div className="info-block-header">
            <h2 className="info-block-title">Core Analytics & Simulation Models</h2>
            <p className="info-block-desc">
              How player distributions, daily roster constraints, and win probabilities are calculated under the hood.
            </p>
          </div>
          <div className="info-grid">
            {METHODOLOGY_CARDS.map((card) => (
              <div className="info-card card" key={card.title}>
                <div className="info-card-header">
                  <span className="info-tag">{card.tag}</span>
                  <h3 className="info-title">{card.title}</h3>
                </div>
                <p className="info-summary">{card.summary}</p>
                <ul className="info-bullet-list">
                  {card.bullets.map((bullet, idx) => (
                    <li key={idx}>{bullet}</li>
                  ))}
                </ul>
                <div className="info-formula">
                  <code>{card.formula}</code>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 4. Data Refresh Schedule */}
        <div className="info-block">
          <div className="info-pipeline card">
            <div className="info-block-header">
              <h2 className="info-block-title">Daily Data Pipeline & Refresh Schedule</h2>
              <p className="info-block-desc">
                Player projections and NBA schedules update automatically every morning after West Coast games conclude, while Yahoo rosters, free agents, and matchup scoreboards are fetched live on demand.
              </p>
            </div>
            <div className="pipeline-grid">
              {PIPELINE_STEPS.map((step) => (
                <div className="pipeline-step" key={step.stage}>
                  <span className="pipeline-time">{step.time}</span>
                  <h4 className="pipeline-stage">{step.stage}</h4>
                  <p className="pipeline-detail">{step.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <footer className="footer">
        Built with 🏀 by <span className="accent">9Cat Hoops</span> &middot; Not affiliated with Yahoo, the NBA, or any fantasy platform.
      </footer>
    </div>
  );
}
