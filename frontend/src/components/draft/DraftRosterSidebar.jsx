export default function DraftRosterSidebar({
  queuedTargets,
  isUserTurn,
  turnInfo,
  isDraftComplete,
  onDraftPlayer,
  onToggleQueue,
  onSelectPlayerName,
  puntedCatsCount,
  puntSleepers,
  teamNames,
  selectedRosterTeamIdx,
  onSelectRosterTeamIdx,
  userTeamId,
  viewedRosterObj,
  viewedOpenPrimary,
}) {
  return (
    <>
      <div className="sidebar-card card queue-card">
        <div className="sidebar-head-row">
          <h4>★ Draft Queue ({queuedTargets.length})</h4>
        </div>
        {queuedTargets.length > 0 ? (
          <div className="queue-list">
            {queuedTargets.map(p => {
              const riskGone =
                !isUserTurn &&
                turnInfo.nextUserPick &&
                p.baseRank <= turnInfo.nextUserPick - 2;
              return (
                <div key={p.name} className="queue-row">
                  <div className="q-info">
                    <span className="q-name" onClick={() => onSelectPlayerName(p.name)}>
                      #{p.overallRank} {p.name}
                    </span>
                    <span className="q-meta">
                      {p.positions} {riskGone && <span className="q-risk" title="Likely drafted before your next pick">· Run risk</span>}
                    </span>
                  </div>
                  <div className="q-actions">
                    <button
                      type="button"
                      className="btn-primary q-draft-btn"
                      onClick={() => onDraftPlayer(p)}
                      disabled={isDraftComplete}
                    >
                      Draft
                    </button>
                    <button
                      type="button"
                      className="q-remove-btn"
                      onClick={() => onToggleQueue(p.name)}
                      aria-label={`Remove ${p.name} from queue`}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="no-data-text" style={{ margin: 0 }}>
            Click ☆ on any player in the board to queue targets between turns.
          </p>
        )}
      </div>

      {puntedCatsCount > 0 && (
        <div className="sidebar-card card sleepers-card">
          <h4>🚀 Punt Risers</h4>
          <p className="roster-hint" style={{ marginBottom: '0.6rem' }}>
            Undrafted players gaining the most ranks under active punts
          </p>
          <div className="sleepers-list">
            {puntSleepers.length > 0 ? (
              puntSleepers.map(({ player, baselineRank, puntRank, rankGain }) => (
                <div key={player.name} className="sleeper-row">
                  <span className="sl-name" onClick={() => onSelectPlayerName(player.name)}>
                    {player.name}
                  </span>
                  <span className="sl-change">
                    #{baselineRank} ➔ <strong className="z-good">#{puntRank}</strong> (+{rankGain})
                  </span>
                </div>
              ))
            ) : (
              <p className="no-data-text">No notable risers left in range.</p>
            )}
          </div>
        </div>
      )}

      <div className="sidebar-card card rosters-card">
        <div className="roster-view-header">
          <h4>📋 Team Roster</h4>
          <select
            value={selectedRosterTeamIdx}
            onChange={(e) => onSelectRosterTeamIdx(parseInt(e.target.value, 10))}
            className="roster-team-select"
          >
            {teamNames.map((name, idx) => (
              <option key={idx} value={idx}>
                {name} {idx + 1 === userTeamId ? '(You)' : ''}
              </option>
            ))}
          </select>
        </div>

        {viewedRosterObj?.fit && (
          <div className="roster-fit-summary">
            <span>
              Starters: <strong>{viewedRosterObj.fit.filledStarterCount}/{viewedRosterObj.fit.totalStarterCount}</strong>
            </span>
            {viewedOpenPrimary.length > 0 && (
              <span className="open-slots-note">Open: {viewedOpenPrimary.join(', ')}</span>
            )}
          </div>
        )}

        <div className="roster-slots-display">
          {(viewedRosterObj?.fit?.slotRows || []).map((row, rIdx) => (
            <div key={`${row.slot}-${row.index}-${rIdx}`} className="roster-slot-row">
              <span className="r-slot-label">{row.slot}</span>
              <span className={`r-slot-value ${row.player ? 'filled' : 'empty'}`}>
                {row.player ? (
                  <>
                    <span className="r-player-name">{row.player.name}</span>
                    <span className="pick-indicator">#{row.player.pickNumber}</span>
                  </>
                ) : (
                  '— Empty —'
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
