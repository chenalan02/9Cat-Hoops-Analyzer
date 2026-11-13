// Trade evaluation engine for 9Cat Hoops Analyzer
//
// Core idea: a trade is judged by how it changes your team's *expected head-to-head
// category wins per week against the rest of the league*, not by raw Z-score sums.
//
//   1. Every player is turned into a weekly contribution vector (per-game μ / σ² × games).
//   2. A team's weekly distribution per category is the sum of its active players
//      (FG% / FT% use aggregated makes / attempts with delta-method variance).
//   3. For every opponent and every active category, P(win) = Φ(Δμ / √(σ²ₐ + σ²ᵦ)).
//   4. Expected Cat Wins = Σ_cats P(win), averaged over all opponents.
//   5. Trade partners are evaluated across all 9 categories by default (configurable
//      via partnerCats), independent of your own punts.

import { CATEGORIES, DB_Z_KEYS, getPlayerStatsObject, getPlayerMu } from './zScore.js';

export const PROJ_GAMES = 3.5;

const IR_SET = new Set(['IL', 'IL+', 'IR', 'IR+', 'NA']);
const NON_STARTING_SLOTS = new Set(['BN', 'IL', 'IL+', 'IR', 'IR+', 'NA']);
const OUT_STATUS_SET = new Set(['OUT', 'INJ', 'INJ_OUT', 'IL', 'IL+', 'IR', 'IR+', 'O', 'SUSP']);
const STAT_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'tov', 'fgm', 'fga', 'ftm', 'fta'];
const COUNT_KEY = { PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk', '3PM': 'fg3m', TO: 'tov' };

export const ALL_CAT_KEYS = CATEGORIES.map(c => c.key);
export const ALL_CAT_SET = new Set(ALL_CAT_KEYS);

export function isActiveSlot(p) {
  return !IR_SET.has(String(p?.selected_position || '').toUpperCase().trim());
}

// ─── Positional eligibility & slot coverage ────────────────

/** Parse a player's eligible positions into normalized uppercase tokens (e.g. ['PG', 'SG']). */
export function parsePositions(player) {
  const raw = player?.positions;
  let tokens = [];
  if (Array.isArray(raw)) {
    tokens = raw.flatMap(t => String(t).split(/[,/|]+/));
  } else if (typeof raw === 'string') {
    tokens = raw.split(/[,/|]+/);
  }
  const clean = tokens.map(s => s.trim().toUpperCase()).filter(Boolean);
  return clean.length ? [...new Set(clean)] : ['UTIL'];
}

export function playerHasPosition(player, pos) {
  if (!pos || pos === 'all') return true;
  const target = String(pos).toUpperCase().trim();
  const positions = parsePositions(player);
  return positions.includes(target);
}

function canPlaySlot(playerPositions, slot) {
  const s = String(slot).toUpperCase().trim();
  if (s === 'UTIL') return true;
  if (playerPositions.includes(s)) return true;
  if (s === 'G') return playerPositions.some(p => p === 'PG' || p === 'SG' || p === 'G');
  if (s === 'F') return playerPositions.some(p => p === 'SF' || p === 'PF' || p === 'F');
  if (s === 'G/F' || s === 'GF') return playerPositions.some(p => p === 'PG' || p === 'SG' || p === 'SF' || p === 'G' || p === 'F');
  if (s === 'F/C' || s === 'FC') return playerPositions.some(p => p === 'SF' || p === 'PF' || p === 'C' || p === 'F');
  return false;
}

function extractStartingSlots(rosterPositions) {
  const rawSlots = [];
  if (Array.isArray(rosterPositions)) {
    for (const item of rosterPositions) {
      if (typeof item === 'string') {
        const pos = item.trim();
        if (pos && !NON_STARTING_SLOTS.has(pos.toUpperCase())) rawSlots.push(pos);
        continue;
      }
      const entry = item?.roster_position || item;
      const pos = String(entry?.position || '').trim();
      const count = Math.max(0, Number(entry?.count ?? 1) || 0);
      if (!pos || NON_STARTING_SLOTS.has(pos.toUpperCase())) continue;
      for (let i = 0; i < count; i++) rawSlots.push(pos);
    }
  }
  if (!rawSlots.length) {
    return {
      slots: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'Util'],
      isDefault: true,
    };
  }
  return { slots: rawSlots, isDefault: false };
}

function solveBipartiteMatching(playerPosList, slots) {
  if (!slots.length || !playerPosList.length) {
    return { matchedCount: 0, unfilledSlots: [...slots] };
  }
  // Sort specific slots so rarest-eligibility slots match first in Kuhn's augmenting path DFS
  const indexed = slots.map((slot, idx) => {
    const elig = playerPosList.filter(pos => canPlaySlot(pos, slot)).length;
    return { slot, idx, elig, isUtil: slot.toUpperCase() === 'UTIL' ? 1 : 0 };
  });
  indexed.sort((a, b) => a.isUtil - b.isUtil || a.elig - b.elig);

  const playerAssignedTo = new Array(playerPosList.length).fill(-1);
  const slotMatched = new Array(indexed.length).fill(false);

  function tryAssign(slotOrderIdx, visited) {
    const slot = indexed[slotOrderIdx].slot;
    for (let p = 0; p < playerPosList.length; p++) {
      if (visited[p] || !canPlaySlot(playerPosList[p], slot)) continue;
      visited[p] = true;
      if (playerAssignedTo[p] === -1 || tryAssign(playerAssignedTo[p], visited)) {
        playerAssignedTo[p] = slotOrderIdx;
        return true;
      }
    }
    return false;
  }

  let matchedCount = 0;
  for (let s = 0; s < indexed.length; s++) {
    const visited = new Array(playerPosList.length).fill(false);
    if (tryAssign(s, visited)) {
      slotMatched[s] = true;
      matchedCount++;
    }
  }

  const unfilledSlots = indexed.filter((_, s) => !slotMatched[s]).map(x => x.slot);
  return { matchedCount, unfilledSlots };
}

/**
 * Analyzes whether active players can fill starting positional slots and checks positional depth.
 */
export function analyzeRosterPositions(players, rosterPositions) {
  const { slots, isDefault } = extractStartingSlots(rosterPositions);
  const active = (players || []).filter(isActiveSlot);
  const playerPosList = active.map(parsePositions);

  const specificSlots = slots.filter(s => s.toUpperCase() !== 'UTIL');
  const specificReqs = {};
  for (const s of specificSlots) {
    const key = s.toUpperCase();
    specificReqs[key] = (specificReqs[key] || 0) + 1;
  }

  const eligibleCounts = {};
  for (const posKey of Object.keys(specificReqs)) {
    eligibleCounts[posKey] = playerPosList.filter(pos => canPlaySlot(pos, posKey)).length;
  }

  const specificMatch = solveBipartiteMatching(playerPosList, specificSlots);
  const fullMatch = solveBipartiteMatching(playerPosList, slots);

  return {
    isDefault,
    totalSlots: slots.length,
    filledCount: fullMatch.matchedCount,
    specificTotal: specificSlots.length,
    specificFilled: specificMatch.matchedCount,
    unfilledSlots: specificMatch.unfilledSlots,
    eligibleCounts,
    specificReqs,
  };
}

/**
 * Compares positional coverage before and after a trade, returning concise user warnings
 * when a move creates unfilled starting slots or strips positional backup depth.
 */
export function comparePositionImpact(beforePlayers, afterPlayers, rosterPositions) {
  if (!beforePlayers?.length || !afterPlayers?.length) return [];
  const before = analyzeRosterPositions(beforePlayers, rosterPositions);
  const after = analyzeRosterPositions(afterPlayers, rosterPositions);
  const warnings = [];

  if (after.unfilledSlots.length > before.unfilledSlots.length) {
    const counts = {};
    for (const s of after.unfilledSlots) {
      const k = s.toUpperCase();
      counts[k] = (counts[k] || 0) + 1;
    }
    const newlyShort = Object.keys(counts).filter(k => {
      const prevCount = before.unfilledSlots.filter(x => x.toUpperCase() === k).length;
      return counts[k] > prevCount;
    });
    const label = (newlyShort.length ? newlyShort : Object.keys(counts)).join('/');
    warnings.push({
      severity: 'error',
      text: `Positional gap: cannot fill all starting ${label} slot${after.unfilledSlots.length > 1 ? 's' : ''}`,
    });
  }

  // Warn when trading away scarce depth at a required core slot (leaves 0 backups)
  const coreSlots = ['PG', 'SG', 'SF', 'PF', 'C'];
  for (const pos of coreSlots) {
    const req = after.specificReqs[pos] || 0;
    if (!req) continue;
    const prevElig = before.eligibleCounts[pos] ?? 0;
    const nextElig = after.eligibleCounts[pos] ?? 0;
    if (nextElig < prevElig && nextElig <= req) {
      if (nextElig < req) {
        const msg = `Only ${nextElig} ${pos}-eligible for ${req} ${pos} slot${req > 1 ? 's' : ''}`;
        if (!warnings.some(w => w.text.includes(pos))) {
          warnings.push({ severity: 'error', text: msg });
        }
      } else {
        warnings.push({
          severity: 'warn',
          text: `Thin at ${pos}: only ${nextElig} ${pos}-eligible (${req} required, 0 backup)`,
        });
      }
    }
  }

  return warnings;
}

// ─── Math helpers ──────────────────────────────────────────

// Abramowitz–Stegun 7.1.26 (max abs error ≈ 1.5e-7)
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

export function normCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ─── Contribution vectors ──────────────────────────────────

function emptyTotals() {
  const t = {};
  for (const k of STAT_KEYS) { t[k] = 0; t[`v_${k}`] = 0; }
  return t;
}

/** Weekly contribution vector for one player (null if no stats / no minutes). */
export function playerContribution(player, source, games = PROJ_GAMES) {
  const s = getPlayerStatsObject(player, source);
  if (!s || !(num(s.mu_min) > 0)) return null;
  const c = {};
  for (const k of STAT_KEYS) {
    c[k] = num(s[`mu_${k}`]) * games;
    c[`v_${k}`] = num(s[`var_${k}`]) * games;
  }
  return c;
}

function addInto(target, contrib, sign = 1) {
  if (!contrib) return target;
  for (const k of STAT_KEYS) {
    target[k] += sign * contrib[k];
    target[`v_${k}`] += sign * contrib[`v_${k}`];
  }
  return target;
}

function cloneTotals(t) {
  return { ...t };
}

/** Convert summed totals into per-category { mu, var } distributions. */
export function distFromTotals(t) {
  const d = {};
  for (const cat of CATEGORIES) {
    if (cat.derived === 'fg' || cat.derived === 'ft') {
      const m = cat.derived === 'fg' ? t.fgm : t.ftm;
      const a = cat.derived === 'fg' ? t.fga : t.fta;
      const vm = cat.derived === 'fg' ? t.v_fgm : t.v_ftm;
      const va = cat.derived === 'fg' ? t.v_fga : t.v_fta;
      const mu = a > 0 ? m / a : 0;
      let v = a > 0 ? (m * m / a ** 4) * Math.max(va, 0) + (1 / (a * a)) * Math.max(vm, 0) : 0;
      v = Math.max(v, 0.006 ** 2); // floor: ~0.6% weekly σ
      d[cat.key] = { mu, var: v, makes: m, attempts: a };
    } else {
      const k = COUNT_KEY[cat.key];
      const mu = t[k];
      const v = Math.max(t[`v_${k}`], (0.06 * Math.abs(mu)) ** 2, 1);
      d[cat.key] = { mu, var: v };
    }
  }
  return d;
}

/** P(team A beats team B) in one category. */
function catWinProb(a, b, cat) {
  const sd = Math.sqrt(a.var + b.var);
  if (!(sd > 0)) return a.mu === b.mu ? 0.5 : (cat.lowerBetter ? (a.mu < b.mu ? 1 : 0) : (a.mu > b.mu ? 1 : 0));
  const z = (a.mu - b.mu) / sd;
  return normCdf(cat.lowerBetter ? -z : z);
}

export function sumPerCatWins(perCat, catSet = ALL_CAT_SET) {
  let total = 0;
  for (const cat of CATEGORIES) {
    if (catSet.has(cat.key)) total += perCat?.[cat.key] ?? 0;
  }
  return total;
}

/**
 * Expected H2H category wins for `teamId` vs every other team.
 * Returns { total, perCat: { [cat]: avgWinProb } } where total = Σ over activeCats.
 */
export function expectedCatWins(teamId, distById, activeCats = ALL_CAT_SET) {
  const mine = distById.get(teamId);
  const perCat = {};
  for (const cat of CATEGORIES) perCat[cat.key] = 0;
  let opps = 0;
  for (const [id, d] of distById) {
    if (id === teamId) continue;
    opps++;
    for (const cat of CATEGORIES) perCat[cat.key] += catWinProb(mine[cat.key], d[cat.key], cat);
  }
  let total = 0;
  for (const cat of CATEGORIES) {
    perCat[cat.key] = opps ? perCat[cat.key] / opps : 0.5;
    if (activeCats.has(cat.key)) total += perCat[cat.key];
  }
  return { total, perCat };
}

/** League rank (1 = best) of `teamId` in every category. */
export function categoryRanks(teamId, distById) {
  const ranks = {};
  const mine = distById.get(teamId);
  for (const cat of CATEGORIES) {
    let better = 0;
    for (const [id, d] of distById) {
      if (id === teamId) continue;
      const a = d[cat.key].mu, b = mine[cat.key].mu;
      if (cat.lowerBetter ? a < b : a > b) better++;
    }
    ranks[cat.key] = better + 1;
  }
  return ranks;
}

// ─── Free agent replacement level ──────────────────────────

/**
 * Builds a synthetic replacement-level player from the bottom of the rostered pool
 * when live waiver wire data is unavailable.
 */
export function buildReplacementPlayer(allPlayers, source, valueFn, streamingBonus = 0) {
  const pool = allPlayers.filter(p => isActiveSlot(p) && playerContribution(p, source));
  const sorted = [...pool].sort((a, b) => valueFn(a) - valueFn(b));
  const n = Math.max(5, Math.floor(sorted.length * 0.1));
  const slice = sorted.slice(0, n);

  const avg = {};
  const keys = ['mu_min', ...STAT_KEYS.map(k => `mu_${k}`), ...STAT_KEYS.map(k => `var_${k}`)];
  for (const k of keys) avg[k] = 0;
  for (const p of slice) {
    const s = getPlayerStatsObject(p, source) || {};
    for (const k of keys) avg[k] += num(s[k]);
  }
  for (const k of keys) avg[k] = slice.length ? avg[k] / slice.length : 0;

  // Shade counting stats down ~10% (keeps FG%/FT% ratios intact since makes & attempts scale together)
  const stats = { ...avg };
  for (const k of STAT_KEYS) {
    stats[`mu_${k}`] = avg[`mu_${k}`] * 0.9;
    stats[`var_${k}`] = avg[`var_${k}`] * 0.9;
  }
  if (!(stats.mu_min > 0)) stats.mu_min = 20;

  const avgZ = slice.length ? slice.reduce((s, p) => s + valueFn(p), 0) / slice.length : -3;
  const z = avgZ - 0.35;

  return {
    name: 'Waiver Replacement',
    isReplacement: true,
    isRealFreeAgent: false,
    streamingGames: PROJ_GAMES + Math.max(0, Number(streamingBonus) || 0),
    selected_position: 'BN',
    positions: 'Util',
    z_total: z,
    zSum: z,
    ema_stats: stats,
    ros_stats: stats,
    weekly_stats: stats,
  };
}

// ─── Player value tables (punt-aware Z + ranks) ────────────

function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function std(a) {
  if (a.length < 2) return 1;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) || 1;
}

function computeCategoryFallback(allPlayers, source) {
  const fallback = {};
  for (const cat of CATEGORIES) {
    const vals = allPlayers.map(p => getPlayerMu(p, cat, source)).filter(v => v != null && !isNaN(v));
    fallback[cat.key] = { m: mean(vals), s: std(vals) };
  }
  return fallback;
}

function computePlayerZRow(p, source, fallback) {
  const s = getPlayerStatsObject(p, source);
  const z = {};
  for (const cat of CATEGORIES) {
    const db = s?.[DB_Z_KEYS[cat.key]];
    if (db != null && !isNaN(db)) { z[cat.key] = Number(db); continue; }
    const mu = getPlayerMu(p, cat, source);
    if (mu == null || isNaN(mu)) { z[cat.key] = 0; continue; }
    let v = (mu - fallback[cat.key].m) / fallback[cat.key].s;
    if (cat.lowerBetter) v = -v;
    z[cat.key] = v;
  }
  return z;
}

/**
 * Per-category Z for every rostered player under the chosen projection source.
 * Uses the precomputed Databricks z_* columns when present, otherwise standardizes
 * against the league's rostered pool.
 */
export function buildZTable(allPlayers, source) {
  const fallback = computeCategoryFallback(allPlayers, source);
  const table = new Map();
  for (const p of allPlayers) {
    table.set(p.name, computePlayerZRow(p, source, fallback));
  }
  return table;
}

export function sumZ(zRow, cats) {
  if (!zRow) return 0;
  let s = 0;
  for (const k of cats) s += zRow[k] ?? 0;
  return s;
}

function selectWaiverReplacement({ freeAgents, allPlayers, ownerByName, source, activeList, fallback, fullValue, streamingBonus }) {
  const bonus = Math.max(0, Number(streamingBonus) || 0);
  const validFas = (freeAgents || []).filter(p => (
    p?.name &&
    !ownerByName.has(p.name) &&
    playerContribution(p, source, PROJ_GAMES) != null
  ));

  if (!validFas.length) {
    const synthetic = buildReplacementPlayer(allPlayers, source, fullValue, bonus);
    const baseContrib = playerContribution(synthetic, source, PROJ_GAMES);
    const streamContrib = playerContribution(synthetic, source, PROJ_GAMES + bonus);
    return {
      replacement: synthetic,
      replacementBaseContrib: baseContrib,
      replacementContrib: streamContrib,
    };
  }

  const healthyFas = validFas.filter(p => !OUT_STATUS_SET.has(String(p.status || '').toUpperCase().trim()));
  const pool = healthyFas.length ? healthyFas : validFas;

  let bestFa = null;
  let bestPuntZ = -Infinity;
  let bestFullZ = 0;

  for (const fa of pool) {
    const zRow = computePlayerZRow(fa, source, fallback);
    const pZ = sumZ(zRow, activeList);
    if (pZ > bestPuntZ) {
      bestPuntZ = pZ;
      bestFullZ = sumZ(zRow, ALL_CAT_KEYS);
      bestFa = fa;
    }
  }

  const baseContrib = playerContribution(bestFa, source, PROJ_GAMES);
  const streamContrib = playerContribution(bestFa, source, PROJ_GAMES + bonus);
  const replacement = {
    ...bestFa,
    isReplacement: true,
    isRealFreeAgent: true,
    streamingGames: PROJ_GAMES + bonus,
    z_total: bestFullZ,
    puntZ: bestPuntZ,
  };

  return {
    replacement,
    replacementBaseContrib: baseContrib,
    replacementContrib: streamContrib,
  };
}

// ─── Trade context ─────────────────────────────────────────

/**
 * Precomputes everything needed to evaluate many hypothetical trades quickly.
 * @param {Array} leagueTeams
 * @param {string} source - 'ros' | 'ema' | 'weekly'
 * @param {Set<string>} activeCats - user's active (non-punted) categories
 * @param {object} [options] - { freeAgents, rosterPositions, streamingBonus }
 */
export function buildTradeContext(leagueTeams, source, activeCats, options = {}) {
  const { freeAgents = [], rosterPositions = [], streamingBonus = 0 } = options;
  const allPlayers = leagueTeams.flatMap(t => t.players);
  const fallback = computeCategoryFallback(allPlayers, source);
  const zTable = new Map();
  for (const p of allPlayers) zTable.set(p.name, computePlayerZRow(p, source, fallback));

  const activeList = [...activeCats];

  const fullValue = p => (p?.isReplacement ? p.z_total : sumZ(zTable.get(p.name), ALL_CAT_KEYS));
  const puntValue = p => (
    p?.isReplacement
      ? (p.puntZ ?? p.z_total * (activeList.length / ALL_CAT_KEYS.length))
      : sumZ(zTable.get(p.name), activeList)
  );

  const contrib = new Map();
  for (const p of allPlayers) contrib.set(p.name, playerContribution(p, source));

  const ownerByName = new Map();
  const teamById = new Map();
  const totalsById = new Map();
  const distById = new Map();

  for (const t of leagueTeams) {
    teamById.set(t.team_id, t);
    const totals = emptyTotals();
    for (const p of t.players) {
      ownerByName.set(p.name, t.team_id);
      if (isActiveSlot(p)) addInto(totals, contrib.get(p.name));
    }
    totalsById.set(t.team_id, totals);
    distById.set(t.team_id, distFromTotals(totals));
  }

  const { replacement, replacementBaseContrib, replacementContrib } = selectWaiverReplacement({
    freeAgents,
    allPlayers,
    ownerByName,
    source,
    activeList,
    fallback,
    fullValue,
    streamingBonus,
  });

  if (!replacement.isRealFreeAgent) {
    replacement.puntZ = replacement.z_total * (activeList.length / ALL_CAT_KEYS.length);
  }

  const byFull = [...allPlayers].sort((a, b) => fullValue(b) - fullValue(a));
  const leagueRank = new Map(byFull.map((p, i) => [p.name, i + 1]));
  const byPunt = [...allPlayers].sort((a, b) => puntValue(b) - puntValue(a));
  const puntRank = new Map(byPunt.map((p, i) => [p.name, i + 1]));

  const marketRank = new Map();
  for (const p of allPlayers) {
    const s = getPlayerStatsObject(p, source);
    const rawR = s?.rank != null ? s.rank : p?.rank;
    const r = Number(rawR);
    marketRank.set(p.name, Number.isFinite(r) && r > 0 && r < 999 ? r : null);
  }

  const baseWins = new Map();
  const baseWinsFull = new Map();
  for (const id of teamById.keys()) {
    const res = expectedCatWins(id, distById, activeCats);
    baseWins.set(id, res);
    baseWinsFull.set(id, { total: sumPerCatWins(res.perCat, ALL_CAT_SET), perCat: res.perCat });
  }

  return {
    source,
    activeCats,
    activeList,
    allPlayers,
    freeAgents,
    rosterPositions,
    streamingBonus: Math.max(0, Number(streamingBonus) || 0),
    zTable,
    fullValue,
    puntValue,
    replacement,
    replacementBaseContrib,
    replacementContrib,
    contrib,
    ownerByName,
    teamById,
    totalsById,
    distById,
    baseWins,
    baseWinsFull,
    leagueRank,
    puntRank,
    marketRank,
  };
}

/** Global market rank (Databricks) with league Z-rank fallback. */
export function getMarketRank(ctx, name) {
  return ctx.marketRank.get(name) ?? ctx.leagueRank.get(name) ?? null;
}

/**
 * Applies roster moves to a team's active totals with roster-size balancing:
 *  - receiving more than giving → drops lowest-value remaining active players under `catsList`
 *  - giving more than receiving → fills open spots with waiver/streaming replacement
 */
function applyMoves(ctx, teamId, outgoing, incoming, catsList = ctx.activeList, useStreamingForFiller = false) {
  const team = ctx.teamById.get(teamId);
  const outNames = new Set(outgoing.map(p => p.name));
  const totals = cloneTotals(ctx.totalsById.get(teamId));

  const outActive = outgoing.filter(p => isActiveSlot(p) && ctx.ownerByName.get(p.name) === teamId);
  for (const p of outActive) addInto(totals, ctx.contrib.get(p.name), -1);
  for (const p of incoming) addInto(totals, ctx.contrib.get(p.name) ?? playerContribution(p, ctx.source), +1);

  const diff = incoming.length - outActive.length;
  let drops = [];
  let fillers = 0;
  if (diff > 0) {
    const valForTeam = p => sumZ(ctx.zTable.get(p.name), catsList);
    drops = team.players
      .filter(p => isActiveSlot(p) && !outNames.has(p.name))
      .sort((a, b) => valForTeam(a) - valForTeam(b))
      .slice(0, diff);
    for (const p of drops) addInto(totals, ctx.contrib.get(p.name), -1);
  } else if (diff < 0) {
    fillers = -diff;
    const fillerContrib = useStreamingForFiller ? ctx.replacementContrib : ctx.replacementBaseContrib;
    for (let i = 0; i < fillers; i++) addInto(totals, fillerContrib, +1);
  }

  const dropNames = new Set(drops.map(p => p.name));
  const afterPlayers = [
    ...team.players.filter(p => !outNames.has(p.name) && !dropNames.has(p.name)),
    ...incoming,
  ];
  for (let i = 0; i < fillers; i++) afterPlayers.push(ctx.replacement);

  return { totals, drops, fillers, afterPlayers };
}

function buildCatChanges(distBefore, distAfter, beforePerCat, afterPerCat) {
  const catChanges = {};
  for (const cat of CATEGORIES) {
    catChanges[cat.key] = {
      muDelta: distAfter[cat.key].mu - distBefore[cat.key].mu,
      probDelta: (afterPerCat[cat.key] ?? 0.5) - (beforePerCat[cat.key] ?? 0.5),
    };
  }
  return catChanges;
}

/**
 * Full evaluation of a (possibly multi-player, multi-team) trade from both perspectives.
 * By default, partner win expectations are evaluated over ALL 9 categories (partnerCats = ALL_CAT_SET),
 * while your team is evaluated over your selected activeCats.
 */
export function evaluateTrade(ctx, myTeamId, outgoing, incoming, partnerCats = ALL_CAT_SET) {
  const partnerIds = [...new Set(incoming.map(p => ctx.ownerByName.get(p.name)).filter(id => id != null && id !== myTeamId))];
  const singlePartner = partnerIds.length === 1 ? partnerIds[0] : null;
  const partnerCatsList = [...(partnerCats || ALL_CAT_SET)];
  const effectivePartnerCats = partnerCats || ALL_CAT_SET;

  const myTeam = ctx.teamById.get(myTeamId);
  const mine = applyMoves(ctx, myTeamId, outgoing, incoming, ctx.activeList, true);
  const distAfter = new Map(ctx.distById);
  distAfter.set(myTeamId, distFromTotals(mine.totals));

  let partner = null;
  let partnerMoves = null;
  if (singlePartner != null) {
    partnerMoves = applyMoves(ctx, singlePartner, incoming, outgoing, partnerCatsList, false);
    distAfter.set(singlePartner, distFromTotals(partnerMoves.totals));
    partner = { teamId: singlePartner, drops: partnerMoves.drops, fillers: partnerMoves.fillers };
  } else if (partnerIds.length > 1) {
    for (const id of partnerIds) {
      const fromTeam = incoming.filter(p => ctx.ownerByName.get(p.name) === id);
      const p = applyMoves(ctx, id, fromTeam, [], ALL_CAT_KEYS, false);
      distAfter.set(id, distFromTotals(p.totals));
    }
  }

  const myBefore = ctx.baseWins.get(myTeamId);
  const myAfter = expectedCatWins(myTeamId, distAfter, ctx.activeCats);
  const myPosWarnings = comparePositionImpact(myTeam.players, mine.afterPlayers, ctx.rosterPositions);

  if (partner) {
    const pTeam = ctx.teamById.get(partner.teamId);
    const baseFull = ctx.baseWinsFull.get(partner.teamId);
    const before = {
      total: sumPerCatWins(baseFull.perCat, effectivePartnerCats),
      perCat: baseFull.perCat,
    };
    const after = expectedCatWins(partner.teamId, distAfter, effectivePartnerCats);
    const pDistBefore = ctx.distById.get(partner.teamId);
    const pDistAfter = distAfter.get(partner.teamId);
    const pPosWarnings = comparePositionImpact(pTeam.players, partnerMoves.afterPlayers, ctx.rosterPositions);

    partner = {
      ...partner,
      before,
      after,
      delta: after.total - before.total,
      ranksBefore: categoryRanks(partner.teamId, ctx.distById),
      ranksAfter: categoryRanks(partner.teamId, distAfter),
      catChanges: buildCatChanges(pDistBefore, pDistAfter, before.perCat, after.perCat),
      posWarnings: pPosWarnings,
    };
  }

  return {
    my: {
      before: myBefore,
      after: myAfter,
      delta: myAfter.total - myBefore.total,
      drops: mine.drops,
      fillers: mine.fillers,
      posWarnings: myPosWarnings,
    },
    partner,
    partnerIds,
    distBefore: ctx.distById.get(myTeamId),
    distAfter: distAfter.get(myTeamId),
    ranksBefore: categoryRanks(myTeamId, ctx.distById),
    ranksAfter: categoryRanks(myTeamId, distAfter),
    myPosWarnings,
  };
}

// Fast package swap for trade target scanning (handles 1-for-1, 2-for-1, 1-for-2 uniformly).
function quickPackageSwap(ctx, myTeamId, outgoing, incoming, partnerId, partnerCats = ALL_CAT_SET) {
  const partnerCatsList = [...(partnerCats || ALL_CAT_SET)];
  const mine = applyMoves(ctx, myTeamId, outgoing, incoming, ctx.activeList, true);
  const partner = applyMoves(ctx, partnerId, incoming, outgoing, partnerCatsList, false);

  const dist = new Map(ctx.distById);
  const myDist = distFromTotals(mine.totals);
  const pDist = distFromTotals(partner.totals);
  dist.set(myTeamId, myDist);
  dist.set(partnerId, pDist);

  const myAfter = expectedCatWins(myTeamId, dist, ctx.activeCats);
  const pAfter = expectedCatWins(partnerId, dist, partnerCats);
  const pBeforeTotal = sumPerCatWins(ctx.baseWinsFull.get(partnerId).perCat, partnerCats);

  const myTeam = ctx.teamById.get(myTeamId);
  const posWarnings = comparePositionImpact(myTeam.players, mine.afterPlayers, ctx.rosterPositions);

  return {
    partnerId,
    myAfter,
    myDelta: myAfter.total - ctx.baseWins.get(myTeamId).total,
    partnerDelta: pAfter.total - pBeforeTotal,
    myDist,
    myDrops: mine.drops,
    myFillers: mine.fillers,
    partnerDrops: partner.drops,
    partnerFillers: partner.fillers,
    posWarnings,
  };
}

// ─── Suggestions ───────────────────────────────────────────

/**
 * Ranks my active players by genuine punt mismatch and saturated-category waste
 * relative to their market value, protecting un-punted top-15 cornerstones from
 * being falsely flagged by within-roster ordinal distortions.
 */
export function computeSellCandidates(ctx, myTeamId) {
  const team = ctx.teamById.get(myTeamId);
  const roster = team.players.filter(p => isActiveSlot(p) && ctx.contrib.get(p.name));
  const baseWinsObj = ctx.baseWins.get(myTeamId);
  const base = baseWinsObj.total;
  const basePerCat = baseWinsObj.perCat;

  const rows = roster.map(p => {
    const totals = cloneTotals(ctx.totalsById.get(myTeamId));
    addInto(totals, ctx.contrib.get(p.name), -1);
    addInto(totals, ctx.replacementBaseContrib, +1);
    const dist = new Map(ctx.distById);
    dist.set(myTeamId, distFromTotals(totals));
    const afterObj = expectedCatWins(myTeamId, dist, ctx.activeCats);
    const after = afterObj.total;
    const afterPerCat = afterObj.perCat;

    const fullZ = ctx.fullValue(p);
    const puntZ = ctx.puntValue(p);
    const puntDrag = Math.max(0, fullZ - puntZ);
    const overallRank = ctx.leagueRank.get(p.name);
    const pRank = ctx.puntRank.get(p.name);
    const rankShift = pRank - overallRank;
    const marketRank = getMarketRank(ctx, p.name);

    // Saturated-category waste: positive stats landing in categories we STILL win >=78% without him,
    // or lost-cause categories <=18% even with him. (Carrying a team from 40%->90% is essential, not surplus!)
    const zRow = ctx.zTable.get(p.name) || {};
    let surplusZ = 0;
    for (const k of ctx.activeList) {
      const z = zRow[k] ?? 0;
      if (z <= 0.25) continue;
      const pBase = basePerCat[k] ?? 0.5;
      const pWithout = afterPerCat[k] ?? 0.5;
      if (pWithout >= 0.78 && pBase >= 0.80) {
        surplusZ += z * ((pWithout - 0.75) / 0.25) * 0.75;
      } else if (pBase <= 0.18) {
        surplusZ += z * ((0.18 - pBase) / 0.18) * 0.60;
      }
    }

    return {
      player: p,
      marginal: base - after,
      fullZ,
      puntZ,
      puntDrag,
      surplusZ,
      overallRank,
      puntRank: pRank,
      rankShift,
      marketRank,
    };
  });

  const zVals = rows.map(r => r.fullZ);
  const minZ = zVals.length ? Math.min(...zVals) : 0;
  const maxZ = zVals.length ? Math.max(...zVals) : 1;
  const spanZ = Math.max(2.0, maxZ - minZ);
  const maxMarg = Math.max(0.35, ...rows.map(r => r.marginal));

  for (const r of rows) {
    const normZ = Math.max(0, (r.fullZ - minZ) / spanZ);
    const normMarg = Math.max(0, r.marginal) / maxMarg;
    r.fitGap = Math.max(0, normZ - normMarg);

    const hasMismatch = r.puntDrag >= 0.35 || r.surplusZ >= 0.35;
    const isCornerstone = (
      r.marketRank != null &&
      r.marketRank <= 15 &&
      r.puntDrag < 1.2 &&
      r.rankShift < 12 &&
      r.surplusZ < 1.0
    );

    const rawScore = (
      r.puntDrag * 0.45 +
      r.surplusZ * 0.40 +
      Math.max(0, r.rankShift) / 30 +
      (hasMismatch ? r.fitGap * 0.40 : r.fitGap * 0.18)
    );
    r.isCornerstone = isCornerstone;
    r.autoEligible = !isCornerstone;
    r.sellScore = isCornerstone ? rawScore - 2.0 : rawScore;

    r.tags = [];
    if (r.puntDrag >= 0.6 || r.rankShift >= 10) r.tags.push('Poor punt fit');
    if (r.surplusZ >= 0.65) r.tags.push('Surplus cat overlap');
    if (!isCornerstone && r.marketRank != null && r.marketRank <= 80 && r.fitGap >= 0.25) {
      r.tags.push('Market value > team impact');
    }
    if (!isCornerstone && r.marginal <= 0.04) r.tags.push('Minimal team impact');
  }

  rows.sort((a, b) => b.sellScore - a.sellScore);
  return rows;
}

/**
 * Generates realistic 1-for-1, 2-for-1 (Upgrade), and 1-for-2 (Depth Split, same partner)
 * trade targets that improve expected wins under your active build, with optional filtering.
 */
export function computeTradeTargets(ctx, myTeamId, givePlayers, options = {}) {
  const {
    window = 15,
    limit = 18,
    perGive = 5,
    tradeTypes = ['1for1', '2for1', '1for2'],
    partnerCats = ALL_CAT_SET,
    partnerFilter = 'all',
    posFilter = 'all',
    catFilter = 'all',
    winWinOnly = false,
  } = options;

  const typeSet = tradeTypes instanceof Set ? tradeTypes : new Set(tradeTypes);
  const myTeam = ctx.teamById.get(myTeamId);
  const myBeforeDist = ctx.distById.get(myTeamId);
  const myBefore = ctx.baseWins.get(myTeamId);
  const replZ = ctx.replacement.z_total ?? -2;

  const validGives = (givePlayers || []).filter(p => ctx.contrib.get(p.name));
  if (!validGives.length) return [];

  const others = ctx.allPlayers.filter(p => {
    const owner = ctx.ownerByName.get(p.name);
    if (!owner || owner === myTeamId || !isActiveSlot(p) || !ctx.contrib.get(p.name)) return false;
    if (partnerFilter !== 'all' && String(owner) !== String(partnerFilter)) return false;
    return true;
  });

  // Group other teams' active players by owner for 2-for-1 drops and same-partner 1-for-2
  const otherTeamsPlayers = new Map();
  for (const p of others) {
    const owner = ctx.ownerByName.get(p.name);
    if (!otherTeamsPlayers.has(owner)) otherTeamsPlayers.set(owner, []);
    otherTeamsPlayers.get(owner).push(p);
  }
  const partnerWorstZ = new Map();
  for (const [tid, plist] of otherTeamsPlayers) {
    const fullTeamActive = ctx.teamById.get(tid).players.filter(p => isActiveSlot(p) && ctx.contrib.get(p.name));
    const minZ = fullTeamActive.length ? Math.min(...fullTeamActive.map(p => ctx.fullValue(p))) : replZ;
    partnerWorstZ.set(tid, minZ);
  }

  const myActive = myTeam.players.filter(p => isActiveSlot(p) && ctx.contrib.get(p.name));

  function evaluateCandidate(type, gives, gets, partnerId, vorDiff, fairnessLabel) {
    if (posFilter !== 'all' && !gets.some(p => playerHasPosition(p, posFilter))) return null;

    const r = quickPackageSwap(ctx, myTeamId, gives, gets, partnerId, partnerCats);
    if (r.myDelta <= 0.015) return null;
    if (winWinOnly && r.partnerDelta < 0) return null;

    const catChanges = buildCatChanges(myBeforeDist, r.myDist, myBefore.perCat, r.myAfter.perCat);
    if (catFilter !== 'all' && (catChanges[catFilter]?.probDelta ?? 0) < 0.015) return null;

    const giveRanks = gives.map(p => getMarketRank(ctx, p.name)).filter(Boolean);
    const getRanks = gets.map(p => getMarketRank(ctx, p.name)).filter(Boolean);
    const hasSeverePosError = r.posWarnings.some(w => w.severity === 'error');

    const id = `${type}:${gives.map(p => p.name).sort().join('+')}=>${gets.map(p => p.name).sort().join('+')}`;
    return {
      id,
      type,
      gives,
      gets,
      give: gives[0],
      get: gets[0],
      partnerId: r.partnerId,
      partnerName: ctx.teamById.get(r.partnerId)?.name,
      myDelta: r.myDelta,
      partnerDelta: r.partnerDelta,
      myDrops: r.myDrops,
      myFillers: r.myFillers,
      partnerDrops: r.partnerDrops,
      partnerFillers: r.partnerFillers,
      giveRank: giveRanks[0] ?? null,
      getRank: getRanks[0] ?? null,
      giveRanks,
      getRanks,
      rankGap: (giveRanks[0] && getRanks[0]) ? giveRanks[0] - getRanks[0] : 0,
      vorDiff,
      fairness: fairnessLabel,
      winWin: r.partnerDelta >= 0,
      posWarnings: r.posWarnings,
      hasSeverePosError,
      catChanges,
    };
  }

  const allCandidates = [];

  // 1) 1-for-1 offers
  if (typeSet.has('1for1')) {
    for (const give of validGives) {
      const giveRank = getMarketRank(ctx, give.name);
      if (giveRank == null) continue;
      const local = [];
      for (const get of others) {
        const getRank = getMarketRank(ctx, get.name);
        if (getRank == null || Math.abs(getRank - giveRank) > window) continue;
        const rankGap = giveRank - getRank;
        let fairness = 'Fair value';
        if (rankGap > 5) fairness = 'Reach';
        else if (rankGap < -5) fairness = 'Overpay';
        const cand = evaluateCandidate('1for1', [give], [get], ctx.ownerByName.get(get.name), rankGap / 10, fairness);
        if (cand) local.push(cand);
      }
      local.sort((a, b) => b.myDelta - a.myDelta);
      allCandidates.push(...local.slice(0, perGive));
    }
  }

  // 2) 2-for-1 consolidations (Give 2 -> Get 1 Star + Open Waiver/Stream Spot)
  if (typeSet.has('2for1') && myActive.length >= 2) {
    const seenPairs = new Set();
    const pairs = [];
    for (const g1 of validGives) {
      for (const g2 of myActive) {
        if (g1.name === g2.name) continue;
        // Skip pairing a non-selected top-15 cornerstone as throw-in sweetener
        const r2 = getMarketRank(ctx, g2.name);
        if (r2 != null && r2 <= 15 && !validGives.some(x => x.name === g2.name)) continue;
        const key = [g1.name, g2.name].sort().join('||');
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        pairs.push([g1, g2]);
      }
    }

    const twoForOnePool = [];
    for (const [g1, g2] of pairs) {
      const z1 = ctx.fullValue(g1);
      const z2 = ctx.fullValue(g2);
      const r1 = getMarketRank(ctx, g1.name) ?? 150;
      const r2 = getMarketRank(ctx, g2.name) ?? 150;
      const bestGiveZ = Math.max(z1, z2);
      const bestGiveRank = Math.min(r1, r2);

      for (const get of others) {
        const zGet = ctx.fullValue(get);
        if (zGet <= bestGiveZ + 0.35) continue; // must be a genuine upgrade over either piece
        const rGet = getMarketRank(ctx, get.name) ?? 999;
        if (rGet <= 12 && bestGiveRank > 45) continue; // guard against two mid guys for a top-12 cornerstone

        const pid = ctx.ownerByName.get(get.name);
        const pDropZ = partnerWorstZ.get(pid) ?? replZ;
        const partnerVorDelta = (z1 + z2) - (zGet + pDropZ);
        if (partnerVorDelta < -1.8 || partnerVorDelta > 2.4) continue;

        let fairness = 'Fair value';
        if (partnerVorDelta < -0.5) fairness = 'Reach';
        else if (partnerVorDelta > 0.7) fairness = 'Overpay';

        const cand = evaluateCandidate('2for1', [g1, g2], [get], pid, partnerVorDelta, fairness);
        if (cand) twoForOnePool.push(cand);
      }
    }
    twoForOnePool.sort((a, b) => (b.myDelta + (b.winWin ? 0.05 : 0)) - (a.myDelta + (a.winWin ? 0.05 : 0)));
    // Cap repeats per incoming star so 2-for-1 doesn't repeat the same star 10 times
    const starCounts = new Map();
    for (const c of twoForOnePool) {
      const cnt = starCounts.get(c.gets[0].name) || 0;
      if (cnt >= 2) continue;
      starCounts.set(c.gets[0].name, cnt + 1);
      allCandidates.push(c);
      if (starCounts.size >= limit) break;
    }
  }

  // 3) 1-for-2 depth splits (Give 1 Star -> Get 2 solid starters from the SAME partner)
  if (typeSet.has('1for2') && myActive.length >= 2) {
    const oneForTwoPool = [];
    for (const give of validGives) {
      const zGive = ctx.fullValue(give);
      const rGive = getMarketRank(ctx, give.name) ?? 999;
      if (rGive > 90 && zGive < replZ + 1.5) continue; // must be worth splitting

      const remainingActive = myActive.filter(p => p.name !== give.name);
      const myDropZ = remainingActive.length
        ? Math.min(...remainingActive.map(p => sumZ(ctx.zTable.get(p.name), ctx.activeList)))
        : replZ;
      const myDropFullZ = remainingActive.length
        ? Math.min(...remainingActive.map(p => ctx.fullValue(p)))
        : replZ;

      for (const [pid, plist] of otherTeamsPlayers) {
        const eligible = plist
          .filter(p => {
            const zP = ctx.fullValue(p);
            const rP = getMarketRank(ctx, p.name) ?? 999;
            return zP > myDropFullZ + 0.45 && zP < zGive + 0.25 && rP <= 145 && sumZ(ctx.zTable.get(p.name), ctx.activeList) > myDropZ + 0.25;
          })
          .sort((a, b) => ctx.fullValue(b) - ctx.fullValue(a))
          .slice(0, 9);

        for (let i = 0; i < eligible.length; i++) {
          for (let j = i + 1; j < eligible.length; j++) {
            const g1 = eligible[i];
            const g2 = eligible[j];
            const z1 = ctx.fullValue(g1);
            const z2 = ctx.fullValue(g2);
            const partnerVorDelta = (zGive + replZ) - (z1 + z2);
            if (partnerVorDelta < -1.8 || partnerVorDelta > 2.4) continue;

            let fairness = 'Fair value';
            if (partnerVorDelta < -0.5) fairness = 'Reach';
            else if (partnerVorDelta > 0.7) fairness = 'Overpay';

            const cand = evaluateCandidate('1for2', [give], [g1, g2], pid, partnerVorDelta, fairness);
            if (cand) oneForTwoPool.push(cand);
          }
        }
      }
    }
    oneForTwoPool.sort((a, b) => (b.myDelta + (b.winWin ? 0.05 : 0)) - (a.myDelta + (a.winWin ? 0.05 : 0)));
    allCandidates.push(...oneForTwoPool.slice(0, Math.max(6, limit)));
  }

  // Deduplicate and rank by net team value (preferring win-win and clean positional fit)
  const dedup = new Map();
  for (const c of allCandidates) {
    if (!dedup.has(c.id)) dedup.set(c.id, c);
  }
  const unique = [...dedup.values()];
  const score = c => c.myDelta + (c.winWin ? 0.05 : 0) - (c.hasSeverePosError ? 0.12 : 0);
  unique.sort((a, b) => score(b) - score(a));

  return unique.slice(0, limit);
}
