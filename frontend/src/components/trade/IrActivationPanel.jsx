import { useState } from 'react';
import { formatZ } from '../../utils/formatters.js';
import { OUT_STATUS_SET, getMarketRank, playerContribution } from '../../utils/tradeEngine.js';
import { signed } from './tradeFormatters.js';

const INJURED_STASH_STATUSES = new Set([...OUT_STATUS_SET, 'GTD', 'DTD', 'Q']);

export default function IrActivationPanel({
  irPlayers = [],
  activePlayers = [],
  irSwaps = {},
  irStashes = [],
  freeAgents = [],
  waiverReplacement = null,
  onToggleIr,
  onChangeReplace,
  onAddStash,
  onChangeStashReplace,
  onRemoveStash,
  onReset,
  rawCtx,
  statsSource,
  irDelta,
}) {
  const [showStashPicker, setShowStashPicker] = useState(false);

  if (!rawCtx) return null;

  const stashedSet = new Set(irStashes.map(s => s.stashPlayerName));
  const bestFaName = waiverReplacement?.isRealFreeAgent ? waiverReplacement.name : null;

  const getClaimReason = (currentIrName, candidateName) => {
    for (const [irName, cfg] of Object.entries(irSwaps || {})) {
      if (irName !== currentIrName && cfg?.enabled && cfg?.replacePlayerName === candidateName) {
        return 'replaced';
      }
    }
    if (stashedSet.has(candidateName)) {
      return 'stashed';
    }
    return null;
  };

  const isClaimedByYahooIr = (candidateName) =>
    Object.values(irSwaps || {}).some(cfg => cfg?.enabled && cfg?.replacePlayerName === candidateName);

  const isFaClaimedByOther = (currentStashName, candidateFaName) => {
    for (const s of irStashes) {
      if (s.stashPlayerName === currentStashName) continue;
      if (s.replaceWith === candidateFaName) return true;
      if (s.replaceWith === '__BEST_FA__' && bestFaName && candidateFaName === bestFaName) return true;
    }
    return false;
  };

  const isBestFaDisabledFor = (currentStashName) => {
    if (!bestFaName) return false;
    return irStashes.some(
      s => s.stashPlayerName !== currentStashName && (s.replaceWith === '__BEST_FA__' || s.replaceWith === bestFaName)
    );
  };

  const enabledYahooCount = Object.values(irSwaps || {}).filter(cfg => cfg?.enabled).length;
  const activeSimCount = enabledYahooCount + irStashes.length;

  const unclaimedActive = activePlayers
    .filter(p => !isClaimedByYahooIr(p.name) && !stashedSet.has(p.name))
    .sort((a, b) => rawCtx.puntValue(b) - rawCtx.puntValue(a));

  const isInjuredStatus = (p) => INJURED_STASH_STATUSES.has(String(p?.status || '').toUpperCase().trim());
  const injuredCandidates = unclaimedActive.filter(isInjuredStatus);
  const healthyCandidates = unclaimedActive.filter(p => !isInjuredStatus(p));

  const bestFaRank = waiverReplacement ? getMarketRank(rawCtx, waiverReplacement.name) : null;
  const bestFaLabel = waiverReplacement?.isRealFreeAgent
    ? `Best FA: ${waiverReplacement.name} (${bestFaRank != null ? `#${bestFaRank} · ` : ''}Z ${formatZ(rawCtx.puntValue(waiverReplacement))})`
    : `Waiver Replacement${waiverReplacement ? ` (Z ${formatZ(rawCtx.puntValue(waiverReplacement))})` : ''}`;

  const pickerVisible = irPlayers.length === 0 || showStashPicker;
  const subtitle = irPlayers.length > 0
    ? 'Activate Yahoo IL/IL+ players in place of active roster spots — or stash an active/injured player on IR — to check category win % and evaluate trades.'
    : 'No players currently in Yahoo IL/IL+ slots (click Reload from Yahoo if you just moved someone). You can still simulate stashing an active or injured player on IR below.';

  return (
    <div className={`ir-sim-panel card ${activeSimCount > 0 ? 'active' : ''}`}>
      <div className="ir-sim-header">
        <div className="ir-sim-title-group">
          <div className="ir-sim-title-row">
            <span className="ir-sim-title">🏥 IR Roster Simulator</span>
            {activeSimCount > 0 ? (
              <span className="ir-sim-count-pill">{activeSimCount} active</span>
            ) : (
              <span className="ir-sim-status-pill">{irPlayers.length} on Yahoo IL</span>
            )}
          </div>
          <span className="ir-sim-sub">{subtitle}</span>
        </div>

        <div className="ir-sim-header-right">
          {activeSimCount > 0 && (
            <button type="button" className="btn-ghost ir-sim-reset-btn" onClick={onReset}>
              Reset IR
            </button>
          )}
        </div>
      </div>

      {(irPlayers.length > 0 || irStashes.length > 0) && (
        <div className="ir-sim-rows">
          {irPlayers.map(irPlayer => {
            const cfg = irSwaps?.[irPlayer.name] || { enabled: false, replacePlayerName: null };
            const isEnabled = Boolean(cfg.enabled);
            const irRank = getMarketRank(rawCtx, irPlayer.name);
            const irZ = rawCtx.puntValue(irPlayer);
            const hasStats = playerContribution(irPlayer, statsSource) != null;
            const slotLabel = String(irPlayer.selected_position || 'IL').toUpperCase();
            const selectVal = cfg.replacePlayerName || '__NONE__';

            return (
              <div key={irPlayer.name} className={`ir-sim-row ${isEnabled ? 'enabled' : ''}`}>
                <div className="ir-sim-player-side">
                  <button
                    type="button"
                    className={`ir-sim-toggle ${isEnabled ? 'on' : ''}`}
                    onClick={() => onToggleIr?.(irPlayer.name)}
                    aria-pressed={isEnabled}
                  >
                    <span className="ir-sim-toggle-dot" />
                    <span>{isEnabled ? 'Activated' : 'Activate'}</span>
                  </button>

                  <div className="ir-sim-player-meta">
                    <div className="ir-sim-name-line">
                      <span className="ir-sim-name">{irPlayer.name}</span>
                      <span className="sp-il-tag">{slotLabel}</span>
                      {irRank != null && <span className="ir-sim-rank">#{irRank}</span>}
                      <span className="ir-sim-z">Z {formatZ(irZ)}</span>
                    </div>
                    {!hasStats && (
                      <span className="ir-sim-warn-pill">
                        No {statsSource.toUpperCase()} stats — try ROS or EMA
                      </span>
                    )}
                  </div>
                </div>

                <div className="ir-sim-replace-side">
                  <span className="ir-sim-arrow" aria-hidden="true">replaces →</span>
                  <select
                    className="ir-sim-select"
                    value={selectVal}
                    onChange={e => onChangeReplace?.(irPlayer.name, e.target.value)}
                    aria-label={`Select active player replaced by ${irPlayer.name}`}
                  >
                    <option value="__NONE__">Open spot (no drop)</option>
                    {activePlayers.map(ap => {
                      const apRank = getMarketRank(rawCtx, ap.name);
                      const apZ = rawCtx.puntValue(ap);
                      const reason = getClaimReason(irPlayer.name, ap.name);
                      const disabled = reason != null;
                      const reasonSuffix = reason === 'stashed'
                        ? ' [stashed on IR]'
                        : reason === 'replaced'
                          ? ' [already replaced]'
                          : '';
                      return (
                        <option key={ap.name} value={ap.name} disabled={disabled}>
                          {ap.name} ({apRank != null ? `#${apRank} · ` : ''}Z {formatZ(apZ)}){reasonSuffix}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
            );
          })}

          {irStashes.map(stash => {
            const stashPlayer = activePlayers.find(p => p.name === stash.stashPlayerName);
            const stashRank = stashPlayer ? getMarketRank(rawCtx, stashPlayer.name) : null;
            const stashZ = stashPlayer ? rawCtx.puntValue(stashPlayer) : 0;
            const bestFaDisabled = isBestFaDisabledFor(stash.stashPlayerName);

            return (
              <div key={`stash-${stash.stashPlayerName}`} className="ir-sim-row enabled">
                <div className="ir-sim-player-side">
                  <button
                    type="button"
                    className="ir-sim-toggle on"
                    onClick={() => onRemoveStash?.(stash.stashPlayerName)}
                    aria-pressed="true"
                    title="Click to return player to active roster"
                  >
                    <span className="ir-sim-toggle-dot" />
                    <span>On IR</span>
                  </button>

                  <div className="ir-sim-player-meta">
                    <div className="ir-sim-name-line">
                      <span className="ir-sim-name">{stash.stashPlayerName}</span>
                      <span className="sp-ir-stash-tag">→ IL</span>
                      {stashPlayer?.status && (
                        <span className="sp-status-tag">{stashPlayer.status}</span>
                      )}
                      {stashRank != null && <span className="ir-sim-rank">#{stashRank}</span>}
                      {stashPlayer && <span className="ir-sim-z">Z {formatZ(stashZ)}</span>}
                    </div>
                  </div>
                </div>

                <div className="ir-sim-replace-side">
                  <span className="ir-sim-arrow" aria-hidden="true">replaced by →</span>
                  <select
                    className="ir-sim-select"
                    value={stash.replaceWith || '__NONE__'}
                    onChange={e => onChangeStashReplace?.(stash.stashPlayerName, e.target.value)}
                    aria-label={`Select free agent replacement for ${stash.stashPlayerName}`}
                  >
                    <option value="__NONE__">No replacement (exclude from active)</option>
                    <option value="__BEST_FA__" disabled={bestFaDisabled}>
                      {bestFaLabel}{bestFaDisabled ? ' [already claimed]' : ''}
                    </option>
                    {freeAgents.length > 0 && (
                      <optgroup label="Available Free Agents">
                        {freeAgents.map(fa => {
                          const faRank = getMarketRank(rawCtx, fa.name);
                          const faZ = rawCtx.puntValue(fa);
                          const disabled = isFaClaimedByOther(stash.stashPlayerName, fa.name);
                          return (
                            <option key={fa.name} value={fa.name} disabled={disabled}>
                              {fa.name}{fa.status ? ` [${fa.status}]` : ''} ({faRank != null ? `#${faRank} · ` : ''}Z {formatZ(faZ)}){disabled ? ' [already claimed]' : ''}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                  </select>
                  <button
                    type="button"
                    className="ir-sim-remove-btn"
                    onClick={() => onRemoveStash?.(stash.stashPlayerName)}
                    title={`Remove ${stash.stashPlayerName} from IR simulator`}
                    aria-label={`Remove ${stash.stashPlayerName} from IR simulator`}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pickerVisible ? (
        <div className={`ir-sim-stash-picker ${(irPlayers.length > 0 || irStashes.length > 0) ? 'with-divider' : ''}`}>
          {injuredCandidates.length > 0 && (
            <div className="ir-sim-quick-row">
              <span className="ir-sim-quick-label">Quick stash injured:</span>
              {injuredCandidates.map(p => (
                <button
                  key={p.name}
                  type="button"
                  className="ir-sim-quick-chip"
                  onClick={() => onAddStash?.(p.name, '__NONE__')}
                  title={`Move ${p.name} (${p.status}) onto IR to simulate roster & trade win %`}
                >
                  🏥 Stash {p.name} ({p.status})
                </button>
              ))}
            </div>
          )}

          <div className="ir-sim-stash-select-row">
            <label className="ir-sim-picker-label" htmlFor="ir-stash-player-select">
              Move to IR:
            </label>
            <select
              id="ir-stash-player-select"
              className="ir-sim-select"
              value=""
              disabled={unclaimedActive.length === 0}
              onChange={e => {
                if (e.target.value) onAddStash?.(e.target.value, '__NONE__');
              }}
            >
              <option value="">
                {unclaimedActive.length > 0
                  ? 'Select active player to move to IR…'
                  : 'No active players available to stash'}
              </option>
              {injuredCandidates.length > 0 && (
                <optgroup label="Injured / Questionable">
                  {injuredCandidates.map(p => {
                    const r = getMarketRank(rawCtx, p.name);
                    return (
                      <option key={p.name} value={p.name}>
                        {p.name} ({p.status}) — {r != null ? `#${r} · ` : ''}Z {formatZ(rawCtx.puntValue(p))}
                      </option>
                    );
                  })}
                </optgroup>
              )}
              {healthyCandidates.length > 0 && (
                <optgroup label="Active Roster">
                  {healthyCandidates.map(p => {
                    const r = getMarketRank(rawCtx, p.name);
                    return (
                      <option key={p.name} value={p.name}>
                        {p.name} — {r != null ? `#${r} · ` : ''}Z {formatZ(rawCtx.puntValue(p))}
                      </option>
                    );
                  })}
                </optgroup>
              )}
            </select>

            {irPlayers.length > 0 && (
              <button
                type="button"
                className="btn-ghost ir-sim-stash-hide-btn"
                onClick={() => setShowStashPicker(false)}
              >
                Hide
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="ir-sim-stash-bar">
          <button
            type="button"
            className="btn-ghost ir-sim-stash-add-btn"
            onClick={() => setShowStashPicker(true)}
          >
            + Stash active/injured player on IR
          </button>
        </div>
      )}

      {irDelta && activeSimCount > 0 && (
        <div className="ir-sim-impact-box">
          <div className="ir-sim-impact-main">
            <span className="ir-sim-impact-label">IR Δ Expected Category Wins / Week</span>
            <span className={`ir-sim-impact-delta ${irDelta.delta >= 0 ? 'z-elite' : 'z-bad'}`}>
              {signed(irDelta.delta)}
            </span>
          </div>
          <div className="ir-sim-impact-meta">
            <span>
              {irDelta.beforeTotal.toFixed(2)} → <strong>{irDelta.afterTotal.toFixed(2)}</strong> of {irDelta.activeCount} cats
            </span>
            <span className="impact-sub-sep">·</span>
            <span title="Sum of punt-adjusted Z of activated/added players minus replaced/stashed players">
              Punt-adj. Z: <strong className={irDelta.netZ >= 0 ? 'z-elite' : 'z-bad'}>{signed(irDelta.netZ)}</strong>
              {' '}({signed(irDelta.inZ, 1)} in / {signed(irDelta.outZ, 1)} out)
            </span>
          </div>
          {irDelta.posWarnings?.length > 0 && (
            <div className="ir-sim-impact-pos-warn">
              🧩 Positional coverage: {irDelta.posWarnings.map(w => w.text).join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
