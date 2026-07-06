import { useState, useMemo, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import { CATEGORIES, getPlayerMu, zScoreClass, zScoreBgClass } from '../utils/zScore.js';
import { formatZ, formatMu } from '../utils/formatters.js';
import CategoryToggle from '../components/CategoryToggle.jsx';
import './DraftPage.css';

// Deduplicate players from league teams to build the draft pool
function buildDraftPool(leagueTeams) {
  const seen = new Set();
  const players = [];
  for (const team of leagueTeams) {
    for (const player of team.players) {
      if (!seen.has(player.name)) {
        seen.add(player.name);
        players.push({ ...player, fantasyTeam: team.name });
      }
    }
  }
  return players;
}

// Compute baseline z-scores for all players in the pool
function computeDraftZScores(players) {
  const stats = {};
  for (const cat of CATEGORIES) {
    const vals = players.map(p => getPlayerMu(p, cat)).filter(v => v !== null && !isNaN(v));
    const m    = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    const variance = vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1 || 1);
    stats[cat.key] = { mean: m, std: Math.sqrt(variance) || 1 };
  }

  return players.map(player => {
    const zScores = {};
    for (const cat of CATEGORIES) {
      const mu = getPlayerMu(player, cat);
      if (mu === null) { zScores[cat.key] = null; continue; }
      let z = (mu - stats[cat.key].mean) / stats[cat.key].std;
      if (cat.lowerBetter) z = -z;
      zScores[cat.key] = z;
    }
    return { ...player, zScores };
  });
}

// Roster slot assignment logic
function getRosterSlot(player, slots, currentRoster) {
  const filled = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0, G: 0, F: 0, Util: 0, Bench: 0 };
  currentRoster.forEach(p => {
    if (filled[p.rosterSlot] !== undefined) filled[p.rosterSlot]++;
  });

  const playerPos = (player.positions ?? '').split(',').map(s => s.trim());

  // 1. Try exact slot
  for (const pos of playerPos) {
    if (slots[pos] !== undefined && filled[pos] < slots[pos]) {
      return pos;
    }
  }

  // 2. Try guard/forward group slots
  const isGuard = playerPos.includes('PG') || playerPos.includes('SG');
  const isForward = playerPos.includes('SF') || playerPos.includes('PF');

  if (isGuard && slots['G'] !== undefined && filled['G'] < slots['G']) {
    return 'G';
  }
  if (isForward && slots['F'] !== undefined && filled['F'] < slots['F']) {
    return 'F';
  }

  // 3. Try Util
  if (slots['Util'] !== undefined && filled['Util'] < slots['Util']) {
    return 'Util';
  }

  // 4. Try Bench
  if (slots['Bench'] !== undefined && filled['Bench'] < slots['Bench']) {
    return 'Bench';
  }

  return 'Bench'; // fallback if everything else is full
}

export default function DraftPage() {
  const { leagueData, myTeam, loading, fetchTeam, fantasyLink } = useContext(TeamDataContext);
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);

  // Settings & Setup state
  const [draftStarted, setDraftStarted] = useState(false);
  const [userTeamId, setUserTeamId] = useState(1);
  const [draftType, setDraftType] = useState('snake');
  const [teamNames, setTeamNames] = useState([]);
  const [rosterSlots, setRosterSlots] = useState({
    PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, Util: 2, Bench: 3
  });

  // Draft execution state
  const [currentPick, setCurrentPick] = useState(1);
  const [draftHistory, setDraftHistory] = useState([]); // array of { player, teamId, teamName, pickNumber }
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRosterTeamIdx, setSelectedRosterTeamIdx] = useState(0);

  // Punt & Filter state
  const [puntedCats, setPuntedCats] = useState(new Set());
  const [sortKey, setSortKey] = useState('avgZ');
  const [sortDir, setSortDir] = useState('desc');
  const [posFilter, setPosFilter] = useState('ALL');

  const handleSyncWithYahoo = async () => {
    if (!fantasyLink) return;
    setSyncing(true);
    try {
      const freshLeagueData = await fetchTeam(fantasyLink);
      if (freshLeagueData && freshLeagueData.teams) {
        // Rebuild draft pool synchronously from fresh teams to find full player metadata
        const freshPool = computeDraftZScores(buildDraftPool(freshLeagueData.teams));

        const T = freshLeagueData.teams.length;
        const teamPlayerPools = freshLeagueData.teams.map(t => [...(t.players || [])]);
        
        const newHistory = [];
        let pick = 1;
        let round = 1;
        let hasMorePlayers = true;

        while (hasMorePlayers) {
          hasMorePlayers = false;
          for (let indexInRound = 0; indexInRound < T; indexInRound++) {
            // Determine which team is picking at this round/index
            const teamIndex = (draftType === 'snake' && round % 2 === 0)
              ? (T - 1 - indexInRound)
              : indexInRound;

            const pool = teamPlayerPools[teamIndex];
            if (pool && pool.length > 0) {
              const player = pool.shift();
              // Find player in freshPool to keep full metadata (z-scores)
              const fullPlayer = freshPool.find(p => p.name === player.name) || player;

              newHistory.push({
                player: fullPlayer,
                teamId: teamIndex + 1,
                teamName: freshLeagueData.teams[teamIndex].name,
                pickNumber: pick
              });
              pick++;
              hasMorePlayers = true;
            }
          }
          round++;
        }

        setDraftHistory(newHistory);
        setCurrentPick(pick);
        setDraftStarted(true); // Auto-start draft if they synced
        setTeamNames(freshLeagueData.teams.map(t => t.name));
      }
    } catch (e) {
      console.error('Yahoo sync failed:', e);
      alert('Failed to sync with Yahoo draft. Please try again.');
    } finally {
      setSyncing(false);
    }
  };

  const handleToggle = (key) => {
    setPuntedCats(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Initialize team names from leagueData once loaded
  useEffect(() => {
    if (leagueData?.teams) {
      setTeamNames(leagueData.teams.map(t => t.name));
      const myId = myTeam?.team_id ?? leagueData.teams[0]?.team_id ?? 1;
      setUserTeamId(myId);
    }
  }, [leagueData, myTeam]);

  // Compute player pools
  const allPlayers = useMemo(() => {
    return leagueData?.teams ? computeDraftZScores(buildDraftPool(leagueData.teams)) : [];
  }, [leagueData]);

  // Get active categories based on punt strategy
  const activeCats = useMemo(() => {
    return CATEGORIES.filter(c => !puntedCats.has(c.key));
  }, [puntedCats]);

  // Compute dynamic player scores based on punt strategy
  const rankedPlayers = useMemo(() => {
    return allPlayers.map(p => {
      const activeZs = activeCats.map(c => p.zScores[c.key]).filter(z => z !== null);
      const avgZ = activeZs.length ? activeZs.reduce((a, b) => a + b, 0) / activeZs.length : -999;
      return { ...p, avgZ };
    });
  }, [allPlayers, activeCats]);

  // Separate undrafted players from drafted ones
  const undraftedPlayers = useMemo(() => {
    return rankedPlayers.filter(
      p => !draftHistory.some(h => h.player.name === p.name)
    );
  }, [rankedPlayers, draftHistory]);

  // Roster slot assignment details for all teams
  const teamRosters = useMemo(() => {
    const rosters = teamNames.map((name, idx) => ({
      teamId: idx + 1,
      name,
      players: []
    }));

    draftHistory.forEach(item => {
      const team = rosters[item.teamId - 1];
      if (team) {
        const slot = getRosterSlot(item.player, rosterSlots, team.players);
        team.players.push({ ...item.player, rosterSlot: slot, pickNumber: item.pickNumber });
      }
    });

    return rosters;
  }, [draftHistory, teamNames, rosterSlots]);

  // Current drafting team calculation
  const T = teamNames.length;
  const round = Math.ceil(currentPick / (T || 1));
  const indexInRound = (currentPick - 1) % (T || 1);
  const teamIndex = (draftType === 'snake' && round % 2 === 0) ? (T - 1 - indexInRound) : indexInRound;
  const onClockTeamId = teamIndex + 1;
  const onClockTeamName = teamNames[teamIndex] ?? `Team ${onClockTeamId}`;
  const isUserTurn = onClockTeamId === userTeamId;

  // AI Assistant calculations for USER team
  const userRoster = useMemo(() => {
    return teamRosters.find(r => r.teamId === userTeamId)?.players ?? [];
  }, [teamRosters, userTeamId]);

  // Suggest punts after drafting 1 or 2 players
  const puntSuggestions = useMemo(() => {
    if (userRoster.length < 1 || userRoster.length > 3) return [];
    const suggestions = [];
    CATEGORIES.forEach(cat => {
      const avgZ = userRoster.reduce((sum, p) => sum + (p.zScores[cat.key] ?? 0), 0) / userRoster.length;
      if (avgZ < -0.4) {
        suggestions.push({ cat, avgZ });
      }
    });
    return suggestions.sort((a, b) => a.avgZ - b.avgZ).slice(0, 2);
  }, [userRoster]);

  // Smart pick recommendations for your turn
  const recommendations = useMemo(() => {
    if (!draftStarted || undraftedPlayers.length === 0) return [];

    // Early rounds: recommend best overall z-score players
    if (userRoster.length < 2) {
      return undraftedPlayers
        .slice(0, 3)
        .map(p => ({
          player: p,
          score: p.avgZ,
          reason: `Best overall available player (Round ${round})`
        }));
    }

    // Later rounds: calculate dynamic smart score based on punt strategy, team needs, and scarcity
    const slots = rosterSlots;
    const filled = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0, G: 0, F: 0, Util: 0, Bench: 0 };
    userRoster.forEach(p => {
      if (filled[p.rosterSlot] !== undefined) filled[p.rosterSlot]++;
    });

    const needsC = filled['C'] < slots['C'];
    const needsG = filled['PG'] < slots['PG'] || filled['SG'] < slots['SG'] || filled['G'] < slots['G'];
    const needsF = filled['SF'] < slots['SF'] || filled['PF'] < slots['PF'] || filled['F'] < slots['F'];

    // Check if team needs specific categories (e.g. low team averages in active categories)
    const categoryStats = {};
    activeCats.forEach(cat => {
      categoryStats[cat.key] = userRoster.reduce((s, p) => s + (p.zScores[cat.key] ?? 0), 0) / userRoster.length;
    });

    const needBLK = !puntedCats.has('BLK') && categoryStats['BLK'] < -0.2;
    const needAST = !puntedCats.has('AST') && categoryStats['AST'] < -0.2;
    const needFT = !puntedCats.has('FT%') && categoryStats['FT%'] < -0.2;

    const scoredList = undraftedPlayers.map(p => {
      let score = p.avgZ;
      let reason = 'Fits punt strategy';
      const posList = (p.positions ?? '').split(',').map(s => s.trim());

      // 1. Team Position need bonus
      if (needsC && posList.includes('C')) {
        score += 0.45;
        reason = 'Fills critical Center slot';
      } else if (needsG && (posList.includes('PG') || posList.includes('SG'))) {
        score += 0.25;
        reason = 'Fills Guard position need';
      } else if (needsF && (posList.includes('SF') || posList.includes('PF'))) {
        score += 0.25;
        reason = 'Fills Forward position need';
      }

      // 2. Scarcity bonuses
      const isGuard = posList.includes('PG') || posList.includes('SG');
      const isCenter = posList.includes('C');

      if (needBLK && isGuard && p.zScores?.['BLK'] > 0.5) {
        score += 0.4;
        reason = 'Rare blocking Guard';
      }
      if (needAST && isCenter && p.zScores?.['AST'] > 0.5) {
        score += 0.4;
        reason = 'Rare passing Center';
      }
      if (needFT && isCenter && p.zScores?.['FT%'] > 0.5) {
        score += 0.3;
        reason = 'High efficiency FT% Center';
      }

      return { player: p, score, reason };
    });

    return scoredList.sort((a, b) => b.score - a.score).slice(0, 3);
  }, [undraftedPlayers, userRoster, rosterSlots, activeCats, puntedCats, draftStarted, round]);

  // Punt Sleeper Picks (players whose value increases most under punt strategy)
  const puntSleepers = useMemo(() => {
    if (puntedCats.size === 0 || undraftedPlayers.length === 0) return [];

    // Calculate baseline z-scores (all categories active)
    const scoredSleepers = undraftedPlayers
      .map(p => {
        const allZs = CATEGORIES.map(c => p.zScores[c.key]).filter(z => z !== null);
        const baselineAvg = allZs.length ? allZs.reduce((a, b) => a + b, 0) / allZs.length : 0;
        const improvement = p.avgZ - baselineAvg;

        // Find baseline rank in original allPlayers pool
        const baselineRank = [...allPlayers]
          .sort((a, b) => {
            const sumA = CATEGORIES.map(c => a.zScores[c.key]).filter(z => z !== null).reduce((x, y) => x + y, 0);
            const sumB = CATEGORIES.map(c => b.zScores[c.key]).filter(z => z !== null).reduce((x, y) => x + y, 0);
            return sumB - sumA;
          })
          .findIndex(x => x.name === p.name) + 1;

        // Find active punt rank in original pool
        const puntRank = [...allPlayers]
          .sort((a, b) => {
            const sumA = activeCats.map(c => a.zScores[c.key]).filter(z => z !== null).reduce((x, y) => x + y, 0);
            const sumB = activeCats.map(c => b.zScores[c.key]).filter(z => z !== null).reduce((x, y) => x + y, 0);
            return sumB - sumA;
          })
          .findIndex(x => x.name === p.name) + 1;

        return {
          player: p,
          improvement,
          baselineRank,
          puntRank
        };
      })
      // Focus on draftable players (top 150 baseline rank) who actually improve
      .filter(item => item.improvement > 0.05 && item.baselineRank <= 150)
      .sort((a, b) => b.improvement - a.improvement)
      .slice(0, 4);

    return scoredSleepers;
  }, [undraftedPlayers, allPlayers, puntedCats, activeCats]);

  // Roster slot count utility
  const getRosterRequirementText = (slots) => {
    return Object.entries(slots)
      .filter(([_, count]) => count > 0)
      .map(([pos, count]) => `${count} ${pos}`)
      .join(', ');
  };

  // Setup Form Handlers
  const handleStartDraft = () => {
    setDraftStarted(true);
    setCurrentPick(1);
    setDraftHistory([]);
  };

  const handleTeamNameChange = (idx, value) => {
    setTeamNames(prev => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  const handleRosterSlotChange = (slot, value) => {
    const val = parseInt(value) || 0;
    setRosterSlots(prev => ({
      ...prev,
      [slot]: val
    }));
  };

  // Draft Execution Handlers
  const handleDraftPlayer = (player) => {
    setDraftHistory(prev => [
      ...prev,
      {
        player,
        teamId: onClockTeamId,
        teamName: onClockTeamName,
        pickNumber: currentPick
      }
    ]);
    setCurrentPick(prev => prev + 1);
  };

  const handleUndoPick = () => {
    if (draftHistory.length === 0) return;
    setDraftHistory(prev => prev.slice(0, -1));
    setCurrentPick(prev => prev - 1);
  };

  const handleResetDraft = () => {
    if (window.confirm('Are you sure you want to reset the draft? All drafted players will be lost.')) {
      setDraftStarted(false);
      setDraftHistory([]);
      setCurrentPick(1);
    }
  };

  // Ranks Sorting & Filtering
  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="sort-icon">⇅</span>;
    return <span className="sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const POS_FILTER_LIST = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'];

  const filteredList = useMemo(() => {
    return undraftedPlayers.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesPos = posFilter === 'ALL' || (p.positions ?? '').includes(posFilter);
      return matchesSearch && matchesPos;
    });
  }, [undraftedPlayers, searchQuery, posFilter]);

  const sortedList = useMemo(() => {
    return [...filteredList].sort((a, b) => {
      let av, bv;
      if (sortKey === 'name') { av = a.name; bv = b.name; }
      else if (sortKey === 'avgZ') { av = a.avgZ; bv = b.avgZ; }
      else {
        av = a.zScores[sortKey] ?? -999;
        bv = b.zScores[sortKey] ?? -999;
      }
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [filteredList, sortKey, sortDir]);

  if (loading) {
    return (
      <div className="page-wrapper center-content">
        <div className="spinner" style={{ width: 36, height: 36 }} />
      </div>
    );
  }

  if (!leagueData) {
    return (
      <div className="page-wrapper center-content">
        <div className="empty-state">
          <div style={{ fontSize: '4rem' }}>📋</div>
          <h2 style={{ marginBottom: '0.5rem' }}>No League Data</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Analyze your team first to configure draft rankings.
          </p>
          <button className="btn-primary" onClick={() => navigate('/')}>Analyze My Team</button>
        </div>
      </div>
    );
  }

  // RENDER: Setup / Configuration screen
  if (!draftStarted) {
    return (
      <div className="draft-setup-page page-wrapper fade-up">
        <div className="section">
          <h1 className="section-title">🛠️ Draft Settings</h1>
          <p className="section-subtitle">Configure your league structure, draft order, and roster slots before starting</p>

          <div className="setup-container">
            {/* Left: General Settings */}
            <div className="setup-card card">
              <h3>General Settings</h3>
              <div className="form-group">
                <label>Your Team:</label>
                <select
                  value={userTeamId}
                  onChange={(e) => setUserTeamId(parseInt(e.target.value))}
                  className="setup-select"
                >
                  {leagueData.teams.map((t, idx) => (
                    <option key={t.team_id} value={idx + 1}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Draft Type:</label>
                <select
                  value={draftType}
                  onChange={(e) => setDraftType(e.target.value)}
                  className="setup-select"
                >
                  <option value="snake">Snake Draft (Typical)</option>
                  <option value="linear">Linear Draft</option>
                </select>
              </div>

              <div className="form-group">
                <label>Roster Slot Requirements:</label>
                <div className="roster-slots-grid">
                  {Object.keys(rosterSlots).map(slot => (
                    <div key={slot} className="roster-slot-input">
                      <span>{slot}</span>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={rosterSlots[slot]}
                        onChange={(e) => handleRosterSlotChange(slot, e.target.value)}
                        aria-label={`${slot} slot count`}
                      />
                    </div>
                  ))}
                </div>
                <p className="roster-hint">
                  Current Settings: {getRosterRequirementText(rosterSlots)} (IL slots are ignored in drafts).
                </p>
              </div>
            </div>

            {/* Right: Draft Order */}
            <div className="setup-card card">
              <h3>Draft Order / Team Names</h3>
              <p className="roster-hint">Enter the draft order from Pick 1 to Pick {teamNames.length || 10}</p>
              <div className="team-names-list">
                {teamNames.map((name, idx) => (
                  <div key={idx} className="team-name-row">
                    <span className="team-order-badge">#{idx + 1}</span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => handleTeamNameChange(idx, e.target.value)}
                      placeholder={`Team ${idx + 1}`}
                      aria-label={`Team ${idx + 1} name`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '2.5rem' }}>
            <button className="btn-primary start-draft-btn" onClick={handleStartDraft}>
              🚀 Start Draft (Manual)
            </button>
            {fantasyLink && (
              <button 
                className="btn-secondary" 
                onClick={handleSyncWithYahoo} 
                disabled={syncing}
                style={{ padding: '12px 28px' }}
              >
                {syncing ? <><span className="spinner" /> Syncing…</> : '🔄 Sync Rosters from Yahoo'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // RENDER: Active Draft Assistant and Dashboard
  return (
    <div className="draft-page page-wrapper fade-up">
      <div className="section">
        {/* Header Bar */}
        <div className="draft-header-bar">
          <div>
            <h1 className="section-title" style={{ textAlign: 'left', margin: 0 }}>Draft Assistant</h1>
            <p className="section-subtitle" style={{ textAlign: 'left', margin: 0 }}>
              Live draft tracker & Z-score analyzer
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {fantasyLink && (
              <button 
                className="btn-primary" 
                onClick={handleSyncWithYahoo} 
                disabled={syncing}
              >
                {syncing ? <><span className="spinner" /> Syncing…</> : '🔄 Sync with Yahoo Draft'}
              </button>
            )}
            <button className="btn-secondary reset-draft-btn" onClick={handleResetDraft}>
              🔄 Reset Draft
            </button>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="draft-dashboard-grid">
          
          {/* Left Column: Draft Status & Smart Assistant */}
          <div className="draft-sidebar">
            
            {/* Widget 1: Pick Status */}
            <div className="sidebar-card card status-card">
              <div className="status-label">Overall Pick {currentPick}</div>
              <div className="status-round">Round {round}, Pick {indexInRound + 1}</div>
              
              <div className={`clock-alert ${isUserTurn ? 'user-turn' : ''}`}>
                <div className="clock-sub">On the Clock:</div>
                <div className="clock-team">{onClockTeamName}</div>
                {isUserTurn && <span className="your-turn-badge">Your Turn!</span>}
              </div>

              <button
                className="btn-secondary undo-pick-btn"
                onClick={handleUndoPick}
                disabled={draftHistory.length === 0}
                style={{ width: '100%', marginTop: '1rem' }}
              >
                ↩️ Undo Last Pick
              </button>
            </div>

            {/* Widget 2: AI Recommendations */}
            <div className="sidebar-card card assistant-card">
              <h4>💡 Smart Recommendations</h4>
              
              {/* Punt Warnings / Suggestions */}
              {puntSuggestions.length > 0 && (
                <div className="punt-warning-box">
                  <div className="box-title">Punt Suggestion:</div>
                  {puntSuggestions.map(({ cat, avgZ }) => (
                    <div key={cat.key} className="punt-suggestion-item">
                      <span>Punt <strong>{cat.key}</strong></span>
                      <span className="avg-z-indicator z-bad">({avgZ.toFixed(2)} avg)</span>
                    </div>
                  ))}
                  <p className="punt-box-desc">Your early picks are weak in these categories. Toggle them off above to optimize value.</p>
                </div>
              )}

              {/* Recommended Picks */}
              <div className="recommendations-list">
                {recommendations.length > 0 ? (
                  recommendations.map(({ player, score, reason }) => (
                    <div key={player.name} className="rec-item">
                      <div className="rec-top">
                        <span className="rec-name" onClick={() => setSearchQuery(player.name)}>
                          {player.name}
                        </span>
                        <button
                          className="btn-primary rec-draft-btn"
                          onClick={() => handleDraftPlayer(player)}
                          title={`Draft ${player.name} to ${onClockTeamName}`}
                        >
                          Draft
                        </button>
                      </div>
                      <div className="rec-bottom">
                        <span className="rec-pos">{player.positions}</span>
                        <span className="rec-badge">{reason}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="no-data-text">Drafting completed or player pool empty.</p>
                )}
              </div>
            </div>

            {/* Widget 3: Punt Sleepers */}
            {puntedCats.size > 0 && (
              <div className="sidebar-card card sleepers-card">
                <h4>🚀 Punt Sleepers</h4>
                <p className="roster-hint" style={{ marginBottom: '0.75rem' }}>Players gaining the most value under active punts</p>
                <div className="sleepers-list">
                  {puntSleepers.length > 0 ? (
                    puntSleepers.map(({ player, baselineRank, puntRank }) => (
                      <div key={player.name} className="sleeper-row">
                        <span className="sl-name" onClick={() => setSearchQuery(player.name)}>
                          {player.name}
                        </span>
                        <span className="sl-change">
                          #{baselineRank} ➔ <strong className="z-good">#{puntRank}</strong>
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="no-data-text">No sleepers found. Try adjusting punts.</p>
                  )}
                </div>
              </div>
            )}

            {/* Widget 4: Team Roster Viewer */}
            <div className="sidebar-card card rosters-card">
              <div className="roster-view-header">
                <h4>📋 Team Rosters</h4>
                <select
                  value={selectedRosterTeamIdx}
                  onChange={(e) => setSelectedRosterTeamIdx(parseInt(e.target.value))}
                  className="roster-team-select"
                >
                  {teamNames.map((name, idx) => (
                    <option key={idx} value={idx}>
                      {name} {idx + 1 === userTeamId ? '(You)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="roster-slots-display">
                {Object.entries(rosterSlots).map(([slotName, count]) => {
                  const slotsArr = [];
                  for (let i = 0; i < count; i++) {
                    slotsArr.push(slotName);
                  }
                  return slotsArr.map((slot, sIdx) => {
                    const teamRosterPlayers = teamRosters[selectedRosterTeamIdx]?.players ?? [];
                    const draftedPlayer = teamRosterPlayers.find(
                      p => p.rosterSlot === slot &&
                      teamRosterPlayers.filter(x => x.rosterSlot === slot).indexOf(p) === sIdx
                    );
                    return (
                      <div key={`${slot}-${sIdx}`} className="roster-slot-row">
                        <span className="r-slot-label">{slot}</span>
                        <span className={`r-slot-value ${draftedPlayer ? 'filled' : 'empty'}`}>
                          {draftedPlayer ? (
                            <>
                              {draftedPlayer.name}
                              <span className="pick-indicator">#{draftedPlayer.pickNumber}</span>
                            </>
                          ) : '— Empty —'}
                        </span>
                      </div>
                    );
                  });
                })}
              </div>
            </div>

          </div>

          {/* Right Column: Interactive Draft Board */}
          <div className="draft-main-board card">
            
            {/* Top Toolbar */}
            <div className="board-toolbar">
              <div className="search-box-wrapper">
                <input
                  type="text"
                  placeholder="🔍 Search players by name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="board-search-input"
                  aria-label="Search players by name"
                />
                {searchQuery && (
                  <button className="clear-search-btn" onClick={() => setSearchQuery('')}>✕</button>
                )}
              </div>

              {/* Position Filters */}
              <div className="pos-filter-bar" style={{ marginBottom: 0 }}>
                {POS_FILTER_LIST.map(pos => (
                  <button
                    key={pos}
                    className={`btn-ghost ${posFilter === pos ? 'active' : ''}`}
                    onClick={() => setPosFilter(pos)}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            {/* Category Punts */}
            <CategoryToggle puntedCats={puntedCats} onToggle={handleToggle} label="Punt Strategy" />

            {/* Players Table */}
            <div className="data-table-wrapper" style={{ marginTop: '1rem' }}>
              <table className="data-table draft-table" aria-label="Available player rankings">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'center', width: 50 }}>Rank</th>
                    <th
                      className={sortKey === 'name' ? 'sort-active' : ''}
                      onClick={() => handleSort('name')}
                      style={{ textAlign: 'left' }}
                    >
                      Player <SortIcon col="name" />
                    </th>
                    <th>Pos</th>
                    <th>Team</th>
                    {CATEGORIES.map(cat => (
                      <th
                        key={cat.key}
                        className={`${sortKey === cat.key ? 'sort-active' : ''} ${puntedCats.has(cat.key) ? 'punted-col' : ''}`}
                        onClick={() => handleSort(cat.key)}
                        title={cat.label}
                      >
                        {cat.key} <SortIcon col={cat.key} />
                      </th>
                    ))}
                    <th
                      className={sortKey === 'avgZ' ? 'sort-active' : ''}
                      onClick={() => handleSort('avgZ')}
                    >
                      Avg Z <SortIcon col="avgZ" />
                    </th>
                    <th style={{ textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedList.length > 0 ? (
                    sortedList.map((player, idx) => (
                      <tr key={player.name}>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text-muted)' }}>{idx + 1}</td>
                        <td>
                          <div className="player-cell">
                            <span className="player-name">{player.name}</span>
                          </div>
                        </td>
                        <td><span className="pos-badge">{player.positions?.split(',')[0]}</span></td>
                        <td className="team-abbr">{player.nba_team}</td>
                        {CATEGORIES.map(cat => {
                          const z      = player.zScores[cat.key];
                          const rawVal = getPlayerMu(player, cat);
                          const punted = puntedCats.has(cat.key);
                          return (
                            <td
                              key={cat.key}
                              className={`${zScoreBgClass(z)} ${punted ? 'punted-col' : ''}`}
                              title={`Z-Score: ${formatZ(z)}`}
                            >
                              <span className={zScoreClass(z)}>{formatMu(rawVal, cat.key)}</span>
                            </td>
                          );
                        })}
                        <td style={{ fontWeight: 800 }}>
                          <span className={player.avgZ >= 0 ? 'z-good' : 'z-poor'}>
                            {player.avgZ !== -999 ? formatZ(player.avgZ) : '—'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn-primary draft-action-btn"
                            onClick={() => handleDraftPlayer(player)}
                          >
                            Draft
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={CATEGORIES.length + 6} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                        No available players match your search or position filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
