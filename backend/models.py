import numpy as np
import pandas as pd
import time
from backend.utils import *

class FantasyLeague():
    def __init__(self, yahoo_query, player_stats_ema):
        league_info = yahoo_query.get_league_info()
        time.sleep(0.5)  # to avoid hitting Yahoo API rate limits
        self.league_id = league_info.league_id
        self.name = league_info.name
        self.season = league_info.season
        self.scoring_type = league_info.scoring_type
        self.teams = []
        self.num_teams = yahoo_query.get_league_info().num_teams
        for team_id in range(1, self.num_teams + 1):
            team_info = yahoo_query.get_team_info(team_id)
            self.teams.append(Team(team_info, player_stats_ema))
            time.sleep(0.5)

    def to_dict(self):
        return {
            "league_id": self.league_id,
            "name": self.name,
            "season": self.season,
            "scoring_type": self.scoring_type,
            "teams": [team.to_dict() for team in self.teams]
        }


class Team():
    def __init__(self, team_info, player_stats_ema):
        self.team_id = team_info.team_id
        self.name = team_info.name
        self.logo_url = team_info.team_logos[0].url if team_info.team_logos else None
        self.scoring_type = team_info.league_scoring_type
        self.rank = team_info.team_standings.rank
        self.record = team_info.team_standings.outcome_totals

        self.players = []
        for player in team_info.roster.players:
            self.players.append(Player(player, player_stats_ema))

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
    def __init__(self, player, player_stats_ema):
        self.name = clean_player_name(player.name.full)
        self.photo_url = player.image_url
        self.positions = player.display_position
        self.selected_position = player.selected_position.position
        self.nba_team = player.editorial_team_abbr
        self.ema_stats = Stats(player_stats_ema.get(self.name, {}))

    def to_dict(self):
        return {
            "name": self.name,
            "photo_url": self.photo_url,
            "positions": self.positions,
            "selected_position": self.selected_position,
            "nba_team": self.nba_team,
            "ema_stats": self.ema_stats.to_dict()
        }
        

class Stats():
    def __init__(self, stats_dict):
        for key in EMA_STATS:
            setattr(self, key, stats_dict.get(key, None))

    def to_dict(self):
        return {key: getattr(self, key) for key in EMA_STATS}
