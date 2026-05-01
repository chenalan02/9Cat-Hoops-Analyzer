import { useState, useCallback } from 'react';
import { MOCK_LEAGUE } from '../utils/mockData.js';
import { computeLeagueZScores } from '../utils/zScore.js';

const STORAGE_KEY = '9cat_league_data';

/**
 * Hook to fetch, cache, and expose league + team data.
 *
 * Returns:
 *   { leagueData, myTeam, loading, error, fetchTeam, clearData }
 *
 * leagueData: full league with z-scores computed
 * myTeam:     the team matching the submitted link's team_id
 */
export function useTeamData() {
  const [leagueData, setLeagueData] = useState(() => {
    try {
      const cached = sessionStorage.getItem(STORAGE_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  });
  const [myTeamId, setMyTeamId] = useState(() => {
    try { return parseInt(sessionStorage.getItem('9cat_my_team_id')) || null; }
    catch { return null; }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchTeam = useCallback(async (fantasyLink) => {
    setLoading(true);
    setError(null);

    // Parse team_id from Yahoo link
    const parts = fantasyLink.split('/');
    const parsedTeamId = parseInt(parts[parts.length - 1]) || 1;

    try {
      const response = await fetch('/api/analyze-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fantasy_link: fantasyLink }),
      });

      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      const data = await response.json();
      if (data.status !== 'success') throw new Error(data.message || 'Unknown error');

      const enriched = computeLeagueZScores(data.payload.teams);
      const result = { ...data.payload, teams: enriched };

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      sessionStorage.setItem('9cat_my_team_id', String(parsedTeamId));
      setLeagueData(result);
      setMyTeamId(parsedTeamId);

    } catch (err) {
      // Fall back to mock data
      console.warn('Backend unavailable — using mock data:', err.message);
      const enriched = computeLeagueZScores(MOCK_LEAGUE.teams);
      const result = { ...MOCK_LEAGUE, teams: enriched };

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      sessionStorage.setItem('9cat_my_team_id', String(parsedTeamId));
      setLeagueData(result);
      setMyTeamId(parsedTeamId);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearData = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem('9cat_my_team_id');
    setLeagueData(null);
    setMyTeamId(null);
  }, []);

  const myTeam = leagueData && myTeamId
    ? leagueData.teams.find(t => t.team_id === myTeamId) ?? leagueData.teams[0]
    : leagueData?.teams?.[0] ?? null;

  return { leagueData, myTeam, loading, error, fetchTeam, clearData };
}
