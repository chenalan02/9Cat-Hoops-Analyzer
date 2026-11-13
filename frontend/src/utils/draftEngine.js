import {
  CATEGORIES,
  DB_Z_KEYS,
  getPlayerMu,
  getPlayerStatsObject,
} from './zScore.js';

export const DEFAULT_ROSTER_SLOTS = {
  PG: 1,
  SG: 1,
  SF: 1,
  PF: 1,
  C: 1,
  G: 1,
  F: 1,
  Util: 3,
  Bench: 3,
};

export const ROSTER_PRESETS = [
  {
    id: 'yahoo13',
    label: 'Yahoo 13 (3 Util, 3 BN)',
    slots: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, Util: 3, Bench: 3 },
  },
  {
    id: 'classic13',
    label: '2 C / 2 Util (13 Spots)',
    slots: { PG: 1, SG: 1, SF: 1, PF: 1, C: 2, G: 1, F: 1, Util: 2, Bench: 3 },
  },
  {
    id: 'shallow12',
    label: 'Standard 12 (2 Util, 3 BN)',
    slots: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, Util: 2, Bench: 3 },
  },
  {
    id: 'deep14',
    label: 'Deep 14 (3 Util, 4 BN)',
    slots: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, Util: 3, Bench: 4 },
  },
];

export const PUNT_PRESETS = [
  { id: 'balanced', label: '9-Cat Balanced', cats: [] },
  { id: 'punt_ft', label: 'Punt FT%', cats: ['FT%'] },
  { id: 'punt_fg_to', label: 'Punt FG% + TO', cats: ['FG%', 'TO'] },
  { id: 'punt_ast', label: 'Punt AST', cats: ['AST'] },
  { id: 'punt_blk', label: 'Punt BLK', cats: ['BLK'] },
  { id: 'punt_ast_ft', label: 'Punt AST + FT%', cats: ['AST', 'FT%'] },
  { id: 'punt_3pm_ft', label: 'Punt 3PM + FT%', cats: ['3PM', 'FT%'] },
];

export const PRIMARY_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const STARTER_SLOT_ORDER = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'Util'];

export function parsePositions(posStr) {
  if (!posStr) return [];
  if (Array.isArray(posStr)) {
    return posStr.map(s => String(s).trim().toUpperCase()).filter(Boolean);
  }
  return String(posStr)
    .split(/[,/]+/)
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
}

export function playerHasPosition(player, targetPos) {
  if (!targetPos || targetPos === 'ALL') return true;
  const posList = parsePositions(player?.positions);
  if (posList.length === 0) return targetPos === 'Util';
  const t = String(targetPos).trim().toUpperCase();
  if (t === 'UTIL') return true;
  if (t === 'G') return posList.includes('PG') || posList.includes('SG') || posList.includes('G');
  if (t === 'F') return posList.includes('SF') || posList.includes('PF') || posList.includes('F');
  return posList.includes(t);
}

function canPlayerPlaySlotType(posList, slotType) {
  if (slotType === 'Util') return true;
  if (slotType === 'G') return posList.includes('PG') || posList.includes('SG') || posList.includes('G');
  if (slotType === 'F') return posList.includes('SF') || posList.includes('PF') || posList.includes('F');
  if (posList.length === 0) return false;
  return posList.includes(slotType);
}

/**
 * Optimal bipartite matching (Kuhn's algorithm) assigning drafted players into
 * starter slots (PG, SG, SF, PF, C, G, F, Util) first and Bench afterwards.
 * Processing less-flexible players before multi-position flex players ensures
 * specific positions stay occupied by specialists when total starters are tied.
 */
export function assignRosterSlots(players, rosterSlots = DEFAULT_ROSTER_SLOTS) {
  const expandedStarters = [];
  for (const slotType of STARTER_SLOT_ORDER) {
    const count = Math.max(0, Number(rosterSlots?.[slotType]) || 0);
    for (let i = 0; i < count; i++) {
      expandedStarters.push({ slot: slotType, index: i });
    }
  }

  const cleanPlayers = (players || []).filter(p => p && p.name);
  const orderedPlayers = cleanPlayers.map((p, origIdx) => {
    const posList = parsePositions(p?.positions).filter(pos => PRIMARY_POSITIONS.includes(pos));
    return {
      player: p,
      origIdx,
      posList: posList.length > 0 ? posList : parsePositions(p?.positions),
      flexCount: posList.length || 5,
    };
  });

  // Fewer eligible positions first -> specialists anchor narrow slots cleanly
  const matchingOrder = [...orderedPlayers].sort((a, b) => {
    if (a.flexCount !== b.flexCount) return a.flexCount - b.flexCount;
    return (a.origIdx ?? 0) - (b.origIdx ?? 0);
  });

  const adj = matchingOrder.map(item => {
    const edges = [];
    for (let sIdx = 0; sIdx < expandedStarters.length; sIdx++) {
      if (canPlayerPlaySlotType(item.posList, expandedStarters[sIdx].slot)) {
        edges.push(sIdx);
      }
    }
    return edges;
  });

  const matchSlotToPlayer = new Array(expandedStarters.length).fill(-1);
  const matchPlayerToSlot = new Array(matchingOrder.length).fill(-1);

  const dfs = (pIdx, seen) => {
    for (const sIdx of adj[pIdx]) {
      if (seen[sIdx]) continue;
      seen[sIdx] = true;
      if (matchSlotToPlayer[sIdx] === -1 || dfs(matchSlotToPlayer[sIdx], seen)) {
        matchSlotToPlayer[sIdx] = pIdx;
        matchPlayerToSlot[pIdx] = sIdx;
        return true;
      }
    }
    return false;
  };

  let filledStarterCount = 0;
  for (let pIdx = 0; pIdx < matchingOrder.length; pIdx++) {
    const seen = new Array(expandedStarters.length).fill(false);
    if (dfs(pIdx, seen)) {
      filledStarterCount++;
    }
  }

  const assignments = {};
  const slotRows = expandedStarters.map((slotDef, sIdx) => {
    const matchedIdx = matchSlotToPlayer[sIdx];
    const p = matchedIdx !== -1 ? matchingOrder[matchedIdx].player : null;
    if (p) assignments[p.name] = slotDef.slot;
    return { slot: slotDef.slot, index: slotDef.index, player: p };
  });

  const benchPlayers = [];
  for (let pIdx = 0; pIdx < matchingOrder.length; pIdx++) {
    if (matchPlayerToSlot[pIdx] === -1) {
      const p = matchingOrder[pIdx].player;
      assignments[p.name] = 'Bench';
      benchPlayers.push(p);
    }
  }

  const benchCount = Math.max(0, Number(rosterSlots?.Bench) || 0);
  const benchSlotsToRender = Math.max(benchCount, benchPlayers.length);
  for (let bIdx = 0; bIdx < benchSlotsToRender; bIdx++) {
    slotRows.push({
      slot: bIdx < benchCount ? 'Bench' : 'BN+',
      index: bIdx,
      player: benchPlayers[bIdx] || null,
    });
  }

  const openStarterCounts = {};
  for (const st of STARTER_SLOT_ORDER) openStarterCounts[st] = 0;
  expandedStarters.forEach((slotDef, sIdx) => {
    if (matchSlotToPlayer[sIdx] === -1) {
      openStarterCounts[slotDef.slot] = (openStarterCounts[slotDef.slot] || 0) + 1;
    }
  });

  return {
    assignments,
    slotRows,
    filledStarterCount,
    totalStarterCount: expandedStarters.length,
    openStarterCounts,
    benchPlayers,
  };
}

export function getTeamIdxForPick(pickNumber, numTeams, draftType = 'snake') {
  const T = Math.max(2, Number(numTeams) || 12);
  const p = Math.max(1, Number(pickNumber) || 1);
  const round = Math.floor((p - 1) / T) + 1;
  const idxInRound = (p - 1) % T;

  if (draftType === 'linear') {
    return idxInRound;
  }
  if (draftType === '3rr') {
    if (round === 1) return idxInRound;
    if (round === 2 || round === 3) return T - 1 - idxInRound;
    // Round 4 forward alternates from Round 3's reverse order: even -> forward, odd -> reverse
    return round % 2 === 0 ? idxInRound : T - 1 - idxInRound;
  }
  // Standard snake
  return round % 2 === 1 ? idxInRound : T - 1 - idxInRound;
}

export function getUserTurnInfo(currentPick, totalPicks, numTeams, draftType, userTeamId) {
  const T = Math.max(2, Number(numTeams) || 12);
  const userIdx = Math.max(0, (Number(userTeamId) || 1) - 1);
  const curIdx = getTeamIdxForPick(currentPick, T, draftType);
  const isUserNow = curIdx === userIdx;

  let nextUserPick = null;
  for (let p = currentPick + 1; p <= totalPicks + T; p++) {
    if (getTeamIdxForPick(p, T, draftType) === userIdx) {
      nextUserPick = p;
      break;
    }
  }

  return {
    isUserNow,
    onClockTeamIdx: curIdx,
    onClockTeamId: curIdx + 1,
    nextUserPick,
    picksUntilNext: nextUserPick != null ? nextUserPick - currentPick : null,
  };
}

function getProjGpForPlayer(player, statsSource) {
  const s = getPlayerStatsObject(player, statsSource);
  const raw =
    statsSource === 'preseason'
      ? (s?.proj_games_preseason ?? s?.proj_games_played ?? player?.preseason_stats?.proj_games_preseason ?? player?.ros_stats?.proj_games_played)
      : (s?.proj_games_played ?? s?.proj_games_preseason ?? player?.ros_stats?.proj_games_played ?? player?.preseason_stats?.proj_games_preseason);
  if (raw === null || raw === undefined || isNaN(raw)) return null;
  const val = Number(raw);
  return val > 0 ? val : null;
}

/**
 * Normalizes the raw backend draft pool for a specific projection source,
 * preferring Databricks precomputed Z-scores and using volume-weighted
 * efficiency fallbacks over the top draftable cutoff if any Z column is missing.
 */
export function prepareDraftPool(
  rawPlayers,
  statsSource = 'preseason',
  poolSizeCutoff = 160,
  fallbackPosMap = null
) {
  if (!rawPlayers || rawPlayers.length === 0) {
    return { players: [], poolMaxProjGp: 0, leagueAvgFgPct: 0.47, leagueAvgFtPct: 0.78 };
  }

  // Reference slice of top draftable rotation players so deep scrubs don't warp mean/std
  const preRanked = [...rawPlayers].sort((a, b) => {
    const sA = getPlayerStatsObject(a, statsSource);
    const sB = getPlayerStatsObject(b, statsSource);
    const zA = sA?.z_total ?? a?.z_total ?? ((sA?.mu_pts ?? 0) * 0.1 - 5);
    const zB = sB?.z_total ?? b?.z_total ?? ((sB?.mu_pts ?? 0) * 0.1 - 5);
    return Number(zB) - Number(zA);
  });
  const refSample = preRanked.slice(0, Math.min(preRanked.length, Math.max(100, poolSizeCutoff)));

  // Volume-weighted baseline percentages over reference sample
  let sumFgm = 0, sumFga = 0, sumFtm = 0, sumFta = 0;
  for (const p of refSample) {
    const s = getPlayerStatsObject(p, statsSource);
    if (!s) continue;
    sumFgm += Number(s.mu_fgm ?? 0) || 0;
    sumFga += Number(s.mu_fga ?? 0) || 0;
    sumFtm += Number(s.mu_ftm ?? 0) || 0;
    sumFta += Number(s.mu_fta ?? 0) || 0;
  }
  const leagueAvgFgPct = sumFga > 0 ? sumFgm / sumFga : 0.47;
  const leagueAvgFtPct = sumFta > 0 ? sumFtm / sumFta : 0.78;

  const fallbackStats = {};
  for (const cat of CATEGORIES) {
    const vals = [];
    for (const p of refSample) {
      const s = getPlayerStatsObject(p, statsSource);
      if (!s) continue;
      if (cat.derived === 'fg') {
        const fga = Number(s.mu_fga ?? 0);
        const fgm = Number(s.mu_fgm ?? 0);
        if (fga > 0) vals.push((fgm / fga - leagueAvgFgPct) * fga);
      } else if (cat.derived === 'ft') {
        const fta = Number(s.mu_fta ?? 0);
        const ftm = Number(s.mu_ftm ?? 0);
        if (fta > 0) vals.push((ftm / fta - leagueAvgFtPct) * fta);
      } else {
        const mu = getPlayerMu(p, cat, statsSource);
        if (mu !== null && !isNaN(mu)) vals.push(Number(mu));
      }
    }
    const m = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    const variance = vals.reduce((a, b) => a + (b - m) ** 2, 0) / (Math.max(1, vals.length - 1));
    fallbackStats[cat.key] = { mean: m, std: Math.sqrt(variance) || 1 };
  }

  const projGpVals = [];
  const enriched = rawPlayers.map(player => {
    const s = getPlayerStatsObject(player, statsSource) || {};
    const zScores = {};
    const mus = {};
    let baseZSum = 0;
    let validCatCount = 0;

    for (const cat of CATEGORIES) {
      const mu = getPlayerMu(player, cat, statsSource);
      mus[cat.key] = mu;
      const dbKey = DB_Z_KEYS[cat.key];
      const dbZ = s[dbKey];

      let z = null;
      if (dbZ !== undefined && dbZ !== null && !isNaN(dbZ)) {
        z = Number(dbZ);
      } else if (cat.derived === 'fg') {
        const fga = Number(s.mu_fga ?? 0);
        const fgm = Number(s.mu_fgm ?? 0);
        if (fga > 0) {
          const impact = (fgm / fga - leagueAvgFgPct) * fga;
          z = (impact - fallbackStats[cat.key].mean) / fallbackStats[cat.key].std;
        }
      } else if (cat.derived === 'ft') {
        const fta = Number(s.mu_fta ?? 0);
        const ftm = Number(s.mu_ftm ?? 0);
        if (fta > 0) {
          const impact = (ftm / fta - leagueAvgFtPct) * fta;
          z = (impact - fallbackStats[cat.key].mean) / fallbackStats[cat.key].std;
        }
      } else if (mu !== null && !isNaN(mu)) {
        z = (Number(mu) - fallbackStats[cat.key].mean) / fallbackStats[cat.key].std;
        if (cat.lowerBetter) z = -z;
      }

      zScores[cat.key] = z;
      if (z !== null && !isNaN(z)) {
        baseZSum += z;
        validCatCount++;
      }
    }

    const posRaw = player.positions && String(player.positions).toUpperCase() !== 'UTIL'
      ? player.positions
      : (fallbackPosMap?.[player.name] || player.positions || 'SF');

    const projGp = getProjGpForPlayer(player, statsSource);
    if (projGp !== null) projGpVals.push(projGp);

    return {
      ...player,
      positions: posRaw,
      activeStats: s,
      mus,
      zScores,
      baseZSum: validCatCount > 0 ? baseZSum : -999,
      projGp,
      muFgm: Number(s.mu_fgm ?? 0) || 0,
      muFga: Number(s.mu_fga ?? 0) || 0,
      muFtm: Number(s.mu_ftm ?? 0) || 0,
      muFta: Number(s.mu_fta ?? 0) || 0,
      dbRank: s.rank ?? player.rank ?? null,
    };
  });

  // Baseline 9-cat ranking
  const sortedBase = [...enriched].sort((a, b) => {
    if (Math.abs(b.baseZSum - a.baseZSum) > 1e-6) return b.baseZSum - a.baseZSum;
    return (a.name || '').localeCompare(b.name || '');
  });
  const baseRankMap = new Map();
  sortedBase.forEach((p, idx) => baseRankMap.set(p.name, idx + 1));

  projGpVals.sort((a, b) => a - b);
  const poolMaxProjGp = projGpVals.length
    ? projGpVals[Math.min(projGpVals.length - 1, Math.floor(projGpVals.length * 0.9))]
    : 0;

  return {
    players: sortedBase.map(p => ({ ...p, baseRank: baseRankMap.get(p.name) })),
    poolMaxProjGp,
    leagueAvgFgPct,
    leagueAvgFtPct,
  };
}

/**
 * Re-ranks prepared draft pool under current active (non-punted) categories.
 */
export function rankDraftPool(preparedPlayers, activeCats) {
  const withActive = (preparedPlayers || []).map(p => {
    let activeZSum = 0;
    let validCount = 0;
    for (const cat of activeCats) {
      const z = p.zScores?.[cat.key];
      if (z !== null && z !== undefined && !isNaN(z)) {
        activeZSum += z;
        validCount++;
      }
    }
    const finalSum = validCount > 0 ? activeZSum : -999;
    const avgActiveZ = validCount > 0 ? activeZSum / validCount : -999;
    return { ...p, activeZSum: finalSum, avgZ: avgActiveZ };
  });

  const sorted = [...withActive].sort((a, b) => {
    if (Math.abs(b.activeZSum - a.activeZSum) > 1e-6) return b.activeZSum - a.activeZSum;
    return (a.name || '').localeCompare(b.name || '');
  });

  return sorted.map((p, idx) => {
    const overallRank = idx + 1;
    const baseRank = p.baseRank ?? overallRank;
    return {
      ...p,
      overallRank,
      rankDelta: baseRank - overallRank,
    };
  });
}

/**
 * Computes cumulative & per-pick 9-cat team profile for a drafted roster,
 * incorporating volume-weighted FG% / FT% percentages.
 */
export function computeTeamCategoryProfile(roster, leagueAvgFgPct = 0.47, leagueAvgFtPct = 0.78) {
  const validRoster = (roster || []).filter(Boolean);
  const n = validRoster.length;
  const cats = {};
  if (n === 0) {
    for (const cat of CATEGORIES) {
      cats[cat.key] = { sumZ: 0, avgZ: 0 };
    }
    return { count: 0, cats, fgPct: null, ftPct: null };
  }

  let fgm = 0, fga = 0, ftm = 0, fta = 0;
  for (const p of validRoster) {
    fgm += p.muFgm || 0;
    fga += p.muFga || 0;
    ftm += p.muFtm || 0;
    fta += p.muFta || 0;
  }

  for (const cat of CATEGORIES) {
    let sumZ = 0;
    for (const p of validRoster) {
      sumZ += p.zScores?.[cat.key] ?? 0;
    }
    cats[cat.key] = {
      sumZ,
      avgZ: sumZ / n,
    };
  }

  return {
    count: n,
    cats,
    fgPct: fga > 0 ? fgm / fga : null,
    ftPct: fta > 0 ? ftm / fta : null,
    fgDiff: fga > 0 ? (fgm / fga) - leagueAvgFgPct : 0,
    ftDiff: fta > 0 ? (ftm / fta) - leagueAvgFtPct : 0,
  };
}

/**
 * Estimates positional cliff dropoff before the user's next turn for primary positions.
 */
function computePositionalDropoffs(undraftedPlayers, teamRosters, onClockTeamIdx, picksUntilNext, numTeams, draftType, currentPick) {
  const dropoffs = {};
  if (!undraftedPlayers.length || !picksUntilNext || picksUntilNext <= 0) {
    return dropoffs;
  }

  // Count how many upcoming picks belong to teams still missing an open starter at pos
  for (const pos of PRIMARY_POSITIONS) {
    const eligible = undraftedPlayers.filter(p => playerHasPosition(p, pos));
    if (eligible.length < 2) {
      dropoffs[pos] = 0;
      continue;
    }

    let demandCount = 0;
    for (let offset = 1; offset < picksUntilNext; offset++) {
      const tIdx = getTeamIdxForPick(currentPick + offset, numTeams, draftType);
      const roster = teamRosters?.[tIdx]?.players || [];
      const hasPrimary = roster.some(r => parsePositions(r.positions).includes(pos));
      demandCount += hasPrimary ? 0.25 : 0.75;
    }

    // Approximate how many eligible players at this position get taken before next turn
    const share = pos === 'C' || pos === 'PG' ? 0.30 : 0.24;
    const expectedTaken = Math.max(
      1,
      Math.min(eligible.length - 1, Math.round(Math.min(picksUntilNext * share, demandCount * 0.45)))
    );
    const bestZ = eligible[0].activeZSum;
    const afterWaitZ = eligible[expectedTaken].activeZSum;
    dropoffs[pos] = Math.max(0, bestZ - afterWaitZ);
  }

  return dropoffs;
}

const INJURY_OUT_TAGS = new Set(['O', 'INJ', 'OUT', 'IL', 'IL+', 'NA', 'SUSP']);

/**
 * Generates genuinely sensible 9-Cat Draft Recommendations combining:
 * 1) Active punt-adjusted value (anchor)
 * 2) Optimal bipartite roster slot fit & positional logjam prevention
 * 3) Turn-aware positional scarcity dropoff before your next pick
 * 4) Active category deficit recovery, surplus diminishing returns & % conflict checks
 * 5) Relative projected games durability & availability awareness
 */
export function computeDraftRecommendations({
  undraftedPlayers,
  userRoster,
  teamRosters,
  rosterSlots,
  activeCats,
  puntedCats,
  currentPick,
  totalPicks,
  numTeams,
  draftType,
  userTeamId,
  poolMaxProjGp = 0,
  leagueAvgFgPct = 0.47,
  leagueAvgFtPct = 0.78,
  limit = 4,
}) {
  if (!undraftedPlayers || undraftedPlayers.length === 0) return [];

  const n = userRoster?.length || 0;
  const turnInfo = getUserTurnInfo(currentPick, totalPicks, numTeams, draftType, userTeamId);
  const picksWait = turnInfo.picksUntilNext ?? numTeams;

  const baseFit = assignRosterSlots(userRoster, rosterSlots);
  const inStarterPhase = n < baseFit.totalStarterCount;
  const teamProfile = computeTeamCategoryProfile(userRoster, leagueAvgFgPct, leagueAvgFtPct);
  const posDropoffs = inStarterPhase
    ? computePositionalDropoffs(undraftedPlayers, teamRosters, turnInfo.onClockTeamIdx, picksWait, numTeams, draftType, currentPick)
    : {};

  // Evaluate top tier slice plus broader pool so no sensible riser is missed, keeping compute fast
  const candidateSlice = undraftedPlayers.slice(0, Math.min(undraftedPlayers.length, 90));
  const bestAvailableActiveZ = candidateSlice[0]?.activeZSum ?? 0;

  // Ramps up from mild tiebreaking after 0-1 picks to full build & fit awareness mid-draft
  const needRamp = n === 0 ? 0.15 : Math.min(1.0, n / 4.0);
  const fitRamp = n === 0 ? 0.25 : 1.0;

  const scored = candidateSlice.map(p => {
    const reasons = [];
    const warnings = [];
    let score = p.activeZSum;

    // 1. Punt / Market value highlight
    if (puntedCats.size > 0 && p.rankDelta >= 6) {
      reasons.push({
        label: `Punt boost ▲${p.rankDelta} (#${p.baseRank} → #${p.overallRank})`,
        kind: 'punt',
      });
    } else if (p.activeZSum >= bestAvailableActiveZ - 0.15) {
      reasons.push({ label: 'Best available value', kind: 'value' });
    }

    // 2. Bipartite starter slot fit & positional cliff scarcity
    let posAdj = 0;
    const pPrimary = parsePositions(p.positions).filter(pos => PRIMARY_POSITIONS.includes(pos));

    if (inStarterPhase) {
      const testFit = assignRosterSlots([...userRoster, p], rosterSlots);
      const addedStarter = testFit.filledStarterCount > baseFit.filledStarterCount;

      if (!addedStarter) {
        posAdj = -1.05 * fitRamp;
        warnings.push('Positional logjam (overflows starter spots)');
      } else {
        const openExact = pPrimary.filter(pos => (baseFit.openStarterCounts[pos] || 0) > 0);
        if (openExact.length > 0 && n >= 1) {
          let bestDrop = 0;
          let scarcePos = openExact[0];
          for (const pos of openExact) {
            const d = posDropoffs[pos] || 0;
            if (d > bestDrop) {
              bestDrop = d;
              scarcePos = pos;
            }
          }
          const exactFitBonus = 0.18 * fitRamp;
          const cliffBonus = Math.min(0.85, Math.max(0, (bestDrop - 0.35) * 0.42)) * fitRamp;
          posAdj = exactFitBonus + cliffBonus;

          if (cliffBonus >= 0.28 && turnInfo.nextUserPick) {
            reasons.push({
              label: `${scarcePos} cliff (-${bestDrop.toFixed(1)}σ before #${turnInfo.nextUserPick})`,
              kind: 'scarcity',
            });
          } else {
            reasons.push({ label: `Fills open ${openExact[0]} slot`, kind: 'pos' });
          }
        } else if (n >= 2 && pPrimary.length >= 3) {
          posAdj = 0.12;
          reasons.push({ label: 'Multi-pos flex', kind: 'pos' });
        }
      }
    } else if (pPrimary.length >= 3) {
      posAdj = 0.10;
      reasons.push({ label: 'Bench multi-pos flex', kind: 'pos' });
    }

    // 3. Active category balance (deficit help + lock diminishing returns + % synergy)
    let catAdj = 0;
    const boostedCats = [];
    for (const cat of activeCats) {
      const pz = p.zScores?.[cat.key];
      if (pz === null || pz === undefined || isNaN(pz)) continue;
      if (pz >= 0.45) boostedCats.push({ key: cat.key, z: pz });

      if (n >= 1) {
        const teamAvg = teamProfile.cats[cat.key]?.avgZ ?? 0;
        if (teamAvg < -0.10 && pz > 0) {
          const needW = Math.min(0.45, (-0.10 - teamAvg) * 0.25);
          catAdj += needW * Math.min(2.2, pz) * needRamp;
        } else if (n >= 3 && teamAvg > 0.95 && pz > 1.2 && !cat.derived) {
          // Mild diminishing returns when heavily over-locked in an active counting cat
          catAdj -= 0.08 * Math.min(1.5, pz - 0.8) * needRamp;
        }
      }
    }

    boostedCats.sort((a, b) => b.z - a.z);

    if (n >= 1) {
      if (!puntedCats.has('FT%')) {
        const ftZ = p.zScores?.['FT%'] ?? 0;
        const teamFt = teamProfile.cats['FT%']?.avgZ ?? 0;
        if (teamFt < -0.35 && ftZ < -0.85) {
          catAdj -= 0.30 * needRamp;
          warnings.push('Hurts active FT%');
        } else if (teamFt < -0.25 && ftZ > 0.65) {
          catAdj += 0.24 * needRamp;
          reasons.push({ label: 'Stabilizes active FT%', kind: 'cat' });
        }
      }
      if (!puntedCats.has('FG%')) {
        const fgZ = p.zScores?.['FG%'] ?? 0;
        const teamFg = teamProfile.cats['FG%']?.avgZ ?? 0;
        if (teamFg < -0.35 && fgZ < -0.85) {
          catAdj -= 0.25 * needRamp;
          warnings.push('Hurts active FG%');
        } else if (teamFg < -0.25 && fgZ > 0.65) {
          catAdj += 0.20 * needRamp;
          reasons.push({ label: 'Stabilizes active FG%', kind: 'cat' });
        }
      }

      // Call out top lagging active cats boosted by this candidate
      const weakHelped = activeCats
        .filter(c => (teamProfile.cats[c.key]?.avgZ ?? 0) < -0.15 && (p.zScores?.[c.key] ?? 0) >= 0.45)
        .sort((a, b) => (teamProfile.cats[a.key].avgZ - teamProfile.cats[b.key].avgZ))
        .slice(0, 2)
        .map(c => c.key);

      if (weakHelped.length > 0 && reasons.length < 3) {
        reasons.push({ label: `Helps weak ${weakHelped.join(' + ')}`, kind: 'cat' });
      }
    }

    // 4. Durability & injury availability guardrail
    let durabilityAdj = 0;
    const statusTag = String(p.status || '').toUpperCase().trim();
    if (INJURY_OUT_TAGS.has(statusTag)) {
      durabilityAdj = -0.85;
      warnings.push(`Injury tag: ${statusTag}`);
    } else if (poolMaxProjGp >= 25 && p.projGp !== null && p.projGp / poolMaxProjGp < 0.72) {
      const ratio = p.projGp / poolMaxProjGp;
      durabilityAdj = -Math.min(0.75, Math.max(0.15, (0.75 - ratio) * 1.6));
      warnings.push(`Low Proj GP (${Math.round(p.projGp)})`);
    }

    score += posAdj + catAdj + durabilityAdj;

    if (reasons.length === 0) {
      reasons.push({ label: puntedCats.size > 0 ? 'Strong build fit' : 'Balanced 9-cat value', kind: 'value' });
    }

    return {
      player: p,
      score,
      reasons: reasons.slice(0, 2),
      warnings,
      boostedCats: boostedCats.slice(0, 3),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Mid-Draft Punt Suggestion Tool.
 * Strictly stays INACTIVE while userRoster.length === 0 ("doesnt activate until after your first pick").
 * Once >= 1 pick is drafted, stays active through mid-draft, ranking 1-cat, 2-cat,
 * and select 3-cat punt builds by drafted-core Z lift + remaining draft pool synergy.
 */
export function computeMidDraftPuntSuggestions({
  userRoster,
  undraftedPlayers,
  currentPunts,
  currentPick = 1,
  numTeams = 12,
  leagueAvgFgPct = 0.47,
  leagueAvgFtPct = 0.78,
}) {
  if (!userRoster || userRoster.length === 0) {
    return {
      activated: false,
      suggestions: [],
      teamProfile: computeTeamCategoryProfile([], leagueAvgFgPct, leagueAvgFtPct),
      isBalancedCore: false,
    };
  }

  const n = userRoster.length;
  const teamProfile = computeTeamCategoryProfile(userRoster, leagueAvgFgPct, leagueAvgFtPct);
  const catKeys = CATEGORIES.map(c => c.key);

  // Effective per-pick category strength (nudging % cats gently by roster volume diff if meaningful)
  const effectiveAvgZ = {};
  for (const k of catKeys) {
    let val = teamProfile.cats[k]?.avgZ ?? 0;
    if (k === 'FG%' && teamProfile.fgPct !== null) {
      val = val * 0.75 + (teamProfile.fgDiff / 0.025) * 0.25;
    } else if (k === 'FT%' && teamProfile.ftPct !== null) {
      val = val * 0.75 + (teamProfile.ftDiff / 0.035) * 0.25;
    }
    effectiveAvgZ[k] = val;
  }

  const baseTeamAvg = catKeys.reduce((s, k) => s + effectiveAvgZ[k], 0) / catKeys.length;
  const sortedCatsByWeakness = [...catKeys].sort((a, b) => effectiveAvgZ[a] - effectiveAvgZ[b]);

  // Weak candidate pool: categories dragging below +0.10 (or clearly dragging behind team strengths)
  const weakKeys = sortedCatsByWeakness.filter(k => effectiveAvgZ[k] < 0.10);
  const isBalancedCore = weakKeys.length === 0 || effectiveAvgZ[sortedCatsByWeakness[0]] > -0.12;

  if (weakKeys.length === 0) {
    return {
      activated: true,
      suggestions: [],
      teamProfile,
      isBalancedCore: true,
    };
  }

  // Enumerate realistic 1-cat, 2-cat, and 3-cat punt sets from lagging categories (keep >= 6 active cats)
  const candidateSets = [];
  for (let i = 0; i < weakKeys.length; i++) {
    candidateSets.push([weakKeys[i]]);
    for (let j = i + 1; j < weakKeys.length; j++) {
      // Only pair a 2nd category if it is actually weak (<= 0.0)
      if (effectiveAvgZ[weakKeys[j]] <= 0.0) {
        candidateSets.push([weakKeys[i], weakKeys[j]]);
        if (n >= 2) {
          for (let m = j + 1; m < weakKeys.length; m++) {
            if (effectiveAvgZ[weakKeys[m]] <= -0.15) {
              candidateSets.push([weakKeys[i], weakKeys[j], weakKeys[m]]);
            }
          }
        }
      }
    }
  }

  // Upcoming draft window to evaluate remaining pool synergy
  const maxRankReach = Math.max(45, currentPick + Math.max(24, numTeams * 2.5));
  const poolWindow = (undraftedPlayers || []).filter(p => (p.baseRank ?? 999) <= maxRankReach);

  const scoredBuilds = candidateSets.map(puntArr => {
    const puntSet = new Set(puntArr);
    const activeKeys = catKeys.filter(k => !puntSet.has(k));
    const activeTeamAvg = activeKeys.reduce((s, k) => s + effectiveAvgZ[k], 0) / activeKeys.length;
    const coreLift = activeTeamAvg - baseTeamAvg;

    // Count upcoming targets who jump substantially under this punt
    const unlockedTargets = [];
    let poolBoostSum = 0;
    for (const p of poolWindow) {
      const baseAvg = (p.baseZSum ?? 0) / 9;
      let pActiveSum = 0;
      for (const k of activeKeys) pActiveSum += p.zScores?.[k] ?? 0;
      const pActiveAvg = pActiveSum / activeKeys.length;
      const avgGain = pActiveAvg - baseAvg;
      if (avgGain >= 0.14 && pActiveAvg > -0.15) {
        poolBoostSum += Math.min(0.45, avgGain);
        unlockedTargets.push({
          name: p.name,
          positions: p.positions,
          baseRank: p.baseRank,
          puntAvgZ: pActiveAvg,
          avgGain,
        });
      }
    }
    unlockedTargets.sort((a, b) => (b.avgGain + b.puntAvgZ * 0.4) - (a.avgGain + a.puntAvgZ * 0.4));

    const complexityPenalty = puntArr.length === 1 ? 0 : puntArr.length === 2 ? 0.09 : 0.28;
    const synergyBonus = Math.min(0.25, poolBoostSum * 0.05);
    const totalScore = coreLift + synergyBonus - complexityPenalty;

    const isSameAsCurrent =
      currentPunts &&
      currentPunts.size === puntSet.size &&
      puntArr.every(k => currentPunts.has(k));

    return {
      id: puntArr.join('+'),
      cats: puntArr,
      label: `Punt ${puntArr.join(' + ')}`,
      coreLift,
      totalScore,
      weakSummary: puntArr.map(k => `${k} ${effectiveAvgZ[k].toFixed(2)}σ`).join(' · '),
      topTargets: unlockedTargets.slice(0, 3),
      isCurrentlyApplied: Boolean(isSameAsCurrent),
    };
  });

  scoredBuilds.sort((a, b) => b.totalScore - a.totalScore);

  // Keep diverse top 3 builds (ensure best 1-cat conservative option appears alongside top 2-cat/3-cat builds)
  const finalSuggestions = [];
  for (const build of scoredBuilds) {
    if (build.coreLift <= 0.02) continue;
    const redundant = finalSuggestions.some(existing => {
      if (build.cats.length > existing.cats.length && existing.cats.every(c => build.cats.includes(c))) {
        return build.totalScore <= existing.totalScore + 0.06;
      }
      return false;
    });
    if (!redundant) {
      finalSuggestions.push(build);
    }
    if (finalSuggestions.length >= 3) break;
  }

  // Guarantee best 1-cat punt option is surfaced if the top 3 were all multi-cat combos
  if (finalSuggestions.length === 3 && !finalSuggestions.some(b => b.cats.length === 1)) {
    const bestSingle = scoredBuilds.find(b => b.cats.length === 1 && b.coreLift >= 0.12);
    if (bestSingle) {
      finalSuggestions[2] = bestSingle;
    }
  }

  return {
    activated: true,
    suggestions: finalSuggestions,
    teamProfile,
    isBalancedCore: isBalancedCore && finalSuggestions.length === 0,
  };
}

/**
 * Fast O(N log N) Punt Riser finder: returns undrafted players gaining the most
 * rank and per-category value under the current punt strategy within draftable range.
 */
export function computePuntSleepers(undraftedPlayers, puntedCats, totalDraftSlots = 156, limit = 5) {
  if (!puntedCats || puntedCats.size === 0 || !undraftedPlayers || undraftedPlayers.length === 0) {
    return [];
  }

  const maxRankCutoff = Math.max(150, totalDraftSlots + 20);
  return undraftedPlayers
    .filter(p => p.overallRank <= maxRankCutoff && p.rankDelta >= 5)
    .map(p => ({
      player: p,
      baselineRank: p.baseRank,
      puntRank: p.overallRank,
      rankGain: p.rankDelta,
      valGain: p.avgZ - (p.baseZSum / 9),
    }))
    .filter(item => item.valGain > 0.08)
    .sort((a, b) => {
      if (b.rankGain !== a.rankGain) return b.rankGain - a.rankGain;
      return b.valGain - a.valGain;
    })
    .slice(0, limit);
}

/**
 * Picks a realistic CPU selection during optional Mock Auto-Pick / Sim-to-My-Turn.
 */
export function pickBestCpuCandidate(undraftedPlayers, cpuRoster, rosterSlots, poolMaxProjGp = 0) {
  if (!undraftedPlayers || undraftedPlayers.length === 0) return null;
  const baseFit = assignRosterSlots(cpuRoster, rosterSlots);
  const inStarterPhase = (cpuRoster?.length || 0) < baseFit.totalStarterCount;

  // Use 9-cat baseZSum + basic positional fit + mild availability check
  const slice = undraftedPlayers.slice(0, Math.min(25, undraftedPlayers.length));
  let best = slice[0];
  let bestScore = -9999;

  for (const p of slice) {
    let score = p.baseZSum ?? p.activeZSum ?? 0;
    if (inStarterPhase && cpuRoster.length >= 2) {
      const testFit = assignRosterSlots([...cpuRoster, p], rosterSlots);
      if (testFit.filledStarterCount <= baseFit.filledStarterCount) {
        score -= 0.9;
      } else {
        const pPrimary = parsePositions(p.positions).filter(pos => PRIMARY_POSITIONS.includes(pos));
        if (pPrimary.some(pos => (baseFit.openStarterCounts[pos] || 0) > 0)) {
          score += 0.25;
        }
      }
    }
    const statusTag = String(p.status || '').toUpperCase().trim();
    if (INJURY_OUT_TAGS.has(statusTag)) score -= 0.7;
    if (poolMaxProjGp >= 25 && p.projGp !== null && p.projGp / poolMaxProjGp < 0.7) score -= 0.4;

    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best;
}
