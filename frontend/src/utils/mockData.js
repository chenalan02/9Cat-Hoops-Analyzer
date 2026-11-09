// Mock data for development / demo when backend is unavailable.
// Mirrors the structure returned by the /analyze-team endpoint.

const makePlayer = (name, pos, team, stats) => ({
  name,
  positions: pos,
  selected_position: pos.split(',')[0],
  nba_team: team,
  photo_url: null,
  z_total: stats.z_total ?? null,
  ema_stats: {
    mu_min:  stats.min  ?? 30,
    games_played: stats.gp ?? 65,
    proj_games_preseason: stats.proj_gp ?? stats.gp ?? 70,
    mu_pts:  stats.pts  ?? 18,  var_pts:  stats.vpts  ?? 16,
    mu_reb:  stats.reb  ?? 5,   var_reb:  stats.vreb  ?? 4,
    mu_ast:  stats.ast  ?? 4,   var_ast:  stats.vast  ?? 3,
    mu_stl:  stats.stl  ?? 1,   var_stl:  stats.vstl  ?? 0.3,
    mu_blk:  stats.blk  ?? 0.5, var_blk:  stats.vblk  ?? 0.3,
    mu_tov:  stats.tov  ?? 2,   var_tov:  stats.vtov  ?? 0.8,
    mu_fg3m: stats.fg3m ?? 1.5, var_fg3m: stats.vfg3m ?? 0.8,
    mu_fgm:  stats.fgm  ?? 7,   var_fgm:  stats.vfgm  ?? 4,
    mu_fga:  stats.fga  ?? 15,  var_fga:  stats.vfga  ?? 9,
    mu_ftm:  stats.ftm  ?? 4,   var_ftm:  stats.vftm  ?? 2,
    mu_fta:  stats.fta  ?? 5,   var_fta:  stats.vfta  ?? 2.5,
  },
});

const MOCK_MY_TEAM = {
  team_id: 3,
  name: "Splash Zone",
  rank: 2,
  record: { wins: 9, losses: 3, ties: 0 },
  current_opponent_id: 4,
  players: [
    makePlayer('Shai Gilgeous-Alexander', 'PG', 'OKC', { pts:32.4,reb:5.5,ast:6.4,stl:2.1,blk:1.1,tov:2.6,fg3m:1.8,fgm:11,fga:20,ftm:8,fta:9.5,gp:72,vpts:28,vast:5,vstl:0.8 }),
    makePlayer('Jayson Tatum',            'SF', 'BOS', { pts:27.4,reb:8.5,ast:4.9,stl:1.1,blk:0.8,tov:2.9,fg3m:3.1,fgm:9,fga:20,ftm:5,fta:6,gp:68 }),
    makePlayer('Domantas Sabonis',        'PF,C','SAC', { pts:19.5,reb:13.5,ast:8.2,stl:1.0,blk:0.5,tov:2.4,fg3m:0.1,fgm:8,fga:13,ftm:3,fta:4.5,gp:70 }),
    makePlayer('De\'Aaron Fox',           'PG', 'SAC', { pts:23.5,reb:4.2,ast:8.1,stl:1.8,blk:0.4,tov:3.2,fg3m:1.4,fgm:9,fga:18,ftm:5,fta:6,gp:70 }),
    makePlayer('Donovan Mitchell',        'SG', 'CLE', { pts:26.1,reb:5.3,ast:5.9,stl:1.4,blk:0.7,tov:2.5,fg3m:2.9,fgm:9.5,fga:20,ftm:5,fta:6.5,gp:64 }),
    makePlayer('Scottie Barnes',          'SF,PF','TOR',{ pts:20.1,reb:8.2,ast:6.1,stl:1.3,blk:1.3,tov:2.2,fg3m:1.0,fgm:8,fga:16,ftm:4,fta:5.5,gp:67 }),
    makePlayer('CJ McCollum',             'SG', 'NOP', { pts:21.2,reb:3.5,ast:4.7,stl:0.9,blk:0.4,tov:1.7,fg3m:3.2,fgm:8,fga:17,ftm:2.5,fta:3,gp:62 }),
    makePlayer('Nikola Vucevic',          'C',  'CHI', { pts:18.1,reb:10.5,ast:3.5,stl:0.8,blk:0.8,tov:1.8,fg3m:1.3,fgm:7,fga:14,ftm:2.5,fta:3,gp:65 }),
    makePlayer('Alperen Sengun',          'C',  'HOU', { pts:21.1,reb:9.4,ast:5.6,stl:1.2,blk:2.1,tov:2.5,fg3m:0.2,fgm:8,fga:14,ftm:5,fta:7,gp:68 }),
    makePlayer('Jordan Poole',            'SG', 'WAS', { pts:17.0,reb:3.0,ast:5.0,stl:0.8,blk:0.3,tov:2.0,fg3m:2.5,fgm:6.5,fga:15,ftm:2,fta:2.5,gp:58 }),
    makePlayer('Tobias Harris',           'PF', 'DET', { pts:14.0,reb:6.5,ast:2.5,stl:0.7,blk:0.5,tov:1.2,fg3m:1.2,fgm:5.5,fga:12,ftm:2,fta:2.5,gp:60 }),
    makePlayer('Isaiah Stewart',          'C',  'DET', { pts:12.5,reb:7.8,ast:2.2,stl:0.6,blk:1.1,tov:1.0,fg3m:1.0,fgm:4.5,fga:10,ftm:2,fta:3,gp:60 }, ),
  ],
};

// Generate mock league of 10 teams
function makeTeam(id, name, scale) {
  return {
    team_id: id,
    name,
    rank: id,
    record: { wins: Math.max(1, 12 - id), losses: id - 1, ties: 0 },
    players: MOCK_MY_TEAM.players.map(p => ({
      ...p,
      ema_stats: Object.fromEntries(
        Object.entries(p.ema_stats).map(([k, v]) => [
          k,
          typeof v === 'number' ? +(v * (0.75 + Math.random() * 0.5 * scale)).toFixed(2) : v,
        ])
      ),
    })),
  };
}

export const MOCK_LEAGUE = {
  league_id: '66811',
  name: 'Fantasy Ballers 2024-25',
  season: 2025,
  scoring_type: 'head',
  week_num: 3,
  weekly_matchups: { "1": 2, "2": 1, "3": 4, "4": 3, "5": 6, "6": 5, "7": 8, "8": 7, "9": 10, "10": 9 },
  teams: [
    makeTeam(1,  'The Knickstertrons', 0.95),
    makeTeam(2,  'Rim Rockers',       1.05),
    MOCK_MY_TEAM,
    makeTeam(4,  'Block Party',        1.0),
    makeTeam(5,  'Alley Oops',         0.9),
    makeTeam(6,  'Triple Doubters',    1.1),
    makeTeam(7,  'Paint Eaters',       0.85),
    makeTeam(8,  'Fast Breakers',      0.92),
    makeTeam(9,  'Swat Squad',         0.88),
    makeTeam(10, 'Brick City',         0.75),
  ],
};

export const MOCK_MY_TEAM_DATA = MOCK_MY_TEAM;

export const MOCK_MATCHUP_ANALYSIS = {
  accumulated_stats: {
    has_live_stats: true,
    team1: { pts: 524, reb: 198, ast: 142, stl: 29, blk: 31, tov: 68, fg3m: 44, fgm: 190, fga: 405, ftm: 100, fta: 128 },
    team2: { pts: 489, reb: 215, ast: 120, stl: 24, blk: 22, tov: 74, fg3m: 38, fgm: 180, fga: 410, ftm: 91,  fta: 115 },
    categories: {
      pts: { team1: 524, team2: 489, leader: 'team1' },
      reb: { team1: 198, team2: 215, leader: 'team2' },
      ast: { team1: 142, team2: 120, leader: 'team1' },
      stl: { team1: 29,  team2: 24,  leader: 'team1' },
      blk: { team1: 31,  team2: 22,  leader: 'team1' },
      tov: { team1: 68,  team2: 74,  leader: 'team1' },
      fg3m:{ team1: 44,  team2: 38,  leader: 'team1' },
      'fg%': { team1: 0.469, team2: 0.439, team1_split: '190/405', team2_split: '180/410', leader: 'team1' },
      'ft%': { team1: 0.781, team2: 0.791, team1_split: '100/128', team2_split: '91/115',  leader: 'team2' }
    },
    live_score: { team1_wins: 7, team2_wins: 2, ties: 0 }
  },
  player_games: {
    team1: {
      'Shai Gilgeous-Alexander': { played: 2, total: 3, remaining: 1, ratio: '2/3', nba_team: 'OKC', positions: 'PG' },
      'Jayson Tatum':            { played: 2, total: 4, remaining: 2, ratio: '2/4', nba_team: 'BOS', positions: 'SF' },
      'Domantas Sabonis':        { played: 3, total: 4, remaining: 1, ratio: '3/4', nba_team: 'SAC', positions: 'PF,C' },
      'De\'Aaron Fox':           { played: 3, total: 4, remaining: 1, ratio: '3/4', nba_team: 'SAC', positions: 'PG' },
      'Donovan Mitchell':        { played: 2, total: 3, remaining: 1, ratio: '2/3', nba_team: 'CLE', positions: 'SG' },
      'Scottie Barnes':          { played: 2, total: 3, remaining: 1, ratio: '2/3', nba_team: 'TOR', positions: 'SF,PF' },
      'CJ McCollum':             { played: 1, total: 3, remaining: 2, ratio: '1/3', nba_team: 'NOP', positions: 'SG' },
      'Nikola Vucevic':          { played: 2, total: 4, remaining: 2, ratio: '2/4', nba_team: 'CHI', positions: 'C' },
      'Alperen Sengun':          { played: 2, total: 3, remaining: 1, ratio: '2/3', nba_team: 'HOU', positions: 'C' },
      'Jordan Poole':            { played: 1, total: 3, remaining: 2, ratio: '1/3', nba_team: 'WAS', positions: 'SG' },
      'Tobias Harris':           { played: 2, total: 3, remaining: 1, ratio: '2/3', nba_team: 'DET', positions: 'PF' },
      'Isaiah Stewart':          { played: 1, total: 3, remaining: 2, ratio: '1/3', nba_team: 'DET', positions: 'C' }
    },
    team2: {
      'Luka Doncic':             { played: 2, total: 4, remaining: 2, ratio: '2/4', nba_team: 'DAL', positions: 'PG' },
      'Kyrie Irving':            { played: 2, total: 4, remaining: 2, ratio: '2/4', nba_team: 'DAL', positions: 'PG,SG' },
      'Anthony Davis':           { played: 2, total: 3, remaining: 1, ratio: '2/3', nba_team: 'LAL', positions: 'PF,C' },
      'LeBron James':            { played: 2, total: 3, remaining: 1, ratio: '2/3', nba_team: 'LAL', positions: 'SF,PF' },
      'Devin Booker':            { played: 2, total: 4, remaining: 2, ratio: '2/4', nba_team: 'PHX', positions: 'SG' },
      'Kevin Durant':            { played: 2, total: 4, remaining: 2, ratio: '2/4', nba_team: 'PHX', positions: 'SF,PF' },
      'Bam Adebayo':             { played: 1, total: 3, remaining: 2, ratio: '1/3', nba_team: 'MIA', positions: 'C' },
      'Jimmy Butler':            { played: 1, total: 3, remaining: 2, ratio: '1/3', nba_team: 'MIA', positions: 'SF' },
      'Tyrese Haliburton':       { played: 2, total: 3, remaining: 1, ratio: '2/3', nba_team: 'IND', positions: 'PG' },
      'Pascal Siakam':           { played: 2, total: 3, remaining: 1, ratio: '2/3', nba_team: 'IND', positions: 'PF' },
      'Myles Turner':            { played: 2, total: 3, remaining: 1, ratio: '2/3', nba_team: 'IND', positions: 'C' },
      'Austin Reaves':           { played: 2, total: 3, remaining: 1, ratio: '2/3', nba_team: 'LAL', positions: 'SG' }
    }
  }
};

export const MOCK_STREAMER_RECOMMENDATIONS = {
  matchup_diagnostics: {
    current_score: { team1_wins: 5, team2_wins: 3, ties: 1 },
    categories: {
      pts:  { status: 'SWING',  p_win: 0.54, margin: 35.0,  target: true },
      reb:  { status: 'SWING',  p_win: 0.42, margin: -17.0, target: true },
      ast:  { status: 'SAFE',   p_win: 0.91, margin: 22.0,  target: false },
      stl:  { status: 'SWING',  p_win: 0.58, margin: 5.0,   target: true },
      blk:  { status: 'SWING',  p_win: 0.48, margin: -1.0,  target: true },
      tov:  { status: 'DOOMED', p_win: 0.12, margin: 18.0,  target: false },
      fg3m: { status: 'SAFE',   p_win: 0.88, margin: 12.0,  target: false },
      'fg%':{ status: 'SWING',  p_win: 0.62, margin: 1.8,   target: true },
      'ft%':{ status: 'SWING',  p_win: 0.45, margin: -1.2,  target: true }
    }
  },
  roster_action: {
    type: 'DROP',
    target_player: 'Isaiah Stewart',
    reason: 'Drop Isaiah Stewart (1 active start remaining this week).'
  },
  recommendations: [
    {
      rank: 1,
      player: {
        name: 'Naz Reid',
        nba_team: 'MIN',
        positions: 'PF,C',
        z_total: 1.45,
        mu_pts: 14.8,
        mu_reb: 6.2,
        mu_ast: 2.1,
        mu_stl: 0.9,
        mu_blk: 1.2,
        mu_fg3m: 2.2
      },
      action: {
        type: 'DROP',
        target_player: 'Isaiah Stewart',
        reason: 'Stewart has 1 start left; Reid gives you 3 active starts on light days.'
      },
      schedule: {
        games_remaining: 3,
        startable_games: 3,
        startable_dates: ['2026-11-10', '2026-11-12', '2026-11-14'],
        clashes: 0
      },
      impact: {
        expected_win_delta: 0.46,
        primary_boost_categories: [
          { cat: 'BLK', before_p: 0.48, after_p: 0.72, delta_p: 0.24, gain: '+3.6 BLK' },
          { cat: 'REB', before_p: 0.42, after_p: 0.59, delta_p: 0.17, gain: '+14.2 REB' },
          { cat: 'PTS', before_p: 0.54, after_p: 0.64, delta_p: 0.10, gain: '+32.4 PTS' }
        ],
        risk_flags: []
      }
    },
    {
      rank: 2,
      player: {
        name: 'Dyson Daniels',
        nba_team: 'ATL',
        positions: 'PG,SG',
        z_total: 1.12,
        mu_pts: 12.4,
        mu_reb: 4.8,
        mu_ast: 3.5,
        mu_stl: 2.4,
        mu_blk: 0.7,
        mu_fg3m: 1.1
      },
      action: {
        type: 'DROP',
        target_player: 'Isaiah Stewart',
        reason: 'Daniels provides elite steals targeting contested Steals and Assists.'
      },
      schedule: {
        games_remaining: 3,
        startable_games: 3,
        startable_dates: ['2026-11-09', '2026-11-11', '2026-11-13'],
        clashes: 0
      },
      impact: {
        expected_win_delta: 0.38,
        primary_boost_categories: [
          { cat: 'STL', before_p: 0.58, after_p: 0.84, delta_p: 0.26, gain: '+6.1 STL' },
          { cat: 'BLK', before_p: 0.48, after_p: 0.58, delta_p: 0.10, gain: '+1.6 BLK' }
        ],
        risk_flags: ['Negative FT% impact (66.7%)']
      }
    },
    {
      rank: 3,
      player: {
        name: 'Nick Richards',
        nba_team: 'CHA',
        positions: 'C',
        z_total: 0.65,
        mu_pts: 10.2,
        mu_reb: 9.8,
        mu_ast: 1.2,
        mu_stl: 0.4,
        mu_blk: 1.8,
        mu_fg3m: 0.0
      },
      action: {
        type: 'DROP',
        target_player: 'Isaiah Stewart',
        reason: 'High-volume center to decisively flip Rebounds and Blocks.'
      },
      schedule: {
        games_remaining: 3,
        startable_games: 2,
        startable_dates: ['2026-11-10', '2026-11-13'],
        clashes: 1
      },
      impact: {
        expected_win_delta: 0.31,
        primary_boost_categories: [
          { cat: 'REB', before_p: 0.42, after_p: 0.63, delta_p: 0.21, gain: '+16.8 REB' },
          { cat: 'BLK', before_p: 0.48, after_p: 0.65, delta_p: 0.17, gain: '+3.2 BLK' },
          { cat: 'FG%', before_p: 0.62, after_p: 0.68, delta_p: 0.06, gain: '+0.8%' }
        ],
        risk_flags: []
      }
    },
    {
      rank: 4,
      player: {
        name: 'Tre Jones',
        nba_team: 'SAS',
        positions: 'PG',
        z_total: 0.52,
        mu_pts: 11.5,
        mu_reb: 3.4,
        mu_ast: 6.8,
        mu_stl: 1.3,
        mu_blk: 0.2,
        mu_fg3m: 0.8
      },
      action: {
        type: 'DROP',
        target_player: 'Isaiah Stewart',
        reason: 'Low turnover playmaker with high assist-to-turnover ratio.'
      },
      schedule: {
        games_remaining: 2,
        startable_games: 2,
        startable_dates: ['2026-11-11', '2026-11-13'],
        clashes: 0
      },
      impact: {
        expected_win_delta: 0.22,
        primary_boost_categories: [
          { cat: 'AST', before_p: 0.91, after_p: 0.97, delta_p: 0.06, gain: '+12.4 AST' },
          { cat: 'STL', before_p: 0.58, after_p: 0.69, delta_p: 0.11, gain: '+2.4 STL' }
        ],
        risk_flags: []
      }
    }
  ]
};
