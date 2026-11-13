export const DRAFT_POOL_CACHE_KEY = '9cat_draft_pool_cache_v1';
export const DRAFT_ROOM_STATE_KEY = '9cat_draft_room_v2';
export const POS_FILTER_LIST = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C', 'G', 'F'];
export const OUT_STATUS_TAGS = new Set(['O', 'INJ', 'OUT', 'IL', 'IL+', 'NA']);

export const SOURCE_OPTIONS = [
  { key: 'preseason', label: 'Preseason', hint: 'Preseason fantasy draft projections' },
  { key: 'ros', label: 'ROS', hint: 'Rest-of-season projections' },
  { key: 'ema', label: 'EMA', hint: 'Recent form exponential moving average' },
];

export function buildDefaultTeamNames(count, prevNames = []) {
  return Array.from({ length: count }, (_, idx) => {
    const existing = prevNames[idx];
    return existing && existing.trim() ? existing : `Team ${idx + 1}`;
  });
}
