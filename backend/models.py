import time
from concurrent.futures import ThreadPoolExecutor

from backend.core.logging import logger
from backend.services.yahoo_client import extract_player_from_yahoo_entry, resolve_league_key
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


def _to_int(value, default=None):
    if value is None or value == "":
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


def _to_float(value, default=0.0):
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def _merge_dict_entries(entries):
    merged = {}
    if isinstance(entries, dict):
        return dict(entries)
    if isinstance(entries, list):
        for item in entries:
            if isinstance(item, dict):
                merged.update(item)
            elif isinstance(item, list):
                merged.update(_merge_dict_entries(item))
    return merged


def _numbered_items(container):
    if not isinstance(container, dict):
        return []
    numbered = []
    for key, val in container.items():
        if key == "count":
            continue
        idx = _to_int(key, default=10**9)
        numbered.append((idx, val))
    numbered.sort(key=lambda pair: pair[0])
    return [val for _, val in numbered]


def _extract_selected_position(selected_pos_raw):
    if isinstance(selected_pos_raw, str):
        return selected_pos_raw
    if isinstance(selected_pos_raw, dict):
        return selected_pos_raw.get("position")
    if isinstance(selected_pos_raw, list):
        for item in selected_pos_raw:
            if isinstance(item, dict) and item.get("position"):
                return item["position"]
    return None


def _extract_team_id_from_team_obj(team_obj):
    if team_obj is None:
        return None
    team_id = getattr(team_obj, "team_id", None)
    if team_id is not None:
        parsed = _to_int(team_id)
        if parsed is not None:
            return parsed
    if isinstance(team_obj, list):
        merged = _merge_dict_entries(team_obj)
        return _extract_team_id_from_team_obj(merged)
    if isinstance(team_obj, dict):
        if team_obj.get("team_id") is not None:
            parsed = _to_int(team_obj["team_id"])
            if parsed is not None:
                return parsed
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
        if teams is None and isinstance(matchup.get("0"), dict):
            teams = matchup["0"].get("teams")
    if isinstance(teams, dict):
        team_entries = [entry.get("team") if isinstance(entry, dict) else entry for entry in _numbered_items(teams)]
    elif isinstance(teams, list):
        team_entries = teams
    else:
        team_entries = []
    if len(team_entries) >= 2:
        t1 = _extract_team_id_from_team_obj(team_entries[0])
        t2 = _extract_team_id_from_team_obj(team_entries[1])
        if t1 and t2:
            return t1, t2
    return None, None


def _normalize_record(outcome_totals):
    if not isinstance(outcome_totals, dict):
        return outcome_totals
    return {
        "wins": _to_int(outcome_totals.get("wins"), default=0),
        "losses": _to_int(outcome_totals.get("losses"), default=0),
        "ties": _to_int(outcome_totals.get("ties"), default=0),
        "percentage": _to_float(outcome_totals.get("percentage"), default=0.0),
    }


def _find_subresource_dict(parts, key):
    for item in parts:
        if isinstance(item, dict) and key in item:
            return item[key]
    return None


class FantasyLeague:
    def __init__(self, yahoo_query, player_stats):
        if self._init_from_batch_api(yahoo_query, player_stats):
            return
        self._init_from_yfpy(yahoo_query, player_stats)

    def _init_from_batch_api(self, yahoo_query, player_stats) -> bool:
        try:
            league_key = resolve_league_key(yahoo_query)
            meta_url = f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key};out=settings,scoreboard"
            teams_url = f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/teams;out=standings,roster"

            with ThreadPoolExecutor(max_workers=2) as executor:
                f_meta = executor.submit(lambda: yahoo_query.get_response(meta_url).json())
                f_teams = executor.submit(lambda: yahoo_query.get_response(teams_url).json())
                meta_payload = f_meta.result()
                teams_payload = f_teams.result()

            league_parts = meta_payload["fantasy_content"]["league"]
            league_meta = league_parts[0] if isinstance(league_parts, list) and league_parts else {}
            settings_raw = _find_subresource_dict(league_parts, "settings")
            settings_data = settings_raw[0] if isinstance(settings_raw, list) and settings_raw else (settings_raw or {})
            scoreboard_data = _find_subresource_dict(league_parts, "scoreboard") or {}

            teams_league_parts = teams_payload["fantasy_content"]["league"]
            teams_container = _find_subresource_dict(teams_league_parts, "teams")
            if not isinstance(teams_container, dict):
                return False

            self.current_week = _to_int(league_meta.get("current_week"), default=1)
            self.league_id = str(league_meta.get("league_id") or yahoo_query.league_id)
            self.name = league_meta.get("name")
            self.season = _to_int(league_meta.get("season"), default=league_meta.get("season"))
            self.scoring_type = league_meta.get("scoring_type")

            raw_roster_positions = settings_data.get("roster_positions") or []
            self.roster_positions = [
                item["roster_position"] if isinstance(item, dict) and isinstance(item.get("roster_position"), dict) else item
                for item in raw_roster_positions
            ]
            self.stat_categories = settings_data.get("stat_categories")

            resolved_key = league_meta.get("league_key") or league_key
            if resolved_key:
                yahoo_query.league_key = resolved_key
                yahoo_query._cached_league_key = resolved_key

            self.weekly_matchups = {}
            matchups_container = (
                scoreboard_data.get("0", {}).get("matchups")
                if isinstance(scoreboard_data.get("0"), dict)
                else scoreboard_data.get("matchups")
            )
            for entry in _numbered_items(matchups_container):
                matchup_obj = entry.get("matchup") if isinstance(entry, dict) else entry
                t1, t2 = _extract_teams_from_matchup(matchup_obj)
                if t1 and t2:
                    self.weekly_matchups[str(t1)] = t2
                    self.weekly_matchups[str(t2)] = t1

            parsed_teams = []
            for entry in _numbered_items(teams_container):
                raw_team = entry.get("team") if isinstance(entry, dict) else entry
                if not isinstance(raw_team, list) or not raw_team:
                    continue
                team_meta = _merge_dict_entries(raw_team[0])
                standings = _find_subresource_dict(raw_team[1:], "team_standings") or {}
                roster = _find_subresource_dict(raw_team[1:], "roster") or {}

                team_id = _to_int(team_meta.get("team_id"))
                logos = team_meta.get("team_logos") or []
                logo_url = None
                if isinstance(logos, list) and logos:
                    first_logo = logos[0].get("team_logo") if isinstance(logos[0], dict) and "team_logo" in logos[0] else logos[0]
                    if isinstance(first_logo, dict):
                        logo_url = first_logo.get("url")

                rank = _to_int(standings.get("rank"))
                record = _normalize_record(standings.get("outcome_totals"))

                roster_players_container = (
                    roster.get("0", {}).get("players")
                    if isinstance(roster.get("0"), dict)
                    else roster.get("players")
                )
                players = []
                for p_entry in _numbered_items(roster_players_container):
                    raw_player = p_entry.get("player") if isinstance(p_entry, dict) else p_entry
                    if not raw_player:
                        continue
                    p_meta = _merge_dict_entries(raw_player[0] if isinstance(raw_player, list) else raw_player)
                    extra_meta = _merge_dict_entries(raw_player[1:]) if isinstance(raw_player, list) and len(raw_player) > 1 else {}

                    extracted_name, extracted_status, extracted_positions = extract_player_from_yahoo_entry(raw_player)
                    full_name = extracted_name or (p_meta.get("name") or {}).get("full") or ""
                    photo_url = p_meta.get("image_url") or (p_meta.get("headshot") or {}).get("url")
                    status = str(p_meta.get("status") or extracted_status or "")
                    positions = p_meta.get("display_position") or extracted_positions
                    selected_position = _extract_selected_position(
                        extra_meta.get("selected_position") or p_meta.get("selected_position")
                    )
                    nba_team = p_meta.get("editorial_team_abbr")

                    players.append(
                        Player.from_fields(
                            full_name=full_name,
                            photo_url=photo_url,
                            status=status,
                            positions=positions,
                            selected_position=selected_position,
                            nba_team=nba_team,
                            player_stats=player_stats,
                        )
                    )

                team_obj = Team.from_fields(
                    team_id=team_id,
                    name=team_meta.get("name"),
                    logo_url=logo_url,
                    scoring_type=team_meta.get("league_scoring_type") or self.scoring_type,
                    rank=rank,
                    record=record,
                    current_opponent_id=self.weekly_matchups.get(str(team_id)),
                    players=players,
                )
                parsed_teams.append(team_obj)

            if not parsed_teams:
                return False

            parsed_teams.sort(key=lambda team: _to_int(team.team_id, default=10**9))
            self.teams = parsed_teams
            self.num_teams = len(parsed_teams)
            logger.debug("Batch-synced league %s (%d teams) for week %s", self.league_id, self.num_teams, self.current_week)
            return True
        except Exception as exc:
            logger.warning("Batch Yahoo league sync failed, falling back to yfpy per-team sync: %s", exc)
            return False

    def _init_from_yfpy(self, yahoo_query, player_stats):
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

        with ThreadPoolExecutor(max_workers=4) as executor:
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
        stats_map = player_stats or {}
        players = [Player(player, stats_map) for player in team_info.roster.players]
        self._assign_fields(
            team_id=team_info.team_id,
            name=team_info.name,
            logo_url=team_info.team_logos[0].url if team_info.team_logos else None,
            scoring_type=team_info.league_scoring_type,
            rank=team_info.team_standings.rank if getattr(team_info, "team_standings", None) else None,
            record=team_info.team_standings.outcome_totals if getattr(team_info, "team_standings", None) else None,
            current_opponent_id=current_opponent_id,
            players=players,
        )

    @classmethod
    def from_fields(
        cls,
        *,
        team_id,
        name,
        logo_url,
        scoring_type,
        rank,
        record,
        current_opponent_id,
        players,
    ):
        obj = cls.__new__(cls)
        obj._assign_fields(
            team_id=team_id,
            name=name,
            logo_url=logo_url,
            scoring_type=scoring_type,
            rank=rank,
            record=record,
            current_opponent_id=current_opponent_id,
            players=players,
        )
        return obj

    def _assign_fields(self, *, team_id, name, logo_url, scoring_type, rank, record, current_opponent_id, players):
        self.team_id = team_id
        self.name = name
        self.logo_url = logo_url
        self.scoring_type = scoring_type
        self.rank = rank
        self.record = record
        self.current_opponent_id = current_opponent_id
        self.players = players

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
        self._assign_fields(
            full_name=player.name.full,
            photo_url=player.image_url,
            status=player.status,
            positions=player.display_position,
            selected_position=player.selected_position.position,
            nba_team=player.editorial_team_abbr,
            player_stats=player_stats,
        )

    @classmethod
    def from_fields(
        cls,
        *,
        full_name,
        photo_url,
        status,
        positions,
        selected_position,
        nba_team,
        player_stats,
    ):
        obj = cls.__new__(cls)
        obj._assign_fields(
            full_name=full_name,
            photo_url=photo_url,
            status=status,
            positions=positions,
            selected_position=selected_position,
            nba_team=nba_team,
            player_stats=player_stats,
        )
        return obj

    def _assign_fields(self, *, full_name, photo_url, status, positions, selected_position, nba_team, player_stats):
        stats_map = player_stats or {}
        self.name = clean_player_name(full_name)
        self.photo_url = photo_url
        self.status = status
        self.positions = positions
        self.selected_position = selected_position
        self.nba_team = nba_team
        self.ema_stats = Stats((stats_map.get("ema") or {}).get(self.name, {}))
        self.ros_stats = Stats((stats_map.get("ros_rankings") or {}).get(self.name, {}))
        self.weekly_stats = Stats((stats_map.get("weekly_rankings") or {}).get(self.name, {}))
        self.preseason_stats = Stats((stats_map.get("preseason_rankings") or {}).get(self.name, {}))

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
