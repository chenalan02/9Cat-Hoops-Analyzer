import { OUT_STATUS_TAGS } from '../../utils/streamerHelpers.js';

export default function StreamerDropSelectorCard({
  openRosterSpots,
  openIlSlots,
  pickupMode,
  setPickupMode,
  effectiveSelectedKey,
  recommendedTargetKey,
  visibleCandidateCards,
  candidateOptions,
  selectedDropPlayer,
  setSelectedDropPlayer,
  isHoldRecommended,
  activeAction,
  showAllRoster,
  setShowAllRoster,
  getPlayerPositions,
}) {
  return (
    <div className="card streamer-controls-card">
      <div className="streamer-setup-header">
        <div className="streamer-setup-title-group">
          <div className="streamer-setup-title">Who Are You Replacing to Open a Streamer Spot?</div>
          <div className="streamer-setup-subtitle">
            {openRosterSpots > 0
              ? 'You have an open roster spot — or click a player below to compare replacing them.'
              : 'Click a player below so we compare incoming free agent games against the exact starts you give up.'}
          </div>
        </div>

        <div className="streamer-horizon-box">
          <span className="streamer-horizon-label">Pickup Window</span>
          <div className="streamer-mode-toggle" role="group" aria-label="Pickup evaluation horizon">
            <button
              type="button"
              className={`mode-toggle-btn ${pickupMode === 'week' ? 'active' : ''}`}
              onClick={() => setPickupMode('week')}
            >
              📅 Rest of Week
            </button>
            <button
              type="button"
              className={`mode-toggle-btn ${pickupMode === 'today' ? 'active' : ''}`}
              onClick={() => setPickupMode('today')}
            >
              ⚡ Today Only
            </button>
          </div>
        </div>
      </div>

      <div className="streamer-player-grid">
        {openRosterSpots > 0 && (() => {
          const isSelected = effectiveSelectedKey === '__OPEN_SLOT__';
          const isRec = recommendedTargetKey === '__OPEN_SLOT__';
          return (
            <button
              type="button"
              className={`streamer-player-option-card open-slot-card ${isSelected ? 'selected' : ''} ${isRec ? 'is-recommended' : ''}`}
              onClick={() => setSelectedDropPlayer('__OPEN_SLOT__')}
            >
              <div className="sp-card-top">
                <span className="sp-player-name">➕ Open Roster Spot</span>
                <span className="sp-status-pill rec">
                  {isRec ? 'Recommended' : `${openRosterSpots} Open`}
                </span>
              </div>
              <div className="sp-card-meta">
                You have {openRosterSpots} unfilled roster spot{openRosterSpots !== 1 ? 's' : ''}
              </div>
              <div className="sp-card-chips">
                <span className="sp-chip zero-starts">🏀 0 starts lost</span>
                <span className="sp-chip">Pure addition</span>
              </div>
            </button>
          );
        })()}

        {visibleCandidateCards.map(c => {
          const isSelected = effectiveSelectedKey === c.name;
          const isRec = !isHoldRecommended && recommendedTargetKey === c.name;
          const statusUpper = String(c.status || '').toUpperCase().trim();
          const isOut = OUT_STATUS_TAGS.has(statusUpper);
          const startsCount = pickupMode === 'today' ? c.starts_today : c.starts_week;
          const numericStarts = Number(startsCount);
          const isZeroStarts = !Number.isNaN(numericStarts) && numericStarts === 0;
          const zVal = Number(c.z_total ?? 0);

          return (
            <button
              key={c.name}
              type="button"
              className={`streamer-player-option-card ${isSelected ? 'selected' : ''} ${c.is_tagged ? 'is-tagged' : ''} ${isRec ? 'is-recommended' : ''}`}
              onClick={() => setSelectedDropPlayer(c.name)}
            >
              <div className="sp-card-top">
                <span className="sp-player-name" title={c.name}>{c.name}</span>
                <div className="sp-badges">
                  {c.status && (
                    <span className={`sp-status-pill ${isOut ? 'out' : 'q'}`}>
                      {c.status}
                    </span>
                  )}
                  {isRec && (
                    <span className="sp-status-pill rec">
                      {isOut && openIlSlots > 0 ? 'IR Move' : 'Suggested'}
                    </span>
                  )}
                </div>
              </div>

              <div className="sp-card-meta">
                <span>{c.nba_team} &middot; {getPlayerPositions(c) || c.positions}</span>
                {c.selected_position && <span className="sp-slot-tag">{c.selected_position}</span>}
              </div>

              <div className="sp-card-chips">
                <span
                  className={`sp-chip ${isZeroStarts ? 'zero-starts' : ''}`}
                  title={pickupMode === 'today' ? 'Active lineup starts today' : 'Remaining active lineup starts this week'}
                >
                  🏀 {startsCount} {pickupMode === 'today' ? 'start today' : `start${startsCount === 1 ? '' : 's'} left`}
                </span>
                <span className="sp-chip" title="Weekly per-game Z-score sum">
                  Z: {zVal > 0 ? `+${c.z_total}` : c.z_total}
                </span>
                {c.hold_tier === 'MUST_HOLD' ? (
                  <span
                    className="sp-chip ros-hold"
                    title={`Top Rest-of-Season value (${c.ros_rank ? `ROS #${c.ros_rank}` : 'Core ROS'}) — protected from automatic drops`}
                  >
                    🔒 {c.ros_rank ? `ROS #${c.ros_rank}` : 'ROS Hold'}
                  </span>
                ) : c.ros_rank ? (
                  <span className="sp-chip ros-rank" title="Rest-of-season market rank">
                    ROS #{c.ros_rank}
                  </span>
                ) : null}
                {typeof c.max_delta_e === 'number' && (
                  <span
                    className={`sp-chip ${c.max_delta_e > 0 ? 'gain-pos' : 'gain-neg'}`}
                    title="Maximum category win probability delta achievable by streaming for this player"
                  >
                    {c.max_delta_e > 0 ? `Max Gain: +${c.max_delta_e.toFixed(2)} ΔE` : `Max Gain: ${c.max_delta_e.toFixed(2)} ΔE`}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="streamer-setup-footer">
        <div className={`streamer-active-summary ${activeAction?.type === 'HOLD_WARNING' ? 'is-hold-warn' : ''}`}>
          <span className="sas-dot" />
          {activeAction?.reason ? (
            <span>{activeAction.reason}</span>
          ) : effectiveSelectedKey === '__OPEN_SLOT__' ? (
            <span>Evaluating Free Agents into an <strong>Open Roster / IR Spot</strong> (0 starts lost).</span>
          ) : (
            <span>Evaluating Free Agents replacing <strong>{effectiveSelectedKey}</strong>.</span>
          )}
          {selectedDropPlayer !== '__AUTO__' && (
            <button
              type="button"
              className="streamer-reset-auto-btn"
              onClick={() => setSelectedDropPlayer('__AUTO__')}
            >
              Reset to Auto
            </button>
          )}
        </div>

        {candidateOptions.length > (openRosterSpots > 0 ? 4 : 5) && (
          <button
            type="button"
            className="streamer-expand-btn"
            onClick={() => setShowAllRoster(prev => !prev)}
          >
            {showAllRoster
              ? 'Show Top Candidates Only ▴'
              : `Show All ${candidateOptions.length} Roster Players ▾`}
          </button>
        )}
      </div>
    </div>
  );
}
