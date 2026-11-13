export class ApiError extends Error {
  constructor(message, { status = 500, code = 'API_ERROR', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function requestJson(url, { method = 'GET', body, headers = {}, signal } = {}) {
  const fetchOptions = {
    method,
    signal,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
  };

  if (body !== undefined) {
    fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);
  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const errObj = data?.error;
    const message = errObj?.message || data?.message || `Server error (${response.status})`;
    throw new ApiError(message, {
      status: response.status,
      code: errObj?.code || 'HTTP_ERROR',
      details: errObj?.details ?? null,
    });
  }

  return data;
}

export function syncLeague(fantasyLink) {
  return requestJson('/api/v1/leagues/sync', {
    method: 'POST',
    body: { fantasy_link: fantasyLink },
  });
}

export function fetchMatchupProjection(leagueId, weekNum, body, signal) {
  return requestJson(
    `/api/v1/leagues/${encodeURIComponent(leagueId)}/matchups/${encodeURIComponent(weekNum)}/projections`,
    { method: 'POST', body, signal }
  );
}

export function fetchStreamerRecommendations(leagueId, weekNum, body) {
  return requestJson(
    `/api/v1/leagues/${encodeURIComponent(leagueId)}/matchups/${encodeURIComponent(weekNum)}/streamers`,
    { method: 'POST', body }
  );
}

export function searchFreeAgents(leagueId, body) {
  return requestJson(
    `/api/v1/leagues/${encodeURIComponent(leagueId)}/free-agents/search`,
    { method: 'POST', body }
  );
}

export function fetchDraftPool(limit = 350) {
  return requestJson(`/api/v1/draft/pool?limit=${encodeURIComponent(limit)}`);
}
