// 9-Category Z-Score Calculation Engine for Chrome Extension
(function(global) {
  const CATEGORIES = [
    { key: 'PTS',  label: 'Points',          muKey: 'mu_pts',  lowerBetter: false },
    { key: 'REB',  label: 'Rebounds',         muKey: 'mu_reb',  lowerBetter: false },
    { key: 'AST',  label: 'Assists',          muKey: 'mu_ast',  lowerBetter: false },
    { key: 'STL',  label: 'Steals',           muKey: 'mu_stl',  lowerBetter: false },
    { key: 'BLK',  label: 'Blocks',           muKey: 'mu_blk',  lowerBetter: false },
    { key: '3PM',  label: '3-Pointers Made',  muKey: 'mu_fg3m', lowerBetter: false },
    { key: 'FG%',  label: 'Field Goal %',     derived: 'fg',    lowerBetter: false },
    { key: 'FT%',  label: 'Free Throw %',     derived: 'ft',    lowerBetter: false },
    { key: 'TO',   label: 'Turnovers',        muKey: 'mu_tov',  lowerBetter: true }
  ];

  function getPlayerMu(player, cat) {
    const s = player.ema_stats;
    if (!s) return null;
    if (cat.derived === 'fg') {
      return (s.mu_fga && s.mu_fga > 0) ? s.mu_fgm / s.mu_fga : null;
    }
    if (cat.derived === 'ft') {
      return (s.mu_fta && s.mu_fta > 0) ? s.mu_ftm / s.mu_fta : null;
    }
    return s[cat.muKey] ?? null;
  }

  function mean(arr) {
    if (!arr || !arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function std(arr) {
    if (!arr || arr.length < 2) return 1;
    const m = mean(arr);
    const variance = arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(variance) || 1;
  }

  function computeDraftZScores(players, puntedCats = new Set()) {
    if (!players || !players.length) return [];

    const stats = {};
    for (const cat of CATEGORIES) {
      const vals = players
        .map(p => getPlayerMu(p, cat))
        .filter(v => v !== null && !isNaN(v));
      stats[cat.key] = {
        mean: mean(vals),
        std: std(vals)
      };
    }

    const activeCats = CATEGORIES.filter(c => !puntedCats.has(c.key));

    const scored = players.map(player => {
      const zScores = {};
      let activeSum = 0;
      let activeCount = 0;

      for (const cat of CATEGORIES) {
        const mu = getPlayerMu(player, cat);
        if (mu === null) {
          zScores[cat.key] = null;
          continue;
        }
        let z = (mu - stats[cat.key].mean) / stats[cat.key].std;
        if (cat.lowerBetter) z = -z;
        zScores[cat.key] = z;

        if (!puntedCats.has(cat.key)) {
          activeSum += z;
          activeCount++;
        }
      }

      const avgZ = activeCount > 0 ? activeSum / activeCount : -999;
      return {
        ...player,
        zScores,
        avgZ
      };
    });

    const sorted = [...scored].sort((a, b) => b.avgZ - a.avgZ);
    return scored.map(player => {
      const rank = sorted.findIndex(p => p.name === player.name) + 1;
      return { ...player, overallRank: rank };
    });
  }

  function zScoreBadgeClass(z) {
    if (z === null || isNaN(z)) return 'z-badge-avg';
    if (z > 1.5) return 'z-badge-elite';
    if (z > 0.5) return 'z-badge-good';
    if (z > -0.5) return 'z-badge-avg';
    if (z > -1.5) return 'z-badge-poor';
    return 'z-badge-bad';
  }

  const Engine = {
    CATEGORIES,
    getPlayerMu,
    computeDraftZScores,
    zScoreBadgeClass
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Engine;
  } else {
    global.ZScoreEngine = Engine;
  }
})(typeof self !== 'undefined' ? self : this);
