import { CATEGORIES } from '../../utils/zScore.js';
import { PROJ_GAMES } from '../../utils/tradeEngine.js';
import { POS_FILTERS } from './tradeFormatters.js';
import TradeTargetCard from './TradeTargetCard.jsx';

export default function TradeSuggestionsPanel({
  ctx,
  puntedCats,
  sellRows,
  autoSellSet,
  giveFocus,
  setGiveFocus,
  rankWindow,
  setRankWindow,
  tradeFormat,
  setTradeFormat,
  partnerFilter,
  setPartnerFilter,
  posFilter,
  setPosFilter,
  catFilter,
  setCatFilter,
  winWinOnly,
  setWinWinOnly,
  streamOpenSpot,
  setStreamOpenSpot,
  otherTeams,
  targets,
  onLoadTrade,
}) {
  return (
    <div className="suggest-layout">
      <div className="sell-panel card">
        <div className="impact-cats-header" style={{ marginBottom: '0.5rem' }}>
          <span>Players to Shop</span>
        </div>
        <p className="suggest-help">
          Surfaces players whose stats sit in your punted or already-saturated categories, while protecting un-punted core stars from Auto-scan.
        </p>

        <button
          type="button"
          className={`sell-row auto ${giveFocus === '__AUTO__' ? 'selected' : ''}`}
          onClick={() => setGiveFocus('__AUTO__')}
        >
          <span className="sell-name">⚡ Auto — scan top 5 candidates</span>
        </button>

        {sellRows.map(r => (
          <button
            key={r.player.name}
            type="button"
            className={`sell-row ${giveFocus === r.player.name ? 'selected' : ''} ${giveFocus === '__AUTO__' && autoSellSet.has(r.player.name) ? 'in-auto' : ''}`}
            onClick={() => setGiveFocus(r.player.name)}
          >
            <div className="sell-row-top">
              <span className="sell-name" title={r.player.name}>{r.player.name}</span>
              {r.marketRank != null && (
                <span className="sp-rank" title={`Projection rank (#${r.marketRank})`}>#{r.marketRank}</span>
              )}
            </div>
            <div className="sell-row-stats">
              <span
                title={
                  puntedCats.size > 0
                    ? `League 9-cat Z-rank (${r.overallRank}) vs rank under your punt build (${r.puntRank}). Blue badge is projection rank.`
                    : `9-cat Z-rank across rostered players (#${r.overallRank}); blue badge is projection rank (#${r.marketRank ?? '—'}).`
                }
              >
                {puntedCats.size > 0 ? (
                  <>
                    Build Rank {r.overallRank} → {r.puntRank}
                    {r.rankShift !== 0 && (
                      <strong className={r.rankShift > 0 ? 'z-bad' : 'z-elite'}>
                        {' '}({r.rankShift > 0 ? '▼' : '▲'}{Math.abs(r.rankShift)})
                      </strong>
                    )}
                  </>
                ) : (
                  <>9-Cat Rank #{r.overallRank}</>
                )}
              </span>
              <span title="Expected category wins per week this player adds over waiver replacement">
                {r.marginal >= 0 ? `+${r.marginal.toFixed(2)}` : `−${Math.abs(r.marginal).toFixed(2)}`} wins/wk
              </span>
            </div>
            {(r.tags.length > 0 || r.isCornerstone) && (
              <div className="sell-tags">
                {r.isCornerstone && <span className="sell-tag cornerstone" title="Protected from Auto-scan; click manually to explore offers">🔒 Cornerstone</span>}
                {r.tags.map(tag => <span key={tag} className="sell-tag">{tag}</span>)}
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="targets-panel">
        <div className="targets-header card">
          <div>
            <div className="targets-title">
              Trade Targets {giveFocus === '__AUTO__' ? 'for your top sell candidates' : `for ${giveFocus}`}
            </div>
            <div className="suggest-help" style={{ margin: 0 }}>
              Realistic 1-for-1 swaps (±{rankWindow} ranks), 2-for-1 upgrades{streamOpenSpot ? ' (with +1.5 gm open-spot streaming)' : ''}, and 1-for-2 depth splits — partner evaluated over 9-cat.
            </div>
          </div>
          <div className="targets-header-controls">
            <label className="stream-spot-toggle" title="Credit open 2-for-1 roster spot with +1.5 games/wk from active waiver streaming">
              <input type="checkbox" checked={streamOpenSpot} onChange={e => setStreamOpenSpot(e.target.checked)} />
              <span>Stream open spot (+1.5 gm)</span>
            </label>
            <label className="window-control">
              <span>1-for-1 window ±{rankWindow}</span>
              <input
                type="range"
                min="5"
                max="40"
                step="5"
                value={rankWindow}
                onChange={e => setRankWindow(Number(e.target.value))}
              />
            </label>
          </div>
        </div>

        <div className="targets-filter-bar card">
          <div className="tf-group">
            {[
              { key: 'all', label: 'All Deals' },
              { key: '1for1', label: '1-for-1' },
              { key: '2for1', label: '2-for-1 Upgrade' },
              { key: '1for2', label: '1-for-2 Depth' },
            ].map(f => (
              <button
                key={f.key}
                type="button"
                className={`tf-pill ${tradeFormat === f.key ? 'active' : ''}`}
                onClick={() => setTradeFormat(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="tf-group">
            {POS_FILTERS.map(pos => (
              <button
                key={pos}
                type="button"
                className={`tf-pill ${posFilter === pos ? 'active' : ''}`}
                onClick={() => setPosFilter(pos)}
              >
                {pos === 'all' ? 'Any Pos' : pos}
              </button>
            ))}
          </div>

          <div className="tf-selects">
            <select className="tf-select" value={partnerFilter} onChange={e => setPartnerFilter(e.target.value)} aria-label="Filter by trade partner">
              <option value="all">All Partners</option>
              {otherTeams.map(t => (
                <option key={t.team_id} value={String(t.team_id)}>{t.name}</option>
              ))}
            </select>

            <select className="tf-select" value={catFilter} onChange={e => setCatFilter(e.target.value)} aria-label="Filter by category boost">
              <option value="all">Boosts Any Cat</option>
              {CATEGORIES.map(c => (
                <option key={c.key} value={c.key}>Boosts {c.key}</option>
              ))}
            </select>

            <label className="tf-check">
              <input type="checkbox" checked={winWinOnly} onChange={e => setWinWinOnly(e.target.checked)} />
              <span>🤝 Win-win only</span>
            </label>
          </div>
        </div>

        {targets.length === 0 ? (
          <div className="card impact-placeholder" style={{ textAlign: 'center', padding: '2rem' }}>
            No upgrades found matching these filters. Try widening the rank window, clearing filters, or picking another shop candidate.
          </div>
        ) : (
          <div className="targets-grid">
            {targets.map(t => (
              <TradeTargetCard
                key={t.id}
                t={t}
                ctx={ctx}
                puntedCats={puntedCats}
                onLoad={onLoadTrade}
              />
            ))}
          </div>
        )}

        <div className="method-note">
          <strong>How this works:</strong> each team's weekly distribution per category is built from its active players' projected
          per-game means and variances × {PROJ_GAMES} games. For every opponent and non-punted category we compute the probability you
          win that category; summed and averaged across the league that gives <em>expected category wins per week</em>.
          Partners are scored on standard 9-cat (unless you model their punts in the Analyzer), and 2-for-1 open spots use {ctx.replacement.name} ({ctx.replacement.streamingGames.toFixed(1)} gm/wk).
        </div>
      </div>
    </div>
  );
}
