import { STREAMER_POS_FILTERS, STREAMER_CAT_FILTERS } from '../../utils/streamerHelpers.js';

export default function StreamerFilterToolbar({
  posFilter,
  setPosFilter,
  boostCatFilter,
  setBoostCatFilter,
  sortBy,
  setSortBy,
  healthyOnly,
  setHealthyOnly,
  dismissedCount,
  onRestoreDismissed,
}) {
  return (
    <div className="streamer-filter-bar card">
      <div className="sf-pills">
        {STREAMER_POS_FILTERS.map(pos => (
          <button
            key={pos}
            type="button"
            className={`sf-pill ${posFilter === pos ? 'active' : ''}`}
            onClick={() => setPosFilter(pos)}
          >
            {pos === 'ALL' ? 'All Pos' : pos}
          </button>
        ))}
      </div>

      <div className="sf-controls">
        <select className="sf-select" value={boostCatFilter} onChange={e => setBoostCatFilter(e.target.value)} aria-label="Filter by category boost">
          <option value="ALL">Boosts Any Cat</option>
          {STREAMER_CAT_FILTERS.filter(c => c !== 'ALL').map(c => (
            <option key={c} value={c}>Boosts {c}</option>
          ))}
        </select>

        <select className="sf-select" value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Sort streamers">
          <option value="delta_e">Sort: Impact (ΔE)</option>
          <option value="games">Sort: Startable Games</option>
          <option value="ros_rank">Sort: ROS Rank</option>
          <option value="pts">Sort: PTS / gm</option>
          <option value="reb">Sort: REB / gm</option>
          <option value="ast">Sort: AST / gm</option>
          <option value="stl">Sort: STL / gm</option>
          <option value="blk">Sort: BLK / gm</option>
          <option value="fg3m">Sort: 3PM / gm</option>
        </select>

        <label className="sf-check" title="Hide GTD / Q / Doubtful / Out players">
          <input type="checkbox" checked={healthyOnly} onChange={e => setHealthyOnly(e.target.checked)} />
          <span>Healthy only</span>
        </label>

        {dismissedCount > 0 && (
          <button type="button" className="sf-reset-hidden-btn" onClick={onRestoreDismissed}>
            Restore {dismissedCount} hidden
          </button>
        )}
      </div>
    </div>
  );
}
