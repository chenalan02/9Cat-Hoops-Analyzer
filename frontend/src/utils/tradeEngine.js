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

import { CATEGORIES, DB_Z_KEYS, getPlayerStatsObject, getPlayerMu, playerRatioMoments, ratioVariance } from './zScore.js';

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

function emptyTotals() {
  const t = { cov_fg: 0, cov_ft: 0 };
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
  const fgM = playerRatioMoments(s.mu_fgm, s.var_fgm, s.mu_fga, s.var_fga);
  const ftM = playerRatioMoments(s.mu_ftm, s.var_ftm, s.mu_fta, s.var_fta);
  c.v_fgm = fgM.effVarM * games;
  c.v_fga = fgM.varA * games;
  c.cov_fg = fgM.covMA * games;
  c.v_ftm = ftM.effVarM * games;
  c.v_fta = ftM.varA * games;
  c.cov_ft = ftM.covMA * games;
  return c;
}

function addInto(target, contrib, sign = 1) {
  if (!contrib) return target;
  for (const k of STAT_KEYS) {
    target[k] += sign * contrib[k];
    target[`v_${k}`] += sign * contrib[`v_${k}`];
  }
  target.cov_fg += sign * num(contrib.cov_fg);
  target.cov_ft += sign * num(contrib.cov_ft);
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
      const isFg = cat.derived === 'fg';
      const m = isFg ? t.fgm : t.ftm;
      const a = isFg ? t.fga : t.fta;
      const vm = isFg ? t.v_fgm : t.v_ftm;
      const va = isFg ? t.v_fga : t.v_fta;
      const cov = isFg ? t.cov_fg : t.cov_ft;
      const mu = a > 0 ? m / a : 0;
      let v = a > 0 ? ratioVariance(m, vm, a, va, cov) : 0;
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

  const validFreeAgents = (freeAgents || []).filter(p => p?.name && !ownerByName.has(p.name));
  const freeAgentSet = new Set(validFreeAgents.map(p => p.name));
  for (const fa of validFreeAgents) {
    if (!zTable.has(fa.name)) zTable.set(fa.name, computePlayerZRow(fa, source, fallback));
    if (!contrib.has(fa.name)) contrib.set(fa.name, playerContribution(fa, source));
  }

  const { replacement, replacementBaseContrib, replacementContrib } = selectWaiverReplacement({
    freeAgents: validFreeAgents,
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
  const yahooRank = new Map();
  const yahooORank = new Map();
  for (const p of [...allPlayers, ...validFreeAgents]) {
    if (!marketRank.has(p.name)) {
      const s = getPlayerStatsObject(p, source);
      const rawR = s?.rank != null ? s.rank : p?.rank;
      const r = Number(rawR);
      marketRank.set(p.name, Number.isFinite(r) && r > 0 && r < 999 ? r : null);
    }
    if (!yahooRank.has(p.name)) {
      const yr = Number(p?.yahoo_rank);
      yahooRank.set(p.name, Number.isFinite(yr) && yr > 0 ? yr : null);
    }
    if (!yahooORank.has(p.name)) {
      const yor = Number(p?.yahoo_orank);
      yahooORank.set(p.name, Number.isFinite(yor) && yor > 0 ? yor : null);
    }
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
    freeAgents: validFreeAgents,
    freeAgentSet,
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
    yahooRank,
    yahooORank,
  };
}

/** Global market rank (Databricks) with league Z-rank fallback. */
export function getMarketRank(ctx, name) {
  return ctx.marketRank.get(name) ?? ctx.leagueRank.get(name) ?? null;
}

/** Yahoo Fantasy rank (current season rank with O-Rank fallback) for perceived fairness. */
export function getYahooRank(ctx, name) {
  const rank = ctx?.yahooRank?.get(name) ?? null;
  const orank = ctx?.yahooORank?.get(name) ?? null;
  return { rank, orank, effective: rank ?? orank ?? null };
}

function yahooRankScore(rank) {
  const r = Math.max(1, Math.min(Number(rank) || 200, 300));
  return 12 / (Math.sqrt(r) + 1);
}

/**
 * Evaluates how "fair" a swap looks on Yahoo's public rank numbers (season rank, O-Rank fallback).
 * Returns null if Yahoo ranks are unavailable for any involved player.
 */
export function computeYahooFairness(ctx, gives, gets) {
  if (!ctx || !gives?.length || !gets?.length) return null;
  const giveRanks = gives.map(p => getYahooRank(ctx, p.name).effective);
  const getRanks = gets.map(p => getYahooRank(ctx, p.name).effective);
  if (giveRanks.some(r => r == null) || getRanks.some(r => r == null)) return null;

  const giveSummary = giveRanks.map(r => `#${r}`).join('+');
  const getSummary = getRanks.map(r => `#${r}`).join('+');
  const detail = `Y! ${giveSummary} → ${getSummary}`;

  if (gives.length === 1 && gets.length === 1) {
    const gap = giveRanks[0] - getRanks[0]; // positive => giving higher rank # (worse) for lower # (better)
    if (gap > 15) {
      return { cls: 'warn', label: `Yahoo: Reach (+${gap})`, detail, gap };
    }
    if (gap < -15) {
      return { cls: 'info', label: `Yahoo: Overpay (${gap})`, detail, gap };
    }
    return { cls: 'good', label: 'Yahoo: Fair', detail, gap };
  }

  const waiverScore = yahooRankScore(160);
  const giveScore = giveRanks.reduce((s, r) => s + yahooRankScore(r), 0)
    + Math.max(0, gets.length - gives.length) * waiverScore;
  const getScore = getRanks.reduce((s, r) => s + yahooRankScore(r), 0)
    + Math.max(0, gives.length - gets.length) * waiverScore;
  const diff = giveScore - getScore; // positive => partner gets more Yahoo perceived value

  if (diff < -0.35) {
    return { cls: 'warn', label: 'Yahoo: Reach', detail, diff };
  }
  if (diff > 0.45) {
    return { cls: 'info', label: 'Yahoo: Overpay', detail, diff };
  }
  return { cls: 'good', label: 'Yahoo: Fair', detail, diff };
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
    const partnerOutgoing = incoming.filter(p => ctx.ownerByName.get(p.name) === singlePartner);
    partnerMoves = applyMoves(ctx, singlePartner, partnerOutgoing, outgoing, partnerCatsList, false);
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

// Ranks my active players by punt mismatch and saturated-category waste relative to market value,
// protecting un-punted top-15 cornerstones from within-roster ordinal distortions.
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

  const replZ = ctx.replacement.z_total ?? -2;
  const spotFloorZ = Math.max(replZ, -2.0);
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
    const isTopTierHero = r.marketRank != null && r.marketRank <= 10 && r.puntDrag < 1.8 && r.rankShift < 10;
    const isCornerstone = isTopTierHero || (
      r.marketRank != null &&
      r.marketRank <= 18 &&
      r.puntDrag < 1.1 &&
      r.rankShift < 10 &&
      r.surplusZ < 1.35
    );
    const isWaiverTier = (r.marketRank != null && r.marketRank > 140) || r.fullZ < spotFloorZ - 0.6;

    const rawScore = (
      r.puntDrag * 0.45 +
      r.surplusZ * 0.40 +
      Math.max(0, r.rankShift) / 30 +
      (hasMismatch ? r.fitGap * 0.40 : r.fitGap * 0.18)
    );
    r.isCornerstone = isCornerstone;
    r.isWaiverTier = isWaiverTier;
    r.autoEligible = !isCornerstone && !isWaiverTier;
    r.sellScore = isCornerstone ? rawScore - 2.0 : isWaiverTier ? rawScore - 1.2 : rawScore;

    r.tags = [];
    if (isWaiverTier) r.tags.push('Waiver tier — check FA Swaps');
    if (r.puntDrag >= 0.6 || r.rankShift >= 10) r.tags.push('Poor punt fit');
    if (r.surplusZ >= 0.65) r.tags.push('Surplus cat overlap');
    if (!isCornerstone && !isWaiverTier && r.marketRank != null && r.marketRank <= 80 && r.fitGap >= 0.25) {
      r.tags.push('Market value > team impact');
    }
    if (!isCornerstone && !isWaiverTier && r.marginal <= 0.04) r.tags.push('Minimal team impact');
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
    yahooFairOnly = false,
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
  const spotCostZ = Math.max(replZ, -2.0);
  const partnerWorstZ = new Map();
  for (const [tid, plist] of otherTeamsPlayers) {
    const fullTeamActive = ctx.teamById.get(tid).players.filter(p => isActiveSlot(p) && ctx.contrib.get(p.name));
    const rawMinZ = fullTeamActive.length ? Math.min(...fullTeamActive.map(p => ctx.fullValue(p))) : spotCostZ;
    // Cap drop-slot credit near the waiver wire so bench outliers don't justify trading two waiver guys for a starter.
    partnerWorstZ.set(tid, Math.max(rawMinZ, spotCostZ - 0.5));
  }

  const myActive = myTeam.players.filter(p => isActiveSlot(p) && ctx.contrib.get(p.name));

  function evaluateCandidate(type, gives, gets, partnerId, vorDiff, fairnessLabel) {
    if (posFilter !== 'all' && !gets.some(p => playerHasPosition(p, posFilter))) return null;

    const r = quickPackageSwap(ctx, myTeamId, gives, gets, partnerId, partnerCats);
    if (r.myDelta <= 0.015) return null;
    if (winWinOnly && r.partnerDelta < 0) return null;
    if (r.partnerDelta < (type === '1for1' ? -0.08 : -0.05)) return null;

    const catChanges = buildCatChanges(myBeforeDist, r.myDist, myBefore.perCat, r.myAfter.perCat);
    if (catFilter !== 'all' && (catChanges[catFilter]?.probDelta ?? 0) < 0.015) return null;

    const yahooFairness = computeYahooFairness(ctx, gives, gets);
    if (yahooFairOnly && yahooFairness?.cls === 'warn') return null;

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
      yahooFairness,
      winWin: r.partnerDelta >= 0,
      posWarnings: r.posWarnings,
      hasSeverePosError,
      catChanges,
    };
  }

  const candidateScore = c => (
    c.myDelta +
    c.partnerDelta * 0.45 +
    (c.winWin ? 0.06 : 0) +
    (c.yahooFairness?.cls === 'good' ? 0.04 : c.yahooFairness?.cls === 'warn' ? -0.06 : 0) -
    (c.fairness === 'Reach' ? 0.04 : 0) -
    (c.hasSeverePosError ? 0.15 : 0)
  );

  const allCandidates = [];

  // 1) 1-for-1 offers (tier-scaled rank window + Z-gap guard so top stars aren't swapped across huge tiers)
  if (typeSet.has('1for1')) {
    for (const give of validGives) {
      const giveRank = getMarketRank(ctx, give.name);
      if (giveRank == null) continue;
      const zGive = ctx.fullValue(give);
      const local = [];
      for (const get of others) {
        const getRank = getMarketRank(ctx, get.name);
        if (getRank == null || getRank > 145) continue;
        const zGet = ctx.fullValue(get);
        if (zGet < spotCostZ - 0.2) continue;

        // Top-3 gods (Jokic/Wemby/Luka tier) only swap 1-for-1 within top 3 and within 1.4 Z
        if (getRank <= 3 && (giveRank > 3 || zGet - zGive > 1.4)) continue;

        const rankGap = giveRank - getRank; // positive => reaching up for higher-ranked player
        if (rankGap > 0) {
          const maxUpwardGap = Math.min(window, Math.max(2, Math.floor(getRank * (window / 45))));
          if (rankGap > maxUpwardGap) continue;
        } else {
          const maxDownwardGap = Math.min(window + 5, Math.max(4, Math.floor(giveRank * (window / 25))));
          if (-rankGap > maxDownwardGap) continue;
        }

        // Prevent lopsided Z-score jumps even when ordinal ranks look close (e.g. #4 -> #1 is >4 Z)
        const vorDiff = zGive - zGet; // negative => asking for more 9-cat Z than giving
        if (vorDiff < -1.35 || vorDiff > 1.75) continue;

        const reachRankThresh = Math.max(3, Math.min(6, Math.floor(getRank * 0.15)));
        const overpayRankThresh = Math.max(4, Math.min(8, Math.floor(giveRank * 0.2)));
        let fairness = 'Fair value';
        if (vorDiff < -0.45 || rankGap > reachRankThresh) fairness = 'Reach';
        else if (vorDiff > 0.55 || -rankGap > overpayRankThresh) fairness = 'Overpay';

        const cand = evaluateCandidate('1for1', [give], [get], ctx.ownerByName.get(get.name), vorDiff, fairness);
        if (cand) local.push(cand);
      }
      local.sort((a, b) => candidateScore(b) - candidateScore(a));
      allCandidates.push(...local.slice(0, perGive));
    }
  }

  // 2) 2-for-1 consolidations (Give 2 real starters -> Get 1 Clear Upgrade + Open Waiver/Stream Spot)
  if (typeSet.has('2for1') && myActive.length >= 2) {
    const seenPairs = new Set();
    const pairs = [];
    for (const g1 of validGives) {
      const z1 = ctx.fullValue(g1);
      const r1 = getMarketRank(ctx, g1.name) ?? 999;
      if (z1 < spotCostZ - 0.3 || r1 > 120) continue;
      for (const g2 of myActive) {
        if (g1.name === g2.name) continue;
        // Both outgoing players must be rosterable starters, not waiver-grade throw-ins.
        const z2 = ctx.fullValue(g2);
        const r2 = getMarketRank(ctx, g2.name) ?? 999;
        if (z2 < spotCostZ + 0.15 || r2 > 110) continue;
        if (r2 <= 18 && !validGives.some(x => x.name === g2.name)) continue;
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
      const secondGiveRank = Math.max(r1, r2);

      for (const get of others) {
        const zGet = ctx.fullValue(get);
        const rGet = getMarketRank(ctx, get.name) ?? 999;
        if (zGet <= bestGiveZ + 0.45) continue; // must be a clear upgrade over the better outgoing piece
        if (rGet >= bestGiveRank - 3) continue; // incoming player should meaningfully outrank your best piece
        if (rGet <= 5 && (bestGiveRank > 12 || secondGiveRank > 35)) continue; // top-5 gods require a 1st-rounder + top-35 piece
        if (rGet <= 15 && (bestGiveRank > 28 || secondGiveRank > 65)) continue; // top-15 stars require a top-28 anchor + top-65 piece
        if (rGet <= 30 && (bestGiveRank > 48 || secondGiveRank > 90)) continue;
        if (zGet - bestGiveZ > 3.2) continue; // prevent implausible two-mid-for-superstar packages

        const pid = ctx.ownerByName.get(get.name);
        const pDropZ = partnerWorstZ.get(pid) ?? spotCostZ;
        // Partner only gains real value if the second piece meaningfully beats their drop/waiver slot.
        if (Math.min(z1, z2) < pDropZ + 0.55) continue;
        const partnerVorDelta = (z1 + z2) - (zGet + pDropZ);
        if (partnerVorDelta < -0.45 || partnerVorDelta > 1.25) continue;

        let fairness = 'Fair value';
        if (partnerVorDelta < -0.15) fairness = 'Reach';
        else if (partnerVorDelta > 0.55) fairness = 'Overpay';

        const cand = evaluateCandidate('2for1', [g1, g2], [get], pid, partnerVorDelta, fairness);
        if (cand) twoForOnePool.push(cand);
      }
    }
    twoForOnePool.sort((a, b) => candidateScore(b) - candidateScore(a));
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

  // 3) 1-for-2 depth splits (Give 1 Clear Star -> Get 2 solid starters from the SAME partner)
  if (typeSet.has('1for2') && myActive.length >= 2) {
    const oneForTwoPool = [];
    for (const give of validGives) {
      const zGive = ctx.fullValue(give);
      const rGive = getMarketRank(ctx, give.name) ?? 999;
      if (rGive > 55 || zGive < spotCostZ + 2.0) continue; // only split an actual top-55 star

      const remainingActive = myActive.filter(p => p.name !== give.name);
      const myDropZ = remainingActive.length
        ? Math.min(...remainingActive.map(p => sumZ(ctx.zTable.get(p.name), ctx.activeList)))
        : spotCostZ;
      const myRawDropFullZ = remainingActive.length
        ? Math.min(...remainingActive.map(p => ctx.fullValue(p)))
        : spotCostZ;
      const mySpotFloorZ = Math.max(myRawDropFullZ, spotCostZ - 0.4);

      for (const [pid, plist] of otherTeamsPlayers) {
        const eligible = plist
          .filter(p => {
            const zP = ctx.fullValue(p);
            const rP = getMarketRank(ctx, p.name) ?? 999;
            return (
              rP > rGive + 4 && // partner must be getting the clear best player in the deal
              rP <= (rGive <= 12 ? 55 : 100) && // splitting a top-12 star requires two top-55 returns
              zP < zGive - 0.55 &&
              zP > mySpotFloorZ + 0.5 &&
              sumZ(ctx.zTable.get(p.name), ctx.activeList) > myDropZ + 0.25
            );
          })
          .sort((a, b) => ctx.fullValue(b) - ctx.fullValue(a))
          .slice(0, 9);

        for (let i = 0; i < eligible.length; i++) {
          for (let j = i + 1; j < eligible.length; j++) {
            const g1 = eligible[i];
            const g2 = eligible[j];
            const z1 = ctx.fullValue(g1);
            const z2 = ctx.fullValue(g2);
            const partnerVorDelta = (zGive + spotCostZ) - (z1 + z2);
            if (partnerVorDelta < -0.55 || partnerVorDelta > 1.15) continue;

            let fairness = 'Fair value';
            if (partnerVorDelta < -0.15) fairness = 'Reach';
            else if (partnerVorDelta > 0.55) fairness = 'Overpay';

            const cand = evaluateCandidate('1for2', [give], [g1, g2], pid, partnerVorDelta, fairness);
            if (cand) oneForTwoPool.push(cand);
          }
        }
      }
    }
    oneForTwoPool.sort((a, b) => candidateScore(b) - candidateScore(a));
    allCandidates.push(...oneForTwoPool.slice(0, Math.max(6, limit)));
  }

  // Deduplicate and rank by composite team + partner + Yahoo fairness score
  const dedup = new Map();
  for (const c of allCandidates) {
    if (!dedup.has(c.id)) dedup.set(c.id, c);
  }
  const unique = [...dedup.values()];
  unique.sort((a, b) => candidateScore(b) - candidateScore(a));

  return unique.slice(0, limit);
}

function isOutStatus(player) {
  return OUT_STATUS_SET.has(String(player?.status || '').toUpperCase().trim());
}

function getRosRank(player) {
  const r = Number(player?.ros_stats?.rank ?? player?.rank);
  return Number.isFinite(r) && r > 0 && r < 999 ? r : null;
}

function classifyDropProtection(ctx, player) {
  const marketRank = getMarketRank(ctx, player.name);
  const rosRank = getRosRank(player);
  const yahooEff = getYahooRank(ctx, player.name).effective;
  const fullZ = ctx.fullValue(player);
  const puntZ = ctx.puntValue(player);
  const spotFloorZ = Math.max(ctx.replacement?.z_total ?? -2, -2.0);
  const out = isOutStatus(player);

  const bestKnownRank = Math.min(
    marketRank ?? 999,
    rosRank ?? 999,
    yahooEff != null ? Math.max(yahooEff, 40) : 999
  );

  // Protect injured top-100 players: they should be moved to IL, never dropped to waivers.
  if (out && ((rosRank != null && rosRank <= 105) || (marketRank != null && marketRank <= 105) || (yahooEff != null && yahooEff <= 90))) {
    return {
      isProtected: true,
      protectionType: 'il-stash',
      protectionLabel: '🏥 Stash on IL — do not drop',
      rosRank,
    };
  }

  // Protect genuine top-90 tradeable assets from waiver drops (even if slumping in EMA/Weekly).
  const isStrongAsset = (
    (rosRank != null && rosRank <= 90) ||
    (marketRank != null && marketRank <= 85) ||
    (bestKnownRank <= 95 && fullZ >= spotFloorZ + 1.1 && puntZ >= spotFloorZ + 0.6)
  );
  if (isStrongAsset) {
    return {
      isProtected: true,
      protectionType: 'hold-trade',
      protectionLabel: rosRank != null && marketRank != null && marketRank - rosRank >= 25
        ? `🔒 Hold (ROS #${rosRank})`
        : '🔒 Hold / Trade instead',
      rosRank,
    };
  }

  return {
    isProtected: false,
    protectionType: null,
    protectionLabel: null,
    rosRank,
  };
}

function evaluateSingleFaSwap(ctx, myTeamId, dropPlayer, fa) {
  const myTeam = ctx.teamById.get(myTeamId);
  const myBeforeDist = ctx.distById.get(myTeamId);
  const myBefore = ctx.baseWins.get(myTeamId);

  const mine = applyMoves(ctx, myTeamId, [dropPlayer], [fa], ctx.activeList, false);
  const dist = new Map(ctx.distById);
  const myDist = distFromTotals(mine.totals);
  dist.set(myTeamId, myDist);

  const myAfter = expectedCatWins(myTeamId, dist, ctx.activeCats);
  const myDelta = myAfter.total - myBefore.total;
  const catChanges = buildCatChanges(myBeforeDist, myDist, myBefore.perCat, myAfter.perCat);
  const posWarnings = comparePositionImpact(myTeam.players, mine.afterPlayers, ctx.rosterPositions);
  const hasSeverePosError = posWarnings.some(w => w.severity === 'error');
  const hasMinorPosWarn = posWarnings.length > 0 && !hasSeverePosError;

  const dropZ = ctx.puntValue(dropPlayer);
  const addZ = ctx.puntValue(fa);
  const puntZDelta = addZ - dropZ;
  const dropRank = getMarketRank(ctx, dropPlayer.name);
  const addRank = getMarketRank(ctx, fa.name);
  const dropYahooRank = getYahooRank(ctx, dropPlayer.name).effective;
  const addYahooRank = getYahooRank(ctx, fa.name).effective;
  const protection = classifyDropProtection(ctx, dropPlayer);

  const activeCatMoves = CATEGORIES
    .filter(c => ctx.activeCats.has(c.key))
    .map(c => ({ key: c.key, probDelta: catChanges[c.key]?.probDelta ?? 0 }))
    .sort((a, b) => b.probDelta - a.probDelta);
  const topGains = activeCatMoves.filter(x => x.probDelta >= 0.01).slice(0, 2).map(x => x.key);
  const topLosses = activeCatMoves.filter(x => x.probDelta <= -0.01).slice(-2).reverse().map(x => x.key);

  const reasonTags = [];
  if (protection.isProtected) {
    reasonTags.push(protection.protectionType === 'il-stash' ? 'Caution: IL stash (#ROS)' : `Caution: #${protection.rosRank ?? dropRank} asset`);
  } else if (isOutStatus(dropPlayer) && !isOutStatus(fa)) {
    reasonTags.push('Replaces OUT player');
  } else if (!ctx.contrib.get(dropPlayer.name)) {
    reasonTags.push('Replaces zero-minute slot');
  }
  if (topGains.length > 0) reasonTags.push(`Boosts ${topGains.join(' & ')}`);
  if (puntZDelta >= 0.6 && myDelta > 0.02) reasonTags.push('Clear value upgrade');
  else if (puntZDelta < 0 && myDelta > 0.02) reasonTags.push('Better build fit');
  if (addYahooRank != null && addYahooRank <= 90) reasonTags.push(`Y! Top-${addYahooRank <= 50 ? 50 : 90} FA`);

  const swapScore = (
    myDelta +
    Math.min(0.08, Math.max(-0.08, puntZDelta * 0.02)) -
    (hasSeverePosError ? 0.25 : hasMinorPosWarn ? 0.04 : 0) -
    (protection.isProtected ? 0.35 : 0)
  );

  return {
    id: `fa:${dropPlayer.name}=>${fa.name}`,
    type: 'fa-swap',
    drop: dropPlayer,
    add: fa,
    gives: [dropPlayer],
    gets: [fa],
    myDelta,
    swapScore,
    puntZDelta,
    dropZ,
    addZ,
    dropRank,
    addRank,
    dropYahooRank,
    addYahooRank,
    dropRosRank: protection.rosRank,
    isDropProtected: protection.isProtected,
    catChanges,
    topGains,
    topLosses,
    posWarnings,
    hasSeverePosError,
    reasonTags,
  };
}

/**
 * Ranks active roster players by upgradeability against available free agents,
 * separating real end-of-bench drop candidates from protected core/tradeable players.
 */
export function computeDropCandidates(ctx, myTeamId, options = {}) {
  const { hideOutFas = true } = options;
  const team = ctx.teamById.get(myTeamId);
  if (!team) return [];

  const activeRoster = team.players.filter(isActiveSlot);
  const candidateFas = (ctx.freeAgents || []).filter(fa => (
    ctx.contrib.get(fa.name) != null && (!hideOutFas || !isOutStatus(fa))
  ));

  const rows = activeRoster.map(p => {
    const marketRank = getMarketRank(ctx, p.name);
    const yahooRank = getYahooRank(ctx, p.name).effective;
    const puntZ = ctx.puntValue(p);
    const out = isOutStatus(p);
    const hasStats = ctx.contrib.get(p.name) != null;
    const protection = classifyDropProtection(ctx, p);

    let bestFa = null;
    let bestFaDelta = null;
    for (const fa of candidateFas) {
      const res = evaluateSingleFaSwap(ctx, myTeamId, p, fa);
      if (res.hasSeverePosError) continue;
      if (!protection.isProtected && res.puntZDelta < -0.55) continue;
      if (bestFaDelta == null || res.myDelta > bestFaDelta) {
        bestFaDelta = res.myDelta;
        bestFa = fa;
      }
    }

    return {
      player: p,
      marketRank,
      yahooRank,
      rosRank: protection.rosRank,
      puntZ,
      isOut: out,
      hasStats,
      isProtected: protection.isProtected,
      protectionLabel: protection.protectionLabel,
      autoDropEligible: !protection.isProtected,
      bestFa,
      bestFaDelta,
    };
  });

  rows.sort((a, b) => {
    // Keep genuine drop candidates above protected Hold/Trade stars
    if (a.isProtected !== b.isProtected) return a.isProtected ? 1 : -1;
    const da = a.bestFaDelta ?? -999;
    const db = b.bestFaDelta ?? -999;
    if (Math.abs(db - da) > 0.005) return db - da;
    return a.puntZ - b.puntZ;
  });
  return rows;
}

/**
 * Evaluates switching current active-roster players for available free agents.
 * In Auto mode (onlyPositive=true), skips protected core players, blocks severe positional
 * errors or large punt-Z downgrades, and deduplicates so the same FA isn't repeated for every bench slot.
 */
export function computeFreeAgentSwaps(ctx, myTeamId, dropPlayers, options = {}) {
  const {
    limit = 18,
    perDrop = 4,
    posFilter = 'all',
    catFilter = 'all',
    hideOutFas = true,
    onlyPositive = true,
  } = options;

  const rawDrops = (dropPlayers || []).filter(isActiveSlot);
  const drops = onlyPositive
    ? rawDrops.filter(p => !classifyDropProtection(ctx, p).isProtected)
    : rawDrops;
  if (!drops.length) return [];

  const candidateFas = (ctx.freeAgents || []).filter(fa => (
    ctx.contrib.get(fa.name) != null &&
    (!hideOutFas || !isOutStatus(fa)) &&
    playerHasPosition(fa, posFilter)
  ));
  if (!candidateFas.length) return [];

  const results = [];
  for (const dropPlayer of drops) {
    const local = [];
    for (const fa of candidateFas) {
      const swap = evaluateSingleFaSwap(ctx, myTeamId, dropPlayer, fa);
      if (onlyPositive) {
        if (swap.myDelta < 0.015) continue;
        if (swap.hasSeverePosError) continue;
        if (swap.puntZDelta < -0.55) continue;
      }
      if (catFilter !== 'all' && (swap.catChanges[catFilter]?.probDelta ?? 0) < 0.01) continue;
      local.push(swap);
    }
    local.sort((a, b) => b.swapScore - a.swapScore);
    results.push(...local.slice(0, perDrop));
  }

  results.sort((a, b) => b.swapScore - a.swapScore);

  const dedup = new Map();
  const faAppearances = new Map();
  const maxPerFa = onlyPositive && drops.length > 1 ? 2 : limit;

  for (const r of results) {
    if (dedup.has(r.id)) continue;
    const faCount = faAppearances.get(r.add.name) || 0;
    if (faCount >= maxPerFa) continue;
    faAppearances.set(r.add.name, faCount + 1);
    dedup.set(r.id, r);
    if (dedup.size >= limit) break;
  }

  return [...dedup.values()];
}
