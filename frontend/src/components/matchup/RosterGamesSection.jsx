const IR_SLOTS = new Set(['IL', 'IL+', 'IR', 'IR+', 'NA']);

function TeamGamesList({ teamName, teamKey, players, playerGames, totals }) {
  return (
    <div className="roster-games-card">
      <div className="roster-games-card-header">
        <span className={`rg-team-name ${teamKey === 'team1' ? 'you' : 'opp'}`}>{teamName}</span>
        <span className="rg-team-totals">{totals.played}/{totals.total} GP &middot; {totals.rem} left</span>
      </div>

      <div className="roster-games-list">
        {players.map(p => {
          const gInfo = playerGames?.[teamKey]?.[p.name] || { played: 0, total: 0, remaining: 0, ratio: '0/0' };
          const hasRemaining = gInfo.remaining > 0;
          return (
            <div className="player-game-item" key={p.name}>
              <div className="player-meta-inline">
                <span className="player-name-text" title={p.name}>{p.name}</span>
                <span className="player-sub-text">{p.nba_team} &middot; {p.positions}</span>
                {p.status && <span className="badge badge-orange rg-status-tag">{p.status}</span>}
              </div>
              <span
                className={`games-played-badge ${hasRemaining ? 'games-badge-active' : 'games-badge-done'}`}
                title={`${gInfo.played} played, ${gInfo.remaining} remaining (${gInfo.total} total this week)`}
              >
                {gInfo.ratio || `${gInfo.played}/${gInfo.total}`} GP
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function RosterGamesSection({ myTeam, oppTeam, playerGames }) {
  const isPlayerInIR = (p, teamKey) =>
    IR_SLOTS.has(String(p?.selected_position || '').toUpperCase().trim()) ||
    Boolean(playerGames?.[teamKey]?.[p?.name]?.is_ir);

  const summarize = (players, teamKey) => {
    const active = players.filter(p => !isPlayerInIR(p, teamKey));
    const played = active.reduce((sum, p) => sum + (playerGames?.[teamKey]?.[p.name]?.played ?? 0), 0);
    const total = active.reduce((sum, p) => sum + (playerGames?.[teamKey]?.[p.name]?.total ?? 0), 0);
    return { active, totals: { played, total, rem: Math.max(0, total - played) } };
  };

  const t1 = summarize(myTeam.players, 'team1');
  const t2 = summarize(oppTeam.players, 'team2');

  return (
    <div className="roster-games-section card fade-up">
      <div className="roster-games-top-bar">
        <div className="roster-games-title-wrap">
          <h3 className="roster-games-title">📅 Weekly Roster Schedule &amp; Games Played</h3>
          <span className="roster-games-sub">Active roster games this week (IR slots excluded)</span>
        </div>
        <div className="roster-games-summary-pills">
          <span className="rg-summary-pill you">
            <strong>{myTeam.name}:</strong> {t1.totals.played}/{t1.totals.total} GP <em>({t1.totals.rem} left)</em>
          </span>
          <span className="rg-summary-pill opp">
            <strong>{oppTeam.name}:</strong> {t2.totals.played}/{t2.totals.total} GP <em>({t2.totals.rem} left)</em>
          </span>
        </div>
      </div>

      <div className="roster-games-grid">
        <TeamGamesList
          teamName={myTeam.name}
          teamKey="team1"
          players={t1.active}
          playerGames={playerGames}
          totals={t1.totals}
        />
        <TeamGamesList
          teamName={oppTeam.name}
          teamKey="team2"
          players={t2.active}
          playerGames={playerGames}
          totals={t2.totals}
        />
      </div>
    </div>
  );
}
