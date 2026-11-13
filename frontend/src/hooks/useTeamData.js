import { useState, useCallback } from 'react';
import { computeLeagueZScores } from '../utils/zScore.js';
import { syncLeague } from '../services/apiClient.js';
import {
  readSessionJson,
  writeSessionJson,
  readSessionString,
  writeSessionString,
  removeSessionKey,
  removeSessionKeysByPrefix,
} from '../services/storageCache.js';

const STORAGE_KEY = '9cat_league_data';
const MY_TEAM_ID_KEY = '9cat_my_team_id';
const FANTASY_LINK_KEY = '9cat_fantasy_link';
const MATCHUP_CACHE_PREFIXES = ['9cat_matchup_', '9cat_streamer_'];

function normalizeLegacyLeaguePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const rosterPositions = Array.isArray(payload.roster_positions)
    ? payload.roster_positions.map((item) => {
        if (!Array.isArray(item)) return item;
        if (item.length >= 4) {
          return { position: item[0], position_type: item[1], count: item[2], is_starting_position: item[3] };
        }
        if (item.length === 3) {
          return { position: item[0], count: item[1], is_starting_position: item[2] };
        }
        return item;
      })
    : payload.roster_positions;

  const teams = Array.isArray(payload.teams)
    ? payload.teams.map((team) => {
        if (!Array.isArray(team?.record)) return team;
        const [wins = 0, losses = 0, ties = 0, percentage = 0] = team.record;
        return { ...team, record: { wins, losses, ties, percentage } };
      })
    : payload.teams;

  return { ...payload, roster_positions: rosterPositions, teams };
}

function clearSessionLeagueKeys() {
  removeSessionKey(STORAGE_KEY);
  removeSessionKey(MY_TEAM_ID_KEY);
  removeSessionKey(FANTASY_LINK_KEY);
}

export function useTeamData() {
  const [leagueData, setLeagueData] = useState(() => {
    const parsed = readSessionJson(STORAGE_KEY);
    if (!parsed) return null;
    if (String(parsed?.league_id) === '66811') {
      clearSessionLeagueKeys();
      return null;
    }
    return normalizeLegacyLeaguePayload(parsed);
  });

  const [myTeamId, setMyTeamId] = useState(() => {
    const raw = readSessionString(MY_TEAM_ID_KEY, '');
    return parseInt(raw, 10) || null;
  });

  const [fantasyLink, setFantasyLink] = useState(() => readSessionString(FANTASY_LINK_KEY, ''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchTeam = useCallback(async (linkVal) => {
    setLoading(true);
    setError(null);

    const urlMatch = linkVal.trim().match(/basketball\.fantasysports\.yahoo\.com\/nba\/\d+\/(\d+)/i);
    const parsedTeamId = urlMatch ? parseInt(urlMatch[1], 10) : null;

    try {
      const payload = await syncLeague(linkVal);
      const resolvedTeamId = parsedTeamId || payload?.teams?.[0]?.team_id || 1;

      const enriched = computeLeagueZScores(payload.teams);
      const result = { ...payload, teams: enriched };

      removeSessionKeysByPrefix(MATCHUP_CACHE_PREFIXES);
      writeSessionJson(STORAGE_KEY, result);
      writeSessionString(MY_TEAM_ID_KEY, resolvedTeamId);
      writeSessionString(FANTASY_LINK_KEY, linkVal);
      setLeagueData(result);
      setMyTeamId(resolvedTeamId);
      setFantasyLink(linkVal);
      return result;
    } catch (err) {
      setError(err.message || 'Invalid link or server unavailable. Please check that your Yahoo Fantasy link is correct and try again.');
      setLeagueData(null);
      setMyTeamId(null);
      setFantasyLink('');
      clearSessionLeagueKeys();
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const selectMyTeam = useCallback((teamId) => {
    const parsed = parseInt(teamId, 10);
    if (!parsed) return;
    writeSessionString(MY_TEAM_ID_KEY, parsed);
    removeSessionKey('9cat_matchup_has_run');
    setMyTeamId(parsed);
  }, []);

  const refreshTeam = useCallback(async () => {
    const link = fantasyLink || readSessionString(FANTASY_LINK_KEY, '');
    if (!link) return null;
    removeSessionKeysByPrefix(MATCHUP_CACHE_PREFIXES);
    return await fetchTeam(link);
  }, [fantasyLink, fetchTeam]);

  const clearData = useCallback(() => {
    clearSessionLeagueKeys();
    removeSessionKeysByPrefix(MATCHUP_CACHE_PREFIXES);
    setLeagueData(null);
    setMyTeamId(null);
    setFantasyLink('');
  }, []);

  const myTeam = leagueData && myTeamId
    ? leagueData.teams.find((t) => t.team_id === myTeamId) ?? leagueData.teams[0]
    : leagueData?.teams?.[0] ?? null;

  return { leagueData, myTeam, myTeamId, selectMyTeam, loading, error, fetchTeam, refreshTeam, clearData, fantasyLink };
}
