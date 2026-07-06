import { useState, useRef, useMemo } from 'react';
import { CATEGORIES, computeTeamWeeklyProjection } from '../utils/zScore.js';
import { formatMu, ordinal } from '../utils/formatters.js';
import './LeagueWeeklyProjectionsChart.css';

export default function LeagueWeeklyProjectionsChart({ leagueTeams = [], myTeam = null }) {
  const [activeCatKey, setActiveCatKey] = useState('PTS');
  const [projGames, setProjGames] = useState(3.5);
  const [projGamesInput, setProjGamesInput] = useState('3.5');
  const [hoveredTeam, setHoveredTeam] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  const activeCategory = useMemo(() => {
    return CATEGORIES.find(c => c.key === activeCatKey) || CATEGORIES[0];
  }, [activeCatKey]);

  // Compute weekly projection and +/- 2 standard deviations for all teams
  const chartData = useMemo(() => {
    if (!leagueTeams.length) return [];

    const data = leagueTeams.map(team => {
      const proj = computeTeamWeeklyProjection(team.players || [], projGames);
      const catProj = proj[activeCatKey];
      
      const mu = catProj?.mu ?? 0;
      // Get standard deviation (sigma) from 68% confidence interval high bound
      // since ci68High = mu + sigma
      const sigma = catProj ? Math.max(catProj.ci68High - catProj.mu, 0) : 0;
      
      const errLow = mu - 2 * sigma;
      const errHigh = mu + 2 * sigma;

      return {
        teamId: team.team_id,
        teamName: team.name,
        isMyTeam: myTeam && String(team.team_id) === String(myTeam.team_id),
        mu,
        sigma,
        errLow,
        errHigh,
        rawProj: catProj
      };
    });

    // Sort by projected mean value descending
    // (for turnovers, since lower is better, we can sort ascending or descending. Let's sort descending so the bars flow high-to-low visually, but keep in mind TO is inverted in zScores)
    return [...data].sort((a, b) => b.mu - a.mu);
  }, [leagueTeams, activeCatKey, projGames, myTeam]);

  // Handle Games per Week input change
  const handleGamesChange = (e) => {
    setProjGamesInput(e.target.value);
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0 && val <= 7) {
      setProjGames(val);
    }
  };

  // Dimensions for SVG
  const width = 800;
  const height = 400;
  const padding = { top: 40, right: 30, bottom: 65, left: 60 };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Scale Y-axis based on the data bounds (with 10% padding)
  const yScales = useMemo(() => {
    if (!chartData.length) return { yMin: 0, yMax: 100 };
    
    const lows = chartData.map(d => d.errLow);
    const highs = chartData.map(d => d.errHigh);
    
    const absoluteMin = Math.min(...lows);
    const absoluteMax = Math.max(...highs);
    const diff = absoluteMax - absoluteMin;
    
    // Ensure we don't go below 0 for counting stats, but zoom in on percentages
    const isPct = activeCatKey === 'FG%' || activeCatKey === 'FT%';
    const yMin = isPct 
      ? Math.max(0, absoluteMin - 0.15 * (diff || 0.1)) 
      : Math.max(0, absoluteMin - 0.1 * (diff || 1));
    const yMax = absoluteMax + 0.1 * (diff || 1);

    return { yMin, yMax };
  }, [chartData, activeCatKey]);

  const { yMin, yMax } = yScales;

  const getY = (val) => {
    const range = yMax - yMin || 1;
    const clampedVal = Math.max(yMin, Math.min(yMax, val));
    const pct = (clampedVal - yMin) / range;
    return height - padding.bottom - pct * plotHeight;
  };

  const colWidth = chartData.length ? plotWidth / chartData.length : 50;
  const barWidth = Math.max(12, Math.min(36, colWidth - 16));

  // Generate grid values for Y axis
  const gridTicks = useMemo(() => {
    const numTicks = 5;
    const ticks = [];
    for (let i = 0; i < numTicks; i++) {
      ticks.push(yMin + (i * (yMax - yMin)) / (numTicks - 1));
    }
    return ticks;
  }, [yMin, yMax]);

  // Handle tooltip tracking
  const handleMouseMove = (e, teamData) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setTooltipPos({ x, y });
    setHoveredTeam(teamData);
  };

  const handleMouseLeave = () => {
    setHoveredTeam(null);
  };

  return (
    <div className="league-weekly-chart-card fade-up" ref={containerRef}>
      <div className="chart-header">
        <div className="chart-title-container">
          <h3 className="chart-title">Weekly Projections Overview</h3>
          <p className="chart-subtitle">
            Expected weekly totals with expected variance (error bars show ±2 std deviations)
          </p>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          {/* Legend */}
          <div className="chart-legend">
            <div className="legend-item">
              <div className="legend-color" style={{ background: 'linear-gradient(180deg, var(--accent, #00e676), #00c864)' }} />
              <span>Projected Mean</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: 'linear-gradient(180deg, #ffa726, #f57c00)' }} />
              <span>Your Team</span>
            </div>
            <div className="legend-item">
              <div className="legend-line" />
              <span>±2 Std Dev (95.4% range)</span>
            </div>
          </div>

          {/* Games Input */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Games/Week:
            <input
              type="number"
              min="1" max="7" step="0.5"
              value={projGamesInput}
              onChange={handleGamesChange}
              style={{
                width: '50px',
                padding: '4px 8px',
                borderRadius: '6px',
                background: 'var(--bg-input, #1a222e)',
                border: '1px solid var(--border, #1e2a38)',
                color: 'var(--text-primary, #f0f4f8)',
                fontWeight: 700,
                textAlign: 'center',
                outline: 'none'
              }}
              aria-label="Hypothetical games per week"
            />
          </label>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="category-toggle-bar">
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            className={`category-chip ${activeCatKey === cat.key ? 'active' : ''}`}
            onClick={() => { setActiveCatKey(cat.key); setHoveredTeam(null); }}
          >
            {cat.key}
          </button>
        ))}
      </div>

      <div className="chart-wrapper">
        {chartData.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            No league teams data available to chart.
          </div>
        ) : (
          <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
            <defs>
              {/* Gradients */}
              <linearGradient id="normalBarGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent, #00e676)" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#00b050" stopOpacity="0.85" />
              </linearGradient>
              <linearGradient id="normalBarGradHover" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#33f090" stopOpacity="1" />
                <stop offset="100%" stopColor="var(--accent, #00e676)" stopOpacity="1" />
              </linearGradient>
              <linearGradient id="myTeamBarGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffa726" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#fb8c00" stopOpacity="0.9" />
              </linearGradient>
              <linearGradient id="myTeamBarGradHover" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffb74d" stopOpacity="1" />
                <stop offset="100%" stopColor="#ffa726" stopOpacity="1" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            {gridTicks.map((val, idx) => (
              <g key={idx}>
                <line
                  x1={padding.left}
                  y1={getY(val)}
                  x2={width - padding.right}
                  y2={getY(val)}
                  className={idx === 0 ? 'baseline' : 'grid-line'}
                />
                <text
                  x={padding.left - 10}
                  y={getY(val) + 4}
                  textAnchor="end"
                  className="axis-text"
                >
                  {formatMu(val, activeCatKey)}
                </text>
              </g>
            ))}

            {/* Render Bars and Error Bars */}
            {chartData.map((d, i) => {
              const xCenter = padding.left + i * colWidth + colWidth / 2;
              const yZero = getY(yMin);
              const yMean = getY(d.mu);

              // Bar dimensions
              const barX = xCenter - barWidth / 2;
              const barY = yMean;
              const barH = Math.max(yZero - yMean, 2); // At least 2px height for visual feedback

              // Error Bar positions (2 standard deviations)
              const yErrTop = getY(d.errHigh);
              const yErrBottom = getY(d.errLow);
              const capWidth = 8;

              const isHovered = hoveredTeam?.teamId === d.teamId;

              return (
                <g key={d.teamId}>
                  {/* Mean Bar */}
                  <rect
                    x={barX}
                    y={barY}
                    width={barWidth}
                    height={barH}
                    rx={4}
                    fill={d.isMyTeam
                      ? (isHovered ? 'url(#myTeamBarGradHover)' : 'url(#myTeamBarGrad)')
                      : (isHovered ? 'url(#normalBarGradHover)' : 'url(#normalBarGrad)')
                    }
                    className={`chart-bar ${d.isMyTeam ? 'my-team' : ''}`}
                  />

                  {/* Error Bar Line */}
                  {d.sigma > 0 && (
                    <g>
                      <line
                        x1={xCenter}
                        y1={yErrBottom}
                        x2={xCenter}
                        y2={yErrTop}
                        className="error-bar-line"
                      />
                      {/* Top Cap */}
                      <line
                        x1={xCenter - capWidth / 2}
                        y1={yErrTop}
                        x2={xCenter + capWidth / 2}
                        y2={yErrTop}
                        className="error-bar-cap"
                      />
                      {/* Bottom Cap */}
                      <line
                        x1={xCenter - capWidth / 2}
                        y1={yErrBottom}
                        x2={xCenter + capWidth / 2}
                        y2={yErrBottom}
                        className="error-bar-cap"
                      />
                    </g>
                  )}

                  {/* Team Tick Label (rotated for space) */}
                  <text
                    x={xCenter}
                    y={height - padding.bottom + 16}
                    textAnchor="end"
                    transform={`rotate(-25, ${xCenter}, ${height - padding.bottom + 16})`}
                    className={`team-tick-text ${d.isMyTeam ? 'my-team' : ''}`}
                    title={d.teamName}
                  >
                    {d.teamName.length > 12 ? d.teamName.substring(0, 10) + '..' : d.teamName}
                  </text>

                  {/* Interactive hover trigger zone for full column */}
                  <rect
                    x={padding.left + i * colWidth}
                    y={padding.top}
                    width={colWidth}
                    height={plotHeight}
                    className="interactive-trigger"
                    onMouseMove={(e) => handleMouseMove(e, d)}
                    onMouseLeave={handleMouseLeave}
                  />
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Hover Tooltip */}
      {hoveredTeam && (
        <div
          className="chart-tooltip"
          style={{
            left: `${tooltipPos.x}px`,
            top: `${tooltipPos.y}px`,
            opacity: 1,
            pointerEvents: 'none',
          }}
        >
          <div className="tooltip-header">
            <span className="tooltip-team-name">
              {hoveredTeam.teamName}
              {hoveredTeam.isMyTeam && (
                <span className="badge badge-green tooltip-team-badge">You</span>
              )}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <div className="tooltip-stat-row">
              <span className="tooltip-stat-label">Projected Total:</span>
              <span className="tooltip-stat-value">
                {formatMu(hoveredTeam.mu, activeCatKey)}
                {(activeCategory.derived === 'fg' || activeCategory.derived === 'ft') && hoveredTeam.rawProj?.totalAttempts > 0 && (
                  <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: '0.68rem' }}>
                    {' '}({hoveredTeam.rawProj.totalMakes.toFixed(1)}/{hoveredTeam.rawProj.totalAttempts.toFixed(1)})
                  </span>
                )}
              </span>
            </div>
            <div className="tooltip-stat-row">
              <span className="tooltip-stat-label">Std Dev (σ):</span>
              <span className="tooltip-stat-value">
                ±{formatMu(hoveredTeam.sigma, activeCatKey)}
              </span>
            </div>
            <div className="tooltip-stat-row" style={{ borderTop: '1px solid var(--border, rgba(255,255,255,0.08))', paddingTop: '0.3rem', marginTop: '0.1rem' }}>
              <span className="tooltip-stat-label">95.4% Range (±2σ):</span>
              <span className="tooltip-stat-value" style={{ fontSize: '0.7rem' }}>
                [{formatMu(hoveredTeam.errLow, activeCatKey)}, {formatMu(hoveredTeam.errHigh, activeCatKey)}]
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
