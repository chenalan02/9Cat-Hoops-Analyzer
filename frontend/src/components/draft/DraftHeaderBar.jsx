import { SOURCE_OPTIONS } from './draftConstants.js';

export default function DraftHeaderBar({
  numTeams,
  draftType,
  totalRosterSpotsPerTeam,
  effectiveSource,
  availableSources,
  onStatsSourceChange,
  isDraftComplete,
  isUserTurn,
  onAutoPick,
  onSimToUserTurn,
  onUndoPick,
  onResetDraft,
  canUndo,
  recentPicks,
  userTeamId,
}) {
  return (
    <>
      <div className="draft-header-bar">
        <div>
          <div className="draft-title-row">
            <h1 className="section-title" style={{ textAlign: 'left', margin: 0 }}>
              Draft Assistant
            </h1>
            <span className="draft-meta-pill">
              {numTeams}T · {draftType === '3rr' ? '3RR' : draftType === 'snake' ? 'Snake' : 'Linear'} · {totalRosterSpotsPerTeam} Rds
            </span>
          </div>
          <p className="section-subtitle" style={{ textAlign: 'left', margin: '0.2rem 0 0 0' }}>
            {SOURCE_OPTIONS.find(s => s.key === effectiveSource)?.hint || 'Live 9-Cat draft optimizer'}
          </p>
        </div>

        <div className="draft-header-actions">
          <div className="draft-source-pills" role="group" aria-label="Projection source">
            {SOURCE_OPTIONS.filter(opt => availableSources.includes(opt.key)).map(opt => (
              <button
                key={opt.key}
                type="button"
                className={`source-pill-btn ${effectiveSource === opt.key ? 'active' : ''}`}
                onClick={() => onStatsSourceChange(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {!isDraftComplete && !isUserTurn && (
            <>
              <button
                type="button"
                className="btn-secondary sim-btn"
                onClick={onAutoPick}
                title="Let CPU make a realistic pick for the team on the clock"
              >
                ⚡ Auto-Pick
              </button>
              <button
                type="button"
                className="btn-primary sim-btn"
                onClick={onSimToUserTurn}
                title="Simulate picks automatically up to your next turn"
              >
                ⏩ Sim to My Turn
              </button>
            </>
          )}

          <button
            type="button"
            className="btn-secondary"
            onClick={onUndoPick}
            disabled={!canUndo}
          >
            ↩️ Undo
          </button>
          <button type="button" className="btn-secondary reset-draft-btn" onClick={onResetDraft}>
            🔄 Reset
          </button>
        </div>
      </div>

      {recentPicks.length > 0 && (
        <div className="recent-picks-bar" aria-label="Recent picks">
          <span className="ticker-label">Recent:</span>
          <div className="ticker-pills">
            {recentPicks.map(pk => {
              const rNum = Math.ceil(pk.pickNumber / numTeams);
              const rSlot = ((pk.pickNumber - 1) % numTeams) + 1;
              const pickCode = `${rNum}.${String(rSlot).padStart(2, '0')}`;
              const isMine = pk.teamId === userTeamId;
              return (
                <span key={pk.pickNumber} className={`ticker-pill ${isMine ? 'mine' : ''}`}>
                  <strong>{pickCode}</strong> {pk.playerName}{' '}
                  <span className="ticker-team">({isMine ? 'You' : pk.teamName})</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
