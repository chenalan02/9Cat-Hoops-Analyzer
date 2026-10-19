import { useState, useRef, useMemo } from 'react';
import { CATEGORIES } from '../utils/zScore.js';
import './TeamZScoreChart.css';

// Helper to determine CSS classes for player z-scores in the tooltip
function getZTagClass(z) {
  if (z === null || isNaN(z)) return 'z-tag-avg';
  if (z > 1.5) return 'z-tag-elite';
  if (z > 0.5) return 'z-tag-good';
  if (z > -0.5) return 'z-tag-avg';
  if (z > -1.5) return 'z-tag-poor';
  return 'z-tag-bad';
}

export default function TeamZScoreChart({ activePlayers = [] }) {
  const [hoveredCat, setHoveredCat] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  // Compute category averages and standard deviations
  const chartData = useMemo(() => {
    return CATEGORIES.map(cat => {
      // Get all active player z-scores for this category
      const playerScores = activePlayers
        .map(p => ({
          name: p.name,
          z: p.zScores?.[cat.key]
        }))
        .filter(item => item.z !== null && item.z !== undefined && !isNaN(item.z));

      const scoresOnly = playerScores.map(p => p.z);
      const count = scoresOnly.length;
      
      const mean = count ? scoresOnly.reduce((a, b) => a + b, 0) / count : 0;
      
      let stdDev = 0;
      if (count > 1) {
        const variance = scoresOnly.reduce((a, b) => a + (b - mean) ** 2, 0) / (count - 1);
        stdDev = Math.sqrt(variance);
      }

      // Sort players by z-score descending for tooltip display
      const sortedPlayers = [...playerScores].sort((a, b) => b.z - a.z);

      return {
        key: cat.key,
        label: cat.label,
        icon: cat.icon,
        mean,
        stdDev,
        players: sortedPlayers,
        count
      };
    });
  }, [activePlayers]);

  // Dimensions for SVG
  const width = 800;
  const height = 350;
  const padding = { top: 25, right: 30, bottom: 45, left: 45 };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Scale variables: Z-score range from -3.5 to +3.5
  const zMin = -3.5;
  const zMax = 3.5;

  const getY = (z) => {
    const clampedZ = Math.max(zMin, Math.min(zMax, z));
    const pct = (clampedZ - zMin) / (zMax - zMin);
    return height - padding.bottom - pct * plotHeight;
  };

  const colWidth = plotWidth / CATEGORIES.length;
  const barWidth = 32;

  // Handle tooltip tracking
  const handleMouseMove = (e, catData) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setTooltipPos({ x, y });
    setHoveredCat(catData);
  };

  const handleMouseLeave = () => {
    setHoveredCat(null);
  };

  // Generate grid values for z-score lines
  const gridLines = [-3, -2, -1, 0, 1, 2, 3];

  return (
    <div className="z-score-chart-card" ref={containerRef}>
      <div className="chart-header">
        <div className="chart-title-container">
          <h3 className="chart-title">Team Z-Score Profile</h3>
          <p className="chart-subtitle">Category strength (mean) & dispersion (standard dev.) among active players</p>
        </div>
        <div className="chart-legend">
          <div className="legend-item">
            <div className="legend-color" style={{ background: 'linear-gradient(180deg, #10b981, #059669)' }} />
            <span>Positive Z (Above League Avg)</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ background: 'linear-gradient(180deg, #ef4444, #dc2626)' }} />
            <span>Negative Z (Below League Avg)</span>
          </div>
          <div className="legend-item">
            <div className="legend-line" />
            <span>Std Dev (Player Variance)</span>
          </div>
        </div>
      </div>

      <div className="chart-wrapper">
        <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
          <defs>
            {/* Gradients */}
            <linearGradient id="posBarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#059669" stopOpacity="0.85" />
            </linearGradient>
            <linearGradient id="negBarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#dc2626" stopOpacity="0.85" />
            </linearGradient>
            <linearGradient id="posBarGradHover" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="1" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="1" />
            </linearGradient>
            <linearGradient id="negBarGradHover" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f87171" stopOpacity="1" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="1" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {gridLines.map(z => (
            <g key={z}>
              <line
                x1={padding.left}
                y1={getY(z)}
                x2={width - padding.right}
                y2={getY(z)}
                className={z === 0 ? 'baseline' : 'grid-line'}
              />
              <text
                x={padding.left - 10}
                y={getY(z) + 4}
                textAnchor="end"
                className="axis-text"
              >
                {z > 0 ? `+${z}.0` : z === 0 ? '0.0' : `${z}.0`}
              </text>
            </g>
          ))}

          {/* Render Bars and Error Bars */}
          {chartData.map((d, i) => {
            const xCenter = padding.left + i * colWidth + colWidth / 2;
            const yZero = getY(0);
            const yMean = getY(d.mean);

            // Bar dimensions
            const barX = xCenter - barWidth / 2;
            const barY = d.mean >= 0 ? yMean : yZero;
            const barH = Math.max(Math.abs(yMean - yZero), 2); // At least 2px height for visual feedback

            // Error Bar positions
            const yErrTop = getY(d.mean + d.stdDev);
            const yErrBottom = getY(d.mean - d.stdDev);
            const capWidth = 10;

            const isHovered = hoveredCat?.key === d.key;

            return (
              <g key={d.key}>
                {/* Mean Bar */}
                <rect
                  x={barX}
                  y={barY}
                  width={barWidth}
                  height={barH}
                  rx={4}
                  fill={d.mean >= 0 
                    ? (isHovered ? 'url(#posBarGradHover)' : 'url(#posBarGrad)') 
                    : (isHovered ? 'url(#negBarGradHover)' : 'url(#negBarGrad)')
                  }
                  className="chart-bar"
                />

                {/* Error Bar Line */}
                {d.stdDev > 0 && (
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

                {/* Category Icon & Label under columns */}
                <text
                  x={xCenter}
                  y={height - padding.bottom + 20}
                  className="cat-label"
                >
                  {d.icon} {d.key}
                </text>

                {/* Invisible hover trigger zone for full column */}
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
      </div>

      {/* Hover Tooltip */}
      {hoveredCat && (
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
            <span className="tooltip-cat">{hoveredCat.icon} {hoveredCat.label}</span>
          </div>
          <div className="tooltip-stats">
            <div>Average Z: <strong>{hoveredCat.mean >= 0 ? '+' : ''}{hoveredCat.mean.toFixed(2)}</strong></div>
            <div>Std Dev (Spread): <strong>±{hoveredCat.stdDev.toFixed(2)}</strong></div>
          </div>
          <div className="player-list">
            {hoveredCat.players.map(p => (
              <div className="player-row" key={p.name}>
                <span className="player-name">{p.name}</span>
                <span className={`player-z ${getZTagClass(p.z)}`}>
                  {p.z >= 0 ? '+' : ''}{p.z.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
