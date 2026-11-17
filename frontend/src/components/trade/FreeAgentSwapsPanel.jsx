import { CATEGORIES } from '../../utils/zScore.js';
import { formatZ } from '../../utils/formatters.js';
import { PROJ_GAMES } from '../../utils/tradeEngine.js';
import { POS_FILTERS, signed, fmtCatDelta } from './tradeFormatters.js';

export default function FreeAgentSwapsPanel({
  ctx,
  puntedCats,
  dropRows,
  dropFocus,
  setDropFocus,
  posFilter,
  setPosFilter,
  catFilter,
  setCatFilter,
  hideOutFas,
  setHideOutFas,
  swaps,
  faLoading,
  faError,
  onLoadSwap,
}) {
  return (
    <div className="suggest-layout">
      <div className="sell-panel card">
        <div className="impact-cats-header" style={{ marginBottom: '0.5rem' }}>
          <span>Your Active Roster</span>
        </div>
        <p className="suggest-help">
          Ranked by how much an available free agent can upgrade each roster spot under your punt build. Click any player to compare specific switches.
        </p>

        <button
          type="button"
          className={`sell-row auto ${dropFocus === '__AUTO__' ? 'selected' : ''}`}
          onClick={() => setDropFocus('__AUTO__')}
        >
          <span className="sell-name">⚡ Auto — best upgrades across roster</span>
        </button>

        {dropRows.map(r => {
          const hasUpgrade = !r.isProtected && r.bestFaDelta != null && r.bestFaDelta >= 0.015;
          return (
            <button
              key={r.player.name}
              type="button"
              className={`sell-row ${dropFocus === r.player.name ? 'selected' : ''} ${dropFocus === '__AUTO__' && r.autoDropEligible && hasUpgrade ? 'in-auto' : ''}`}
              onClick={() => setDropFocus(r.player.name)}
            >
              <div className="sell-row-top">
                <span className="sell-name" title={r.player.name}>
                  {r.player.name}
                  {r.player.status && <span className="sp-status-tag">{r.player.status}</span>}
                </span>
                {r.marketRank != null && (
                  <span
                    className="sp-rank"
                    title={`Model rank #${r.marketRank}${r.yahooRank != null ? ` · Yahoo #${r.yahooRank}` : ''}`}
                  >
                    #{r.marketRank}
                  </span>
                )}
              </div>
              <div className="sell-row-stats">
                <span>
                  Punt Z {formatZ(r.puntZ)}
                  {r.yahooRank != null ? ` · Y! #${r.yahooRank}` : ''}
                </span>
                {r.isProtected ? (
                  <span className="z-muted" title="Protected from Auto waiver drops; click manually to inspect">
                    Protected
                  </span>
                ) : r.bestFaDelta != null ? (
                  <span className={hasUpgrade ? 'z-elite' : ''}>
                    {hasUpgrade ? `${signed(r.bestFaDelta)} vs ${r.bestFa.name}` : 'No FA upgrade'}
                  </span>
                ) : (
                  <span>{faLoading ? 'Checking FAs…' : '—'}</span>
                )}
              </div>
              {r.protectionLabel && (
                <div className="sell-tags">
                  <span className="sell-tag cornerstone">{r.protectionLabel}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="targets-panel">
        <div className="targets-header card">
          <div>
            <div className="targets-title">
              Free Agent Switches {dropFocus === '__AUTO__' ? 'for your active roster' : `to replace ${dropFocus}`}
            </div>
            <div className="suggest-help" style={{ margin: 0 }}>
              1-for-1 waiver swaps scored by Δ expected H2H category wins / week ({PROJ_GAMES} gm/wk) against the league under your active punt build.
            </div>
          </div>
          <label className="tf-check" style={{ marginLeft: 0 }}>
            <input type="checkbox" checked={hideOutFas} onChange={e => setHideOutFas(e.target.checked)} />
            <span>Hide OUT / INJ free agents</span>
          </label>
        </div>

        <div className="targets-filter-bar card">
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
            <select className="tf-select" value={catFilter} onChange={e => setCatFilter(e.target.value)} aria-label="Filter by category boost">
              <option value="all">Boosts Any Cat</option>
              {CATEGORIES.map(c => (
                <option key={c.key} value={c.key}>Boosts {c.key}</option>
              ))}
            </select>
          </div>
        </div>

        {faLoading ? (
          <div className="card impact-placeholder" style={{ textAlign: 'center', padding: '2rem' }}>
            Fetching available free agents from Yahoo Fantasy…
          </div>
        ) : faError ? (
          <div className="card impact-placeholder" style={{ textAlign: 'center', padding: '2rem' }}>
            Unable to load league free agents right now. Try refreshing or switching back shortly.
          </div>
        ) : swaps.length === 0 ? (
          <div className="card impact-placeholder" style={{ textAlign: 'center', padding: '2rem' }}>
            {dropFocus === '__AUTO__'
              ? 'No free agents currently improve your active roster under these filters. Click a specific player on the left to compare lateral swaps.'
              : 'No free agents match the current position/category filters.'}
          </div>
        ) : (
          <div className="targets-grid">
            {swaps.map(s => {
              const positive = s.myDelta >= 0;
              return (
                <div key={s.id} className={`target-card ${positive ? 'win-win' : ''}`}>
                  <div className="tc-format-row">
                    <span className="tc-format-pill fmt-fa">Waiver Swap</span>
                    <span className={`tc-badge ${s.puntZDelta >= 0 ? 'good' : 'neutral'}`}>
                      Punt Z {signed(s.puntZDelta, 1)}
                    </span>
                  </div>

                  <div className="tc-top">
                    <div className="tc-swap">
                      <div className="tc-player give">
                        <span className="tc-label">Drop</span>
                        <div className="tc-player-item">
                          <span className="tc-name" title={s.drop.name}>
                            {s.drop.name}
                            {s.drop.status && <span className="sp-status-tag">{s.drop.status}</span>}
                          </span>
                          <span className="tc-meta">
                            #{s.dropRank ?? '—'}{s.dropYahooRank != null ? ` · Y! #${s.dropYahooRank}` : ''} · {s.drop.nba_team} · {s.drop.positions}
                          </span>
                        </div>
                      </div>
                      <span className="tc-arrow">⇄</span>
                      <div className="tc-player get">
                        <span className="tc-label">Add FA</span>
                        <div className="tc-player-item">
                          <span className="tc-name" title={s.add.name}>
                            {s.add.name}
                            {s.add.status && <span className="sp-status-tag">{s.add.status}</span>}
                          </span>
                          <span className="tc-meta">
                            #{s.addRank ?? '—'}{s.addYahooRank != null ? ` · Y! #${s.addYahooRank}` : ''} · {s.add.nba_team} · {s.add.positions}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className={`tc-delta ${positive ? '' : 'negative'}`} title="Change in your expected H2H category wins per week vs the league">
                      <span className="tc-delta-val">{signed(s.myDelta)}</span>
                      <span className="tc-delta-lbl">cat wins / wk</span>
                    </div>
                  </div>

                  {s.reasonTags.length > 0 && (
                    <div className="tc-badges">
                      {s.reasonTags.map(tag => (
                        <span
                          key={tag}
                          className={`tc-badge ${tag.startsWith('Caution') ? 'warn' : tag.startsWith('Boosts') || tag.startsWith('Clear') || tag.startsWith('Replaces') ? 'good' : 'info'}`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {s.posWarnings?.length > 0 && (
                    <div className="tc-pos-warn">⚠️ {s.posWarnings[0].text}</div>
                  )}

                  <div className="tc-cats">
                    {CATEGORIES.map(cat => {
                      const c = s.catChanges[cat.key];
                      const punted = puntedCats.has(cat.key);
                      const cls = punted ? 'punted' : c.probDelta > 0.005 ? 'pos' : c.probDelta < -0.005 ? 'neg' : 'flat';
                      return (
                        <span
                          key={cat.key}
                          className={`tc-cat ${cls}`}
                          title={`${cat.label}: weekly ${fmtCatDelta(cat, c.muDelta)} · win chance ${signed(c.probDelta * 100, 1)} pts`}
                        >
                          <span className="tc-cat-key">{cat.key}</span>
                          <span className="tc-cat-val">{fmtCatDelta(cat, c.muDelta)}</span>
                        </span>
                      );
                    })}
                  </div>

                  <button type="button" className="tc-load-btn" onClick={() => onLoadSwap(s)}>
                    Open in Trade Analyzer →
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="method-note">
          <strong>How this works:</strong> simulates dropping a current active player for each available free agent using your chosen projection source ({ctx.source.toUpperCase()} × {PROJ_GAMES} gm/wk) and punt build, then recomputes expected H2H category wins against every team in the league.
        </div>
      </div>
    </div>
  );
}
