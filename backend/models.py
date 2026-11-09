import time
from backend.utils import *

def _extract_team_id_from_team_obj(t):
    if t is None:
        return None
    team_id = getattr(t, 'team_id', None)
    if team_id is not None:
        try:
            return int(team_id)
        except (ValueError, TypeError):
            pass
    if isinstance(t, dict):
        if 'team_id' in t and t['team_id'] is not None:
            try:
                return int(t['team_id'])
            except (ValueError, TypeError):
                pass
        if 'team' in t:
            return _extract_team_id_from_team_obj(t['team'])
    team_key = getattr(t, 'team_key', None) or (t.get('team_key') if isinstance(t, dict) else None)
    if team_key:
        parts = str(team_key).split('.t.')
        if len(parts) > 1 and parts[-1].isdigit():
            return int(parts[-1])
    return None

def _extract_teams_from_matchup(m):
    teams = getattr(m, 'teams', None)
    if teams is None and isinstance(m, dict):
        teams = m.get('teams')
    if isinstance(teams, list) and len(teams) >= 2:
        t1 = _extract_team_id_from_team_obj(teams[0])
        t2 = _extract_team_id_from_team_obj(teams[1])
        if t1 and t2:
            return t1, t2
    return None, None

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

        # Fetch current week matchups to automatically map opponents
        self.weekly_matchups = {}
        # Method 1: get_league_matchups_by_week
        try:
            time.sleep(0.05)
            matchups_data = yahoo_query.get_league_matchups_by_week(int(self.current_week))
            m_list = getattr(matchups_data, 'matchups', matchups_data)
            if isinstance(m_list, list):
                for m in m_list:
                    t1, t2 = _extract_teams_from_matchup(m)
                    if t1 and t2:
                        self.weekly_matchups[str(t1)] = t2
                        self.weekly_matchups[str(t2)] = t1
        except Exception as e:
            print(f"Warning: Could not fetch weekly matchups for week {self.current_week}: {e}")

        self.teams = []
        self.num_teams = yahoo_query.get_league_info().num_teams
        for team_id in range(1, self.num_teams + 1):
            team_info = yahoo_query.get_team_info(team_id)

            # Method 2: Check team_info.matchups if not yet mapped
            if str(team_id) not in self.weekly_matchups and hasattr(team_info, 'matchups') and team_info.matchups:
                for m in team_info.matchups:
                    m_week = getattr(m, 'week', None)
                    if m_week is not None and str(m_week) == str(self.current_week):
                        t1, t2 = _extract_teams_from_matchup(m)
                        if t1 and t2:
                            self.weekly_matchups[str(t1)] = t2
                            self.weekly_matchups[str(t2)] = t1
                            break

            # Method 3: Try get_team_matchups(team_id) if still not mapped
            if str(team_id) not in self.weekly_matchups:
                try:
                    time.sleep(0.05)
                    t_matchups = yahoo_query.get_team_matchups(team_id)
                    for m in (t_matchups or []):
                        m_week = getattr(m, 'week', None)
                        if m_week is not None and str(m_week) == str(self.current_week):
                            t1, t2 = _extract_teams_from_matchup(m)
                            if t1 and t2:
                                self.weekly_matchups[str(t1)] = t2
                                self.weekly_matchups[str(t2)] = t1
                                break
                except Exception:
                    pass

            current_opp_id = self.weekly_matchups.get(str(team_id))
            self.teams.append(Team(team_info, player_stats, current_opponent_id=current_opp_id))
            time.sleep(0.05)

        # Backfill current_opponent_id on any team that had its matchup discovered later
        for team in self.teams:
            if not team.current_opponent_id:
                team.current_opponent_id = self.weekly_matchups.get(str(team.team_id))

        print(f"DEBUG: Weekly matchups mapped for week {self.current_week}: {self.weekly_matchups}")


    def to_dict(self):
        return {
            "league_id": self.league_id,
            "name": self.name,
            "season": self.season,
            "scoring_type": self.scoring_type,
            "teams": [team.to_dict() for team in self.teams],
            "roster_positions": self.roster_positions,
            "stat_categories": self.stat_categories,
            "week_num": self.current_week,
            "weekly_matchups": self.weekly_matchups
        }


class Team():
    def __init__(self, team_info, player_stats, current_opponent_id=None):
        self.team_id = team_info.team_id
        self.name = team_info.name
        self.logo_url = team_info.team_logos[0].url if team_info.team_logos else None
        self.scoring_type = team_info.league_scoring_type
        self.rank = team_info.team_standings.rank if getattr(team_info, 'team_standings', None) else None
        self.record = team_info.team_standings.outcome_totals if getattr(team_info, 'team_standings', None) else None
        self.current_opponent_id = current_opponent_id

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
            "current_opponent_id": self.current_opponent_id,
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

        # Direct z_total (prefers ema, then ros, weekly, preseason)
        raw_z = (
            getattr(self.ema_stats, 'z_total', None)
            if getattr(self.ema_stats, 'z_total', None) is not None
            else getattr(self.ros_stats, 'z_total', None)
            if getattr(self.ros_stats, 'z_total', None) is not None
            else getattr(self.weekly_stats, 'z_total', None)
            if getattr(self.weekly_stats, 'z_total', None) is not None
            else getattr(self.preseason_stats, 'z_total', None)
        )
        self.z_total = round(float(raw_z), 4) if raw_z is not None else None

    def to_dict(self):
        return {
            "name": self.name,
            "photo_url": self.photo_url,
            "status": self.status,
            "positions": self.positions,
            "selected_position": self.selected_position,
            "nba_team": self.nba_team,
            "z_total": self.z_total,
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
