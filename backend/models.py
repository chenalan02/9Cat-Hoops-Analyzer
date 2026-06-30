import time
from backend.utils import *

class FantasyLeague():
    def __init__(self, yahoo_query, player_stats):
        league_info = yahoo_query.get_league_info()
        time.sleep(0.05)  # to avoid hitting Yahoo API rate limits
        self.current_week = league_info.current_week
        self.league_id = league_info.league_id
        self.name = league_info.name
        self.season = league_info.season
        self.scoring_type = league_info.scoring_type
        self.roster_positions = league_info.settings.roster_positions
        self.stat_categories = league_info.settings.stat_categories
        self.teams = []
        self.num_teams = yahoo_query.get_league_info().num_teams
        for team_id in range(1, self.num_teams + 1):
            team_info = yahoo_query.get_team_info(team_id)
            self.teams.append(Team(team_info, player_stats))
            time.sleep(0.05)


    def to_dict(self):
        return {
            "league_id": self.league_id,
            "name": self.name,
            "season": self.season,
            "scoring_type": self.scoring_type,
            "teams": [team.to_dict() for team in self.teams],
            "roster_positions": self.roster_positions,
            "stat_categories": self.stat_categories
        }


class Team():
    def __init__(self, team_info, player_stats):
        self.team_id = team_info.team_id
        self.name = team_info.name
        self.logo_url = team_info.team_logos[0].url if team_info.team_logos else None
        self.scoring_type = team_info.league_scoring_type
        self.rank = team_info.team_standings.rank
        self.record = team_info.team_standings.outcome_totals

        self.players = []
        for player in team_info.roster.players:
            self.players.append(Player(player, player_stats))

    def to_dict(self):
        return {
            "team_id": self.team_id,
            "name": self.name,
            "logo_url": self.logo_url,
            "scoring_type": self.scoring_type,
            "rank": self.rank,
            "record": self.record,
            "players": [player.to_dict() for player in self.players]
        }


class Player():
    def __init__(self, player, player_stats):
        self.name = clean_player_name(player.name.full)
        self.photo_url = player.image_url
        self.status = player.status
        self.positions = player.display_position # eligible positions
        self.selected_position = player.selected_position.position
        self.nba_team = player.editorial_team_abbr
        self.ema_stats = Stats(player_stats["ema"].get(self.name, {}))
        self.ros_stats = Stats(player_stats["ros_rankings"].get(self.name, {}))
        self.weekly_stats = Stats(player_stats["weekly_rankings"].get(self.name, {}))
        self.preseason_stats = Stats(player_stats["preseason_rankings"].get(self.name, {}))

    def to_dict(self):
        return {
            "name": self.name,
            "photo_url": self.photo_url,
            "status": self.status,
            "positions": self.positions,
            "selected_position": self.selected_position,
            "nba_team": self.nba_team,
            "ema_stats": self.ema_stats.to_dict(),
            "ros_stats": self.ros_stats.to_dict(),
            "weekly_stats": self.weekly_stats.to_dict(),
            "preseason_stats": self.preseason_stats.to_dict()
        }


class Stats():
    def __init__(self, stats_dict):
        for key in stats_dict.keys():
            setattr(self, key, stats_dict.get(key, None))

    def to_dict(self):
        return {key: getattr(self, key) for key in self.__dict__.keys()}
