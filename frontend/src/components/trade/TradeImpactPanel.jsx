import { CATEGORIES } from '../../utils/zScore.js';
import { formatZ } from '../../utils/formatters.js';
import { PROJ_GAMES, isActiveSlot } from '../../utils/tradeEngine.js';
import { signed, verdictFor, partnerVerdict } from './tradeFormatters.js';
import AssetExchangeGrid from './AssetExchangeGrid.jsx';
import CatBar from './CatBar.jsx';
import PlayerBreakdownCard from './PlayerBreakdownCard.jsx';

export default function TradeImpactPanel({
  ctx,
  myTeamId,
  statsSource,
  puntedCats,
  activeCount,
  baseWins,
  baseRanks,
  outList,
  inList,
  hasChanges,
  evaluation,
  zSummary,
  impactView,
  setImpactView,
  streamOpenSpot,
  setStreamOpenSpot,
  partnerTeam,
  partnerPuntsSet,
  partnerActiveCats,
  onTogglePartnerPunt,
}) {
  const verdict = evaluation ? verdictFor(evaluation.my.delta) : null;
  const pCatChanges = evaluation?.partner && partnerTeam
    ? CATEGORIES
        .map(cat => ({ cat, d: evaluation.partner.catChanges?.[cat.key]?.probDelta ?? 0 }))
        .filter(x => !partnerPuntsSet.has(x.cat.key))
    : [];
  const topGains = pCatChanges.filter(x => x.d >= 0.008).sort((a, b) => b.d - a.d).slice(0, 2);
  const topLosses = pCatChanges.filter(x => x.d <= -0.008).sort((a, b) => a.d - b.d).slice(0, 2);
  const partnerVerdictMeta = evaluation?.partner ? partnerVerdict(evaluation.partner.delta) : null;

  return (
    <div className="trade-impact">
      {evaluation && evaluation.my.drops.length > 0 && (
        <div className="trade-balance-alert warning">
          <span className="tba-icon">⚠️</span>
          <div>
            <strong>Uneven trade ({inList.length} in, {outList.filter(isActiveSlot).length} out):</strong>
            <span> you'll need to drop {evaluation.my.drops.length} player{evaluation.my.drops.length > 1 ? 's' : ''} to stay at roster size.</span>
            <div className="tba-sub">
              Assumed drop (lowest punt-adjusted value): <strong>{evaluation.my.drops.map(p => `${p.name} (Z ${formatZ(ctx.puntValue(p))})`).join(', ')}</strong>
            </div>
          </div>
        </div>
      )}

      {evaluation && evaluation.my.fillers > 0 && (
        <div className="trade-balance-alert info">
          <span className="tba-icon">💡</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <strong>{inList.length === 0 ? 'Unpaired drop' : 'Consolidation trade'}:</strong>
                <span>
                  {' '}{evaluation.my.fillers} open spot{evaluation.my.fillers > 1 ? 's' : ''} filled with <strong>{ctx.replacement.name}</strong>
                  {ctx.replacement.isRealFreeAgent ? ` (best FA${ctx.replacement.rank ? `, #${ctx.replacement.rank}` : ''})` : ' (waiver proxy)'} at {ctx.replacement.streamingGames.toFixed(1)} gm/wk.
                </span>
              </div>
              <label className="stream-spot-toggle" title="Model active streaming out of the open roster spot (+1.5 games/wk over standard 3.5 gm/wk)">
                <input type="checkbox" checked={streamOpenSpot} onChange={e => setStreamOpenSpot(e.target.checked)} />
                <span>Stream open spot (+1.5 gm)</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {evaluation?.myPosWarnings?.length > 0 && (
        <div className={`trade-balance-alert ${evaluation.myPosWarnings.some(w => w.severity === 'error') ? 'danger' : 'warning'}`}>
          <span className="tba-icon">🧩</span>
          <div>
            <strong>Positional coverage:</strong>{' '}
            {evaluation.myPosWarnings.map(w => w.text).join(' · ')}
          </div>
        </div>
      )}

      <div className={`impact-summary card ${evaluation ? (evaluation.my.delta >= 0.08 ? 'impact-positive' : evaluation.my.delta <= -0.08 ? 'impact-negative' : '') : ''}`}>
        <div className="impact-label">Δ Expected Category Wins / Week (vs league)</div>
        {evaluation ? (
          <>
            <div className={`impact-delta ${evaluation.my.delta >= 0 ? 'z-elite' : 'z-bad'}`}>
              {signed(evaluation.my.delta)}
            </div>
            <div className="impact-sub">
              <span>{evaluation.my.before.total.toFixed(2)} → <strong>{evaluation.my.after.total.toFixed(2)}</strong> of {activeCount} cats</span>
              <span className="impact-sub-sep">·</span>
              <span title="Sum of punt-adjusted Z of incoming minus outgoing (incl. forced drops / waiver fillers)">
                Punt-adj. Z: <strong className={zSummary.net >= 0 ? 'z-elite' : 'z-bad'}>{signed(zSummary.net)}</strong>
                {' '}({signed(zSummary.inZ, 1)} in / {signed(zSummary.outZ, 1)} out)
              </span>
            </div>
            <div className={`impact-verdict ${verdict.cls}`}>{verdict.text}</div>
            {Math.sign(evaluation.my.delta) !== Math.sign(zSummary.net) && Math.abs(zSummary.net) > 0.5 && Math.abs(evaluation.my.delta) > 0.05 && (
              <div className="impact-note">
                {zSummary.net > 0
                  ? 'You gain raw value, but it lands in categories you already win, lose comfortably, or punt.'
                  : 'You give up raw value, but the stats you gain land in your competitive categories — a fit-driven win.'}
              </div>
            )}
          </>
        ) : (
          <div className="impact-placeholder">Select players to analyze trade impact — or try the Trade Suggestions tab.</div>
        )}
      </div>

      {evaluation?.partner && partnerTeam && (
        <div className="partner-card card">
          <div className="partner-card-top">
            <div className="partner-card-left">
              <span className="impact-label" style={{ marginBottom: 2 }}>Partner perspective</span>
              <span className="partner-name">{partnerTeam.name}</span>
              <span className="partner-sub">
                {evaluation.partner.before.total.toFixed(2)} → {evaluation.partner.after.total.toFixed(2)} wins
                {' '}({partnerPuntsSet.size === 0 ? 'all 9 cats' : `${partnerActiveCats.size} cats`})
                {evaluation.partner.drops.length > 0 && ` · would drop ${evaluation.partner.drops.map(p => p.name).join(', ')}`}
              </span>
              {(topGains.length > 0 || topLosses.length > 0) && (
                <div className="partner-cat-movers">
                  {topGains.map(({ cat, d }) => (
                    <span key={cat.key} className="pcm-chip good">+{cat.key} {signed(d * 100, 1)}%</span>
                  ))}
                  {topLosses.map(({ cat, d }) => (
                    <span key={cat.key} className="pcm-chip bad">{cat.key} {signed(d * 100, 1)}%</span>
                  ))}
                </div>
              )}
              {evaluation.partner.posWarnings?.length > 0 && (
                <span className="partner-pos-warn">⚠️ Partner fit: {evaluation.partner.posWarnings[0].text}</span>
              )}
            </div>
            <div className="partner-card-right">
              <span className={`partner-delta ${evaluation.partner.delta >= 0 ? 'z-elite' : 'z-bad'}`}>{signed(evaluation.partner.delta)}</span>
              <span className={`partner-verdict ${partnerVerdictMeta.cls}`}>{partnerVerdictMeta.text}</span>
            </div>
          </div>
          <div className="partner-punt-bar">
            <span className="partner-punt-lbl">Model partner punts:</span>
            <div className="partner-punt-pills">
              {CATEGORIES.map(c => {
                const isPunted = partnerPuntsSet.has(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    className={`partner-punt-btn ${isPunted ? 'punted' : ''}`}
                    onClick={() => onTogglePartnerPunt(partnerTeam.team_id, c.key)}
                    title={isPunted ? `Un-punt ${c.key} for ${partnerTeam.name}` : `Model ${partnerTeam.name} punting ${c.key}`}
                  >
                    {c.key}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {evaluation && evaluation.partnerIds.length > 1 && (
        <div className="trade-balance-alert info">
          <span className="tba-icon">🔀</span>
          <div>Multi-team trade — partner acceptance can't be estimated because it's unclear which team receives your players.</div>
        </div>
      )}

      <div className="impact-cats card">
        <div className="impact-cats-header">
          <span>Category Impact</span>
          <div className="impact-view-tabs">
            <button className={`impact-tab-btn ${impactView === 'team' ? 'active' : ''}`} onClick={() => setImpactView('team')}>
              Full Team Weekly Totals
            </button>
            <button className={`impact-tab-btn ${impactView === 'exchange' ? 'active' : ''}`} onClick={() => setImpactView('exchange')}>
              Direct Asset Exchange
            </button>
          </div>
        </div>

        {impactView === 'exchange' ? (
          hasChanges ? (
            <AssetExchangeGrid
              inList={[...inList, ...Array.from({ length: evaluation?.my.fillers || 0 }, () => ctx.replacement)]}
              outList={[...outList.filter(isActiveSlot), ...(evaluation?.my.drops || [])]}
              source={statsSource}
              puntedCats={puntedCats}
            />
          ) : (
            <div className="impact-placeholder">Select players to see category differentials</div>
          )
        ) : (
          <div className="cat-bar-list">
            <div className="cat-legend-bar">
              <span className="legend-dot before" /> Current roster &nbsp;
              <span className="legend-dot after" /> After trade
              <span className="cat-legend-note">Weekly totals assume {PROJ_GAMES} games per active player</span>
            </div>
            {CATEGORIES.map(cat => (
              <CatBar
                key={cat.key}
                cat={cat}
                before={ctx.distById.get(myTeamId)[cat.key].mu}
                after={evaluation?.distAfter[cat.key].mu}
                probBefore={baseWins.perCat[cat.key]}
                probAfter={evaluation?.my.after.perCat[cat.key]}
                rankBefore={baseRanks[cat.key]}
                rankAfter={evaluation?.ranksAfter[cat.key]}
                punted={puntedCats.has(cat.key)}
                showChange={!!evaluation}
              />
            ))}
          </div>
        )}
      </div>

      {hasChanges && (
        <div className="player-delta-panel card">
          <div className="impact-cats-header">
            <span>
              Player Breakdown ({ctx.replacement.isRealFreeAgent ? `waiver benchmark: ${ctx.replacement.name}, ` : 'waiver replacement: '}Z {formatZ(ctx.replacement.puntZ)})
            </span>
          </div>
          <div className="player-delta-grid">
            {outList.map(p => <PlayerBreakdownCard key={p.name} p={p} kind="out" ctx={ctx} puntedCats={puntedCats} />)}
            {inList.map(p => <PlayerBreakdownCard key={p.name} p={p} kind="in" ctx={ctx} puntedCats={puntedCats} />)}
          </div>
        </div>
      )}
    </div>
  );
}
