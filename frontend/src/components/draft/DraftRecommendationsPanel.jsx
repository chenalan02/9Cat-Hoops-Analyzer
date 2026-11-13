export default function DraftRecommendationsPanel({
  isUserTurn,
  recommendations,
  puntedCats,
  turnInfo,
  queuedNameSet,
  isDraftComplete,
  onClockTeamName,
  onToggleQueue,
  onDraftPlayer,
  onSelectPlayerName,
}) {
  return (
    <div className={`card recommendations-panel ${isUserTurn ? 'your-turn-active' : ''}`}>
      <div className="rec-panel-header">
        <div>
          <h3>
            {isUserTurn ? '🎯 Recommended Picks for Your Turn' : '💡 Projected Targets for Your Build'}
          </h3>
          <p className="rec-panel-sub">
            Ranked by active punt value, bipartite slot fit, category balance, and{' '}
            {turnInfo.nextUserPick ? `scarcity before Pick #${turnInfo.nextUserPick}` : 'roster depth'}.
          </p>
        </div>
        {puntedCats.size > 0 && (
          <span className="active-punt-pill">
            Punting: {[...puntedCats].join(', ')}
          </span>
        )}
      </div>

      <div className="rec-cards-grid">
        {recommendations.length > 0 ? (
          recommendations.map(({ player, reasons, warnings, boostedCats }) => {
            const isQueued = queuedNameSet.has(player.name);
            return (
              <div key={player.name} className="smart-rec-card">
                <div className="src-top">
                  <div className="src-ranks">
                    <span className="src-rank-main" title="Active build rank">
                      #{player.overallRank}
                    </span>
                    {puntedCats.size > 0 && player.rankDelta !== 0 && (
                      <span
                        className={`src-rank-base ${player.rankDelta > 0 ? 'up' : 'down'}`}
                        title={`9-Cat rank #${player.baseRank}`}
                      >
                        {player.rankDelta > 0 ? `▲${player.rankDelta}` : `▼${Math.abs(player.rankDelta)}`}
                      </span>
                    )}
                  </div>
                  <div className="src-actions">
                    <button
                      type="button"
                      className={`star-queue-btn ${isQueued ? 'active' : ''}`}
                      onClick={() => onToggleQueue(player.name)}
                      title={isQueued ? 'Remove from queue' : 'Add to queue'}
                    >
                      {isQueued ? '★' : '☆'}
                    </button>
                    <button
                      type="button"
                      className="btn-primary rec-draft-btn"
                      onClick={() => onDraftPlayer(player)}
                      disabled={isDraftComplete}
                      title={`Draft ${player.name} to ${onClockTeamName}`}
                    >
                      Draft
                    </button>
                  </div>
                </div>

                <div className="src-name" onClick={() => onSelectPlayerName(player.name)}>
                  {player.name}
                </div>
                <div className="src-meta">
                  <span>{player.positions}</span>
                  <span>· {player.nba_team || 'NBA'}</span>
                  {player.projGp != null && <span>· {Math.round(player.projGp)} GP</span>}
                </div>

                <div className="src-tags">
                  {reasons.map((r, i) => (
                    <span key={i} className={`src-reason-tag kind-${r.kind}`}>
                      {r.label}
                    </span>
                  ))}
                  {warnings.map((w, i) => (
                    <span key={`w-${i}`} className="src-warning-tag">
                      ⚠ {w}
                    </span>
                  ))}
                </div>

                {boostedCats.length > 0 && (
                  <div className="src-cats">
                    {boostedCats.map(c => (
                      <span key={c.key} className="src-cat-chip">
                        {c.key} +{c.z.toFixed(1)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <p className="no-data-text">No undrafted recommendations remaining.</p>
        )}
      </div>
    </div>
  );
}
