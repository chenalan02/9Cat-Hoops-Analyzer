import { useState, useEffect, useMemo } from 'react';
import { fetchPlayerGameLogs } from '../services/apiClient.js';
import {
  CATEGORIES,
  getPlayerZScore,
  zScoreClass,
  zScoreBgClass,
} from '../utils/zScore.js';
import { formatZ } from '../utils/formatters.js';
import './PlayerGameLogModal.css';

const _gameLogsCache = new Map();

const SPLIT_ROWS = [
  { key: 'season', label: 'Season' },
  { key: 'last_15', label: 'Last 15' },
  { key: 'last_7', label: 'Last 7' },
  { key: 'last_3', label: 'Last 3' },
];

const CHART_STATS = [
  { key: 'pts', label: 'PTS' },
  { key: 'min', label: 'MIN' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'fg3m', label: '3PM' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'fg_pct', label: 'FG%', isPct: true },
  { key: 'ft_pct', label: 'FT%', isPct: true },
  { key: 'tov', label: 'TO', lowerBetter: true },
  { key: 'plus_minus', label: '+/-', signed: true },
];

const WINDOW_OPTIONS = [
  { id: 'all', label: 'All Games', count: null },
  { id: 'l15', label: 'Last 15', count: 15 },
  { id: 'l7', label: 'Last 7', count: 7 },
  { id: 'l5', label: 'Last 5', count: 5 },
];

function formatSplitPct(pctVal) {
  if (pctVal == null || Number.isNaN(pctVal)) return '—';
  return `${(Number(pctVal) * 100).toFixed(1)}%`;
}

function formatChartValue(val, statMeta) {
  if (val == null || Number.isNaN(val)) return '—';
  if (statMeta?.isPct) return `${(Number(val) * 100).toFixed(1)}%`;
  if (statMeta?.signed) {
    const n = Number(val);
    return n > 0 ? `+${Number.isInteger(n) ? n : n.toFixed(1)}` : `${Number.isInteger(n) ? n : n.toFixed(1)}`;
  }
  const n = Number(val);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function initialsFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function PlayerGameLogModal({
  player,
  statsSource = 'ema',
  puntedCats = new Set(),
  onClose,
}) {
  const [logData, setLogData] = useState(() =>
    player?.name ? (_gameLogsCache.get(player.name) ?? null) : null
  );
  const [loading, setLoading] = useState(() => Boolean(player?.name && !_gameLogsCache.has(player.name)));
  const [error, setError] = useState('');
  const [chartStat, setChartStat] = useState('pts');
  const [windowId, setWindowId] = useState('l15');
  const [oppQuery, setOppQuery] = useState('');
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
    setHoveredIdx(null);
    setOppQuery('');
  }, [player?.name]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const name = player?.name;
    if (!name) return;
    if (_gameLogsCache.has(name)) {
      setLogData(_gameLogsCache.get(name));
      setLoading(false);
      setError('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');
    fetchPlayerGameLogs(name)
      .then((res) => {
        if (cancelled) return;
        _gameLogsCache.set(name, res);
        setLogData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'Unable to load player game logs.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [player?.name]);

  const logs = logData?.logs ?? [];
  const splits = logData?.splits ?? {};
  const consistency = logData?.consistency ?? {};

  const activeWindowOption = WINDOW_OPTIONS.find(w => w.id === windowId) || WINDOW_OPTIONS[0];
  const windowedLogs = useMemo(() => {
    const base = activeWindowOption.count ? logs.slice(0, activeWindowOption.count) : logs;
    const q = oppQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter(row =>
      String(row.matchup || '').toLowerCase().includes(q)
      || String(row.opponent || '').toLowerCase().includes(q)
      || String(row.game_date || '').toLowerCase().includes(q)
    );
  }, [logs, activeWindowOption.count, oppQuery]);

  const chartStatMeta = CHART_STATS.find(s => s.key === chartStat) || CHART_STATS[0];
  const chartGames = useMemo(() => {
    const base = activeWindowOption.count ? logs.slice(0, activeWindowOption.count) : logs;
    // Reverse to chronological order (oldest -> newest) for chart reading left-to-right
    return [...base].reverse();
  }, [logs, activeWindowOption.count]);

  const seasonAvgForChart = useMemo(() => {
    const seasonSplit = splits?.season;
    if (!seasonSplit) return null;
    if (chartStat === 'fg_pct') return seasonSplit.fg_pct ?? null;
    if (chartStat === 'ft_pct') return seasonSplit.ft_pct ?? null;
    return seasonSplit[chartStat] ?? null;
  }, [splits, chartStat]);

  if (!player) return null;

  const activeZ = player.zSum ?? player.z_total ?? null;
  const yahooRank = player.yahoo_rank ?? player.yahoo_orank ?? null;
  const yahooLabel = player.yahoo_rank ? `Y! #${player.yahoo_rank}` : (player.yahoo_orank ? `Y! O#${player.yahoo_orank}` : null);
  const statusUpper = String(player.status || '').toUpperCase();
  const isOutStatus = ['O', 'INJ', 'OUT', 'IL', 'IL+', 'IR', 'IR+', 'SUSP'].includes(statusUpper);

  const ownerType = player.ownerType || (player.isMyTeam ? 'mine' : (player.ownerName && player.ownerName !== 'Free Agent' ? 'rostered' : (player.ownerName === 'Free Agent' ? 'fa' : null)));

  const renderChart = () => {
    if (!chartGames.length) return null;
    const values = chartGames.map(g => {
      const raw = g[chartStat];
      return raw == null ? null : Number(raw);
    });
    const validVals = values.filter(v => v != null && !Number.isNaN(v));
    if (!validVals.length) return null;

    const avgVal = seasonAvgForChart ?? (validVals.reduce((a, b) => a + b, 0) / validVals.length);
    const isSigned = Boolean(chartStatMeta.signed);
    const rawMin = isSigned ? Math.min(0, ...validVals, avgVal ?? 0) : 0;
    const rawMax = Math.max(...validVals, avgVal ?? 0, chartStatMeta.isPct ? 1.0 : 1);
    const span = Math.max(rawMax - rawMin, 0.001);
    const yMin = isSigned ? rawMin - span * 0.08 : 0;
    const yMax = rawMax + span * 0.1;
    const totalSpan = Math.max(yMax - yMin, 0.001);

    const W = 680;
    const H = 164;
    const padL = 38;
    const padR = 12;
    const padT = 14;
    const padB = 26;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const yToPx = v => padT + ((yMax - v) / totalSpan) * plotH;
    const zeroY = yToPx(0);
    const avgY = avgVal != null ? yToPx(avgVal) : null;
    const step = plotW / chartGames.length;
    const barW = Math.max(4, Math.min(28, step * 0.68));
    const hoveredGame = hoveredIdx != null ? chartGames[hoveredIdx] : null;
    const hoveredVal = hoveredIdx != null ? values[hoveredIdx] : null;

    return (
      <div className="pgl-chart-card">
        <div className="pgl-chart-top">
          <div className="pgl-chart-pills" role="tablist" aria-label="Chart statistic">
            {CHART_STATS.map(st => (
              <button
                key={st.key}
                type="button"
                className={`pgl-chart-pill ${chartStat === st.key ? 'active' : ''}`}
                onClick={() => setChartStat(st.key)}
              >
                {st.label}
              </button>
            ))}
          </div>

          <div className="pgl-chart-readout">
            {hoveredGame ? (
              <span>
                <strong>{hoveredGame.game_date}</strong> · {hoveredGame.matchup || hoveredGame.opponent} ({hoveredGame.wl || '—'}):{' '}
                <strong className="accent">{formatChartValue(hoveredVal, chartStatMeta)}</strong>
              </span>
            ) : (
              <span>
                Season Avg: <strong>{formatChartValue(avgVal, chartStatMeta)}</strong>
                <span className="pgl-chart-hint"> · Hover bar for game details</span>
              </span>
            )}
          </div>
        </div>

        <div className="pgl-chart-svg-wrap">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="pgl-chart-svg"
            onMouseLeave={() => setHoveredIdx(null)}
            role="img"
            aria-label={`${player.name} ${chartStatMeta.label} game log chart`}
          >
            {/* Zero baseline */}
            <line
              x1={padL}
              x2={W - padR}
              y1={isSigned ? zeroY : padT + plotH}
              y2={isSigned ? zeroY : padT + plotH}
              stroke="rgba(255,255,255,0.14)"
              strokeWidth="1"
            />
            <text x={padL - 6} y={padT + 8} textAnchor="end" className="pgl-axis-lbl">
              {formatChartValue(yMax, chartStatMeta)}
            </text>
            <text x={padL - 6} y={padT + plotH} textAnchor="end" className="pgl-axis-lbl">
              {formatChartValue(yMin, chartStatMeta)}
            </text>

            {avgY != null && (
              <>
                <line
                  x1={padL}
                  x2={W - padR}
                  y1={avgY}
                  y2={avgY}
                  stroke="rgba(56, 189, 248, 0.75)"
                  strokeWidth="1.25"
                  strokeDasharray="4 3"
                />
                <text x={W - padR - 2} y={Math.max(padT + 10, avgY - 4)} textAnchor="end" className="pgl-avg-lbl">
                  Avg {formatChartValue(avgVal, chartStatMeta)}
                </text>
              </>
            )}

            {chartGames.map((game, i) => {
              const v = values[i];
              const cx = padL + i * step + step / 2;
              const x = cx - barW / 2;
              if (v == null || Number.isNaN(v)) {
                return null;
              }
              const baseLineY = isSigned ? zeroY : padT + plotH;
              const valY = yToPx(v);
              const rectY = Math.min(valY, baseLineY);
              const rectH = Math.max(2, Math.abs(baseLineY - valY));
              const isAbove = avgVal != null
                ? (chartStatMeta.lowerBetter ? v <= avgVal : v >= avgVal)
                : true;
              const isHov = hoveredIdx === i;
              const fill = isAbove
                ? (isHov ? '#34d399' : 'rgba(0, 230, 118, 0.72)')
                : (isHov ? '#fb923c' : 'rgba(148, 163, 184, 0.45)');

              const showXTick =
                chartGames.length <= 12
                || i === 0
                || i === chartGames.length - 1
                || i % Math.ceil(chartGames.length / 6) === 0;

              return (
                <g
                  key={`${game.game_id || game.game_date}-${i}`}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onClick={() => setHoveredIdx(i)}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    x={padL + i * step}
                    y={padT}
                    width={step}
                    height={plotH}
                    fill="transparent"
                  />
                  <rect
                    x={x}
                    y={rectY}
                    width={barW}
                    height={rectH}
                    rx={Math.min(3, barW / 3)}
                    fill={fill}
                  />
                  {showXTick && (
                    <text x={cx} y={H - 8} textAnchor="middle" className="pgl-axis-lbl">
                      {String(game.game_date || '').slice(5)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <div className="pgl-consistency-strip">
          {consistency.pts_high != null && (
            <span className="pgl-metric-chip">
              PTS Range: <strong>{consistency.pts_low}–{consistency.pts_high}</strong>
              {consistency.pts_std != null && ` (σ ${consistency.pts_std})`}
            </span>
          )}
          {consistency.min_high != null && (
            <span className="pgl-metric-chip">
              MIN Range: <strong>{consistency.min_low}–{consistency.min_high}</strong>
              {consistency.games_30_plus_min_pct != null && ` (${Math.round(consistency.games_30_plus_min_pct * 100)}% 30+m)`}
            </span>
          )}
          {(consistency.double_doubles > 0 || consistency.triple_doubles > 0) && (
            <span className="pgl-metric-chip">
              DD / TD: <strong>{consistency.double_doubles}</strong> / <strong>{consistency.triple_doubles}</strong>
            </span>
          )}
          {consistency.home_pts != null && consistency.away_pts != null && (
            <span className="pgl-metric-chip">
              Home/Away PTS: <strong>{consistency.home_pts}</strong> / <strong>{consistency.away_pts}</strong>
            </span>
          )}
          {(consistency.wins > 0 || consistency.losses > 0) && (
            <span className="pgl-metric-chip">
              W–L in GP: <strong>{consistency.wins}–{consistency.losses}</strong>
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="pgl-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${player.name} profile and game logs`}
    >
      <div className="pgl-modal fade-up">
        <button
          type="button"
          className="pgl-close-btn"
          onClick={onClose}
          aria-label="Close player game logs modal"
        >
          ✕
        </button>

        {/* 1. Header */}
        <div className="pgl-header">
          <div className="pgl-avatar-wrap">
            {player.photo_url && !imgError ? (
              <img
                src={player.photo_url}
                alt={player.name}
                className="pgl-avatar-img"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="pgl-avatar-fallback">{initialsFromName(player.name)}</div>
            )}
          </div>

          <div className="pgl-header-main">
            <div className="pgl-title-row">
              <h2 className="pgl-player-name">{player.name}</h2>
              {player.status && (
                <span className={`status-tag ${isOutStatus ? 'status-il' : 'status-q'}`}>
                  {player.status}
                </span>
              )}
              {ownerType === 'mine' && (
                <span className="pgl-owner-pill mine">★ My Team ({player.ownerName})</span>
              )}
              {ownerType === 'rostered' && (
                <span className="pgl-owner-pill rostered">{player.ownerName}</span>
              )}
              {ownerType === 'fa' && (
                <span className="pgl-owner-pill fa">Free Agent</span>
              )}
            </div>

            <div className="pgl-meta-row">
              {player.nba_team && <span className="pgl-meta-item">{player.nba_team}</span>}
              {player.positions && <span className="pgl-meta-item">{player.positions}</span>}
              {player.selected_position && (
                <span className="pgl-meta-item">Slot: {player.selected_position}</span>
              )}
              {player.rank != null && (
                <span className="pgl-meta-badge">
                  Rank #{player.rank}
                  {puntedCats.size > 0 && player.baseRank && player.baseRank !== player.rank
                    ? ` (9-cat #${player.baseRank})`
                    : ''}
                </span>
              )}
              {yahooLabel && yahooRank && (
                <span className="pgl-meta-badge yahoo">{yahooLabel}</span>
              )}
              {activeZ != null && (
                <span className={`pgl-meta-badge ${activeZ >= 0 ? 'good' : 'bad'}`}>
                  ΣZ {formatZ(activeZ)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 2. 9-Cat Z-Score Profile Strip */}
        <div className="pgl-z-strip">
          {CATEGORIES.map(cat => {
            const zVal = player.zScores?.[cat.key] ?? getPlayerZScore(player, cat, statsSource);
            const isPunted = puntedCats.has(cat.key);
            return (
              <div
                key={cat.key}
                className={`pgl-z-tile ${zScoreBgClass(zVal)} ${isPunted ? 'punted' : ''}`}
                title={`${cat.label}: z = ${formatZ(zVal)}${isPunted ? ' (Punted)' : ''}`}
              >
                <span className="pgl-z-cat">{cat.key}</span>
                <span className={`pgl-z-val ${zScoreClass(zVal)}`}>{formatZ(zVal)}</span>
              </div>
            );
          })}
        </div>

        {/* Body Content: Splits, Chart, Box Scores */}
        {loading ? (
          <div className="pgl-state-box">
            <span className="spinner" style={{ width: 26, height: 26 }} />
            <span>Loading {player.name}&apos;s game logs…</span>
          </div>
        ) : error ? (
          <div className="pgl-state-box error">
            <span>⚠️ {error}</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="pgl-state-box">
            <span>No logged regular-season NBA games found yet for {player.name}.</span>
          </div>
        ) : (
          <div className="pgl-sections">
            {/* 3. Season vs Recent Splits Table */}
            <div className="pgl-block">
              <div className="pgl-block-header">
                <h3>Season vs. Recent Splits</h3>
                <span className="pgl-block-sub">
                  {logData.total_games} game{logData.total_games !== 1 ? 's' : ''} logged
                </span>
              </div>
              <div className="pgl-table-wrap">
                <table className="data-table pgl-table pgl-splits-table">
                  <thead>
                    <tr>
                      <th>Window</th>
                      <th>GP</th>
                      <th>MIN</th>
                      <th>PTS</th>
                      <th>REB</th>
                      <th>AST</th>
                      <th>STL</th>
                      <th>BLK</th>
                      <th>3PM</th>
                      <th>FG%</th>
                      <th>FT%</th>
                      <th>TO</th>
                      <th>+/-</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SPLIT_ROWS.map(({ key, label }) => {
                      const sp = splits[key];
                      const base = splits.season;
                      if (!sp) return null;
                      const minDelta = key !== 'season' && base ? sp.min - base.min : 0;
                      const ptsDelta = key !== 'season' && base ? sp.pts - base.pts : 0;
                      return (
                        <tr key={key} className={key === 'season' ? 'pgl-season-row' : ''}>
                          <td className="pgl-win-label">{label}</td>
                          <td>{sp.gp}</td>
                          <td>
                            <span>{sp.min.toFixed(1)}</span>
                            {Math.abs(minDelta) >= 2.0 && (
                              <span className={`pgl-inline-delta ${minDelta > 0 ? 'up' : 'down'}`}>
                                {minDelta > 0 ? `+${minDelta.toFixed(1)}` : minDelta.toFixed(1)}
                              </span>
                            )}
                          </td>
                          <td>
                            <span>{sp.pts.toFixed(1)}</span>
                            {Math.abs(ptsDelta) >= 2.5 && (
                              <span className={`pgl-inline-delta ${ptsDelta > 0 ? 'up' : 'down'}`}>
                                {ptsDelta > 0 ? `+${ptsDelta.toFixed(1)}` : ptsDelta.toFixed(1)}
                              </span>
                            )}
                          </td>
                          <td>{sp.reb.toFixed(1)}</td>
                          <td>{sp.ast.toFixed(1)}</td>
                          <td>{sp.stl.toFixed(1)}</td>
                          <td>{sp.blk.toFixed(1)}</td>
                          <td>{sp.fg3m.toFixed(1)}</td>
                          <td>
                            <div>{formatSplitPct(sp.fg_pct)}</div>
                            <div className="pgl-sub-split">{sp.fgm.toFixed(1)}/{sp.fga.toFixed(1)}</div>
                          </td>
                          <td>
                            <div>{formatSplitPct(sp.ft_pct)}</div>
                            <div className="pgl-sub-split">{sp.ftm.toFixed(1)}/{sp.fta.toFixed(1)}</div>
                          </td>
                          <td>{sp.tov.toFixed(1)}</td>
                          <td>
                            {sp.plus_minus != null
                              ? `${sp.plus_minus > 0 ? '+' : ''}${sp.plus_minus.toFixed(1)}`
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 4. Interactive Trend Chart */}
            {renderChart()}

            {/* 5. Game-by-Game Box Score Table */}
            <div className="pgl-block">
              <div className="pgl-block-header">
                <h3>Game-by-Game Box Scores</h3>
                <div className="pgl-logs-controls">
                  <div className="pgl-window-pills">
                    {WINDOW_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`pgl-window-btn ${windowId === opt.id ? 'active' : ''}`}
                        onClick={() => setWindowId(opt.id)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="search"
                    value={oppQuery}
                    onChange={(e) => setOppQuery(e.target.value)}
                    placeholder="Filter opp or date…"
                    className="pgl-opp-input"
                    aria-label="Filter game logs by opponent or date"
                  />
                </div>
              </div>

              <div className="pgl-table-wrap pgl-logs-scroll">
                <table className="data-table pgl-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Matchup</th>
                      <th>W/L</th>
                      <th>MIN</th>
                      <th>PTS</th>
                      <th>REB</th>
                      <th>AST</th>
                      <th>STL</th>
                      <th>BLK</th>
                      <th>3PM</th>
                      <th>FG</th>
                      <th>FT</th>
                      <th>TO</th>
                      <th>+/-</th>
                    </tr>
                  </thead>
                  <tbody>
                    {windowedLogs.map((g, idx) => (
                      <tr key={`${g.game_id || g.game_date}-${idx}`}>
                        <td className="pgl-date-cell">{g.game_date}</td>
                        <td className="pgl-matchup-cell">
                          <span>{g.matchup || g.opponent || '—'}</span>
                          {g.triple_double ? (
                            <span className="pgl-award-tag td" title="Triple-Double">TD</span>
                          ) : g.double_double ? (
                            <span className="pgl-award-tag dd" title="Double-Double">DD</span>
                          ) : null}
                        </td>
                        <td>
                          {g.wl && (
                            <span className={`pgl-wl-tag ${g.wl === 'W' ? 'win' : 'loss'}`}>
                              {g.wl}
                            </span>
                          )}
                        </td>
                        <td>{g.min}</td>
                        <td className="pgl-pts-cell">{g.pts}</td>
                        <td>{g.reb}</td>
                        <td>{g.ast}</td>
                        <td>{g.stl}</td>
                        <td>{g.blk}</td>
                        <td>{g.fg3m}</td>
                        <td>
                          <span>{g.fgm}-{g.fga}</span>
                          {g.fg_pct != null && (
                            <span className="pgl-pct-inline"> ({formatSplitPct(g.fg_pct)})</span>
                          )}
                        </td>
                        <td>
                          <span>{g.ftm}-{g.fta}</span>
                          {g.ft_pct != null && (
                            <span className="pgl-pct-inline"> ({formatSplitPct(g.ft_pct)})</span>
                          )}
                        </td>
                        <td>{g.tov}</td>
                        <td>
                          {g.plus_minus != null ? (
                            <span className={g.plus_minus > 0 ? 'z-good' : g.plus_minus < 0 ? 'z-poor' : ''}>
                              {g.plus_minus > 0 ? `+${g.plus_minus}` : g.plus_minus}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
