import { CATEGORIES, zScoreClass, zScoreBgClass } from '../../utils/zScore.js';
import { formatZ, formatMu } from '../../utils/formatters.js';
import SortIcon from '../common/SortIcon.jsx';
import { POS_FILTER_LIST, OUT_STATUS_TAGS } from './draftConstants.js';

export default function DraftBoardTable({
  searchQuery,
  onSearchChange,
  posFilter,
  onPosFilterChange,
  hideInjured,
  onHideInjuredChange,
  showAllRows,
  onToggleShowAllRows,
  filteredCount,
  sortedList,
  sortKey,
  sortDir,
  onSort,
  puntedCats,
  recommendedNameSet,
  queuedNameSet,
  isDraftComplete,
  onToggleQueue,
  onDraftPlayer,
}) {
  return (
    <div className="draft-main-board card">
      <div className="board-toolbar">
        <div className="search-box-wrapper">
          <input
            type="text"
            placeholder="🔍 Search player or NBA team..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="board-search-input"
            aria-label="Search players by name"
          />
          {searchQuery && (
            <button className="clear-search-btn" onClick={() => onSearchChange('')}>✕</button>
          )}
        </div>

        <div className="pos-filter-bar" style={{ marginBottom: 0 }}>
          {POS_FILTER_LIST.map(pos => (
            <button
              key={pos}
              type="button"
              className={`btn-ghost ${posFilter === pos ? 'active' : ''}`}
              onClick={() => onPosFilterChange(pos)}
            >
              {pos}
            </button>
          ))}
        </div>

        <div className="board-extra-toggles">
          <label className="board-check-label">
            <input
              type="checkbox"
              checked={hideInjured}
              onChange={(e) => onHideInjuredChange(e.target.checked)}
            />
            Healthy only
          </label>
          <button
            type="button"
            className="toggle-rows-btn"
            onClick={onToggleShowAllRows}
          >
            {showAllRows ? `Showing ${filteredCount}` : `Top 100 / ${filteredCount}`}
          </button>
        </div>
      </div>

      <div className="data-table-wrapper">
        <table className="data-table draft-table" aria-label="Available player rankings">
          <thead>
            <tr>
              <th
                className={sortKey === 'activeZSum' ? 'sort-active' : ''}
                onClick={() => onSort('activeZSum')}
                style={{ textAlign: 'center', width: 58 }}
                title="Rank under active punt strategy"
              >
                Rank <SortIcon active={sortKey === 'activeZSum'} dir={sortDir} />
              </th>
              {puntedCats.size > 0 && (
                <th
                  className={sortKey === 'baseRank' ? 'sort-active' : ''}
                  onClick={() => onSort('baseRank')}
                  style={{ textAlign: 'center', width: 52 }}
                  title="Baseline 9-Cat Rank"
                >
                  9-Cat <SortIcon active={sortKey === 'baseRank'} dir={sortDir} />
                </th>
              )}
              <th style={{ width: 28, textAlign: 'center' }} title="Queue target">★</th>
              <th
                className={sortKey === 'name' ? 'sort-active' : ''}
                onClick={() => onSort('name')}
                style={{ textAlign: 'left' }}
              >
                Player <SortIcon active={sortKey === 'name'} dir={sortDir} />
              </th>
              <th>Pos</th>
              <th>Team</th>
              <th
                className={sortKey === 'projGp' ? 'sort-active' : ''}
                onClick={() => onSort('projGp')}
                title="Projected Games Played"
              >
                PGP <SortIcon active={sortKey === 'projGp'} dir={sortDir} />
              </th>
              {CATEGORIES.map(cat => (
                <th
                  key={cat.key}
                  className={`${sortKey === cat.key ? 'sort-active' : ''} ${puntedCats.has(cat.key) ? 'punted-col' : ''}`}
                  onClick={() => onSort(cat.key)}
                  title={`${cat.label} — click to sort`}
                >
                  {cat.key} <SortIcon active={sortKey === cat.key} dir={sortDir} />
                </th>
              ))}
              <th
                className={sortKey === 'activeZSum' ? 'sort-active' : ''}
                onClick={() => onSort('activeZSum')}
                title="Sum of Z-scores across active categories"
              >
                ΣZ <SortIcon active={sortKey === 'activeZSum'} dir={sortDir} />
              </th>
              <th style={{ textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {sortedList.length > 0 ? (
              sortedList.map(player => {
                const isRec = recommendedNameSet.has(player.name);
                const isQueued = queuedNameSet.has(player.name);
                const isOut = OUT_STATUS_TAGS.has(String(player.status || '').toUpperCase().trim());
                return (
                  <tr key={player.name} className={isRec ? 'rec-highlight-row' : ''}>
                    <td style={{ textAlign: 'center', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--text-muted)' }}>#{player.overallRank}</span>
                      {puntedCats.size > 0 && player.rankDelta !== 0 && (
                        <span
                          className={`board-delta ${player.rankDelta > 0 ? 'z-good' : 'z-bad'}`}
                          title={`9-Cat #${player.baseRank} → Build #${player.overallRank}`}
                        >
                          {player.rankDelta > 0 ? `+${player.rankDelta}` : player.rankDelta}
                        </span>
                      )}
                    </td>
                    {puntedCats.size > 0 && (
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        #{player.baseRank}
                      </td>
                    )}
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className={`table-star-btn ${isQueued ? 'active' : ''}`}
                        onClick={() => onToggleQueue(player.name)}
                        title={isQueued ? 'Remove from Queue' : 'Add to Queue'}
                      >
                        {isQueued ? '★' : '☆'}
                      </button>
                    </td>
                    <td>
                      <div className="player-cell">
                        <span className="player-name" title={player.name}>{player.name}</span>
                        {isRec && <span className="rec-mini-pill">REC</span>}
                        {player.status && (
                          <span className={`status-mini-pill ${isOut ? 'out' : 'q'}`}>
                            {player.status}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="pos-badge" title={player.positions}>
                        {player.positions}
                      </span>
                    </td>
                    <td className="team-abbr">{player.nba_team || '—'}</td>
                    <td style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                      {player.projGp != null ? Math.round(player.projGp) : '—'}
                    </td>
                    {CATEGORIES.map(cat => {
                      const z = player.zScores?.[cat.key];
                      const rawVal = player.mus?.[cat.key];
                      const punted = puntedCats.has(cat.key);
                      return (
                        <td
                          key={cat.key}
                          className={`${zScoreBgClass(z)} ${punted ? 'punted-col' : ''}`}
                          title={`Z-Score: ${formatZ(z)}`}
                        >
                          <span className={zScoreClass(z)}>{formatMu(rawVal, cat.key)}</span>
                        </td>
                      );
                    })}
                    <td style={{ fontWeight: 800 }}>
                      <span className={player.activeZSum >= 0 ? 'z-good' : 'z-poor'}>
                        {player.activeZSum !== -999 ? formatZ(player.activeZSum) : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn-primary draft-action-btn"
                        onClick={() => onDraftPlayer(player)}
                        disabled={isDraftComplete}
                      >
                        Draft
                      </button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={CATEGORIES.length + (puntedCats.size > 0 ? 9 : 8)}
                  style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}
                >
                  No available players match your search or filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
