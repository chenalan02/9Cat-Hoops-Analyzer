import { CATEGORIES } from './zScore.js';
import {
  readSessionJson,
  writeSessionJson,
} from '../services/storageCache.js';

export const BACKEND_TO_FRONTEND = {
  pts:  'PTS',
  reb:  'REB',
  ast:  'AST',
  stl:  'STL',
  blk:  'BLK',
  tov:  'TO',
  fg3m: '3PM',
  'fg%': 'FG%',
  'ft%': 'FT%',
};

export const FRONTEND_TO_BACKEND = Object.fromEntries(
  Object.entries(BACKEND_TO_FRONTEND).map(([b, f]) => [f, b])
);

export const MATCHUP_CACHE_STORAGE_KEY = '9cat_matchup_analysis_cache';
export const MC_CACHE_STORAGE_KEY = '9cat_matchup_mc_cache';
export const MATCHUP_OPP_STORAGE_KEY = '9cat_matchup_selected_opp';
export const MATCHUP_WEEK_STORAGE_KEY = '9cat_matchup_selected_week';
export const MATCHUP_TAB_STORAGE_KEY = '9cat_matchup_active_tab';
export const MATCHUP_HAS_RUN_KEY = '9cat_matchup_has_run';

const memoryStores = {
  [MATCHUP_CACHE_STORAGE_KEY]: {},
  [MC_CACHE_STORAGE_KEY]: {},
};

export function getMatchupCache(storageKey, entryKey) {
  if (!entryKey) return null;
  const mem = memoryStores[storageKey];
  if (mem?.[entryKey]) return mem[entryKey];
  const stored = readSessionJson(storageKey);
  if (stored && stored[entryKey]) {
    if (mem) mem[entryKey] = stored[entryKey];
    return stored[entryKey];
  }
  return null;
}

export function setMatchupCache(storageKey, entryKey, data) {
  if (!entryKey || !data) return;
  const mem = memoryStores[storageKey];
  if (mem) mem[entryKey] = data;
  const stored = readSessionJson(storageKey, {}) || {};
  stored[entryKey] = data;
  const keys = Object.keys(stored);
  if (keys.length > 25) delete stored[keys[0]];
  writeSessionJson(storageKey, stored);
}

// Delta-method variance approximation for FG%/FT% ratios:
// Var(X/Y) ~= (mu_x^2 / mu_y^4) * Var(y) + (1 / mu_y^2) * Var(x)
function derivedRatioDist(teamDist, madeKey, attKey) {
  const made = teamDist?.[madeKey];
  const att = teamDist?.[attKey];
  if (!(att?.mu > 0)) return { mu: 0, sigma: 0 };
  const mu = (made?.mu ?? 0) / att.mu;
  const variance = ((made?.mu ?? 0) ** 2 / att.mu ** 4) * (att.var ?? 0)
    + (1 / att.mu ** 2) * (made?.var ?? 0);
  return { mu, sigma: Math.sqrt(Math.max(variance, 0)) };
}

export function parseAnalysisResult(result) {
  const { win_probs, agg_dists } = result;
  if (!win_probs || !agg_dists) return [];

  return CATEGORIES.map(cat => {
    const bKey = FRONTEND_TO_BACKEND[cat.key];
    const winProb = win_probs[bKey] ?? 0;

    if (cat.derived === 'fg' || cat.derived === 'ft') {
      const mKey = cat.derived === 'fg' ? 'fgm' : 'ftm';
      const aKey = cat.derived === 'fg' ? 'fga' : 'fta';
      const t1 = derivedRatioDist(agg_dists.team1, mKey, aKey);
      const t2 = derivedRatioDist(agg_dists.team2, mKey, aKey);
      return { cat, myMu: t1.mu, mySigma: t1.sigma, oppMu: t2.mu, oppSigma: t2.sigma, winProb };
    }

    const t1Dist = agg_dists.team1?.[bKey];
    const t2Dist = agg_dists.team2?.[bKey];
    return {
      cat,
      myMu: t1Dist?.mu ?? 0,
      mySigma: Math.sqrt(Math.max(t1Dist?.var ?? 0, 0)),
      oppMu: t2Dist?.mu ?? 0,
      oppSigma: Math.sqrt(Math.max(t2Dist?.var ?? 0, 0)),
      winProb,
    };
  });
}

export function parseMonteCarloResult(mcResult) {
  if (!mcResult?.win_pcts) return null;
  const ratioAvg = (side, mKey, aKey) =>
    mcResult.sim_avg?.[side]?.[aKey] > 0
      ? mcResult.sim_avg[side][mKey] / mcResult.sim_avg[side][aKey]
      : 0;

  return CATEGORIES.map(cat => {
    const bKey = FRONTEND_TO_BACKEND[cat.key];
    const winProb = mcResult.win_pcts[bKey] ?? 0;
    const myMu = cat.derived === 'fg'
      ? ratioAvg('team1', 'fgm', 'fga')
      : cat.derived === 'ft'
      ? ratioAvg('team1', 'ftm', 'fta')
      : mcResult.sim_avg?.team1?.[bKey] ?? 0;
    const oppMu = cat.derived === 'fg'
      ? ratioAvg('team2', 'fgm', 'fga')
      : cat.derived === 'ft'
      ? ratioAvg('team2', 'ftm', 'fta')
      : mcResult.sim_avg?.team2?.[bKey] ?? 0;

    return { cat, winProb, winPct: winProb, myMu, myAvg: myMu, oppMu, oppAvg: oppMu };
  });
}

// Poisson-Binomial DP for P(wins >= ceil((N + 1) / 2)), where 5+ wins win a 9-cat week.
export function computeMatchupWinStats(oddsList) {
  if (!oddsList || oddsList.length === 0) {
    return {
      matchupWinProb: 0,
      expectedWins: 0,
      projectedMyScore: '0.0',
      projectedOppScore: '0.0',
      favoredCatsCount: 0,
      tossupCatsCount: 0,
    };
  }

  let dp = [1.0];
  let expectedWins = 0;
  let favoredCount = 0;
  let tossupCount = 0;

  for (const o of oddsList) {
    const p = Math.max(0, Math.min(1, o.winProb));
    expectedWins += p;
    if (p >= 0.55) favoredCount++;
    else if (p >= 0.45) tossupCount++;

    const nextDp = new Array(dp.length + 1).fill(0);
    for (let k = 0; k < dp.length; k++) {
      nextDp[k] += dp[k] * (1 - p);
      nextDp[k + 1] += dp[k] * p;
    }
    dp = nextDp;
  }

  const winThreshold = Math.ceil((oddsList.length + 1) / 2);
  let winProb = 0;
  for (let k = winThreshold; k < dp.length; k++) {
    winProb += dp[k] || 0;
  }

  return {
    matchupWinProb: winProb,
    expectedWins,
    projectedMyScore: expectedWins.toFixed(1),
    projectedOppScore: (oddsList.length - expectedWins).toFixed(1),
    favoredCatsCount: favoredCount,
    tossupCatsCount: tossupCount,
  };
}

export function formatCatMargin(cat, myMu, oppMu) {
  if (cat.derived) {
    const diff = (myMu - oppMu) * 100;
    return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
  }
  if (cat.key === 'TO') {
    const diff = Math.abs(myMu - oppMu);
    if (myMu === oppMu) return '0.0 TO';
    return myMu < oppMu ? `-${diff.toFixed(1)} TO` : `+${diff.toFixed(1)} TO`;
  }
  const diff = myMu - oppMu;
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} ${cat.key}`;
}

export function getCategoryMagnitude(catKey, isPct, t1Val, t2Val, leader) {
  const n1 = typeof t1Val === 'number' ? t1Val : parseFloat(t1Val) || 0;
  const n2 = typeof t2Val === 'number' ? t2Val : parseFloat(t2Val) || 0;

  if (leader === 'tie' || n1 === n2) {
    return {
      text: 'Tied',
      subText: 'Even (0)',
      pillClass: 'live-margin-tied',
      intensity: 'neutral',
      diffStr: '0',
    };
  }

  const isWinning = leader === 'team1';
  const pillClass = isWinning ? 'live-margin-winning' : 'live-margin-trailing';

  if (isPct) {
    const diffPct = Math.abs(n1 - n2) * 100;
    const diffStr = `${diffPct.toFixed(1)}%`;
    const text = isWinning ? `+${diffStr}` : `-${diffStr}`;
    const intensity = diffPct >= 3.0 ? 'decisive' : diffPct <= 1.0 ? 'close' : 'solid';
    const subText = intensity === 'decisive' ? '★ Commanding' : intensity === 'close' ? '⚡ Tight Battle' : 'Solid Margin';
    return { text, subText, pillClass, intensity, diffStr, isWinning };
  }

  if (catKey === 'tov') {
    const diff = Math.round(Math.abs(n1 - n2));
    const text = isWinning ? `-${diff} TO` : `+${diff} TO`;
    const intensity = diff >= 8 ? 'decisive' : diff <= 2 ? 'close' : 'solid';
    const subText = intensity === 'decisive' ? '★ Commanding' : intensity === 'close' ? '⚡ Tight Battle' : 'Solid Margin';
    return { text, subText, pillClass, intensity, diffStr: `${diff} TO`, isWinning };
  }

  const diff = Math.round(Math.abs(n1 - n2));
  const catUnit = catKey.toUpperCase();
  const text = isWinning ? `+${diff} ${catUnit}` : `-${diff} ${catUnit}`;
  let thresh = 6;
  if (catKey === 'pts') thresh = 30;
  else if (catKey === 'reb' || catKey === 'ast') thresh = 12;
  else if (catKey === '3pm' || catKey === 'fg3m') thresh = 6;
  else if (catKey === 'stl' || catKey === 'blk') thresh = 4;

  const intensity = diff >= thresh ? 'decisive' : diff <= Math.max(1, Math.floor(thresh / 4)) ? 'close' : 'solid';
  const subText = intensity === 'decisive' ? '★ Commanding' : intensity === 'close' ? '⚡ Tight Battle' : 'Solid Margin';
  return { text, subText, pillClass, intensity, diffStr: `${diff} ${catUnit}`, isWinning };
}
