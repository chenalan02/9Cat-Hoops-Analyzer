import time
from concurrent.futures import ThreadPoolExecutor

from backend.core.logging import logger
from backend.utils import clean_player_name


def _to_plain_data(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    # yfpy models implement __iter__ over field values, so Pydantic would flatten them into lists unless serialized explicitly.
    serialized = getattr(value, "serialized", None)
    if callable(serialized):
        return _to_plain_data(serialized())
    if isinstance(value, dict):
        return {k: _to_plain_data(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_plain_data(item) for item in value]
    return value


def _extract_team_id_from_team_obj(team_obj):
    if team_obj is None:
        return None
    team_id = getattr(team_obj, "team_id", None)
    if team_id is not None:
        try:
            return int(team_id)
        except (ValueError, TypeError):
            pass
    if isinstance(team_obj, dict):
        if team_obj.get("team_id") is not None:
            try:
                return int(team_obj["team_id"])
            except (ValueError, TypeError):
                pass
        if "team" in team_obj:
            return _extract_team_id_from_team_obj(team_obj["team"])
    team_key = getattr(team_obj, "team_key", None) or (team_obj.get("team_key") if isinstance(team_obj, dict) else None)
    if team_key:
        parts = str(team_key).split(".t.")
        if len(parts) > 1 and parts[-1].isdigit():
            return int(parts[-1])
    return None


def _extract_teams_from_matchup(matchup):
    teams = getattr(matchup, "teams", None)
    if teams is None and isinstance(matchup, dict):
        teams = matchup.get("teams")
    if isinstance(teams, list) and len(teams) >= 2:
        t1 = _extract_team_id_from_team_obj(teams[0])
        t2 = _extract_team_id_from_team_obj(teams[1])
        if t1 and t2:
            return t1, t2
    return None, None


class FantasyLeague:
    def __init__(self, yahoo_query, player_stats):
        league_info = yahoo_query.get_league_info()
        time.sleep(0.05)
        self.current_week = league_info.current_week
        self.league_id = league_info.league_id
        self.name = league_info.name
        self.season = league_info.season
        self.scoring_type = league_info.scoring_type
        self.roster_positions = league_info.settings.roster_positions
        self.stat_categories = league_info.settings.stat_categories

        # Cache league_key on yahoo_query so downstream team calls skip extra metadata requests.
        league_key = getattr(league_info, "league_key", None)
        if league_key:
            yahoo_query.league_key = league_key
            yahoo_query._cached_league_key = league_key

        self.weekly_matchups = {}
        try:
            time.sleep(0.05)
            matchups_data = yahoo_query.get_league_matchups_by_week(int(self.current_week))
            m_list = getattr(matchups_data, "matchups", matchups_data)
            if isinstance(m_list, list):
                for m in m_list:
                    t1, t2 = _extract_teams_from_matchup(m)
                    if t1 and t2:
                        self.weekly_matchups[str(t1)] = t2
                        self.weekly_matchups[str(t2)] = t1
        except Exception as exc:
            logger.warning("Could not fetch weekly matchups for week %s: %s", self.current_week, exc)

        self.teams = []
        try:
            self.num_teams = int(league_info.num_teams)
        except (ValueError, TypeError):
            self.num_teams = 12

        def _fetch_single_team(t_id):
            try:
                return t_id, yahoo_query.get_team_info(t_id)
            except Exception:
                time.sleep(0.4)
                return t_id, yahoo_query.get_team_info(t_id)

        with ThreadPoolExecutor(max_workers=2) as executor:
            fetched_results = list(executor.map(_fetch_single_team, range(1, self.num_teams + 1)))

        fetched_results.sort(key=lambda item: item[0])

        for idx, (team_id, team_info) in enumerate(fetched_results):
            fetched_results[idx] = None
            if str(team_id) not in self.weekly_matchups and getattr(team_info, "matchups", None):
                for m in team_info.matchups:
                    m_week = getattr(m, "week", None)
                    if m_week is not None and str(m_week) == str(self.current_week):
                        t1, t2 = _extract_teams_from_matchup(m)
                        if t1 and t2:
                            self.weekly_matchups[str(t1)] = t2
                            self.weekly_matchups[str(t2)] = t1
                            break

            if str(team_id) not in self.weekly_matchups:
                try:
                    time.sleep(0.05)
                    for m in (yahoo_query.get_team_matchups(team_id) or []):
                        m_week = getattr(m, "week", None)
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

        for team in self.teams:
            if not team.current_opponent_id:
                team.current_opponent_id = self.weekly_matchups.get(str(team.team_id))

        logger.debug("Weekly matchups mapped for week %s: %s", self.current_week, self.weekly_matchups)

    def to_dict(self):
        return {
            "league_id": _to_plain_data(self.league_id),
            "name": _to_plain_data(self.name),
            "season": _to_plain_data(self.season),
            "scoring_type": _to_plain_data(self.scoring_type),
            "teams": [team.to_dict() for team in self.teams],
            "roster_positions": _to_plain_data(self.roster_positions),
            "stat_categories": _to_plain_data(self.stat_categories),
            "week_num": _to_plain_data(self.current_week),
            "weekly_matchups": _to_plain_data(self.weekly_matchups),
        }


class Team:
    def __init__(self, team_info, player_stats, current_opponent_id=None):
        self.team_id = team_info.team_id
        self.name = team_info.name
        self.logo_url = team_info.team_logos[0].url if team_info.team_logos else None
        self.scoring_type = team_info.league_scoring_type
        self.rank = team_info.team_standings.rank if getattr(team_info, "team_standings", None) else None
        self.record = team_info.team_standings.outcome_totals if getattr(team_info, "team_standings", None) else None
        self.current_opponent_id = current_opponent_id

        stats_map = player_stats or {}
        self.players = [Player(player, stats_map) for player in team_info.roster.players]

    def to_dict(self):
        return {
            "team_id": _to_plain_data(self.team_id),
            "name": _to_plain_data(self.name),
            "logo_url": _to_plain_data(self.logo_url),
            "scoring_type": _to_plain_data(self.scoring_type),
            "rank": _to_plain_data(self.rank),
            "record": _to_plain_data(self.record),
            "current_opponent_id": _to_plain_data(self.current_opponent_id),
            "players": [player.to_dict() for player in self.players],
        }


class Player:
    def __init__(self, player, player_stats):
        self.name = clean_player_name(player.name.full)
        self.photo_url = player.image_url
        self.status = player.status
        self.positions = player.display_position
        self.selected_position = player.selected_position.position
        self.nba_team = player.editorial_team_abbr
        self.ema_stats = Stats((player_stats.get("ema") or {}).get(self.name, {}))
        self.ros_stats = Stats((player_stats.get("ros_rankings") or {}).get(self.name, {}))
        self.weekly_stats = Stats((player_stats.get("weekly_rankings") or {}).get(self.name, {}))
        self.preseason_stats = Stats((player_stats.get("preseason_rankings") or {}).get(self.name, {}))

        raw_z = (
            getattr(self.ema_stats, "z_total", None)
            if getattr(self.ema_stats, "z_total", None) is not None
            else getattr(self.ros_stats, "z_total", None)
            if getattr(self.ros_stats, "z_total", None) is not None
            else getattr(self.weekly_stats, "z_total", None)
            if getattr(self.weekly_stats, "z_total", None) is not None
            else getattr(self.preseason_stats, "z_total", None)
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
            "preseason_stats": self.preseason_stats.to_dict(),
        }


class Stats:
    def __init__(self, stats_dict):
        for key, value in stats_dict.items():
            setattr(self, key, value)

    def to_dict(self):
        return dict(self.__dict__)
