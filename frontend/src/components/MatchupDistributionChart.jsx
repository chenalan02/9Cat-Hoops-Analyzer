import { useMemo } from 'react';
import { formatMu, formatPct } from '../utils/formatters.js';
import './MatchupDistributionChart.css';

const PDF = (x, mu, sigma) => {
  if (sigma <= 0) return 0;
  return (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - mu) / sigma) ** 2);
};

export default function MatchupDistributionChart({ category, my, opp, winProb }) {
  const width = 800;
  const height = 280;
  const padding = { top: 40, right: 40, bottom: 40, left: 40 };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Compute stats and path data
  const {
    myPath,
    myFillPath,
    oppPath,
    oppFillPath,
    xTicks,
    myMuX,
    oppMuX
  } = useMemo(() => {
    // Generate ranges covering +- 3.5 standard deviations
    const minX = Math.min(my.mu - 3.5 * my.sigma, opp.mu - 3.5 * opp.sigma);
    const maxX = Math.max(my.mu + 3.5 * my.sigma, opp.mu + 3.5 * opp.sigma);
    const rangeX = maxX - minX || 1;

    // Normalize Y coordinates based on maximum peak height
    const maxPdfMy = 1 / (my.sigma * Math.sqrt(2 * Math.PI) || 1);
    const maxPdfOpp = 1 / (opp.sigma * Math.sqrt(2 * Math.PI) || 1);
    const maxPdf = Math.max(maxPdfMy, maxPdfOpp) || 1;

    const getX = (x) => padding.left + ((x - minX) / rangeX) * plotWidth;
    const getY = (y) => height - padding.bottom - (y / maxPdf) * plotHeight;

    // Generate path points
    const numPoints = 120;
    const myPoints = [];
    const oppPoints = [];

    for (let i = 0; i <= numPoints; i++) {
      const xVal = minX + (i / numPoints) * rangeX;
      const yValMy = PDF(xVal, my.mu, my.sigma);
      const yValOpp = PDF(xVal, opp.mu, opp.sigma);

      myPoints.push({ x: getX(xVal), y: getY(yValMy) });
      oppPoints.push({ x: getX(xVal), y: getY(yValOpp) });
    }

    // Build SVG paths
    const buildPath = (pts) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const buildFillPath = (pts) => {
      const lineStr = buildPath(pts);
      const startX = pts[0].x.toFixed(1);
      const endX = pts[pts.length - 1].x.toFixed(1);
      const bottomY = (height - padding.bottom).toFixed(1);
      return `${lineStr} L ${endX} ${bottomY} L ${startX} ${bottomY} Z`;
    };

    // 5 X-Axis ticks
    const ticks = [];
    for (let i = 0; i < 5; i++) {
      const val = minX + (i / 4) * rangeX;
      ticks.push({
        val,
        x: getX(val)
      });
    }

    return {
      myPath: buildPath(myPoints),
      myFillPath: buildFillPath(myPoints),
      oppPath: buildPath(oppPoints),
      oppFillPath: buildFillPath(oppPoints),
      xTicks: ticks,
      myMuX: getX(my.mu),
      oppMuX: getX(opp.mu)
    };
  }, [my, opp, plotWidth, plotHeight]);

  const color = winProb >= 0.6 ? 'var(--accent, #10b981)'
              : winProb >= 0.4 ? 'var(--text-secondary, #9ca3af)'
              : '#ef4444';

  return (
    <div className="matchup-dist-card">
      <div className="dist-header">
        <div className="dist-title-container">
          <h3 className="dist-title">{category.label} Probability Distribution</h3>
          <p className="dist-subtitle">
            Expected weekly performance curves (Win Probability: <strong style={{ color }}>{formatPct(winProb)}</strong>)
          </p>
        </div>
        <div className="dist-legend">
          <div className="dist-legend-item">
            <div className="dist-legend-color" style={{ borderColor: '#10b981', background: 'rgba(16, 185, 129, 0.12)' }} />
            <span>You (Expected: {formatMu(my.mu, category.key)})</span>
          </div>
          <div className="dist-legend-item">
            <div className="dist-legend-color" style={{ borderColor: '#ef4444', background: 'rgba(239, 68, 68, 0.12)' }} />
            <span>Opponent (Expected: {formatMu(opp.mu, category.key)})</span>
          </div>
        </div>
      </div>

      <div className="dist-chart-wrapper">
        <svg viewBox={`0 0 ${width} ${height}`} className="dist-chart-svg">
          <defs>
            {/* Fills */}
            <linearGradient id="myCurveGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="oppCurveGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid vertical lines */}
          {xTicks.map((t, idx) => (
            <g key={idx}>
              <line
                x1={t.x}
                y1={padding.top}
                x2={t.x}
                y2={height - padding.bottom}
                className="dist-grid-line"
              />
              <text
                x={t.x}
                y={height - padding.bottom + 18}
                textAnchor="middle"
                className="dist-axis-text"
              >
                {formatMu(t.val, category.key)}
              </text>
            </g>
          ))}

          {/* Curves */}
          <path d={oppFillPath} className="curve-path-opp" />
          <path d={myFillPath} className="curve-path-my" />

          {/* Mean indicators */}
          <line
            x1={oppMuX}
            y1={padding.top - 10}
            x2={oppMuX}
            y2={height - padding.bottom}
            className="mean-line-opp"
          />
          <text
            x={oppMuX}
            y={padding.top - 15}
            textAnchor="middle"
            className="mean-label-opp"
          >
            Opp μ ({formatMu(opp.mu, category.key)})
          </text>

          <line
            x1={myMuX}
            y1={padding.top - 10}
            x2={myMuX}
            y2={height - padding.bottom}
            className="mean-line-my"
          />
          <text
            x={myMuX}
            y={padding.top - 15}
            textAnchor="middle"
            className="mean-label-my"
          >
            You μ ({formatMu(my.mu, category.key)})
          </text>

          {/* Bottom X-axis line */}
          <line
            x1={padding.left}
            y1={height - padding.bottom}
            x2={width - padding.right}
            y2={height - padding.bottom}
            className="dist-axis-line"
          />
        </svg>
      </div>
    </div>
  );
}
