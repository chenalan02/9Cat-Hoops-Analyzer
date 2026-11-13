import json
import threading
import time
import urllib.parse

from yfpy.query import YahooFantasySportsQuery

from backend.core.config import get_settings
from backend.core.logging import logger
from backend.services.stats_utils import parse_yahoo_stat_value
from backend.utils import clean_player_name

_QUERY_LOCK = threading.Lock()
_QUERY_CACHE: dict[str, YahooFantasySportsQuery] = {}

_LIVE_STATS_CACHE: dict[tuple[str, str, int], tuple[float, dict[str, float], bool]] = {}
_LIVE_STATS_LOCK = threading.Lock()
_LIVE_STATS_TTL_SECS = 60.0

_YAHOO_FA_STATUS_CACHE: dict[str, tuple[float, dict[str, dict[str, str]]]] = {}
_YAHOO_FA_STATUS_LOCK = threading.Lock()
_YAHOO_FA_STATUS_TTL = 300

_FALLBACK_POSITIONS_LOCK = threading.Lock()
_FALLBACK_POSITIONS_CACHE: dict[str, str] | None = None

_YAHOO_STAT_MAP = {
    "12": "pts",
    "15": "reb",
    "16": "ast",
    "17": "stl",
    "18": "blk",
    "19": "tov",
    "10": "fg3m",
}


def _load_fallback_positions_map() -> dict[str, str]:
    global _FALLBACK_POSITIONS_CACHE
    with _FALLBACK_POSITIONS_LOCK:
        if _FALLBACK_POSITIONS_CACHE is not None:
            return _FALLBACK_POSITIONS_CACHE

        loaded: dict[str, str] = {}
        fallback_path = get_settings().fallback_positions_path
        if fallback_path.exists():
            try:
                raw_map = json.loads(fallback_path.read_text(encoding="utf-8"))
                for raw_key, raw_pos in raw_map.items():
                    if not raw_key or not raw_pos:
                        continue
                    cleaned = clean_player_name(raw_key)
                    pos_str = str(raw_pos).strip()
                    loaded[cleaned] = pos_str
                    loaded[raw_key] = pos_str
                    loaded[cleaned.lower()] = pos_str
                    loaded[str(raw_key).lower()] = pos_str
            except Exception as exc:
                logger.warning("Failed to load fallback positions file %s: %s", fallback_path, exc)

        _FALLBACK_POSITIONS_CACHE = loaded
        return loaded


def get_yahoo_query(league_id: str) -> YahooFantasySportsQuery:
    lid = str(league_id).strip()
    settings = get_settings()
    with _QUERY_LOCK:
        cached = _QUERY_CACHE.get(lid)
        if cached is not None:
            try:
                if cached.oauth.token_is_valid():
                    return cached
            except Exception:
                pass

        # Cache per-league queries so OAuth token checks and HTTP keep-alive connections are reused.
        query = YahooFantasySportsQuery(
            league_id=lid,
            game_code="nba",
            offline=False,
            yahoo_consumer_key=settings.yahoo_consumer_key,
            yahoo_consumer_secret=settings.yahoo_consumer_secret,
            env_file_location=settings.yahoo_auth_dir,
            save_token_data_to_env_file=False,
        )
        _QUERY_CACHE[lid] = query
        return query


def resolve_league_key(yahoo_query) -> str:
    league_key = getattr(yahoo_query, "league_key", None) or getattr(yahoo_query, "_cached_league_key", None)
    if not league_key:
        league_key = yahoo_query.get_league_key()
        yahoo_query._cached_league_key = league_key
    return league_key


def get_live_team_stats(yahoo_query, team_id, week_num, league_key=None):
    if not league_key:
        league_key = resolve_league_key(yahoo_query)

    cache_key = (str(league_key), str(team_id), int(week_num))
    now = time.time()
    with _LIVE_STATS_LOCK:
        if cache_key in _LIVE_STATS_CACHE:
            ts, stats_cached, live_cached = _LIVE_STATS_CACHE[cache_key]
            if now - ts < _LIVE_STATS_TTL_SECS:
                return dict(stats_cached), live_cached

    team_key = f"{league_key}.t.{team_id}"
    url = f"https://fantasysports.yahooapis.com/fantasy/v2/team/{team_key}/stats;type=week;week={week_num}"
    raw_data = yahoo_query.get_response(url).json()

    team_section = raw_data["fantasy_content"]["team"][1]
    stats_list = team_section["team_stats"]["stats"]
    raw_live = team_section.get("team_remaining_games", {}).get("total", {}).get("live_games", 0)
    live_games = int(raw_live or 0) > 0

    live_stats: dict[str, float] = {}
    for item in stats_list:
        if "stat" not in item:
            continue

        stat_id = str(item["stat"]["stat_id"])
        value = item["stat"]["value"]

        if stat_id == "9004003":
            ratio = str(value).strip() if value is not None else ""
            fgm, fga = ratio.split("/", 1) if "/" in ratio else ("0", "0")
            live_stats["fgm"] = parse_yahoo_stat_value(fgm)
            live_stats["fga"] = parse_yahoo_stat_value(fga)
        elif stat_id == "9007006":
            ratio = str(value).strip() if value is not None else ""
            ftm, fta = ratio.split("/", 1) if "/" in ratio else ("0", "0")
            live_stats["ftm"] = parse_yahoo_stat_value(ftm)
            live_stats["fta"] = parse_yahoo_stat_value(fta)
        elif stat_id in _YAHOO_STAT_MAP:
            cat_name = _YAHOO_STAT_MAP[stat_id]
            try:
                live_stats[cat_name] = parse_yahoo_stat_value(value)
            except ValueError:
                live_stats[cat_name] = 0.0

    for key in ("fgm", "fga", "ftm", "fta"):
        live_stats.setdefault(key, 0.0)

    with _LIVE_STATS_LOCK:
        _LIVE_STATS_CACHE[cache_key] = (now, dict(live_stats), live_games)

    return live_stats, live_games


def extract_player_from_yahoo_entry(player_data):
    name = None
    status = None
    display_pos = None
    eligible_pos_list: list[str] = []

    def _process_dict(entry):
        nonlocal name, status, display_pos
        if not isinstance(entry, dict):
            return
        if "name" in entry and isinstance(entry["name"], dict):
            name = entry["name"].get("full") or name
        if "status" in entry and entry.get("status"):
            status = entry.get("status")
        elif "status_full" in entry and entry.get("status_full") and not status:
            status = entry.get("status_full")
        if "display_position" in entry and entry.get("display_position"):
            dp = str(entry.get("display_position")).strip()
            if dp and dp.upper() != "UTIL":
                display_pos = dp
        if "eligible_positions" in entry:
            ep = entry.get("eligible_positions")
            if isinstance(ep, list):
                for p_item in ep:
                    if isinstance(p_item, dict) and p_item.get("position"):
                        eligible_pos_list.append(str(p_item["position"]).strip())
                    elif isinstance(p_item, str):
                        eligible_pos_list.append(p_item.strip())
            elif isinstance(ep, dict) and "position" in ep:
                eligible_pos_list.append(str(ep["position"]).strip())

    if isinstance(player_data, list):
        for item in player_data:
            if isinstance(item, list):
                for subitem in item:
                    _process_dict(subitem)
            elif isinstance(item, dict):
                _process_dict(item)
    elif isinstance(player_data, dict):
        _process_dict(player_data)

    positions = display_pos
    if not positions and eligible_pos_list:
        valid_pos: list[str] = []
        seen_upper: set[str] = set()
        for pos in eligible_pos_list:
            up = pos.upper()
            if up not in ("BN", "IL", "IL+", "IR", "IR+", "NA", "UTIL") and up not in seen_upper:
                valid_pos.append(pos)
                seen_upper.add(up)
        if valid_pos:
            positions = ",".join(valid_pos)

    return name, status, positions


def query_single_player_yahoo_positions(yahoo_query, player_name):
    if not yahoo_query or not player_name:
        return None
    try:
        league_key = resolve_league_key(yahoo_query)
        url = (
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}"
            f"/players;search={urllib.parse.quote(player_name)}"
        )
        resp = yahoo_query.get_response(url)
        if resp and resp.status_code == 200:
            data = resp.json()
            league_content = data.get("fantasy_content", {}).get("league", [])
            players_dict = {}
            for item in league_content:
                if isinstance(item, dict) and "players" in item:
                    players_dict = item["players"]
                    break
            if isinstance(players_dict, dict):
                for key, val in players_dict.items():
                    if key == "count" or not isinstance(val, dict):
                        continue
                    _, _, p_pos = extract_player_from_yahoo_entry(val.get("player"))
                    if p_pos and p_pos.upper() != "UTIL":
                        return p_pos
    except Exception as exc:
        logger.warning("Single-player Yahoo position lookup failed for %s: %s", player_name, exc)
    return None


def get_yahoo_fa_info_map(yahoo_query):
    if not yahoo_query:
        return {}

    try:
        league_key = resolve_league_key(yahoo_query)
    except Exception as exc:
        logger.warning("Could not resolve league_key for FA info: %s", exc)
        return {}

    now = time.time()
    with _YAHOO_FA_STATUS_LOCK:
        if league_key in _YAHOO_FA_STATUS_CACHE:
            ts, cached_map = _YAHOO_FA_STATUS_CACHE[league_key]
            if now - ts < _YAHOO_FA_STATUS_TTL:
                return cached_map

    # Yahoo Fantasy REST API rejects batch requests larger than count=25.
    endpoints = [
        f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;status=A;sort={sort_mode};start={start};count=25"
        for sort_mode, total_limit in (("OR", 250), ("AR", 100))
        for start in range(0, total_limit, 25)
    ]

    fa_info_map: dict[str, dict[str, str]] = {}
    for url in endpoints:
        try:
            resp = yahoo_query.get_response(url)
            if not resp or resp.status_code != 200:
                continue
            data = resp.json()
            league_content = data.get("fantasy_content", {}).get("league", [])
            players_dict = {}
            for item in league_content:
                if isinstance(item, dict) and "players" in item:
                    players_dict = item["players"]
                    break

            if isinstance(players_dict, dict):
                for key, val in players_dict.items():
                    if key == "count" or not isinstance(val, dict):
                        continue
                    p_name, p_status, p_positions = extract_player_from_yahoo_entry(val.get("player"))
                    if p_name:
                        cleaned = clean_player_name(p_name)
                        entry_data = {
                            "status": str(p_status or "").upper().strip(),
                            "positions": str(p_positions or "").strip(),
                        }
                        fa_info_map[cleaned] = entry_data
                        fa_info_map[p_name] = entry_data
                        fa_info_map[cleaned.lower()] = entry_data
                        fa_info_map[p_name.lower()] = entry_data
        except Exception as exc:
            logger.warning("Failed querying Yahoo available players at %s: %s", url, exc)

    with _YAHOO_FA_STATUS_LOCK:
        _YAHOO_FA_STATUS_CACHE[league_key] = (now, fa_info_map)

    return fa_info_map


def get_yahoo_fa_injury_map(yahoo_query):
    info_map = get_yahoo_fa_info_map(yahoo_query)
    return {k: (v.get("status", "") if isinstance(v, dict) else str(v)) for k, v in info_map.items()}


def build_position_resolver(yahoo_query, fa_info_map=None, teams=None):
    fallback_positions_map = _load_fallback_positions_map()
    known_roster_positions: dict[str, str] = {}
    for team in (teams or []):
        if not isinstance(team, dict):
            continue
        for player in team.get("players", []):
            pos = player.get("positions")
            if pos and str(pos).upper() != "UTIL":
                cleaned = clean_player_name(player.get("name"))
                known_roster_positions[cleaned] = str(pos)
                known_roster_positions[cleaned.lower()] = str(pos)
                known_roster_positions[player.get("name")] = str(pos)

    fa_map = fa_info_map or {}

    def resolve_player_positions(p_name, p_stats_dict=None, allow_yahoo_lookup=True):
        if not p_name:
            return "Util"
        c_name = clean_player_name(p_name)
        fa_entry = (
            fa_map.get(c_name)
            or fa_map.get(p_name)
            or fa_map.get(c_name.lower())
            or fa_map.get(p_name.lower())
            or {}
        )
        if isinstance(fa_entry, dict):
            pos = fa_entry.get("positions")
            if pos and str(pos).upper() != "UTIL":
                return str(pos)
        if c_name in known_roster_positions:
            return known_roster_positions[c_name]
        if p_name in known_roster_positions:
            return known_roster_positions[p_name]
        if c_name.lower() in known_roster_positions:
            return known_roster_positions[c_name.lower()]
        if p_stats_dict:
            stat_pos = p_stats_dict.get("positions") or p_stats_dict.get("position")
            if stat_pos and str(stat_pos).upper() != "UTIL":
                return str(stat_pos)
        if c_name in fallback_positions_map:
            return fallback_positions_map[c_name]
        if p_name in fallback_positions_map:
            return fallback_positions_map[p_name]
        if c_name.lower() in fallback_positions_map:
            return fallback_positions_map[c_name.lower()]
        if allow_yahoo_lookup and yahoo_query:
            od_pos = query_single_player_yahoo_positions(yahoo_query, p_name)
            if od_pos and str(od_pos).upper() != "UTIL":
                return od_pos
        if p_stats_dict:
            ast = float(p_stats_dict.get("mu_ast") or 0.0)
            reb = float(p_stats_dict.get("mu_reb") or 0.0)
            fg3 = float(p_stats_dict.get("mu_fg3m") or 0.0)
            blk = float(p_stats_dict.get("mu_blk") or 0.0)
            if reb >= 7.5 or blk >= 1.2:
                return "C,PF"
            if ast >= 4.5:
                return "PG,SG"
            if reb >= 5.0:
                return "SF,PF"
            if fg3 >= 1.5 or ast >= 2.5:
                return "SG,SF"
        return "SF"

    return resolve_player_positions
