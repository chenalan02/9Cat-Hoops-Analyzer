import { getCategoryMagnitude } from '../../utils/matchupHelpers.js';

const LIVE_CATS = [
  { key: 'pts', short: 'PTS', label: 'Points' },
  { key: 'reb', short: 'REB', label: 'Rebounds' },
  { key: 'ast', short: 'AST', label: 'Assists' },
  { key: 'stl', short: 'STL', label: 'Steals' },
  { key: 'blk', short: 'BLK', label: 'Blocks' },
  { key: 'fg3m', short: '3PM', label: '3-Pointers' },
  { key: 'fg%', short: 'FG%', label: 'Field Goal %', isPct: true },
  { key: 'ft%', short: 'FT%', label: 'Free Throw %', isPct: true },
  { key: 'tov', short: 'TO', label: 'Turnovers' },
];

export default function LiveScoreboardCard({ accumulatedStats, weekNum, myTeam, oppTeam }) {
  const s = accumulatedStats.live_score;
  const tiesCount = s?.ties ?? 0;
  const tieSuffix = tiesCount > 0 ? `–${tiesCount}` : '';
  const hasStats = accumulatedStats.has_live_stats;

  const isAllZero = !s || (!hasStats && s.team1_wins === 0 && s.team2_wins === 0);
  const scoreClass = isAllZero
    ? 'tied'
    : s.team1_wins > s.team2_wins
    ? 'winning'
    : s.team1_wins < s.team2_wins
    ? 'trailing'
    : 'tied';

  const scoreLabel = isAllZero
    ? '0 – 0 Tied'
    : s.team1_wins > s.team2_wins
    ? `Leading ${s.team1_wins}–${s.team2_wins}${tieSuffix}`
    : s.team1_wins < s.team2_wins
    ? `Trailing ${s.team1_wins}–${s.team2_wins}${tieSuffix}`
    : `Tied ${s.team1_wins}–${s.team2_wins}${tieSuffix}`;

  const tooltip = s
    ? `${s.team1_wins} Wins · ${s.team2_wins} Losses · ${tiesCount} Ties`
    : 'No matchup score yet';

  const formatCell = (cat, side) => {
    const cData = accumulatedStats.categories?.[cat.key];
    if (!cat.isPct) {
      return { main: accumulatedStats[side]?.[cat.key] ?? '0', sub: null };
    }
    const pctVal = side === 'team1' ? cData?.team1 : cData?.team2;
    const splitStr = side === 'team1' ? cData?.team1_split : cData?.team2_split;
    const madeKey = `${cat.key.replace('%', '')}m`;
    const attKey = `${cat.key.replace('%', '')}a`;
    const fallbackPct = ((accumulatedStats[side]?.[madeKey] ?? 0) / (accumulatedStats[side]?.[attKey] || 1)) * 100;
    const pctStr = pctVal != null ? `${(pctVal * 100).toFixed(1)}%` : `${fallbackPct.toFixed(1)}%`;
    return { main: pctStr, sub: splitStr || null };
  };

  return (
    <div className="card live-scoreboard-card fade-up">
      <div className="live-scoreboard-header">
        <div className="live-scoreboard-title-group">
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.02rem' }}>
            🏆 Live Matchup Scoreboard
            {hasStats && (
              <span className="badge badge-green" style={{ fontSize: '0.68rem', padding: '1px 7px' }}>
                ● Live
              </span>
            )}
          </h3>
          <span className="live-scoreboard-sub">Week {weekNum} accumulated totals</span>
        </div>

        <div className="live-score-display">
          <div className={`live-score-pill ${scoreClass}`} title={tooltip}>
            {scoreLabel}
          </div>
        </div>
      </div>

      <div className="live-stats-table-wrapper">
        <table className="live-stats-table condensed">
          <thead>
            <tr>
              <th className="team-col">Team</th>
              {LIVE_CATS.map(cat => (
                <th key={cat.key} title={cat.label}>{cat.short}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="team-col">
                <span className="team-dot you" />
                <span className="team-name-cell">{myTeam.name}</span>
                <span className="team-tag-you">You</span>
              </td>
              {LIVE_CATS.map(cat => {
                const cData = accumulatedStats.categories?.[cat.key];
                const isWinning = cData?.leader === 'team1';
                const isTrailing = cData?.leader === 'team2';
                const { main, sub } = formatCell(cat, 'team1');
                return (
                  <td key={cat.key} className={isWinning ? 'live-stat-win' : isTrailing ? 'live-stat-loss' : ''}>
                    <div>{main}</div>
                    {sub && <div className="live-stat-split">{sub}</div>}
                  </td>
                );
              })}
            </tr>

            <tr>
              <td className="team-col">
                <span className="team-dot opp" />
                <span className="team-name-cell">{oppTeam.name}</span>
              </td>
              {LIVE_CATS.map(cat => {
                const cData = accumulatedStats.categories?.[cat.key];
                const isWinning = cData?.leader === 'team1';
                const isTrailing = cData?.leader === 'team2';
                const { main, sub } = formatCell(cat, 'team2');
                return (
                  <td key={cat.key} className={isTrailing ? 'live-stat-win' : isWinning ? 'live-stat-loss' : ''}>
                    <div>{main}</div>
                    {sub && <div className="live-stat-split">{sub}</div>}
                  </td>
                );
              })}
            </tr>

            <tr className="margin-row">
              <td className="team-col margin-label-col">Margin</td>
              {LIVE_CATS.map(cat => {
                const cData = accumulatedStats.categories?.[cat.key];
                const magnitude = getCategoryMagnitude(cat.key, cat.isPct, cData?.team1, cData?.team2, cData?.leader);
                return (
                  <td key={cat.key}>
                    <span className={`live-margin-pill ${magnitude.pillClass}`} title={magnitude.subText}>
                      {magnitude.text.replace(` ${cat.short}`, '').replace(' FG%', '%').replace(' FT%', '%')}
                    </span>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
