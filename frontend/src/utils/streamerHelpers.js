import { readSessionJson, writeSessionJson } from '../services/storageCache.js';

export const MATCHUP_CACHE_STORAGE_KEY = '9cat_matchup_analysis_cache';
export const STREAMER_CACHE_STORAGE_KEY = '9cat_matchup_streamer_cache_v29';
export const STREAMER_PUNTS_STORAGE_KEY = '9cat_matchup_streamer_punts';
export const MATCHUP_OPP_STORAGE_KEY = '9cat_matchup_selected_opp';
export const MATCHUP_WEEK_STORAGE_KEY = '9cat_matchup_selected_week';

export const STREAMER_POS_FILTERS = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'];
export const STREAMER_CAT_FILTERS = ['ALL', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'TO'];

export const IR_SLOTS = new Set(['IL', 'IL+', 'IR', 'IR+', 'NA']);
export const OUT_STATUS_TAGS = new Set(['O', 'INJ', 'OUT', 'IL', 'INJURED', 'SUSP']);
export const Q_STATUS_TAGS = new Set(['Q', 'GTD', 'DTD', 'DOUBTFUL']);
export const ANY_INJ_TAGS = new Set([...OUT_STATUS_TAGS, ...Q_STATUS_TAGS]);

export function loadSavedPunts(teamKey) {
  if (!teamKey) return new Set();
  const parsed = readSessionJson(STREAMER_PUNTS_STORAGE_KEY);
  return Array.isArray(parsed?.[teamKey]) ? new Set(parsed[teamKey]) : new Set();
}

export function savePunts(teamKey, puntsSet) {
  if (!teamKey) return;
  const parsed = readSessionJson(STREAMER_PUNTS_STORAGE_KEY, {}) || {};
  parsed[teamKey] = [...puntsSet];
  writeSessionJson(STREAMER_PUNTS_STORAGE_KEY, parsed);
}

export function getCachedAnalysis(key) {
  if (!key) return null;
  const parsed = readSessionJson(MATCHUP_CACHE_STORAGE_KEY);
  return parsed?.[key] || null;
}

export function hasAnyCachedAnalysisForTeam(leagueId, myTeamId) {
  if (!myTeamId) return false;
  const parsed = readSessionJson(MATCHUP_CACHE_STORAGE_KEY);
  if (!parsed || typeof parsed !== 'object') return false;
  const prefix = `${leagueId || ''}-${myTeamId}-`;
  return Object.keys(parsed).some(k => k.startsWith(prefix) && parsed[k]);
}

export function getCachedStreamers(key) {
  if (!key) return null;
  const parsed = readSessionJson(STREAMER_CACHE_STORAGE_KEY);
  return parsed?.[key] || null;
}

export function setCachedStreamers(key, data) {
  if (!key || !data) return;
  const parsed = readSessionJson(STREAMER_CACHE_STORAGE_KEY, {}) || {};
  parsed[key] = data;
  const keys = Object.keys(parsed);
  if (keys.length > 25) delete parsed[keys[0]];
  writeSessionJson(STREAMER_CACHE_STORAGE_KEY, parsed);
}
