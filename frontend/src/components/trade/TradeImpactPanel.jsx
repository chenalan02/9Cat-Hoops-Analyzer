import { CATEGORIES } from '../../utils/zScore.js';
import { formatZ } from '../../utils/formatters.js';
import { PROJ_GAMES, isActiveSlot, computeYahooFairness, comparePositionImpact } from '../../utils/tradeEngine.js';
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
  appliedIrSwaps = [],
  rawCtx = null,
  rawWins = null,
  rawRanks = null,
  compareVsRaw = false,
  setCompareVsRaw = null,
  onResetIr = null,
}) {
  const verdict = evaluation ? verdictFor(
    hasChanges && appliedIrSwaps.length > 0 && compareVsRaw && rawWins
      ? evaluation.my.after.total - rawWins.total
      : evaluation.my.delta
  ) : null;
  const pCatChanges = evaluation?.partner && partnerTeam
    ? CATEGORIES
        .map(cat => ({ cat, d: evaluation.partner.catChanges?.[cat.key]?.probDelta ?? 0 }))
        .filter(x => !partnerPuntsSet.has(x.cat.key))
    : [];
  const topGains = pCatChanges.filter(x => x.d >= 0.008).sort((a, b) => b.d - a.d).slice(0, 2);
  const topLosses = pCatChanges.filter(x => x.d <= -0.008).sort((a, b) => a.d - b.d).slice(0, 2);
  const partnerVerdictMeta = evaluation?.partner ? partnerVerdict(evaluation.partner.delta) : null;
  const yahooFairness = evaluation ? computeYahooFairness(ctx, outList, inList) : null;

  const isIrPreviewOnly = !hasChanges && appliedIrSwaps.length > 0 && Boolean(rawCtx && rawWins && rawRanks);
  const isIrWithTrade = hasChanges && Boolean(evaluation) && appliedIrSwaps.length > 0;
  const useRawBaseline = isIrWithTrade && compareVsRaw && Boolean(rawCtx && rawWins && rawRanks);

  const irActivatedList = appliedIrSwaps.map(s => s.irPlayer).filter(Boolean);
  const irReplacedList = appliedIrSwaps.map(s => s.replacePlayer).filter(Boolean);
  const irSummaryText = appliedIrSwaps
    .map(s => {
      if (s.type === 'stash') {
        return s.irPlayer
          ? `IR: ${s.replacePlayer.name} (+${s.irPlayer.name})`
          : `IR: ${s.replacePlayer.name}`;
      }
      return s.replacePlayer
        ? `+${s.irPlayer.name} (−${s.replacePlayer.name})`
        : `+${s.irPlayer.name}`;
    })
    .join(', ');

  let irPreviewDelta = null;
  let irPreviewVerdict = null;
  let irPreviewZ = null;
  let irPreviewPosWarnings = [];
  if (isIrPreviewOnly) {
    irPreviewDelta = baseWins.total - rawWins.total;
    irPreviewVerdict = verdictFor(irPreviewDelta);
    const inZ = irActivatedList.reduce((sum, p) => sum + rawCtx.puntValue(p), 0);
    const outZ = irReplacedList.reduce((sum, p) => sum + rawCtx.puntValue(p), 0);
    irPreviewZ = { inZ, outZ, net: inZ - outZ };
    const rawTeam = rawCtx.teamById.get(myTeamId);
    const effTeam = ctx.teamById.get(myTeamId);
    if (rawTeam && effTeam) {
      irPreviewPosWarnings = comparePositionImpact(rawTeam.players, effTeam.players, ctx.rosterPositions);
    }
  }

  let displayZSummary = zSummary;
  if (useRawBaseline && zSummary && rawCtx) {
    const irInZ = irActivatedList.reduce((sum, p) => sum + rawCtx.puntValue(p), 0);
    const irOutZ = irReplacedList.reduce((sum, p) => sum + rawCtx.puntValue(p), 0);
    displayZSummary = {
      inZ: zSummary.inZ + irInZ,
      outZ: zSummary.outZ + irOutZ,
      net: zSummary.net + (irInZ - irOutZ),
    };
  }

  const beforeDistMap = (isIrPreviewOnly || useRawBaseline)
    ? rawCtx.distById.get(myTeamId)
    : ctx.distById.get(myTeamId);
  const beforeWinsObj = (isIrPreviewOnly || useRawBaseline) ? rawWins : baseWins;
  const beforeRanksObj = (isIrPreviewOnly || useRawBaseline) ? rawRanks : baseRanks;

  const afterDistMap = isIrPreviewOnly
    ? ctx.distById.get(myTeamId)
    : evaluation?.distAfter;
  const afterWinsObj = isIrPreviewOnly ? baseWins : evaluation?.my.after;
  const afterRanksObj = isIrPreviewOnly ? baseRanks : evaluation?.ranksAfter;
  const showBarChange = Boolean(evaluation || isIrPreviewOnly);

  const summaryDelta = isIrPreviewOnly
    ? irPreviewDelta
    : useRawBaseline
      ? evaluation.my.after.total - rawWins.total
      : evaluation?.my.delta;

  const summaryZ = isIrPreviewOnly ? irPreviewZ : displayZSummary;
  const summaryVerdict = isIrPreviewOnly ? irPreviewVerdict : verdict;

  return (
    <div className="trade-impact">
      {isIrWithTrade && (
        <div className="trade-balance-alert ir-sim">
          <span className="tba-icon">🏥</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <strong>IR Sim Active:</strong> <span>{irSummaryText}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <label
                  className="stream-spot-toggle"
                  title="Measure delta against your current Yahoo roster instead of the post-IR baseline"
                >
                  <input
                    type="checkbox"
                    checked={compareVsRaw}
                    onChange={e => setCompareVsRaw?.(e.target.checked)}
                  />
                  <span>Compare vs. current Yahoo roster</span>
                </label>
                {onResetIr && (
                  <button type="button" className="btn-ghost ir-banner-reset" onClick={onResetIr}>
                    Reset IR
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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

      {(evaluation?.myPosWarnings?.length > 0 || irPreviewPosWarnings.length > 0) && (
        <div className={`trade-balance-alert ${(isIrPreviewOnly ? irPreviewPosWarnings : evaluation.myPosWarnings).some(w => w.severity === 'error') ? 'danger' : 'warning'}`}>
          <span className="tba-icon">🧩</span>
          <div>
            <strong>Positional coverage:</strong>{' '}
            {(isIrPreviewOnly ? irPreviewPosWarnings : evaluation.myPosWarnings).map(w => w.text).join(' · ')}
          </div>
        </div>
      )}

      <div className={`impact-summary card ${showBarChange ? (summaryDelta >= 0.08 ? 'impact-positive' : summaryDelta <= -0.08 ? 'impact-negative' : '') : ''}`}>
        <div className="impact-label">
          {isIrPreviewOnly
            ? 'Δ Expected Category Wins / Week — IR Roster Preview'
            : useRawBaseline
              ? 'Δ Expected Category Wins / Week (vs current Yahoo roster)'
              : 'Δ Expected Category Wins / Week (vs league)'}
        </div>
        {showBarChange ? (
          <>
            <div className={`impact-delta ${summaryDelta >= 0 ? 'z-elite' : 'z-bad'}`}>
              {signed(summaryDelta)}
            </div>
            <div className="impact-sub">
              <span>{beforeWinsObj.total.toFixed(2)} → <strong>{afterWinsObj.total.toFixed(2)}</strong> of {activeCount} cats</span>
              <span className="impact-sub-sep">·</span>
              <span title="Sum of punt-adjusted Z of incoming/activated minus outgoing/replaced">
                Punt-adj. Z: <strong className={summaryZ.net >= 0 ? 'z-elite' : 'z-bad'}>{signed(summaryZ.net)}</strong>
                {' '}({signed(summaryZ.inZ, 1)} in / {signed(summaryZ.outZ, 1)} out)
              </span>
            </div>
            <div className={`impact-verdict ${summaryVerdict.cls}`}>
              {isIrPreviewOnly ? `IR Sim: ${summaryVerdict.text}` : summaryVerdict.text}
            </div>
            {!isIrPreviewOnly && Math.sign(summaryDelta) !== Math.sign(summaryZ.net) && Math.abs(summaryZ.net) > 0.5 && Math.abs(summaryDelta) > 0.05 && (
              <div className="impact-note">
                {summaryZ.net > 0
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
              {yahooFairness && (
                <span
                  className={`tc-badge ${yahooFairness.cls}`}
                  style={{ marginTop: '0.35rem', alignSelf: 'flex-end' }}
                  title={`Perceived fairness using Yahoo rankings (${yahooFairness.detail})`}
                >
                  {yahooFairness.label} · {yahooFairness.detail}
                </span>
              )}
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
          ) : isIrPreviewOnly ? (
            <AssetExchangeGrid
              inList={irActivatedList}
              outList={irReplacedList}
              source={statsSource}
              puntedCats={puntedCats}
            />
          ) : (
            <div className="impact-placeholder">Select players to see category differentials</div>
          )
        ) : (
          <div className="cat-bar-list">
            <div className="cat-legend-bar">
              <span className="legend-dot before" /> {isIrPreviewOnly ? 'Current win %' : 'Current win %'}
              {showBarChange && (
                <>
                  &nbsp; <span className="legend-dot after" /> Gain
                  &nbsp; <span className="legend-dot loss" /> Drop
                </>
              )}
              <span className="cat-legend-note">
                Tick = 50% league avg · Weekly totals assume {PROJ_GAMES} gm/wk
              </span>
            </div>
            <div className="cir-header">
              <span>Cat</span>
              <span className="cir-header-scale">
                <span>0%</span>
                <span>Win Chance (50%)</span>
                <span>100%</span>
              </span>
              <span>Odds & Rank</span>
              <span style={{ textAlign: 'right' }}>Weekly Proj</span>
            </div>
            {CATEGORIES.map(cat => (
              <CatBar
                key={cat.key}
                cat={cat}
                before={beforeDistMap[cat.key].mu}
                after={afterDistMap?.[cat.key].mu}
                probBefore={beforeWinsObj.perCat[cat.key]}
                probAfter={afterWinsObj?.perCat[cat.key]}
                rankBefore={beforeRanksObj[cat.key]}
                rankAfter={afterRanksObj?.[cat.key]}
                punted={puntedCats.has(cat.key)}
                showChange={showBarChange}
              />
            ))}
          </div>
        )}
      </div>

      {(hasChanges || isIrPreviewOnly) && (
        <div className="player-delta-panel card">
          <div className="impact-cats-header">
            <span>
              {isIrPreviewOnly
                ? 'IR Swap Breakdown'
                : `Player Breakdown (${ctx.replacement.isRealFreeAgent ? `waiver benchmark: ${ctx.replacement.name}, ` : 'waiver replacement: '}Z ${formatZ(ctx.replacement.puntZ)})`}
            </span>
          </div>
          <div className="player-delta-grid">
            {(isIrPreviewOnly
              ? irReplacedList.map(p => ({ ...p, selected_position: p._origSelectedPosition || p.selected_position }))
              : outList
            ).map(p => (
              <PlayerBreakdownCard key={`out-${p.name}`} p={p} kind="out" ctx={ctx} puntedCats={puntedCats} />
            ))}
            {(isIrPreviewOnly
              ? irActivatedList.map(p => ({ ...p, selected_position: 'BN' }))
              : inList
            ).map(p => (
              <PlayerBreakdownCard key={`in-${p.name}`} p={p} kind="in" ctx={ctx} puntedCats={puntedCats} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
