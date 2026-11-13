function ShootingEfficiencyTile({
  label,
  unit,
  isContested,
  vsDrop,
  diffPct,
  pickPct,
  pickMakes,
  pickAtt,
  dropPct,
  dropMakes,
  dropAtt,
  diffAtt,
}) {
  return (
    <div className={`sc-eff-tile ${isContested ? 'contested' : ''}`}>
      <div className="sc-eff-tile-hdr">
        <div className="sc-eff-hdr-left">
          <span className="sc-eff-tile-name">{label}</span>
          {isContested && <span className="sc-eff-swing-bolt" title="Contested Matchup Category">⚡</span>}
        </div>
        {vsDrop && (
          <span className={`sc-eff-badge ${diffPct >= 0 ? 'pos' : 'neg'}`}>
            {diffPct >= 0 ? `+${diffPct}%` : `${diffPct}%`}
          </span>
        )}
      </div>
      <div className="sc-eff-tile-body">
        <div className="sc-eff-col pick">
          <span className="sc-eff-pct">{pickPct}%</span>
          <span className="sc-eff-vol">{pickMakes}/{pickAtt} {unit}</span>
        </div>
        {vsDrop && (
          <>
            <span className="sc-eff-sep">vs</span>
            <div className="sc-eff-col drop">
              <span className="sc-eff-pct">{dropPct}%</span>
              <span className="sc-eff-vol">{dropMakes}/{dropAtt} {unit}</span>
            </div>
          </>
        )}
      </div>
      {vsDrop ? (
        <div className="sc-eff-tile-footer">
          <span>Shooting volume:</span>
          <strong className={diffAtt >= 0 ? 'vol-pos' : 'vol-neg'}>
            {diffAtt >= 0 ? `+${diffAtt}` : diffAtt} {unit} / gm
          </strong>
        </div>
      ) : (
        <div className="sc-eff-tile-footer">
          <span>Added directly to team</span>
        </div>
      )}
    </div>
  );
}

const formatStat = (v) => (typeof v === 'number' ? v.toFixed(1) : (v ?? '0.0'));
const formatDiff = (d) => (typeof d === 'number' ? (d > 0 ? `+${d.toFixed(1)}` : d.toFixed(1)) : '0.0');

export default function StreamerRecommendationCard({
  rec,
  pickupMode,
  contestedCatSet,
  copiedPlayer,
  getPlayerPositions,
  onCopyPlayer,
  onDismissPlayer,
}) {
  const p = rec.player;
  const action = rec.action;
  const sched = rec.schedule;
  const impact = rec.impact;
  const isCopied = copiedPlayer === p.name;
  const isTopBeneficial = rec.rank === 1 && rec.is_beneficial !== false && impact.expected_win_delta > 0;
  const isNegativeNet = rec.is_negative || impact.expected_win_delta <= 0;

  const dropStarts = Number(action?.drop_starts ?? 0);
  const netStarts = sched.net_team_starts ?? (sched.startable_games - dropStarts);
  const vsDrop = rec.vs_drop;
  const dropStats = vsDrop?.stats;
  const pLastName = p.name ? p.name.split(' ').slice(-1)[0] : 'Pick';
  const dropLastName = vsDrop?.drop_name ? vsDrop.drop_name.split(' ').slice(-1)[0] : 'drop';

  const fgStreamerFgm = dropStats?.fg_pct?.streamer_fgm ?? p.mu_fgm ?? 0;
  const fgStreamerFga = dropStats?.fg_pct?.streamer_fga ?? p.mu_fga ?? 0;
  const fgDropFgm = dropStats?.fg_pct?.drop_fgm ?? 0;
  const fgDropFga = dropStats?.fg_pct?.drop_fga ?? 0;
  const fgDiffFga = dropStats?.fg_pct?.diff_fga ?? Math.round((fgStreamerFga - fgDropFga) * 10) / 10;
  const fgDiffPct = dropStats?.fg_pct?.diff ?? 0;

  const ftStreamerFtm = dropStats?.ft_pct?.streamer_ftm ?? p.mu_ftm ?? 0;
  const ftStreamerFta = dropStats?.ft_pct?.streamer_fta ?? p.mu_fta ?? 0;
  const ftDropFtm = dropStats?.ft_pct?.drop_ftm ?? 0;
  const ftDropFta = dropStats?.ft_pct?.drop_fta ?? 0;
  const ftDiffFta = dropStats?.ft_pct?.diff_fta ?? Math.round((ftStreamerFta - ftDropFta) * 10) / 10;
  const ftDiffPct = dropStats?.ft_pct?.diff ?? 0;

  const statCategories = [
    { key: 'PTS',  label: 'PTS', pVal: p.mu_pts,  dropVal: dropStats?.pts?.drop_pg,  diff: dropStats?.pts?.diff_pg,  netWk: dropStats?.pts?.net_weekly },
    { key: 'REB',  label: 'REB', pVal: p.mu_reb,  dropVal: dropStats?.reb?.drop_pg,  diff: dropStats?.reb?.diff_pg,  netWk: dropStats?.reb?.net_weekly },
    { key: 'AST',  label: 'AST', pVal: p.mu_ast,  dropVal: dropStats?.ast?.drop_pg,  diff: dropStats?.ast?.diff_pg,  netWk: dropStats?.ast?.net_weekly },
    { key: 'STL',  label: 'STL', pVal: p.mu_stl,  dropVal: dropStats?.stl?.drop_pg,  diff: dropStats?.stl?.diff_pg,  netWk: dropStats?.stl?.net_weekly },
    { key: 'BLK',  label: 'BLK', pVal: p.mu_blk,  dropVal: dropStats?.blk?.drop_pg,  diff: dropStats?.blk?.diff_pg,  netWk: dropStats?.blk?.net_weekly },
    { key: 'FG3M', label: '3PM', pVal: p.mu_fg3m, dropVal: dropStats?.fg3m?.drop_pg, diff: dropStats?.fg3m?.diff_pg, netWk: dropStats?.fg3m?.net_weekly },
    { key: 'TO',   label: 'TO',  lowerBetter: true, pVal: p.mu_tov, dropVal: dropStats?.tov?.drop_pg, diff: dropStats?.tov?.diff_pg, netWk: dropStats?.tov?.net_weekly },
  ];

  return (
    <div className={`streamer-card card ${isTopBeneficial ? 'top-rank' : ''} ${isNegativeNet ? 'is-net-loss' : ''}`}>
      <div className="sc-header">
        <div
          className="sc-rank-badge"
          title={p.rank ? `Weekly Projection Rank: #${p.rank}${p.ros_rank ? ` · ROS Rank: #${p.ros_rank}` : ''}` : 'Unranked in Top Tier'}
        >
          <span className="sc-rank-num">{p.rank ? `#${p.rank}` : 'NR'}</span>
          <span className="sc-rank-sub">WK RNK</span>
        </div>

        <div className="sc-player-info">
          <div className="sc-name-row">
            <span className="sc-name" title={p.name}>{p.name}</span>
            {p.status && (
              <span
                className="sp-status-pill q"
                title={`Status: ${p.status}${p.play_prob != null && p.play_prob < 1 ? ` (~${Math.round(p.play_prob * 100)}% play weight)` : ''}`}
              >
                {p.status}
              </span>
            )}
            <button
              type="button"
              className={`sc-inline-copy-btn ${isCopied ? 'copied' : ''}`}
              onClick={() => onCopyPlayer(p.name)}
              title="Copy player name for Yahoo Fantasy search"
            >
              {isCopied ? '✓ Copied' : '📋 Copy'}
            </button>
            <button
              type="button"
              className="sc-dismiss-btn"
              onClick={() => onDismissPlayer(p.name)}
              title="Hide player (e.g. already picked up in your league)"
              aria-label={`Hide ${p.name}`}
            >
              ✕
            </button>
          </div>
          <div className="sc-meta-row">
            <span className="sc-team-pos-pill">
              {p.nba_team}{getPlayerPositions(p) ? ` · ${getPlayerPositions(p)}` : ''}
            </span>
            <span className="sc-z-pill" title="Active-category Z-score sum">
              Z: {p.z_total > 0 ? '+' : ''}{p.z_total?.toFixed(2) ?? '0.00'}
            </span>
            {(p.ros_rank || p.is_ros_hold) && (
              <span
                className={`sc-ros-pill ${p.is_ros_hold ? 'hold' : ''}`}
                title="Rest-of-season value rank (multi-week hold upside)"
              >
                {p.is_ros_hold ? '⭐ ' : ''}ROS #{p.ros_rank ?? 'Core'}
              </span>
            )}
            {p.fg_pct > 0 && (
              <span className="sc-eff-meta">
                {p.fg_pct}% FG &middot; {p.ft_pct}% FT
              </span>
            )}
          </div>
        </div>

        <div
          className={`sc-delta-box ${impact.expected_win_delta < 0 ? 'neg' : ''}`}
          title="Expected Categories Gained (Cat Win Delta / ΔE): Swing-weighted sum of win probability gains across your active categories."
        >
          <span className={`sc-delta-val ${impact.expected_win_delta < 0 ? 'neg' : ''}`}>
            {impact.expected_win_delta >= 0 ? '+' : ''}{impact.expected_win_delta.toFixed(2)}
          </span>
          <span className={`sc-delta-lbl ${impact.expected_win_delta < 0 ? 'neg' : ''}`}>
            {impact.expected_win_delta < 0 ? 'Net Loss' : 'Exp. Cats'}
          </span>
        </div>
      </div>

      {vsDrop ? (
        <div className="sc-compare-bar" title={`Replacement plan: Pickup ${p.name}, drop ${vsDrop.drop_name}`}>
          <div className="sc-compare-bar-main">
            <div className="sc-compare-target-info">
              <span className="sc-compare-badge">⇄ REPLACING</span>
              <span className="sc-compare-name">{vsDrop.drop_name}</span>
              <span className="sc-compare-sub">
                ({vsDrop.drop_team || 'Bench'} &middot; {vsDrop.drop_starts} start{vsDrop.drop_starts !== 1 ? 's' : ''})
              </span>
            </div>
            <div className="sc-compare-pills">
              <span
                className={`sc-diff-pill ${netStarts >= 0 ? 'pos' : 'neg'}`}
                title={`Net team starting slots gained${sched.bench_backfill_games > 0 ? ` (includes +${sched.bench_backfill_games} bench backfill)` : ''}`}
              >
                {netStarts >= 0 ? `+${netStarts}` : netStarts} starts
              </span>
              <span
                className={`sc-diff-pill ${vsDrop.z_diff >= 0 ? 'pos' : 'neg'}`}
                title={`Z-score quality difference: ${p.z_total?.toFixed(2)} vs ${action?.drop_z > 0 ? '+' : ''}${action?.drop_z ?? 0}`}
              >
                {vsDrop.z_diff >= 0 ? `+${vsDrop.z_diff.toFixed(2)}` : vsDrop.z_diff.toFixed(2)} Z
              </span>
            </div>
          </div>
        </div>
      ) : action?.type === 'OPEN_SLOT' ? (
        <div className="sc-compare-bar open-slot">
          <div className="sc-compare-bar-main">
            <div className="sc-compare-target-info">
              <span className="sc-compare-badge open">➕ OPEN SPOT</span>
              <span className="sc-compare-name">No Player Dropped</span>
              <span className="sc-compare-sub">({sched.startable_games} starts added directly)</span>
            </div>
            <div className="sc-compare-pills">
              <span className="sc-diff-pill pos">0 Drops</span>
              <span className="sc-diff-pill pos">+{sched.startable_games} starts</span>
            </div>
          </div>
        </div>
      ) : action?.type === 'HOLD' ? (
        <div className="sc-compare-bar hold">
          <div className="sc-compare-bar-main">
            <div className="sc-compare-target-info">
              <span className="sc-compare-badge hold">🛡️ HOLD ROSTER</span>
              <span className="sc-compare-name">Keep Current Roster</span>
              <span className="sc-compare-sub">(No drop recommended &middot; all options ΔE ≤ 0)</span>
            </div>
            <div className="sc-compare-pills">
              <span className="sc-diff-pill neg">Net Category Loss</span>
              <span className="sc-diff-pill pos">0 Drops Needed</span>
            </div>
          </div>
        </div>
      ) : null}

      <div className="sc-stat-comparison-wrap">
        {vsDrop && (
          <div className="sc-tiles-legend">
            <span className="sc-leg-item pick">
              <span className="sc-leg-dot pick" /> {pLastName} (pickup)
            </span>
            <span className="sc-leg-item drop">
              <span className="sc-leg-dot drop" /> {dropLastName} (drop)
            </span>
            <span className="sc-leg-item diff">&Delta; Net / gm</span>
          </div>
        )}

        <div className="sc-stat-tiles-grid">
          {statCategories.map(st => {
            const diff = st.diff ?? 0;
            const isGoodDiff = st.lowerBetter ? diff < 0 : diff > 0;
            const isBadDiff = st.lowerBetter ? diff > 0 : diff < 0;
            const isAdvantage = vsDrop ? isGoodDiff : (st.lowerBetter ? false : (st.pVal || 0) > 0);
            const isDisadvantage = vsDrop && isBadDiff;
            const isContested = contestedCatSet.has(st.key) || contestedCatSet.has(st.label);

            return (
              <div
                key={st.label}
                className={`sc-stat-tile ${isAdvantage ? 'advantage' : ''} ${isDisadvantage ? 'disadvantage' : ''} ${isContested ? 'contested' : ''}`}
                title={`${st.label}${st.lowerBetter ? ' (lower is better)' : ''}: ${p.name} (${formatStat(st.pVal)}) vs ${vsDrop ? vsDrop.drop_name : 'none'} (${vsDrop ? formatStat(st.dropVal) : '-'})${isContested ? ' · Contested Swing Battle' : ''}`}
              >
                <div className="sc-tile-cat-row">
                  <span className={`sc-tile-cat ${isAdvantage ? 'advantage' : isDisadvantage ? 'disadvantage' : ''}`}>{st.label}</span>
                  {isContested && <span className="sc-tile-swing-dot" title="Contested Swing Battle (15%–85% win prob)">⚡</span>}
                </div>
                <div className="sc-tile-values">
                  <span className="sc-tile-pick-val">{formatStat(st.pVal)}</span>
                  {vsDrop && (
                    <span className="sc-tile-drop-val" title={`Drop (${dropLastName}): ${formatStat(st.dropVal)}`}>
                      <span className="sc-tile-vs">vs</span> {formatStat(st.dropVal)}
                    </span>
                  )}
                </div>
                {vsDrop && (
                  <div
                    className={`sc-tile-diff-pill ${isGoodDiff ? 'pos' : isBadDiff ? 'neg' : 'neutral'}`}
                    title={`${st.label} net weekly: ${st.netWk >= 0 ? '+' : ''}${st.netWk ?? 0}`}
                  >
                    {formatDiff(st.diff)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="sc-efficiency-dual-grid">
          <ShootingEfficiencyTile
            label="Field Goals (FG%)"
            unit="FGA"
            isContested={contestedCatSet.has('FG%')}
            vsDrop={vsDrop}
            diffPct={fgDiffPct}
            pickPct={p.fg_pct}
            pickMakes={fgStreamerFgm}
            pickAtt={fgStreamerFga}
            dropPct={dropStats ? dropStats.fg_pct.drop : 0}
            dropMakes={fgDropFgm}
            dropAtt={fgDropFga}
            diffAtt={fgDiffFga}
          />
          <ShootingEfficiencyTile
            label="Free Throws (FT%)"
            unit="FTA"
            isContested={contestedCatSet.has('FT%')}
            vsDrop={vsDrop}
            diffPct={ftDiffPct}
            pickPct={p.ft_pct}
            pickMakes={ftStreamerFtm}
            pickAtt={ftStreamerFta}
            dropPct={dropStats ? dropStats.ft_pct.drop : 0}
            dropMakes={ftDropFtm}
            dropAtt={ftDropFta}
            diffAtt={ftDiffFta}
          />
        </div>
      </div>

      <div className="sc-boosts-section">
        <div className="sc-section-hdr">
          <span className="sc-boosts-label">Category Win Chance Impact</span>
          <span className="sc-boosts-sub">Before → After Pickup</span>
        </div>

        {impact.primary_boost_categories?.length > 0 ? (
          <div className="sc-impact-rows">
            {impact.primary_boost_categories.map((b, idx) => {
              const beforePct = Math.round(b.before_p * 100);
              const afterPct = Math.round(b.after_p * 100);
              const deltaPct = afterPct - beforePct;
              const isZero = deltaPct === 0;
              const isNeg = deltaPct < 0;
              const displayCat = b.cat === 'FG3M' ? '3PM' : b.cat;
              const isContested = Boolean(!b.is_punted && (b.is_target || contestedCatSet.has(displayCat) || contestedCatSet.has(b.cat)));
              const displayGain = String(b.gain || '').replace(/\s*(FG3M|3PM|PTS|REB|AST|STL|BLK|TOV|TO)\b/gi, '').trim();
              const minPct = Math.min(beforePct, afterPct);
              const spanPct = isZero ? 0 : Math.max(1.5, Math.abs(deltaPct));

              return (
                <div
                  key={displayCat || idx}
                  className={`sc-impact-row ${b.is_punted ? 'is-punted' : ''} ${isNeg ? 'is-neg' : isZero ? 'is-zero' : 'is-pos'} ${isContested ? 'is-contested' : ''}`}
                >
                  <div className="sc-impact-left">
                    <div className="sc-cat-badge-wrap">
                      <span className={`sc-impact-cat ${isNeg ? 'neg' : isZero ? 'zero' : ''}`}>{displayCat}</span>
                      {isContested && (
                        <span className="sc-contested-bolt" title="Contested Matchup Category (15%–85% win probability)">⚡</span>
                      )}
                    </div>
                    <span className="sc-impact-stat-gain">{displayGain}</span>
                  </div>

                  <div
                    className="sc-impact-bar-track"
                    title={`${displayCat}: ${beforePct}% → ${afterPct}% (${deltaPct > 0 ? '+' : ''}${deltaPct}%)${b.is_punted ? ' [Punted]' : ''}`}
                  >
                    <div className="sc-impact-bar-before" style={{ width: `${Math.min(100, Math.max(0, minPct))}%` }} />
                    {spanPct > 0 && (
                      <div
                        className={`sc-impact-bar-gain ${isNeg ? 'neg' : ''}`}
                        style={{
                          left: `${Math.min(100, Math.max(0, minPct))}%`,
                          width: `${Math.min(100 - minPct, spanPct)}%`,
                        }}
                      />
                    )}
                  </div>

                  <div className="sc-impact-right">
                    <span className="sc-prob-before">{beforePct}%</span>
                    <span className="sc-arrow">→</span>
                    <span className="sc-prob-after">{afterPct}%</span>
                    <span className={`sc-prob-delta ${isNeg ? 'neg' : isZero ? 'zero' : ''}`}>
                      {b.is_punted ? 'PUNT' : (deltaPct > 0 ? `+${deltaPct}%` : `${deltaPct}%`)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="sc-balanced-note">Provides balanced all-around depth across active categories.</div>
        )}

        {impact.risk_flags?.length > 0 && (
          <div className="sc-risks-row">
            {impact.risk_flags.map((rf, rIdx) => (
              <span key={rIdx} className="sc-risk-chip">⚠️ {rf}</span>
            ))}
          </div>
        )}
      </div>

      <div className="sc-schedule-row">
        <div className="sc-sched-meta">
          <span className="sc-starts-badge">
            🏀 {sched.startable_games} Startable Game{sched.startable_games !== 1 ? 's' : ''}
            {pickupMode === 'today' ? ' Today' : ''}
          </span>
          {sched.back_to_back_pairs?.length > 0 && (
            <span className="sc-b2b-badge" title={`Back-to-back games on ${sched.back_to_back_pairs.map(pr => pr.join('/')).join(', ')}`}>
              ⚡ B2B
            </span>
          )}
          {pickupMode === 'today' && sched.rest_of_week_dates?.length > 0 && (
            <span className="sc-row-more-hint" title="Additional team games remaining later this week">
              (+{sched.rest_of_week_dates.length} more this wk)
            </span>
          )}
          {dropStarts > 0 && (
            <span className={`sc-net-games ${netStarts >= 0 ? 'pos' : 'neg'}`}>
              ({netStarts >= 0 ? `+${netStarts}` : netStarts} net vs. {dropLastName})
            </span>
          )}
          {sched.bench_backfill_games > 0 && (
            <span className="sc-backfill-note" title="Your bench players fill starting slots freed by dropping the replaced player">
              · +{sched.bench_backfill_games} bench backfill
            </span>
          )}
          {sched.clashes > 0 && <span className="sc-clash-note">· {sched.clashes} bench clash</span>}
        </div>

        <div className="sc-dates-pills">
          {(sched.all_game_dates || sched.startable_dates || []).map(dateStr => {
            const dObj = new Date(dateStr + 'T12:00:00');
            const dayName = dObj.toLocaleDateString('en-US', { weekday: 'short' });
            const dayNum = dObj.getDate();
            const isClashed = sched.clashed_dates?.includes(dateStr);
            return (
              <span
                key={dateStr}
                className={`sc-date-pill ${isClashed ? 'clash' : 'active'}`}
                title={isClashed ? `${dateStr}: Roster full / no eligible starting slot` : `${dateStr}: Fits in an open active starting slot`}
              >
                <span className="sc-dot" /> {dayName} {dayNum}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
