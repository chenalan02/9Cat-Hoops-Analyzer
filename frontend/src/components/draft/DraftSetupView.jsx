import { ROSTER_PRESETS } from '../../utils/draftEngine.js';
import { SOURCE_OPTIONS } from './draftConstants.js';

export default function DraftSetupView({
  playerCount,
  numTeams,
  userTeamId,
  draftType,
  effectiveSource,
  availableSources,
  teamNames,
  rosterSlots,
  onLeagueSizeChange,
  onUserTeamChange,
  onDraftTypeChange,
  onStatsSourceChange,
  onRosterSlotChange,
  onApplyRosterPreset,
  onTeamNameChange,
  onStartDraft,
}) {
  const slotSum = Object.values(rosterSlots).reduce((s, v) => s + (Number(v) || 0), 0);

  return (
    <div className="draft-setup-page page-wrapper fade-up">
      <div className="section">
        <h1 className="section-title">🏀 Draft Assistant Setup</h1>
        <p className="section-subtitle">
          Standalone 9-Cat live draft & mock room — powered by Databricks projections ({playerCount} NBA players loaded)
        </p>

        <div className="setup-container">
          <div className="setup-card card">
            <h3>League & Projection Settings</h3>

            <div className="setup-row-2col">
              <div className="form-group">
                <label>Teams in League:</label>
                <select
                  value={numTeams}
                  onChange={(e) => onLeagueSizeChange(e.target.value)}
                  className="setup-select"
                >
                  {[8, 10, 12, 14, 16].map(cnt => (
                    <option key={cnt} value={cnt}>{cnt} Teams</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Your Draft Slot:</label>
                <select
                  value={userTeamId}
                  onChange={(e) => onUserTeamChange(parseInt(e.target.value, 10))}
                  className="setup-select"
                >
                  {teamNames.map((t, idx) => (
                    <option key={idx} value={idx + 1}>
                      Pick #{idx + 1} — {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="setup-row-2col">
              <div className="form-group">
                <label>Draft Type:</label>
                <select
                  value={draftType}
                  onChange={(e) => onDraftTypeChange(e.target.value)}
                  className="setup-select"
                >
                  <option value="snake">Snake Draft</option>
                  <option value="3rr">3rd-Round Reversal (3RR)</option>
                  <option value="linear">Linear Draft</option>
                </select>
              </div>

              <div className="form-group">
                <label>Rankings Source:</label>
                <select
                  value={effectiveSource}
                  onChange={(e) => onStatsSourceChange(e.target.value)}
                  className="setup-select"
                >
                  {SOURCE_OPTIONS.filter(opt => availableSources.includes(opt.key)).map(opt => (
                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <div className="slot-header-row">
                <label>Roster Slots ({slotSum} Rounds · {slotSum * numTeams} Picks):</label>
                <div className="roster-preset-pills">
                  {ROSTER_PRESETS.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      className="preset-mini-btn"
                      onClick={() => onApplyRosterPreset(p.slots)}
                    >
                      {p.label.split(' (')[0]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="roster-slots-grid">
                {Object.keys(rosterSlots).map(slot => (
                  <div key={slot} className="roster-slot-input">
                    <span>{slot}</span>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={rosterSlots[slot]}
                      onChange={(e) => onRosterSlotChange(slot, e.target.value)}
                      aria-label={`${slot} slot count`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="setup-card card">
            <h3>Draft Order (Picks #1 – #{numTeams})</h3>
            <p className="roster-hint">Customize manager names in Round 1 pick order</p>
            <div className="team-names-list">
              {teamNames.map((name, idx) => (
                <div key={idx} className={`team-name-row ${idx + 1 === userTeamId ? 'is-you' : ''}`}>
                  <span className="team-order-badge">#{idx + 1}</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => onTeamNameChange(idx, e.target.value)}
                    placeholder={`Team ${idx + 1}`}
                    aria-label={`Team ${idx + 1} name`}
                  />
                  {idx + 1 === userTeamId && <span className="you-pill">YOU</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="setup-launch-bar">
          <button className="btn-primary start-draft-btn" onClick={onStartDraft}>
            🚀 Enter Draft Room
          </button>
        </div>
      </div>
    </div>
  );
}
