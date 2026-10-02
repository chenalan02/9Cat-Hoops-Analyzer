import { useState, useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import { CATEGORIES, zScoreClass, zScoreBgClass } from '../utils/zScore.js';
import { formatZ } from '../utils/formatters.js';
import './StreamerPage.css';

// Sample schedule generator for demonstration / free agent streaming
const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const OFF_DAYS = ['Tue', 'Thu', 'Sun']; // Days with typically fewer NBA games scheduled

export default function StreamerPage() {
  const { leagueData, myTeam, loading } = useContext(TeamDataContext);
  const navigate = useNavigate();

  const [selectedCats, setSelectedCats] = useState(new Set(['STL', '3PM']));
  const [selectedDay, setSelectedDay] = useState('ALL');
  const [minGames, setMinGames] = useState(3);
  const [searchQuery, setSearchQuery] = useState('');

  // Extract all available players from league teams or free agent pool
  const allFreeAgents = useMemo(() => {
    if (!leagueData?.teams) return [];
    
    // Flatten players from league teams (or simulate waiver pool)
    const seen = new Set();
    const list = [];
    
    for (const team of leagueData.teams) {
      for (const player of team.players) {
        if (!seen.has(player.name)) {
          seen.add(player.name);
          
          // Generate realistic weekly schedule metadata for demo/analysis
          const hash = player.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
          const numGames = (hash % 2) === 0 ? 4 : 3;
          const gameDays = numGames === 4 
            ? ['Mon', 'Wed', 'Fri', 'Sun'] 
            : ['Tue', 'Thu', 'Sat'];
          
          const offDayCount = gameDays.filter(d => OFF_DAYS.includes(d)).length;
          
          list.push({
            ...player,
            numGames,
            gameDays,
            offDayCount,
            ownerTeam: team.name
          });
        }
      }
    }
    return list;
  }, [leagueData]);

  // Toggle category selection
  const toggleCategory = (key) => {
    setSelectedCats(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Rank streamers based on target category Z-scores & schedule density
  const rankedStreamers = useMemo(() => {
    if (!allFreeAgents.length) return [];

    const activeCatList = CATEGORIES.filter(c => selectedCats.has(c.key));

    const scored = allFreeAgents.map(player => {
      const stats = player.ema_stats || {};
      
      // Calculate average Z-score for selected target categories
      let catScoreSum = 0;
      activeCatList.forEach(cat => {
        const muKey = cat.muKey;
        const val = stats[muKey] ?? 0;
        let z = val > 0 ? (val - 2.5) / 2.0 : -0.5;
        if (cat.lowerBetter) z = -z;
        catScoreSum += z;
      });

      const avgTargetZ = activeCatList.length ? catScoreSum / activeCatList.length : 0;
      
      // Schedule boost: +0.4 for 4-game week, +0.3 per off-day game
      const scheduleScore = (player.numGames * 0.25) + (player.offDayCount * 0.3);
      
      const totalStreamerScore = avgTargetZ + scheduleScore;

      return {
        ...player,
        avgTargetZ,
        totalStreamerScore
      };
    });

    // Apply filters
    return scored
      .filter(p => {
        if (p.numGames < minGames) return false;
        if (selectedDay !== 'ALL' && !p.gameDays.includes(selectedDay)) return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          return p.name.toLowerCase().includes(q) || (p.positions && p.positions.toLowerCase().includes(q));
        }
        return true;
      })
      .sort((a, b) => b.totalStreamerScore - a.totalStreamerScore);
  }, [allFreeAgents, selectedCats, selectedDay, minGames, searchQuery]);

  if (loading) {
    return (
      <div className="page-wrapper center-content">
        <div className="spinner" style={{ width: 36, height: 36 }} />
        <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>Loading streamer recommendations…</p>
      </div>
    );
  }

  return (
    <div className="streamer-page page-wrapper fade-up">
      <div className="section">
        {/* Header */}
        <div className="streamer-header">
          <div>
            <h1 className="streamer-title">🔥 Streamer & Waiver Recommendations</h1>
            <p className="streamer-subtitle">
              Find high-impact waiver targets optimized for off-day games and target category boosts.
            </p>
          </div>
          <button className="btn-secondary" onClick={() => navigate('/matchup')}>
            📊 Matchup Projection
          </button>
        </div>

        {/* Filters Panel */}
        <div className="streamer-controls-card card">
          <div className="control-group">
            <label className="control-label">1. Select Target Need Categories</label>
            <div className="cat-chip-grid">
              {CATEGORIES.map(cat => {
                const isSelected = selectedCats.has(cat.key);
                return (
                  <button
                    key={cat.key}
                    className={`cat-chip ${isSelected ? 'active' : ''}`}
                    onClick={() => toggleCategory(cat.key)}
                  >
                    {cat.label} ({cat.key})
                  </button>
                );
              })}
            </div>
          </div>

          <div className="control-row mt-4">
            <div className="control-subgroup">
              <label className="control-label">2. Target Day</label>
              <div className="day-chip-grid">
                <button
                  className={`day-chip ${selectedDay === 'ALL' ? 'active' : ''}`}
                  onClick={() => setSelectedDay('ALL')}
                >
                  All Week
                </button>
                {DAYS_OF_WEEK.map(day => (
                  <button
                    key={day}
                    className={`day-chip ${selectedDay === day ? 'active' : ''} ${OFF_DAYS.includes(day) ? 'off-day-chip' : ''}`}
                    onClick={() => setSelectedDay(day)}
                  >
                    {day} {OFF_DAYS.includes(day) ? '★' : ''}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-subgroup">
              <label className="control-label">3. Min Games in Week</label>
              <div className="games-btn-group">
                {[2, 3, 4].map(g => (
                  <button
                    key={g}
                    className={`game-btn ${minGames === g ? 'active' : ''}`}
                    onClick={() => setMinGames(g)}
                  >
                    {g}+ Games
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="control-row mt-3">
            <input
              type="text"
              className="streamer-search-input"
              placeholder="🔍 Search player by name or position (PG, SG, C...)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Results Streamer Cards Grid */}
        <div className="streamer-results-header mt-4">
          <h3>Top Recommended Streamers ({rankedStreamers.length} Available)</h3>
          <span className="text-secondary text-sm">Sorted by Schedule Density + Target Category Impact</span>
        </div>

        <div className="streamer-grid mt-3">
          {rankedStreamers.slice(0, 12).map((player, idx) => (
            <div key={player.name} className="streamer-card card">
              <div className="streamer-card-header">
                <div>
                  <span className="rank-badge">#{idx + 1}</span>
                  <h4 className="player-name-text">{player.name}</h4>
                  <span className="player-sub-text">{player.positions || 'Util'} · {player.ownerTeam || 'Free Agent'}</span>
                </div>
                <div className="score-badge">
                  <span className="score-label">Streamer Score</span>
                  <span className="score-val">+{player.totalStreamerScore.toFixed(2)}</span>
                </div>
              </div>

              {/* Schedule Days */}
              <div className="schedule-bar">
                <span className="schedule-title">{player.numGames} Games this week:</span>
                <div className="day-badges">
                  {player.gameDays.map(d => (
                    <span key={d} className={`day-tag ${OFF_DAYS.includes(d) ? 'off-day-tag' : ''}`}>
                      {d} {OFF_DAYS.includes(d) ? '⚡' : ''}
                    </span>
                  ))}
                </div>
              </div>

              {/* Target Categories Impact */}
              <div className="impact-section">
                <span className="impact-title">Target Category Stats (Per Game):</span>
                <div className="impact-grid">
                  {Array.from(selectedCats).map(catKey => {
                    const catObj = CATEGORIES.find(c => c.key === catKey);
                    const val = player.ema_stats?.[catObj?.muKey] ?? null;
                    return (
                      <div key={catKey} className="impact-chip">
                        <span className="cat-name">{catKey}</span>
                        <span className="cat-val">{val !== null ? Number(val).toFixed(1) : '-'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}

          {rankedStreamers.length === 0 && (
            <div className="empty-streamer-box card">
              <p>No streamer candidates match the selected filters.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
