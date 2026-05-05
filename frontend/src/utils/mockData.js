// Mock data for development / demo when backend is unavailable.
// Mirrors the structure returned by the /analyze-team endpoint.

const makePlayer = (name, pos, team, stats) => ({
  name,
  positions: pos,
  selected_position: pos.split(',')[0],
  nba_team: team,
  photo_url: null,
  ema_stats: {
    mu_min:  stats.min  ?? 30,
    games_played: stats.gp ?? 65,
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
  teams: [
    MOCK_MY_TEAM,
    makeTeam(2,  'Rim Rockers',       1.05),
    makeTeam(3,  'The Knickstertrons', 0.95),
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
