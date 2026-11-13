import { CATEGORIES } from '../../utils/zScore.js';
import { formatZ } from '../../utils/formatters.js';
import { PUNT_PRESETS } from '../../utils/draftEngine.js';
import CategoryToggle from '../CategoryToggle.jsx';

export default function DraftPuntSidebar({
  isDraftComplete,
  currentPick,
  totalDraftPicks,
  round,
  indexInRound,
  draftHistoryCount,
  isUserTurn,
  onClockTeamName,
  turnInfo,
  puntedCats,
  onTogglePunt,
  onApplyPuntSet,
  userRosterCount,
  midDraftPuntAnalysis,
  onSelectPlayerName,
}) {
  return (
    <>
      <div className="sidebar-card card status-card">
        <div className="status-top-row">
          <span className="status-label">
            {isDraftComplete ? 'Draft Complete' : `Overall Pick #${currentPick}`}
          </span>
          <span className="status-sub-pick">
            {isDraftComplete
              ? `${draftHistoryCount}/${totalDraftPicks}`
              : `Rd ${round}.${String(indexInRound + 1).padStart(2, '0')}`}
          </span>
        </div>

        <div className={`clock-alert ${isUserTurn ? 'user-turn' : ''}`}>
          <div className="clock-sub">
            {isDraftComplete ? 'All Rounds Completed' : 'On the Clock'}
          </div>
          <div className="clock-team">
            {isDraftComplete ? 'League Draft Complete 🎉' : onClockTeamName}
          </div>
          {isUserTurn && <span className="your-turn-badge">Your Turn!</span>}
        </div>

        {!isDraftComplete && (
          <div className="turn-countdown">
            {isUserTurn ? (
              turnInfo.nextUserPick ? (
                <>Following pick: <strong>#{turnInfo.nextUserPick}</strong> ({turnInfo.picksUntilNext} away)</>
              ) : (
                <>Final pick of your draft</>
              )
            ) : turnInfo.nextUserPick ? (
              <>Your next pick: <strong>#{turnInfo.nextUserPick}</strong> (in {turnInfo.picksUntilNext} pick{turnInfo.picksUntilNext === 1 ? '' : 's'})</>
            ) : (
              <>You have completed your picks</>
            )}
          </div>
        )}

        <div className="draft-progress-track">
          <div
            className="draft-progress-fill"
            style={{ width: `${Math.min(100, (draftHistoryCount / Math.max(1, totalDraftPicks)) * 100)}%` }}
          />
        </div>
      </div>

      <div className="sidebar-card card punt-selector-card">
        <div className="sidebar-head-row">
          <h4>🎯 Punt Selector Tool</h4>
          {puntedCats.size > 0 && (
            <button
              type="button"
              className="clear-punts-link"
              onClick={() => onApplyPuntSet([])}
            >
              Clear ({puntedCats.size})
            </button>
          )}
        </div>

        <CategoryToggle
          puntedCats={puntedCats}
          onToggle={onTogglePunt}
          label="Click Categories to Punt"
        />

        <div className="punt-presets-wrap">
          <span className="punt-presets-label">Quick Presets:</span>
          <div className="punt-preset-pills">
            {PUNT_PRESETS.map(preset => {
              const active =
                puntedCats.size === preset.cats.length &&
                preset.cats.every(c => puntedCats.has(c));
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`punt-preset-btn ${active ? 'active' : ''}`}
                  onClick={() => onApplyPuntSet(preset.cats)}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        {userRosterCount > 0 && (
          <div className="live-team-profile">
            <div className="ltp-header">
              <span>Your Drafted Profile ({userRosterCount} pick{userRosterCount > 1 ? 's' : ''})</span>
              <span className="ltp-sub">Avg σ / pick</span>
            </div>
            <div className="ltp-grid">
              {CATEGORIES.map(cat => {
                const avg = midDraftPuntAnalysis.teamProfile.cats[cat.key]?.avgZ ?? 0;
                const isPunted = puntedCats.has(cat.key);
                return (
                  <button
                    key={cat.key}
                    type="button"
                    className={`ltp-chip ${isPunted ? 'punted' : avg >= 0.4 ? 'strong' : avg <= -0.35 ? 'weak' : 'neutral'}`}
                    onClick={() => onTogglePunt(cat.key)}
                    title={`Click to ${isPunted ? 'un-punt' : 'punt'} ${cat.label} (${formatZ(avg)} avg Z)`}
                  >
                    <span className="ltp-cat">{cat.key}</span>
                    <span className="ltp-val">{avg >= 0 ? `+${avg.toFixed(1)}` : avg.toFixed(1)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className={`sidebar-card card punt-advisor-card ${midDraftPuntAnalysis.activated ? 'unlocked' : 'locked'}`}>
        <div className="sidebar-head-row">
          <h4>🧠 Mid-Draft Punt Advisor</h4>
          <span className={`advisor-state-badge ${midDraftPuntAnalysis.activated ? 'active' : 'locked'}`}>
            {midDraftPuntAnalysis.activated ? `Active (${userRosterCount} picks)` : 'After Pick 1'}
          </span>
        </div>

        {!midDraftPuntAnalysis.activated ? (
          <div className="advisor-locked-box">
            <div className="locked-icon">🔒</div>
            <p>
              <strong>Inactive until after your 1st pick.</strong> Draft your cornerstone first so the engine can analyze your core build and suggest the strongest punt paths.
            </p>
          </div>
        ) : midDraftPuntAnalysis.isBalancedCore && midDraftPuntAnalysis.suggestions.length === 0 ? (
          <div className="advisor-balanced-box">
            <p>
              <strong>Balanced Start:</strong> Your drafted core has no major category drag yet. Stay flexible (9-cat) until your next 1–2 picks reveal a natural punt.
            </p>
          </div>
        ) : (
          <div className="punt-suggestions-list">
            {midDraftPuntAnalysis.suggestions.map((sug, idx) => (
              <div
                key={sug.id}
                className={`punt-sug-card ${sug.isCurrentlyApplied ? 'applied' : ''} ${idx === 0 ? 'top-pick' : ''}`}
              >
                <div className="ps-top">
                  <div>
                    <span className="ps-title">{sug.label}</span>
                    <span className="ps-lift">+{sug.coreLift.toFixed(2)}σ/cat</span>
                  </div>
                  <button
                    type="button"
                    className={`ps-apply-btn ${sug.isCurrentlyApplied ? 'active' : ''}`}
                    onClick={() => onApplyPuntSet(sug.cats)}
                  >
                    {sug.isCurrentlyApplied ? '✓ Active' : 'Apply'}
                  </button>
                </div>
                <div className="ps-weak-cats">Core drag: {sug.weakSummary}</div>
                {sug.topTargets.length > 0 && (
                  <div className="ps-targets">
                    Targets:{' '}
                    {sug.topTargets.map((t, ti) => (
                      <span key={t.name} className="ps-target-link" onClick={() => onSelectPlayerName(t.name)}>
                        {t.name}{ti < sug.topTargets.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
