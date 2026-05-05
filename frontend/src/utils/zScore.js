// Z-Score utilities for 9Cat Hoops Analyzer
//
// Z-scores are computed league-wide across all rostered players.
// For TO (turnovers), a lower value is better, so z-score is inverted.

export const CATEGORIES = [
  { key: 'PTS',  label: 'Points',          muKey: 'mu_pts',  varKey: 'var_pts',  icon: '🔥', lowerBetter: false },
  { key: 'REB',  label: 'Rebounds',         muKey: 'mu_reb',  varKey: 'var_reb',  icon: '🏀', lowerBetter: false },
  { key: 'AST',  label: 'Assists',          muKey: 'mu_ast',  varKey: 'var_ast',  icon: '🎯', lowerBetter: false },
  { key: 'STL',  label: 'Steals',           muKey: 'mu_stl',  varKey: 'var_stl',  icon: '🖐️', lowerBetter: false },
  { key: 'BLK',  label: 'Blocks',           muKey: 'mu_blk',  varKey: 'var_blk',  icon: '🚫', lowerBetter: false },
  { key: '3PM',  label: '3-Pointers Made',  muKey: 'mu_fg3m', varKey: 'var_fg3m', icon: '🎱', lowerBetter: false },
  { key: 'FG%',  label: 'Field Goal %',     muKey: null,      varKey: null,       icon: '📈', lowerBetter: false, derived: 'fg' },
  { key: 'FT%',  label: 'Free Throw %',     muKey: null,      varKey: null,       icon: '🎯', lowerBetter: false, derived: 'ft' },
  { key: 'TO',   label: 'Turnovers',        muKey: 'mu_tov',  varKey: 'var_tov',  icon: '⚠️', lowerBetter: true },
];

// Get the μ value for a player in a given category.
// FG% and FT% are derived from their component mus.
export function getPlayerMu(player, cat) {
  const s = player.ema_stats;
  if (!s) return null;
  if (cat.derived === 'fg') {
    return s.mu_fga > 0 ? s.mu_fgm / s.mu_fga : null;
  }
  if (cat.derived === 'ft') {
    return s.mu_fta > 0 ? s.mu_ftm / s.mu_fta : null;
  }
  return s[cat.muKey] ?? null;
}

// Get the variance for a player in a given category.
// For derived stats (FG%, FT%) we approximate variance using
// the delta method: Var(X/Y) ≈ (μx²/μy⁴)·Var(y) + (1/μy²)·Var(x)
export function getPlayerVar(player, cat) {
  const s = player.ema_stats;
  if (!s) return null;
  if (cat.derived === 'fg') {
    if (!s.mu_fga || s.mu_fga === 0) return null;
    return (s.mu_fgm ** 2 / s.mu_fga ** 4) * (s.var_fga ?? 0)
         + (1 / s.mu_fga ** 2) * (s.var_fgm ?? 0);
  }
  if (cat.derived === 'ft') {
    if (!s.mu_fta || s.mu_fta === 0) return null;
    return (s.mu_ftm ** 2 / s.mu_fta ** 4) * (s.var_fta ?? 0)
         + (1 / s.mu_fta ** 2) * (s.var_ftm ?? 0);
  }
  return s[cat.varKey] ?? null;
}

// Compute per-player μ values for all categories across the entire league roster.
// Returns a map: { catKey → [ mu values of all players who have data ] }
function buildLeagueMuMap(allPlayers) {
  const map = {};
  for (const cat of CATEGORIES) {
    const vals = allPlayers
      .map(p => getPlayerMu(p, cat))
      .filter(v => v !== null && !isNaN(v));
    map[cat.key] = vals;
  }
  return map;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
  if (arr.length < 2) return 1;
  const m = mean(arr);
  const variance = arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance) || 1;
}

// Given a league's team list (from the API payload), compute z-scores for each
// player on each category, then compute summed z-scores for ranking.
//
// allTeams: Team[] from API — each has .players[].ema_stats
// activeCats: string[] of active category keys (not punted)
//
// Returns the same teams with each player augmented with:
//   player.zScores: { [catKey]: number }
//   player.zSum:    number  (sum of z-scores for active cats)
//   player.rank:    number
export function computeLeagueZScores(allTeams, activeCats = CATEGORIES.map(c => c.key)) {
  const allPlayers = allTeams.flatMap(t => t.players);
  const leagueMuMap = buildLeagueMuMap(allPlayers);

  // Pre-compute league mean & std per cat
  const stats = {};
  for (const cat of CATEGORIES) {
    stats[cat.key] = {
      mean: mean(leagueMuMap[cat.key]),
      std: std(leagueMuMap[cat.key]),
    };
  }

  // Augment each player
  for (const team of allTeams) {
    for (const player of team.players) {
      player.zScores = {};
      let zSum = 0;
      for (const cat of CATEGORIES) {
        const mu = getPlayerMu(player, cat);
        if (mu === null) { player.zScores[cat.key] = null; continue; }
        let z = (mu - stats[cat.key].mean) / stats[cat.key].std;
        if (cat.lowerBetter) z = -z;
        player.zScores[cat.key] = z;
        if (activeCats.includes(cat.key)) zSum += z;
      }
      player.zSum = zSum;
    }
  }

  return allTeams;
}

// Rank players on a given team by their zSum (descending).
// Returns player list with .rank property.
export function rankPlayers(players) {
  const sorted = [...players]
    .filter(p => p.selected_position !== 'IL' && p.selected_position !== 'NA')
    .sort((a, b) => (b.zSum ?? -999) - (a.zSum ?? -999));

  return sorted.map((p, i) => ({ ...p, rank: i + 1 }));
}

// Compute team-level category μ for weekly projection.
// Assumes projGames games in a week (default 3.5).
// Returns: { [catKey]: { mu, ci95Low, ci95High, ci68Low, ci68High } }
export function computeTeamWeeklyProjection(players, projGames = 3.5) {
  const result = {};
  const activePlayers = players.filter(
    p => p.selected_position !== 'IL' && p.selected_position !== 'NA'
  );

  for (const cat of CATEGORIES) {
    let teamMu = 0;
    let teamVar = 0;

    for (const player of activePlayers) {
      const mu = getPlayerMu(player, cat);
      const variance = getPlayerVar(player, cat);
      if (mu === null) continue;

      const gp = player.ema_stats?.mu_min > 0 ? projGames : 0;
      teamMu += mu * gp;
      if (variance !== null) teamVar += variance * gp;
    }

    const sigma = Math.sqrt(teamVar);
    result[cat.key] = {
      mu: teamMu,
      ci95Low:  teamMu - 1.96 * sigma,
      ci95High: teamMu + 1.96 * sigma,
      ci68Low:  teamMu - sigma,
      ci68High: teamMu + sigma,
    };
  }

  return result;
}

// Get CSS class for a z-score value.
export function zScoreClass(z) {
  if (z === null || isNaN(z)) return 'z-avg';
  if (z >  1.5) return 'z-elite';
  if (z >  0.5) return 'z-good';
  if (z > -0.5) return 'z-avg';
  if (z > -1.5) return 'z-poor';
  return 'z-bad';
}

export function zScoreBgClass(z) {
  if (z === null || isNaN(z)) return 'z-bg-avg';
  if (z >  1.5) return 'z-bg-elite';
  if (z >  0.5) return 'z-bg-good';
  if (z > -0.5) return 'z-bg-avg';
  if (z > -1.5) return 'z-bg-poor';
  return 'z-bg-bad';
}
