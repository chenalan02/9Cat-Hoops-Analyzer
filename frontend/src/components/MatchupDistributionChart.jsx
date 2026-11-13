import { useMemo } from 'react';
import { CATEGORIES } from '../utils/zScore.js';
import { formatMu, formatPct } from '../utils/formatters.js';
import './MatchupDistributionChart.css';

const PDF = (x, mu, sigma) => {
  if (sigma <= 0) return 0;
  return (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - mu) / sigma) ** 2);
};

export default function MatchupDistributionChart({
  category,
  my,
  opp,
  winProb,
  onSelectCategory = null,
}) {
  const width = 760;
  const height = 270;
  const padding = { top: 48, right: 36, bottom: 38, left: 36 };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const mySigma = Math.max(my.sigma || 0, 1e-4);
  const oppSigma = Math.max(opp.sigma || 0, 1e-4);

  // Compute stats and path data
  const {
    myFillPath,
    oppFillPath,
    xTicks,
    myMuX,
    oppMuX,
    myLabelY,
    oppLabelY,
  } = useMemo(() => {
    const minX = Math.min(my.mu - 3.5 * mySigma, opp.mu - 3.5 * oppSigma);
    const maxX = Math.max(my.mu + 3.5 * mySigma, opp.mu + 3.5 * oppSigma);
    const rangeX = maxX - minX || 1;

    const maxPdfMy = 1 / (mySigma * Math.sqrt(2 * Math.PI) || 1);
    const maxPdfOpp = 1 / (oppSigma * Math.sqrt(2 * Math.PI) || 1);
    const maxPdf = Math.max(maxPdfMy, maxPdfOpp) || 1;

    const getX = (x) => padding.left + ((x - minX) / rangeX) * plotWidth;
    const getY = (y) => height - padding.bottom - (y / maxPdf) * plotHeight;

    const numPoints = 120;
    const myPoints = [];
    const oppPoints = [];

    for (let i = 0; i <= numPoints; i++) {
      const xVal = minX + (i / numPoints) * rangeX;
      const yValMy = PDF(xVal, my.mu, mySigma);
      const yValOpp = PDF(xVal, opp.mu, oppSigma);

      myPoints.push({ x: getX(xVal), y: getY(yValMy) });
      oppPoints.push({ x: getX(xVal), y: getY(yValOpp) });
    }

    const buildPath = (pts) =>
      pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const buildFillPath = (pts) => {
      const lineStr = buildPath(pts);
      const startX = pts[0].x.toFixed(1);
      const endX = pts[pts.length - 1].x.toFixed(1);
      const bottomY = (height - padding.bottom).toFixed(1);
      return `${lineStr} L ${endX} ${bottomY} L ${startX} ${bottomY} Z`;
    };

    const ticks = [];
    for (let i = 0; i < 5; i++) {
      const val = minX + (i / 4) * rangeX;
      ticks.push({
        val,
        x: getX(val),
      });
    }

    const mX = getX(my.mu);
    const oX = getX(opp.mu);
    const tooClose = Math.abs(mX - oX) < 110;

    return {
      myFillPath: buildFillPath(myPoints),
      oppFillPath: buildFillPath(oppPoints),
      xTicks: ticks,
      myMuX: mX,
      oppMuX: oX,
      myLabelY: tooClose ? padding.top - 26 : padding.top - 15,
      oppLabelY: tooClose ? padding.top - 11 : padding.top - 15,
    };
  }, [my.mu, opp.mu, mySigma, oppSigma, plotWidth, plotHeight]);

  const color = winProb >= 0.6 ? 'var(--accent, #10b981)'
              : winProb >= 0.4 ? '#fbbf24'
              : '#ef4444';

  const isTurnovers = category.key === 'TO';
  const isFavorable = isTurnovers ? my.mu < opp.mu : my.mu > opp.mu;
  const marginText = useMemo(() => {
    if (category.derived) {
      const diff = (my.mu - opp.mu) * 100;
      return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
    }
    if (isTurnovers) {
      const diff = Math.abs(my.mu - opp.mu);
      if (my.mu === opp.mu) return '0.0 TO';
      return my.mu < opp.mu ? `-${diff.toFixed(1)} TO` : `+${diff.toFixed(1)} TO`;
    }
    const diff = my.mu - opp.mu;
    return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} ${category.key}`;
  }, [category, my.mu, opp.mu, isTurnovers]);

  return (
    <div className="matchup-dist-card">
      {onSelectCategory && (
        <div className="dist-cat-pills" role="tablist" aria-label="Select category distribution">
          {CATEGORIES.map(c => (
            <button
              key={c.key}
              type="button"
              className={`dist-cat-pill ${c.key === category.key ? 'active' : ''}`}
              onClick={() => onSelectCategory(c.key)}
            >
              {c.key}
            </button>
          ))}
        </div>
      )}

      <div className="dist-header">
        <div className="dist-title-container">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <h3 className="dist-title">{category.icon} {category.label} Probability Distribution</h3>
            {isTurnovers && (
              <span className="badge badge-orange" style={{ fontSize: '0.68rem' }}>Lower is Better</span>
            )}
          </div>
          <p className="dist-subtitle">
            Overlapping weekly outcome curves based on projected mean (μ) and game-to-game volatility (σ)
          </p>
        </div>

        <div className="dist-win-Highlight">
          <span className="dist-win-pct" style={{ color }}>{formatPct(winProb)}</span>
          <span className="dist-win-lbl">Category Win Chance</span>
        </div>
      </div>

      {/* Head-to-Head Summary Strip */}
      <div className="dist-stats-strip">
        <div className="dist-stat-box you">
          <div className="dsb-header">
            <span className="dist-legend-dot you" />
            <span>Your Projection</span>
          </div>
          <div className="dsb-main">{formatMu(my.mu, category.key)}</div>
          <div className="dsb-sub">
            ± {category.derived ? `${(my.sigma * 100).toFixed(1)}%` : my.sigma.toFixed(1)} σ (1 SD range)
          </div>
        </div>

        <div className="dist-stat-box opp">
          <div className="dsb-header">
            <span className="dist-legend-dot opp" />
            <span>Opponent Projection</span>
          </div>
          <div className="dsb-main">{formatMu(opp.mu, category.key)}</div>
          <div className="dsb-sub">
            ± {category.derived ? `${(opp.sigma * 100).toFixed(1)}%` : opp.sigma.toFixed(1)} σ (1 SD range)
          </div>
        </div>

        <div className="dist-stat-box margin">
          <div className="dsb-header">
            <span>Expected Margin</span>
          </div>
          <div
            className="dsb-main"
            style={{ color: my.mu === opp.mu ? 'var(--text-secondary)' : isFavorable ? '#4ade80' : '#f87171' }}
          >
            {marginText}
          </div>
          <div className="dsb-sub">
            {winProb >= 0.65 ? 'Strong Advantage' : winProb >= 0.45 && winProb <= 0.55 ? 'Toss-Up Swing Battle' : isFavorable ? 'Slight Edge' : 'Trailing'}
          </div>
        </div>
      </div>

      <div className="dist-chart-wrapper">
        <svg viewBox={`0 0 ${width} ${height}`} className="dist-chart-svg">
          <defs>
            <linearGradient id="myCurveGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="oppCurveGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.02" />
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
            y1={padding.top - 8}
            x2={oppMuX}
            y2={height - padding.bottom}
            className="mean-line-opp"
          />
          <text
            x={oppMuX}
            y={oppLabelY}
            textAnchor="middle"
            className="mean-label-opp"
          >
            Opp μ ({formatMu(opp.mu, category.key)})
          </text>

          <line
            x1={myMuX}
            y1={padding.top - 8}
            x2={myMuX}
            y2={height - padding.bottom}
            className="mean-line-my"
          />
          <text
            x={myMuX}
            y={myLabelY}
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
