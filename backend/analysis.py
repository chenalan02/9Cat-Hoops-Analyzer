import math
import os
import json
import threading
import time
import urllib.parse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment
from backend.utils import clean_player_name


_FALLBACK_POSITIONS_FILE = os.path.join(os.path.dirname(__file__), "player_positions_fallback.json")
_FALLBACK_POSITIONS_MAP = {}
if os.path.exists(_FALLBACK_POSITIONS_FILE):
    try:
        with open(_FALLBACK_POSITIONS_FILE, "r") as _f:
            _raw_map = json.load(_f)
            for _k, _v in _raw_map.items():
                if _k and _v:
                    _clean_k = clean_player_name(_k)
                    _pos_str = str(_v).strip()
                    _FALLBACK_POSITIONS_MAP[_clean_k] = _pos_str
                    _FALLBACK_POSITIONS_MAP[_k] = _pos_str
                    _FALLBACK_POSITIONS_MAP[_clean_k.lower()] = _pos_str
                    _FALLBACK_POSITIONS_MAP[str(_k).lower()] = _pos_str
    except Exception as _e:
        print(f"Warning: could not load player_positions_fallback.json: {_e}")


_SQRT2 = math.sqrt(2.0)


def _prob_positive(mu, var):
    '''
    P(X > 0) for X ~ Normal(mu, var).
    Pure-math replacement for scipy.stats.norm.sf(0, loc=mu, scale=sqrt(var)) — identical result,
    but ~100x cheaper per scalar call (scipy's distribution wrappers carry heavy per-call overhead).
    Degenerate (zero-variance) distributions resolve to a step function instead of NaN.
    '''
    if var is None or not var > 0:
        return 1.0 if mu > 0 else (0.0 if mu < 0 else 0.5)
    return 0.5 * math.erfc(-mu / (math.sqrt(var) * _SQRT2))


# ─── Prepared NBA schedule cache ──────────────────────────────────
# The raw schedule from Databricks only changes once a day, but every request used to copy it,
# re-parse its dates and re-normalize team abbreviations (3x per streamer request).
# We prepare it once per source DataFrame and reuse it until app.state.nba_schedule is replaced.
_SCHEDULE_CACHE = {"source": None, "prepared": None}
_SCHEDULE_LOCK = threading.Lock()


def _get_prepared_schedule(nba_schedule):
    '''
    Returns a copy of the schedule with:
      - 'scheduled_date' as tz-naive datetimes floored to the day
      - 'team_normalized' with Yahoo/NBA abbreviations reconciled
    The result is shared between requests and must be treated as read-only.
    '''
    with _SCHEDULE_LOCK:
        if _SCHEDULE_CACHE["source"] is nba_schedule and _SCHEDULE_CACHE["prepared"] is not None:
            return _SCHEDULE_CACHE["prepared"]

    sched = nba_schedule.copy()
    if 'scheduled_date' not in sched.columns and sched.index.name == 'scheduled_date':
        sched = sched.reset_index()
    sched['scheduled_date'] = pd.to_datetime(sched['scheduled_date']).dt.tz_localize(None).dt.floor('D')
    sched['team_normalized'] = sched['team'].map(normalize_nba_team)

    with _SCHEDULE_LOCK:
        _SCHEDULE_CACHE["source"] = nba_schedule
        _SCHEDULE_CACHE["prepared"] = sched
    return sched


# Mapping between Yahoo team abbreviations and official NBA schedule abbreviations
NBA_TEAM_ALIASES = {
    "GS": "GSW", "GSW": "GSW",
    "NO": "NOP", "NOP": "NOP",
    "SA": "SAS", "SAS": "SAS",
    "PHO": "PHX", "PHX": "PHX",
    "NY": "NYK", "NYK": "NYK",
    "BRK": "BKN", "BKN": "BKN",
    "CHO": "CHA", "CHA": "CHA",
    "UTAH": "UTA", "UTA": "UTA",
    "WSH": "WAS", "WAS": "WAS",
    "OKC": "OKC", "POR": "POR", "SAC": "SAC", "TOR": "TOR", "MIA": "MIA",
    "MIL": "MIL", "MIN": "MIN", "IND": "IND", "LAC": "LAC", "LAL": "LAL",
    "MEM": "MEM", "ATL": "ATL", "BOS": "BOS", "CHI": "CHI", "CLE": "CLE",
    "DAL": "DAL", "DEN": "DEN", "DET": "DET", "HOU": "HOU", "ORL": "ORL",
    "PHI": "PHI",
}

def normalize_nba_team(abbr):
    if not abbr:
        return ""
    cleaned = str(abbr).upper().strip()
    return NBA_TEAM_ALIASES.get(cleaned, cleaned)


def _parse_yahoo_stat_value(value):
    if value is None or not str(value).strip() or str(value).strip() == "-":
        return 0.0
    return float(value)


def _calculate_weekly_player_games(team1, team2, date_start, nba_schedule):
    '''
    For each player on both teams, calculates:
    - total games scheduled in the current fantasy week (Monday to Sunday)
    - games already played (scheduled before date_start)
    - games remaining in the week (scheduled on or after date_start)
    '''
    date_start_dt = pd.to_datetime(date_start).tz_localize(None).floor('D')
    # Start of fantasy week (Monday 00:00:00)
    monday = (date_start_dt - pd.Timedelta(days=date_start_dt.weekday())).floor('D')
    # End of fantasy week (next Monday 00:00:00, exclusive)
    next_monday = monday + pd.Timedelta(days=7)

    sched = _get_prepared_schedule(nba_schedule)

    # Full week schedule: Monday through Sunday inclusive
    week_sched = sched[(sched['scheduled_date'] >= monday) & (sched['scheduled_date'] < next_monday)]

    # Total games for each NBA team in the full week
    team_total_games = week_sched.groupby('team_normalized')['scheduled_date'].count().to_dict()

    # Games played so far (scheduled before date_start day boundary)
    played_sched = week_sched[week_sched['scheduled_date'] < date_start_dt]
    team_played_games = played_sched.groupby('team_normalized')['scheduled_date'].count().to_dict()

    player_games = {"team1": {}, "team2": {}}
    ir_slots_set = {"IL", "IL+", "IR", "IR+", "NA"}
    for team_key, team in [("team1", team1), ("team2", team2)]:
        for player in team.get("players", []):
            p_name = player.get("name")
            raw_nba_team = player.get("nba_team")
            nba_team_norm = normalize_nba_team(raw_nba_team)
            selected_pos = str(player.get("selected_position") or "").upper().strip()
            is_ir = selected_pos in ir_slots_set

            raw_total = int(team_total_games.get(nba_team_norm, 0))
            raw_played = int(team_played_games.get(nba_team_norm, 0))

            # Players sitting in IR/IL/IL+/NA slots do not count toward weekly matchup GP
            total = 0 if is_ir else raw_total
            played = 0 if is_ir else raw_played
            remaining = max(0, total - played)
            player_games[team_key][p_name] = {
                "played": played,
                "total": total,
                "remaining": remaining,
                "ratio": f"{played}/{total}",
                "is_ir": is_ir,
                "nba_team": raw_nba_team or nba_team_norm,
                "status": player.get("status"),
                "positions": player.get("positions"),
                "selected_position": player.get("selected_position")
            }

    return player_games


def _build_accumulated_stats(scoreboard1, scoreboard2, any_live_games):
    '''
    Formats accumulated live stats and computes category leaders & current live score.
    '''
    t1_fgm = scoreboard1.get("fgm", 0.0)
    t1_fga = scoreboard1.get("fga", 0.0)
    t1_ftm = scoreboard1.get("ftm", 0.0)
    t1_fta = scoreboard1.get("fta", 0.0)

    t2_fgm = scoreboard2.get("fgm", 0.0)
    t2_fga = scoreboard2.get("fga", 0.0)
    t2_ftm = scoreboard2.get("ftm", 0.0)
    t2_fta = scoreboard2.get("fta", 0.0)

    t1_fg_pct = t1_fgm / t1_fga if t1_fga > 0 else 0.0
    t1_ft_pct = t1_ftm / t1_fta if t1_fta > 0 else 0.0
    t2_fg_pct = t2_fgm / t2_fga if t2_fga > 0 else 0.0
    t2_ft_pct = t2_ftm / t2_fta if t2_fta > 0 else 0.0

    categories = [
        ("pts", True),
        ("reb", True),
        ("ast", True),
        ("stl", True),
        ("blk", True),
        ("tov", False),  # lower is better
        ("fg3m", True),
    ]

    t1_wins = 0
    t2_wins = 0
    ties = 0

    cat_comparison = {}
    for cat, higher_better in categories:
        v1 = scoreboard1.get(cat, 0.0)
        v2 = scoreboard2.get(cat, 0.0)
        if v1 == v2:
            ties += 1
            leader = "tie"
        elif (v1 > v2 and higher_better) or (v1 < v2 and not higher_better):
            t1_wins += 1
            leader = "team1"
        else:
            t2_wins += 1
            leader = "team2"
        cat_comparison[cat] = {"team1": v1, "team2": v2, "leader": leader}

    # FG%
    if t1_fg_pct == t2_fg_pct:
        ties += 1
        fg_leader = "tie"
    elif t1_fg_pct > t2_fg_pct:
        t1_wins += 1
        fg_leader = "team1"
    else:
        t2_wins += 1
        fg_leader = "team2"
    cat_comparison["fg%"] = {
        "team1": round(t1_fg_pct, 4),
        "team2": round(t2_fg_pct, 4),
        "team1_split": f"{int(t1_fgm)}/{int(t1_fga)}",
        "team2_split": f"{int(t2_fgm)}/{int(t2_fga)}",
        "leader": fg_leader
    }

    # FT%
    if t1_ft_pct == t2_ft_pct:
        ties += 1
        ft_leader = "tie"
    elif t1_ft_pct > t2_ft_pct:
        t1_wins += 1
        ft_leader = "team1"
    else:
        t2_wins += 1
        ft_leader = "team2"
    cat_comparison["ft%"] = {
        "team1": round(t1_ft_pct, 4),
        "team2": round(t2_ft_pct, 4),
        "team1_split": f"{int(t1_ftm)}/{int(t1_fta)}",
        "team2_split": f"{int(t2_ftm)}/{int(t2_fta)}",
        "leader": ft_leader
    }

    has_data = any_live_games or any(v > 0 for v in scoreboard1.values()) or any(v > 0 for v in scoreboard2.values())

    return {
        "team1": scoreboard1,
        "team2": scoreboard2,
        "categories": cat_comparison,
        "has_live_stats": has_data,
        "live_score": {
            "team1_wins": t1_wins,
            "team2_wins": t2_wins,
            "ties": ties
        }
    }


_LIVE_STATS_CACHE = {}
_LIVE_STATS_LOCK = threading.Lock()
_LIVE_STATS_TTL_SECS = 60.0


def _get_live_team_stats(yahoo_query, team_id, week_num, league_key=None):
    '''
    Makes a single raw API call to extract ALL 9-cat stats for a team, 
    mapping standard categories and splitting the raw FGM/FGA and FTM/FTA strings.
    Cached for 60 seconds to avoid repeating identical Yahoo HTTP requests during
    rapid tab switches, drop-player changes, or Monte Carlo triggers.
    '''
    if not league_key:
        league_key = getattr(yahoo_query, "league_key", None) or getattr(yahoo_query, "_cached_league_key", None)
        if not league_key:
            league_key = yahoo_query.get_league_key()
            yahoo_query._cached_league_key = league_key

    cache_key = (str(league_key), str(team_id), int(week_num))
    now = time.time()
    with _LIVE_STATS_LOCK:
        if cache_key in _LIVE_STATS_CACHE:
            ts, stats_cached, live_cached = _LIVE_STATS_CACHE[cache_key]
            if now - ts < _LIVE_STATS_TTL_SECS:
                return dict(stats_cached), live_cached

    team_key = f"{league_key}.t.{team_id}"
    url = f"https://fantasysports.yahooapis.com/fantasy/v2/team/{team_key}/stats;type=week;week={week_num}"

    # Fetch the Response object and call .json() to turn it into a dictionary
    response_obj = yahoo_query.get_response(url)
    raw_data = response_obj.json()

    stats_list = raw_data["fantasy_content"]["team"][1]["team_stats"]["stats"]

    # Map Yahoo's integer IDs to your simulator's string keys
    yahoo_stat_map = {
        "12": "pts",
        "15": "reb",
        "16": "ast",
        "17": "stl",
        "18": "blk",
        "19": "tov",
        "10": "fg3m",
    }

    live_stats = {}
    live_games = raw_data['fantasy_content']['team'][1]['team_remaining_games']['total']['live_games'] > 0

    for item in stats_list:
        if "stat" not in item:
            continue

        stat_id = str(item["stat"]["stat_id"])
        value = item["stat"]["value"]

        # 1. Handle the string splits for efficiency volume
        if stat_id == "9004003":
            ratio = str(value).strip() if value is not None else ""
            fgm, fga = ("0", "0") if ratio in {"", "-", "0"} else ratio.split("/")
            live_stats["fgm"] = _parse_yahoo_stat_value(fgm)
            live_stats["fga"] = _parse_yahoo_stat_value(fga)

        elif stat_id == "9007006":
            ratio = str(value).strip() if value is not None else ""
            ftm, fta = ("0", "0") if ratio in {"", "-", "0"} else ratio.split("/")
            live_stats["ftm"] = _parse_yahoo_stat_value(ftm)
            live_stats["fta"] = _parse_yahoo_stat_value(fta)

        # 2. Handle the standard 9 categories
        elif stat_id in yahoo_stat_map:
            cat_name = yahoo_stat_map[stat_id]

            # Yahoo uses a dash or an empty string when there are no stats yet.
            try:
                live_stats[cat_name] = _parse_yahoo_stat_value(value)
            except ValueError:
                live_stats[cat_name] = 0.0

    # Fallback to ensure volume keys exist even if a team hasn't taken a shot yet
    for key in ["fgm", "fga", "ftm", "fta"]:
        if key not in live_stats:
            live_stats[key] = 0.0

    with _LIVE_STATS_LOCK:
        _LIVE_STATS_CACHE[cache_key] = (now, dict(live_stats), live_games)

    return live_stats, live_games


_YAHOO_FA_STATUS_CACHE = {}
_YAHOO_FA_STATUS_LOCK = threading.Lock()
_YAHOO_FA_STATUS_TTL = 300  # 5 minutes


def _extract_player_from_yahoo_entry(player_data):
    """Safely extracts player name, injury status, and eligible positions from Yahoo REST API response element."""
    name = None
    status = None
    display_pos = None
    eligible_pos_list = []

    def _process_dict(d):
        nonlocal name, status, display_pos, eligible_pos_list
        if not isinstance(d, dict):
            return
        if "name" in d and isinstance(d["name"], dict):
            name = d["name"].get("full") or name
        if "status" in d and d.get("status"):
            status = d.get("status")
        elif "status_full" in d and d.get("status_full") and not status:
            status = d.get("status_full")
        if "display_position" in d and d.get("display_position"):
            dp = str(d.get("display_position")).strip()
            if dp and dp.upper() != "UTIL":
                display_pos = dp
        if "eligible_positions" in d:
            ep = d.get("eligible_positions")
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
        valid_pos = []
        for p in eligible_pos_list:
            up = p.upper()
            if up not in ("BN", "IL", "IL+", "IR", "IR+", "NA", "UTIL") and up not in [x.upper() for x in valid_pos]:
                valid_pos.append(p)
        if valid_pos:
            positions = ",".join(valid_pos)

    return name, status, positions


def _query_single_player_yahoo_positions(yahoo_query, player_name):
    """Queries Yahoo API for a specific player by name if not in pre-fetched cache."""
    if not yahoo_query or not player_name:
        return None
    try:
        league_key = getattr(yahoo_query, "league_key", None) or getattr(yahoo_query, "_cached_league_key", None)
        if not league_key:
            league_key = yahoo_query.get_league_key()
            yahoo_query._cached_league_key = league_key
        url = f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;search={urllib.parse.quote(player_name)}"
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
                for k, v in players_dict.items():
                    if k == "count" or not isinstance(v, dict):
                        continue
                    p_entry = v.get("player")
                    _, _, p_pos = _extract_player_from_yahoo_entry(p_entry)
                    if p_pos and p_pos.upper() != "UTIL":
                        return p_pos
    except Exception as e:
        print(f"Warning: query for single player positions '{player_name}' failed: {e}")
    return None


def _get_yahoo_fa_info_map(yahoo_query):
    """
    Retrieves real-time Yahoo Fantasy injury statuses and eligible positions for available players in the league.
    Returns:
        dict: clean_player_name -> {"status": str, "positions": str}
    """
    if not yahoo_query:
        return {}

    try:
        league_key = getattr(yahoo_query, "league_key", None) or getattr(yahoo_query, "_cached_league_key", None)
        if not league_key:
            league_key = yahoo_query.get_league_key()
            yahoo_query._cached_league_key = league_key
    except Exception as e:
        print(f"Warning: could not get league_key for FA info: {e}")
        return {}

    now = time.time()
    with _YAHOO_FA_STATUS_LOCK:
        if league_key in _YAHOO_FA_STATUS_CACHE:
            ts, cached_map = _YAHOO_FA_STATUS_CACHE[league_key]
            if now - ts < _YAHOO_FA_STATUS_TTL:
                return cached_map

    fa_info_map = {}
    try:
        # Fetch available players from Yahoo in strict batches of 25 (Yahoo REST API limit: count <= 25)
        # Query top 250 by Overall Rank (OR) and top 100 by Actual Rank (AR)
        endpoints = [
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;status=A;sort=OR;start=0;count=25",
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;status=A;sort=OR;start=25;count=25",
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;status=A;sort=OR;start=50;count=25",
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;status=A;sort=OR;start=75;count=25",
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;status=A;sort=OR;start=100;count=25",
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;status=A;sort=OR;start=125;count=25",
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;status=A;sort=OR;start=150;count=25",
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;status=A;sort=OR;start=175;count=25",
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;status=A;sort=OR;start=200;count=25",
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;status=A;sort=OR;start=225;count=25",
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;status=A;sort=AR;start=0;count=25",
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;status=A;sort=AR;start=25;count=25",
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;status=A;sort=AR;start=50;count=25",
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{league_key}/players;status=A;sort=AR;start=75;count=25",
        ]
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
                    for k, v in players_dict.items():
                        if k == "count" or not isinstance(v, dict):
                            continue
                        p_entry = v.get("player")
                        p_name, p_status, p_positions = _extract_player_from_yahoo_entry(p_entry)
                        if p_name:
                            cleaned = clean_player_name(p_name)
                            st_val = str(p_status or "").upper().strip()
                            pos_val = str(p_positions or "").strip()
                            entry_data = {"status": st_val, "positions": pos_val}
                            fa_info_map[cleaned] = entry_data
                            fa_info_map[p_name] = entry_data
                            fa_info_map[cleaned.lower()] = entry_data
                            fa_info_map[p_name.lower()] = entry_data
            except Exception as inner_e:
                print(f"Warning: Failed querying Yahoo available players at {url}: {inner_e}")
    except Exception as e:
        print(f"Warning: Error fetching Yahoo available player info: {e}")

    with _YAHOO_FA_STATUS_LOCK:
        _YAHOO_FA_STATUS_CACHE[league_key] = (now, fa_info_map)

    return fa_info_map


def _get_yahoo_fa_injury_map(yahoo_query):
    """
    Retrieves real-time Yahoo Fantasy injury statuses for available players in the league.
    Returns:
        dict: clean_player_name(full_name) -> status string (e.g. 'O', 'INJ', 'GTD', etc.)
    """
    info_map = _get_yahoo_fa_info_map(yahoo_query)
    return {k: (v.get("status", "") if isinstance(v, dict) else str(v)) for k, v in info_map.items()}


def _get_league_roster_slots(roster_positions):
    '''
    Get the roster slots of the league in list format
    '''
    if not roster_positions:
        default_active = ["PG_1", "SG_1", "G_1", "SF_1", "PF_1", "F_1", "C_1", "C_2", "Util_1", "Util_2"]
        default_inactive = ["BN_1", "BN_2", "BN_3", "IL_1", "IL_2"]
        return default_active, default_inactive

    inactive_pos_names = {"BN", "IL", "IL+", "IR", "IR+", "NA"}
    active_slots = []
    inactive_slots = []
    for position in roster_positions:
        if isinstance(position, dict) and "roster_position" in position and isinstance(position["roster_position"], dict):
            position = position["roster_position"]
        # Handle both dict (from API payload) and custom yfpy RosterPosition object
        if isinstance(position, dict):
            is_starting = position.get("is_starting_position")
            count = int(position.get("count", 0) or 0)
            pos_name = str(position.get("position", "") or "").strip()
        else:
            is_starting = getattr(position, "is_starting_position", None)
            count = int(getattr(position, "count", 0) or 0)
            pos_name = str(getattr(position, "position", "") or "").strip()

        if not pos_name or count <= 0:
            continue

        if pos_name.upper() in inactive_pos_names:
            is_active = False
        elif is_starting is not None and bool(is_starting):
            is_active = True
        else:
            is_active = pos_name.upper() not in inactive_pos_names

        for i in range(count):
            slot_label = f"{pos_name}_{i+1}"
            if is_active:
                active_slots.append(slot_label)
            else:
                inactive_slots.append(slot_label)

    if not active_slots:
        active_slots = ["PG_1", "SG_1", "G_1", "SF_1", "PF_1", "F_1", "C_1", "C_2", "Util_1", "Util_2"]

    return active_slots, inactive_slots


def _get_safe_player_stats(player_info, stats_source):
    if not player_info:
        player_info = {}
    ema_fallback = player_info.get("ema_stats", {}) or {}
    stats = player_info.get(stats_source, {}) or {}
    defaults = {
        "rank": 999,
        "proj_games_played": None,
    }
    for stat in ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]:
        defaults[f"mu_{stat}"] = 0.0
        defaults[f"var_{stat}"] = 0.0
    for stat in ["fg", "ft"]:
        defaults[f"mu_{stat}a"] = 0.0
        defaults[f"var_{stat}a"] = 0.0
        defaults[f"mu_{stat}m"] = 0.0
        defaults[f"var_{stat}m"] = 0.0
    
    return {
        **defaults,
        **{k: v for k, v in ema_fallback.items() if v is not None},
        **{k: v for k, v in stats.items() if v is not None},
    }


_OUT_TAGS = {"O", "INJ", "OUT", "IL", "INJURED", "SUSP", "NA", "IR"}
_Q_TAGS = {"Q", "GTD", "DTD", "DOUBTFUL"}
_IR_SLOTS = {"IL", "IL+", "IR", "IR+", "NA"}

_CAT_ALIASES = {
    "PTS": "pts", "REB": "reb", "AST": "ast", "STL": "stl", "BLK": "blk",
    "TO": "tov", "TOV": "tov", "3PM": "fg3m", "FG3M": "fg3m",
    "FG%": "fg%", "FG": "fg%", "FT%": "ft%", "FT": "ft%",
}

_CAT_DB_Z_KEYS = {
    "pts": "z_pts",
    "reb": "z_reb",
    "ast": "z_ast",
    "stl": "z_stl",
    "blk": "z_blk",
    "tov": "z_tov",
    "fg3m": "z_fg3m",
    "fg%": "z_fg%",
    "ft%": "z_ft%",
}


def _canonical_cat(cat_key):
    if not cat_key:
        return ""
    k = str(cat_key).upper().strip()
    return _CAT_ALIASES.get(k, k.lower())


def _parse_positions(raw_positions):
    if isinstance(raw_positions, str):
        return [p.strip().upper() for p in raw_positions.replace("/", ",").split(",") if p.strip()]
    if isinstance(raw_positions, (list, tuple, set)):
        return [str(p).strip().upper() for p in raw_positions if str(p).strip()]
    return []


def _can_play_slot(pos_list, slot_name):
    slot_type = slot_name.split("_")[0].upper()
    if slot_type in ("UTIL", "BN"):
        return True
    if slot_type == "G":
        return any(pos in ("PG", "SG", "G") for pos in pos_list) or not pos_list
    if slot_type == "F":
        return any(pos in ("SF", "PF", "F") for pos in pos_list) or not pos_list
    return slot_type in pos_list or not pos_list


def _can_play_active(pos_list, player_status, slot_name, selected_pos=""):
    if str(selected_pos or "").upper().strip() in _IR_SLOTS:
        return False
    if str(player_status or "").upper().strip() in _OUT_TAGS:
        return False
    return _can_play_slot(pos_list, slot_name)


def _solve_day_lineup_matrix(players_meta, active_slots):
    """
    Solves optimal assignment of a list of eligible healthy playing players for ONE day
    into `active_slots`. Each element in `players_meta` is a dict containing:
      - name: str
      - slot_mask: list[bool] of len(active_slots) (or pos_list)
      - rank_score: float
    Returns list of (slot_name, player_meta_index).
    """
    num_players = len(players_meta)
    num_slots = len(active_slots)
    if num_players == 0 or num_slots == 0:
        return []

    cost_matrix = np.zeros((num_players, num_slots), dtype=np.float64)
    has_any = False
    for p_idx, p_info in enumerate(players_meta):
        weight = 100000.0 + float(p_info["rank_score"])
        mask = p_info["slot_mask"]
        for s_idx, eligible in enumerate(mask):
            if eligible:
                cost_matrix[p_idx, s_idx] = -weight
                has_any = True

    if not has_any:
        return []

    row_ind, col_ind = linear_sum_assignment(cost_matrix)
    assigned = []
    for r, c in zip(row_ind, col_ind):
        if cost_matrix[r, c] < -50000.0:
            assigned.append((active_slots[c], int(r)))
    return assigned


_VEC_MU_KEYS = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fgm", "fga", "ftm", "fta"]


def _stats_to_vec(p_stats_dict):
    """Packs 11 means followed by 11 variances into a length-22 float64 array."""
    v = np.zeros(22, dtype=np.float64)
    if not p_stats_dict:
        return v
    for i, k in enumerate(_VEC_MU_KEYS):
        v[i] = float(p_stats_dict.get(f"mu_{k}") or 0.0)
        v[11 + i] = max(0.0, float(p_stats_dict.get(f"var_{k}") or 0.0))
    return v


def _compute_player_rank_score(p, player_stats, stats_source):
    raw_rank = player_stats.get("rank", 999) if player_stats else 999
    if raw_rank is not None:
        try:
            r_val = float(raw_rank)
            if r_val < 999:
                return max(1.0, 1000.0 - r_val)
        except (ValueError, TypeError):
            pass
    z_val = None
    if player_stats and player_stats.get("z_total") is not None:
        z_val = player_stats.get("z_total")
    elif isinstance(p, dict):
        src_dict = p.get(stats_source, {}) or {}
        if src_dict.get("z_total") is not None:
            z_val = src_dict.get("z_total")
        elif p.get("z_total") is not None:
            z_val = p.get("z_total")
        else:
            ema_d = p.get("ema_stats", {}) or {}
            z_val = ema_d.get("z_total")
    return max(1.0, 500.0 + (float(z_val) * 25.0 if z_val is not None else 0.0))


def _weighted_cat_delta(p_base, p_after, status):
    """
    Applies triage-aware category weighting:
      - PUNTED: ignored (0.0)
      - SWING: full weight (1.15x in tight 35-65% battles)
      - SAFE (>= 85%): surplus overkill gains weighted 0.35x; drops below 85% take full 1.0x penalty
      - DOOMED (<= 15%): deep-deficit bumps below 20% weighted 0.25x; reviving past 20% gets full 1.0x
    """
    if status == "PUNTED":
        return 0.0
    if status == "SAFE":
        if p_after >= 0.85:
            return (p_after - p_base) * 0.35
        return (0.85 - p_base) * 0.35 + (p_after - 0.85) * 1.0
    if status == "DOOMED":
        if p_after <= 0.20:
            return (p_after - p_base) * 0.25
        return (0.20 - p_base) * 0.25 + (p_after - 0.20) * 1.0
    weight = 1.15 if 0.35 <= p_base <= 0.65 else 1.0
    return (p_after - p_base) * weight


def _extract_rank_and_z(stats_dict):
    if not isinstance(stats_dict, dict):
        return None, None
    r_val = None
    for k in ("rank", "ros_rank", "weekly_rank", "preseason_rank"):
        raw = stats_dict.get(k)
        if raw is not None:
            try:
                cand = int(float(raw))
                if 0 < cand < 999:
                    r_val = cand
                    break
            except (ValueError, TypeError):
                pass
    z_val = None
    if stats_dict.get("z_total") is not None:
        try:
            z_val = float(stats_dict["z_total"])
        except (ValueError, TypeError):
            pass
    return r_val, z_val


def _resolve_player_ros(p_name, player_obj=None, ros_stats_pool=None, fallback_stats=None):
    ros_dict = None
    if isinstance(player_obj, dict):
        candidate = player_obj.get("ros_stats")
        if isinstance(candidate, dict) and (candidate.get("z_total") is not None or candidate.get("rank") is not None):
            ros_dict = candidate
    if ros_dict is None and ros_stats_pool and p_name:
        c_name = clean_player_name(p_name)
        ros_dict = (
            ros_stats_pool.get(p_name)
            or ros_stats_pool.get(c_name)
            or ros_stats_pool.get(p_name.lower())
            or ros_stats_pool.get(c_name.lower())
        )
    r_val, z_val = _extract_rank_and_z(ros_dict)
    if r_val is None and fallback_stats:
        fb_r, fb_z = _extract_rank_and_z(fallback_stats)
        if z_val is None:
            z_val = fb_z
        return r_val, z_val, "MUST_HOLD" if (z_val is not None and z_val >= 2.0) else "CORE_HOLD" if (z_val is not None and z_val >= 0.6) else "STREAMABLE"
    if (r_val is not None and r_val <= 75) or (z_val is not None and z_val >= 2.0):
        hold_tier = "MUST_HOLD"
    elif (r_val is not None and r_val <= 115) or (z_val is not None and z_val >= 0.6):
        hold_tier = "CORE_HOLD"
    else:
        hold_tier = "STREAMABLE"
    return r_val, z_val, hold_tier


def _build_position_resolver(yahoo_query, fa_info_map=None, teams=None):
    known_roster_positions = {}
    for team in (teams or []):
        if not isinstance(team, dict):
            continue
        for p in team.get("players", []):
            pos = p.get("positions")
            if pos and str(pos).upper() != "UTIL":
                cname = clean_player_name(p.get("name"))
                known_roster_positions[cname] = str(pos)
                known_roster_positions[cname.lower()] = str(pos)
                known_roster_positions[p.get("name")] = str(pos)

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
        if c_name in _FALLBACK_POSITIONS_MAP:
            return _FALLBACK_POSITIONS_MAP[c_name]
        if p_name in _FALLBACK_POSITIONS_MAP:
            return _FALLBACK_POSITIONS_MAP[p_name]
        if c_name.lower() in _FALLBACK_POSITIONS_MAP:
            return _FALLBACK_POSITIONS_MAP[c_name.lower()]
        if allow_yahoo_lookup and yahoo_query:
            od_pos = _query_single_player_yahoo_positions(yahoo_query, p_name)
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


def _solve_optimal_lineup(team1, team2, date_start, roster_positions, stats_source, nba_schedule):
    '''
    Get game schedule for the week for both teams, then solve for the optimal lineup based on player stats and roster positions.
    Uses scipy.optimize.linear_sum_assignment (Hungarian algorithm) in-process rather than shelling out to CBC/PuLP,
    cutting ~14 LP solver subprocess launches per request down to a few microseconds of pure C/NumPy execution.
    '''
    team1_schedule = {}
    team2_schedule = {}

    date_start_dt = pd.to_datetime(date_start).tz_localize(None).floor('D')
    next_sunday = (date_start_dt + pd.Timedelta(days=(6 - date_start_dt.weekday()))).floor('D')

    sched = _get_prepared_schedule(nba_schedule)
    window_sched = sched[(sched['scheduled_date'] >= date_start_dt) & (sched['scheduled_date'] <= next_sunday)]

    # Map team_normalized -> scheduled_date -> game_info row dict
    daily_games_by_date = {}
    for date_val, group in window_sched.groupby('scheduled_date'):
        date_str = date_val.strftime('%Y-%m-%d')
        daily_games_by_date[date_str] = group.set_index('team_normalized').to_dict(orient='index')

    for date in pd.date_range(start=date_start_dt, end=next_sunday, freq='D'):
        date_str = date.strftime('%Y-%m-%d')
        games_info = daily_games_by_date.get(date_str, {})
        team1_schedule[date_str] = {}
        team2_schedule[date_str] = {}
        teams_set = set(games_info.keys())

        for player in team1.get("players", []):
            p_nba = normalize_nba_team(player.get('nba_team'))
            if p_nba in teams_set:
                team1_schedule[date_str][player['name']] = games_info[p_nba]
        for player in team2.get("players", []):
            p_nba = normalize_nba_team(player.get('nba_team'))
            if p_nba in teams_set:
                team2_schedule[date_str][player['name']] = games_info[p_nba]

    team_lineups = {"team1": {}, "team2": {}}
    active_slots, _ = _get_league_roster_slots(roster_positions)
    num_slots = len(active_slots)

    for team_num, team in [("team1", team1), ("team2", team2)]:
        players = team.get("players", [])
        num_players = len(players)

        # Precompute player metadata and static scores once per team
        player_meta = []
        for p in players:
            p_name = p['name']
            pos_list = _parse_positions(p.get('positions'))
            player_status = p.get('status')
            selected_pos = p.get('selected_position')
            player_stats = _get_safe_player_stats(p, stats_source)
            player_rank_score = _compute_player_rank_score(p, player_stats, stats_source)

            player_meta.append({
                "name": p_name,
                "pos_list": pos_list,
                "status": player_status,
                "selected_pos": selected_pos,
                "rank_score": player_rank_score,
            })

        for date in pd.date_range(start=date_start_dt, end=next_sunday, freq='D'):
            date_str = date.strftime('%Y-%m-%d')
            team_lineups[team_num][date_str] = {}

            if not players or num_slots == 0:
                continue

            players_with_game = (
                team1_schedule[date_str].keys() if team_num == "team1"
                else team2_schedule[date_str].keys()
            )

            # Build a bipartite matching cost matrix (players x active slots).
            # linear_sum_assignment minimizes total cost, so eligible assignments get
            # cost = -(100000.0 + player_rank_score) and ineligible assignments get 0.
            # Only strictly negative costs represent valid active starts.
            cost_matrix = np.zeros((num_players, num_slots), dtype=np.float64)
            has_any_eligible = False

            for p_idx, p_info in enumerate(player_meta):
                if p_info["name"] not in players_with_game:
                    continue
                pos_list = p_info["pos_list"]
                player_status = p_info["status"]
                selected_pos = p_info["selected_pos"]
                weight = 100000.0 + p_info["rank_score"]

                for s_idx, slot in enumerate(active_slots):
                    if _can_play_active(pos_list, player_status, slot, selected_pos):
                        cost_matrix[p_idx, s_idx] = -weight
                        has_any_eligible = True

            if not has_any_eligible:
                continue

            row_ind, col_ind = linear_sum_assignment(cost_matrix)
            for r, c in zip(row_ind, col_ind):
                if cost_matrix[r, c] < -50000.0:  # Matches valid eligible starting assignments
                    slot_name = active_slots[c]
                    player_name = player_meta[r]["name"]
                    team_lineups[team_num][date_str][slot_name] = player_name

    return team_lineups, {"team1": team1_schedule, "team2": team2_schedule}


def matchup_analysis(yahoo_query, team1, team2, week_num, date_start, roster_positions, stats_source, nba_schedule):
    '''
    Analyze the matchup between two teams for the week, considering their schedules and player stats.
    '''

    optimal_lineups, team_schedules = _solve_optimal_lineup(team1, team2, date_start, roster_positions, stats_source, nba_schedule)
    players_list = team1["players"] + team2["players"]
    players_dict = {player['name']: player for player in players_list}

    active_slots, _ = _get_league_roster_slots(roster_positions)
    active_slots_set = set(active_slots)

    counting_stats = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]
    efficiency_stats = ["fg", "ft"]

    def get_base_dist():
        return {stat: {"mu": 0, "var": 0} for stat in 
            ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fga", "fgm", "fta", "ftm"]}

    agg_dists = {
        "team1": get_base_dist(),
        "team2": get_base_dist()
    }

    # fill aggregate stats from previous games concurrently
    league_key = getattr(yahoo_query, "_cached_league_key", None)
    if not league_key:
        league_key = yahoo_query.get_league_key()
        yahoo_query._cached_league_key = league_key

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(_get_live_team_stats, yahoo_query, team1["team_id"], week_num, league_key)
        f2 = executor.submit(_get_live_team_stats, yahoo_query, team2["team_id"], week_num, league_key)
        scoreboard1, live_games1 = f1.result()
        scoreboard2, live_games2 = f2.result()

    any_live_games = live_games1 or live_games2
    for stat, value in scoreboard1.items():
        agg_dists["team1"][stat]["mu"] = value
    for stat, value in scoreboard2.items():
        agg_dists["team2"][stat]["mu"] = value

    # fill aggregate stats dists with probability dists
    for team_num, team in [("team1", team1), ("team2", team2)]:
        team_sched = team_schedules[team_num]
        for date, lineup in optimal_lineups[team_num].items():
            players_with_game = team_sched.get(date, {})
            for slot, player_name in lineup.items():
                # A player only contributes stats if placed in an active starting slot AND actually playing in a game on that date
                if slot not in active_slots_set or player_name not in players_with_game:
                    continue

                player_info = players_dict[player_name]
                player_stats = _get_safe_player_stats(player_info, stats_source)

                for stat in counting_stats:
                    agg_dists[team_num][stat]["mu"] += player_stats["mu_" + stat]
                    agg_dists[team_num][stat]["var"] += player_stats["var_" + stat]

                for stat in efficiency_stats:
                    agg_dists[team_num][f"{stat}a"]["mu"] += player_stats[f"mu_{stat}a"]
                    agg_dists[team_num][f"{stat}a"]["var"] += player_stats[f"var_{stat}a"]
                    agg_dists[team_num][f"{stat}m"]["mu"] += player_stats[f"mu_{stat}m"]
                    agg_dists[team_num][f"{stat}m"]["var"] += player_stats[f"var_{stat}m"]

    win_probs = {}

    for cat in counting_stats:
        team1_mu = agg_dists["team1"][cat]["mu"]
        team1_var = agg_dists["team1"][cat]["var"]
        team2_mu = agg_dists["team2"][cat]["mu"]
        team2_var = agg_dists["team2"][cat]["var"]

        # Using normal approximation for difference of two independent random variables
        diff_mu = team1_mu - team2_mu
        diff_var = team1_var + team2_var  # variances add for independent variables

        # Calculate probability that team1 outperforms team2 in this category (lower is better for tov)
        if cat == "tov":
            prob_team1_wins = _prob_positive(-diff_mu, diff_var)
        else:
            prob_team1_wins = _prob_positive(diff_mu, diff_var)
        win_probs[cat] = prob_team1_wins

    for cat in efficiency_stats:
        team1_m_mu = agg_dists["team1"][f"{cat}m"]["mu"]
        team1_m_var = agg_dists["team1"][f"{cat}m"]["var"]
        team1_a_mu = agg_dists["team1"][f"{cat}a"]["mu"]
        team1_a_var = agg_dists["team1"][f"{cat}a"]["var"]

        team2_m_mu = agg_dists["team2"][f"{cat}m"]["mu"]
        team2_m_var = agg_dists["team2"][f"{cat}m"]["var"]
        team2_a_mu = agg_dists["team2"][f"{cat}a"]["mu"]
        team2_a_var = agg_dists["team2"][f"{cat}a"]["var"]

        team1_eff_mu = team1_m_mu / team1_a_mu if team1_a_mu > 0 else 0
        team2_eff_mu = team2_m_mu / team2_a_mu if team2_a_mu > 0 else 0

        # Delta Method variance formula
        if team1_a_mu > 0:
            team1_eff_var = (team1_m_var / (team1_a_mu ** 2)) + (((team1_m_mu ** 2) * team1_a_var) / (team1_a_mu ** 4))
        else:
            team1_eff_var = 0
            
        if team2_a_mu > 0:
            team2_eff_var = (team2_m_var / (team2_a_mu ** 2)) + (((team2_m_mu ** 2) * team2_a_var) / (team2_a_mu ** 4))
        else:
            team2_eff_var = 0

        diff_eff_mu = team1_eff_mu - team2_eff_mu
        
        # Max(..., 0) prevents highly unlikely floating point calculation errors from breaking the square root
        diff_eff_var = max(team1_eff_var + team2_eff_var, 0)

        win_probs[f"{cat}%"] = _prob_positive(diff_eff_mu, diff_eff_var)

    accumulated_stats = _build_accumulated_stats(scoreboard1, scoreboard2, any_live_games)
    player_games = _calculate_weekly_player_games(team1, team2, date_start, nba_schedule)

    # Collect players who are injured, in IR/IL/NA slots, or have 0 scheduled games this week
    inactive_players = {"team1": [], "team2": []}
    ir_slots_set = {"IL", "IL+", "IR", "IR+", "NA"}
    for team_key, team in [("team1", team1), ("team2", team2)]:
        for player in team["players"]:
            p_name = player.get("name")
            status = player.get("status")
            selected_pos = str(player.get("selected_position") or "").upper().strip()
            is_ir = selected_pos in ir_slots_set
            is_injured = (status is not None and status != "") or is_ir
            sched_games = player_games.get(team_key, {}).get(p_name, {}).get("total", 0)
            is_zero_games = sched_games == 0
            if is_injured or is_zero_games:
                display_status = f"{status} ({selected_pos})" if (status and is_ir and status != selected_pos) else (status or (selected_pos if is_ir else None))
                inactive_players[team_key].append({
                    "name": p_name,
                    "status": display_status,
                    "proj_games_played": 0 if (is_ir or status in ["O", "INJ", "IL", "OUT"]) else sched_games
                })

    return {
        "win_probs": win_probs,
        "agg_dists": agg_dists,
        "analytical_projections": agg_dists,
        "optimal_lineups": optimal_lineups,
        "team_schedules": team_schedules,
        "inactive_players": inactive_players,
        "accumulated_stats": accumulated_stats,
        "player_games": player_games
    }


def matchup_analysis_monte_carlo(yahoo_query, team1, team2, week_num, date_start, roster_positions, stats_source, nba_schedule, n_sims=10000):
    '''
    Analyze the matchup between two teams for the week, considering their schedules and player stats.
    '''
    optimal_lineups, team_schedules = _solve_optimal_lineup(team1, team2, date_start, roster_positions, stats_source, nba_schedule)
    players_list = team1["players"] + team2["players"]
    players_dict = {player['name']: player for player in players_list}

    active_slots, _ = _get_league_roster_slots(roster_positions)
    active_slots_set = set(active_slots)

    counting_stats = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]
    efficiency_stats = ["fg", "ft"]

    # fill aggregate stats from previous games concurrently
    agg_dists = {"team1": {}, "team2": {}}
    league_key = getattr(yahoo_query, "_cached_league_key", None)
    if not league_key:
        league_key = yahoo_query.get_league_key()
        yahoo_query._cached_league_key = league_key

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(_get_live_team_stats, yahoo_query, team1["team_id"], week_num, league_key)
        f2 = executor.submit(_get_live_team_stats, yahoo_query, team2["team_id"], week_num, league_key)
        scoreboard1, live_games1 = f1.result()
        scoreboard2, live_games2 = f2.result()

    any_live_games = live_games1 or live_games2
    for stat, value in scoreboard1.items():
        agg_dists["team1"][stat] = value
    for stat, value in scoreboard2.items():
        agg_dists["team2"][stat] = value
    
    def get_base_dict(team):
        return {stat: np.full(n_sims, agg_dists[team][stat]) for stat in counting_stats + [f"{stat}a" for stat in efficiency_stats] + [f"{stat}m" for stat in efficiency_stats]}
    # aggrgegate counts for each category for each sim
    sim_agg = {"team1": get_base_dict("team1"),
               "team2": get_base_dict("team2")}

    win_counts = {}
    win_pcts = {}
    
    for team in ["team1", "team2"]:
        team_sched = team_schedules[team]
        for date, lineup in optimal_lineups[team].items():
            players_with_game = team_sched.get(date, {})
            sim_agg[team][date] = {}
            for slot, player_name in lineup.items():
                if slot not in active_slots_set or player_name not in players_with_game:
                    continue

                player_info = players_dict[player_name]
                player_stats = _get_safe_player_stats(player_info, stats_source)

                # negative binomial sim for counting stats, poisson if not overdispersed
                for stat in counting_stats:
                    mu = player_stats["mu_" + stat]
                    var = player_stats["var_" + stat]

                    if var > mu and mu > 0:
                        p = mu / var
                        n = (mu ** 2) / (var - mu)
                        player_sim = np.random.negative_binomial(n, p, size=n_sims)
                    else:
                        player_sim = np.random.poisson(mu, size=n_sims)

                    sim_agg[team][stat] += player_sim

                # simulate attempts and makes for efficiency stats
                for stat in efficiency_stats:
                    a_mu = player_stats[f"mu_{stat}a"]
                    a_var = player_stats[f"var_{stat}a"]
                    m_mu = player_stats[f"mu_{stat}m"]
                    m_var = player_stats[f"var_{stat}m"]

                    # simulate attempts with negative binomial if overdispersed, otherwise poisson
                    if a_var > a_mu and a_mu > 0:
                        p_a = a_mu / a_var
                        n_a = (a_mu ** 2) / (a_var - a_mu)
                        sim_A = np.random.negative_binomial(n_a, p_a, size=n_sims)
                    else:
                        sim_A = np.random.poisson(a_mu, size=n_sims)

                    # simulate true percentage as beta distribution
                    p_mean = m_mu / a_mu if a_mu > 0 else 0

                    if a_mu > 0:
                        p_var = (m_var / (a_mu ** 2)) - (((m_mu ** 2) * a_var) / (a_mu ** 4))
                        p_var = max(p_var, 1e-6)
                    else:
                        p_var = 0

                    max_allowed_var = p_mean * (1 - p_mean)
                    if 0 < p_var < max_allowed_var:
                        nu = (max_allowed_var / p_var) - 1
                        alpha = p_mean * nu
                        beta = (1 - p_mean) * nu
                        sim_p = np.random.beta(alpha, beta, size=n_sims)
                    else:
                        sim_p = np.full(n_sims, p_mean)

                    # simulate makes from binomial distribution
                    sim_M = np.random.binomial(n=sim_A.astype(int), p=sim_p)

                    sim_agg[team][f"{stat}a"] += sim_A
                    sim_agg[team][f"{stat}m"] += sim_M

    # calculate win probabilities based on sims (lower is better for tov)
    for cat in counting_stats:
        if cat == "tov":
            win_counts[cat] = sim_agg["team1"][cat] < sim_agg["team2"][cat]
        else:
            win_counts[cat] = sim_agg["team1"][cat] > sim_agg["team2"][cat]
        win_pcts[cat] = np.sum(win_counts[cat]) / n_sims
    
    for cat in efficiency_stats:
        team1_eff = sim_agg["team1"][f"{cat}m"] / np.where(sim_agg["team1"][f"{cat}a"] > 0, sim_agg["team1"][f"{cat}a"], 1)
        team2_eff = sim_agg["team2"][f"{cat}m"] / np.where(sim_agg["team2"][f"{cat}a"] > 0, sim_agg["team2"][f"{cat}a"], 1)
        win_counts[f"{cat}%"] = team1_eff > team2_eff
        win_pcts[f"{cat}%"] = np.sum(win_counts[f"{cat}%"]) / n_sims

    all_cat_wins = np.array([win_counts[cat] for cat in counting_stats + [f"{stat}%" for stat in efficiency_stats]])
    matchup_wins = np.sum(all_cat_wins, axis=0) > 4
    win_pcts["matchup"] = np.sum(matchup_wins) / n_sims

    # get average results for each category for each team across all simulations
    sim_avg = {
        team: {
            cat: np.mean(sim_agg[team][cat]) 
            for cat in counting_stats + [f"{stat}a" for stat in efficiency_stats] + [f"{stat}m" for stat in efficiency_stats]
        } 
        for team in ["team1", "team2"]
    }   

    accumulated_stats = _build_accumulated_stats(scoreboard1, scoreboard2, any_live_games)
    player_games = _calculate_weekly_player_games(team1, team2, date_start, nba_schedule)

    # Collect players who are injured, in IR/IL/NA slots, or have 0 scheduled games this week
    inactive_players = {"team1": [], "team2": []}
    ir_slots_set = {"IL", "IL+", "IR", "IR+", "NA"}
    for team_key, team in [("team1", team1), ("team2", team2)]:
        for player in team["players"]:
            p_name = player.get("name")
            status = player.get("status")
            selected_pos = str(player.get("selected_position") or "").upper().strip()
            is_ir = selected_pos in ir_slots_set
            is_injured = (status is not None and status != "") or is_ir
            sched_games = player_games.get(team_key, {}).get(p_name, {}).get("total", 0)
            is_zero_games = sched_games == 0
            if is_injured or is_zero_games:
                display_status = f"{status} ({selected_pos})" if (status and is_ir and status != selected_pos) else (status or (selected_pos if is_ir else None))
                inactive_players[team_key].append({
                    "name": p_name,
                    "status": display_status,
                    "proj_games_played": 0 if (is_ir or status in ["O", "INJ", "IL", "OUT"]) else sched_games
                })

    return {
        "win_pcts": win_pcts,
        "sim_avg": sim_avg,
        "inactive_players": inactive_players,
        "accumulated_stats": accumulated_stats,
        "player_games": player_games
    }


def get_streamer_recommendations(
    yahoo_query,
    team1,
    team2,
    week_num,
    date_start,
    roster_positions,
    stats_source,
    nba_schedule,
    player_stats_pool,
    all_rostered_names=None,
    limit=6,
    target_drop_player=None,
    pickup_mode="week",
    punted_cats=None,
    ros_stats_pool=None,
):
    '''
    Evaluates free agent streamers to maximize expected matchup wins for team1.
    Supports:
    - pickup_mode: "week" (rest of week through Sunday) or "today" (current day only)
    - target_drop_player: None / "__AUTO__" (auto-suggest), "__OPEN_SLOT__" (no player dropped),
      or a specific player name on team1 to bench/drop/move to IR.
    - punted_cats: optional list of punted category names (ignored in ranking ΔE and triage).
    - ros_stats_pool: optional ROS stats dict to protect core ROS holds and show FA ROS upside.
    '''
    pickup_mode = "today" if str(pickup_mode or "").lower().strip() == "today" else "week"
    punted_set = {_canonical_cat(c) for c in (punted_cats or []) if _canonical_cat(c)}
    date_start_dt = pd.to_datetime(date_start).tz_localize(None)
    today_dt = date_start_dt.floor('D')
    today_str = today_dt.strftime('%Y-%m-%d')
    next_sunday = (today_dt + pd.Timedelta(days=(6 - today_dt.weekday()))).floor('D')

    week_date_strings = [d.strftime('%Y-%m-%d') for d in pd.date_range(start=today_dt, end=next_sunday, freq='D')]
    window_date_strings = [today_str] if pickup_mode == "today" else week_date_strings
    window_date_set = set(window_date_strings)

    # 1. Run baseline matchup analysis
    baseline = matchup_analysis(
        yahoo_query=yahoo_query,
        team1=team1,
        team2=team2,
        week_num=week_num,
        date_start=date_start,
        roster_positions=roster_positions,
        stats_source=stats_source,
        nba_schedule=nba_schedule
    )

    baseline_win_probs = baseline.get("win_probs", {})
    baseline_proj = baseline.get("analytical_projections") or baseline.get("agg_dists", {})
    optimal_lineups = baseline.get("optimal_lineups", {})
    team_schedules = baseline.get("team_schedules", {})
    player_games_t1 = baseline.get("player_games", {}).get("team1", {})

    counting_stats = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]
    cat_keys = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fg%", "ft%"]

    # 2. Category Diagnostics & Triage (punt-aware)
    category_diagnostics = {}
    for cat in cat_keys:
        p0 = baseline_win_probs.get(cat, 0.5)
        if cat in ["fg%", "ft%"]:
            prefix = "fg" if cat == "fg%" else "ft"
            t1_m = baseline_proj.get("team1", {}).get(f"{prefix}m", {}).get("mu", 0)
            t1_a = baseline_proj.get("team1", {}).get(f"{prefix}a", {}).get("mu", 0)
            t2_m = baseline_proj.get("team2", {}).get(f"{prefix}m", {}).get("mu", 0)
            t2_a = baseline_proj.get("team2", {}).get(f"{prefix}a", {}).get("mu", 0)
            t1_rate = t1_m / t1_a if t1_a > 0 else 0
            t2_rate = t2_m / t2_a if t2_a > 0 else 0
            margin = (t1_rate - t2_rate) * 100
        else:
            t1_mu = baseline_proj.get("team1", {}).get(cat, {}).get("mu", 0)
            t2_mu = baseline_proj.get("team2", {}).get(cat, {}).get("mu", 0)
            margin = t1_mu - t2_mu

        is_punted = cat in punted_set
        if is_punted:
            status = "PUNTED"
            target = False
        elif p0 >= 0.85:
            status = "SAFE"
            target = False
        elif p0 <= 0.15:
            status = "DOOMED"
            target = False
        else:
            status = "SWING"
            target = True

        category_diagnostics[cat] = {
            "status": status,
            "p_win": round(float(p0), 4),
            "margin": round(float(margin), 2),
            "target": target,
            "is_punted": is_punted,
        }

    # 3. Roster Slots & Starts Helper
    active_slots, inactive_slots = _get_league_roster_slots(roster_positions)
    active_slots_set = set(active_slots)

    bn_slots = [s for s in inactive_slots if s.split("_")[0].upper() == "BN"]
    il_slots = [s for s in inactive_slots if s.split("_")[0].upper() in ("IL", "IL+", "IR", "IR+")]
    standard_capacity = len(active_slots) + len(bn_slots)

    t1_players = [
        p for p in team1.get("players", [])
        if str(p.get("selected_position") or "").upper() not in _IR_SLOTS
    ]
    occupied_il_slots = sum(
        1 for p in team1.get("players", [])
        if str(p.get("selected_position") or "").upper() in ("IL", "IL+", "IR", "IR+")
    )
    open_il_slots = max(0, len(il_slots) - occupied_il_slots)
    open_roster_spots = max(0, standard_capacity - len(t1_players)) if standard_capacity > 0 else 0

    def get_player_starts(player_name, dates_filter=None):
        target_dates = set(dates_filter if dates_filter is not None else window_date_strings)
        t1_lineups = optimal_lineups.get("team1", {})
        t1_sched = team_schedules.get("team1", {})
        if t1_lineups:
            starts = 0
            for d, lineup in t1_lineups.items():
                if d not in target_dates:
                    continue
                players_with_game = t1_sched.get(d, {})
                if player_name in players_with_game:
                    for slot, p_in_slot in lineup.items():
                        if slot in active_slots_set and p_in_slot == player_name:
                            starts += 1
                            break
            return starts
        p_g = player_games_t1.get(player_name, {})
        if str(p_g.get("status") or "").upper() in _OUT_TAGS:
            return 0
        if dates_filter is not None and len(target_dates) == 1:
            return min(1, int(p_g.get("remaining", 0) or 0))
        return int(p_g.get("remaining", 0) or 0)

    # 4. Schedule Window Lookup (moved ahead of FA selection so schedule volume informs pool)
    sched = _get_prepared_schedule(nba_schedule)
    week_sched = sched[(sched['scheduled_date'] >= today_dt) & (sched['scheduled_date'] <= next_sunday)]
    team_week_game_dates = {}
    for team_abbr, group in week_sched.groupby('team_normalized'):
        team_week_game_dates[team_abbr] = set(group['scheduled_date'].dt.strftime('%Y-%m-%d'))

    team_game_dates = {
        team_abbr: (dates & window_date_set)
        for team_abbr, dates in team_week_game_dates.items()
    }

    # 5. Filter & Prioritize Candidate Free Agents (schedule + swing specialists + overall punt value)
    if all_rostered_names is None:
        all_rostered_names = set(p["name"] for p in team1.get("players", []) + team2.get("players", []))
    else:
        all_rostered_names = set(all_rostered_names)

    fa_info_map = _get_yahoo_fa_info_map(yahoo_query)
    fa_status_map = {k: (v.get("status", "") if isinstance(v, dict) else str(v)) for k, v in fa_info_map.items()}
    resolve_player_positions = _build_position_resolver(
        yahoo_query=yahoo_query,
        fa_info_map=fa_info_map,
        teams=[team1, team2],
    )

    def get_punt_z_from_stats(stats_dict, fallback_z=0.0):
        if not stats_dict:
            return float(fallback_z or 0.0)
        if not punted_set:
            val = stats_dict.get("z_total")
            if val is not None:
                return float(val)
        z_sum = 0.0
        found_any = False
        for c in cat_keys:
            if c in punted_set:
                continue
            zk = _CAT_DB_Z_KEYS.get(c)
            if zk and stats_dict.get(zk) is not None:
                z_sum += float(stats_dict[zk])
                found_any = True
        if found_any:
            return z_sum
        return float(stats_dict.get("z_total") if stats_dict.get("z_total") is not None else fallback_z or 0.0)

    def get_swing_z_from_stats(stats_dict):
        if not stats_dict:
            return 0.0
        z_sum = 0.0
        for c, diag in category_diagnostics.items():
            if diag["status"] != "SWING":
                continue
            zk = _CAT_DB_Z_KEYS.get(c)
            if zk and stats_dict.get(zk) is not None:
                z_sum += float(stats_dict[zk])
        return z_sum

    fa_candidates = []
    for p_name, p_stats in (player_stats_pool or {}).items():
        if p_name in all_rostered_names:
            continue
        if (p_stats.get("games_played") or 0) < 3:
            continue
        if (p_stats.get("mu_min") or 0) < 13.0:
            continue

        clean_name = clean_player_name(p_name)
        yahoo_status = (
            fa_status_map.get(clean_name)
            or fa_status_map.get(p_name)
            or fa_status_map.get(clean_name.lower())
            or fa_status_map.get(p_name.lower())
            or ""
        )
        if yahoo_status in _OUT_TAGS:
            continue

        db_status = str(p_stats.get("status") or p_stats.get("injury_status") or "").upper().strip()
        if db_status in _OUT_TAGS:
            continue

        proj_gp = p_stats.get("proj_games_played")
        if proj_gp is not None:
            try:
                if float(proj_gp) <= 0:
                    continue
            except (ValueError, TypeError):
                pass
        elif stats_source in ("weekly_stats", "weekly_rankings"):
            if p_stats.get("is_ema_fallback", False):
                continue

        raw_team = p_stats.get("team")
        if not raw_team:
            continue
        norm_team = normalize_nba_team(raw_team)
        win_games = len(team_game_dates.get(norm_team, set()))
        if win_games == 0:
            continue

        cand_status = yahoo_status or db_status or None
        cand_punt_z = get_punt_z_from_stats(p_stats, p_stats.get("z_total"))
        cand_swing_z = get_swing_z_from_stats(p_stats)
        fa_candidates.append({
            "name": p_name,
            "norm_team": norm_team,
            "stats": p_stats,
            "status": cand_status,
            "win_games": win_games,
            "punt_z": cand_punt_z,
            "swing_z": cand_swing_z,
            "sched_score": win_games * max(0.5, 4.0 + cand_punt_z),
            "specialist_score": min(win_games, 4) * cand_swing_z,
        })

    by_punt_z = sorted(fa_candidates, key=lambda c: c["punt_z"], reverse=True)[:60]
    by_sched = sorted(fa_candidates, key=lambda c: c["sched_score"], reverse=True)[:45]
    by_specialist = sorted(fa_candidates, key=lambda c: c["specialist_score"], reverse=True)[:35]

    seen_fa_names = set()
    top_fa_pool = []
    for bucket in (by_punt_z, by_sched, by_specialist):
        for item in bucket:
            if item["name"] not in seen_fa_names:
                seen_fa_names.add(item["name"])
                top_fa_pool.append(item)
                if len(top_fa_pool) >= 120:
                    break
        if len(top_fa_pool) >= 120:
            break

    top_fa_zs = [x["punt_z"] for x in by_punt_z[:5]]
    fa_benchmark_z = float(np.mean(top_fa_zs)) if top_fa_zs else -3.5

    def get_player_z(p):
        src_dict = (p.get(stats_source) or {}) if isinstance(p, dict) else {}
        if punted_set and src_dict:
            return get_punt_z_from_stats(src_dict)
        val = (
            src_dict.get("z_total")
            if src_dict.get("z_total") is not None
            else p.get("z_total")
            if p.get("z_total") is not None
            else (p.get("ema_stats") or {}).get("z_total")
        )
        return float(val) if val is not None else 0.0

    # 6. Precompute Vectorized Roster State & Baseline Window Lineups for Fast Daily Re-Solving
    date_strings = window_date_strings
    t1_lineups = optimal_lineups.get("team1", {})
    t1_sched = team_schedules.get("team1", {})
    window_label = "today" if pickup_mode == "today" else "left this week"

    t1_vec_by_name = {}
    t1_meta_by_name = {}
    t1_pos_mask_by_name = {}
    for p in t1_players:
        p_name = p.get("name")
        p_stats = _get_safe_player_stats(p, stats_source)
        p_pos = _parse_positions(p.get("positions"))
        p_status = p.get("status")
        sel_pos = p.get("selected_position")
        p_rank_score = _compute_player_rank_score(p, p_stats, stats_source)
        mask = tuple(_can_play_active(p_pos, p_status, s, sel_pos) for s in active_slots)
        t1_vec_by_name[p_name] = _stats_to_vec(p_stats)
        t1_pos_mask_by_name[p_name] = mask
        t1_meta_by_name[p_name] = {
            "name": p_name,
            "slot_mask": mask,
            "rank_score": p_rank_score,
            "is_eligible_any": any(mask),
        }

    base_day_vec = {}
    base_day_starters = {}
    base_window_vec = np.zeros(22, dtype=np.float64)
    base_total_starts = 0
    for d_str in date_strings:
        lineup = t1_lineups.get(d_str, {})
        players_with_game = t1_sched.get(d_str, {})
        starters = set()
        d_vec = np.zeros(22, dtype=np.float64)
        for slot, assigned_p in lineup.items():
            if slot in active_slots_set and assigned_p and assigned_p in players_with_game:
                starters.add(assigned_p)
                if assigned_p in t1_vec_by_name:
                    d_vec += t1_vec_by_name[assigned_p]
        base_day_starters[d_str] = starters
        base_day_vec[d_str] = d_vec
        base_window_vec += d_vec
        base_total_starts += len(starters)

    # Pre-unpack base team1/team2 projections & FA position masks
    base_t1_mu_arr = {c: float(baseline_proj.get("team1", {}).get(c, {}).get("mu", 0.0)) for c in _VEC_MU_KEYS}
    base_t1_var_arr = {c: float(baseline_proj.get("team1", {}).get(c, {}).get("var", 0.0)) for c in _VEC_MU_KEYS}
    base_t2_mu_arr = {c: float(baseline_proj.get("team2", {}).get(c, {}).get("mu", 0.0)) for c in _VEC_MU_KEYS}
    base_t2_var_arr = {c: float(baseline_proj.get("team2", {}).get(c, {}).get("var", 0.0)) for c in _VEC_MU_KEYS}

    base_t2_eff = {}
    for cat in ("fg", "ft"):
        m2 = base_t2_mu_arr[f"{cat}m"]
        a2 = base_t2_mu_arr[f"{cat}a"]
        mv2 = base_t2_var_arr[f"{cat}m"]
        av2 = base_t2_var_arr[f"{cat}a"]
        e2_mu = m2 / a2 if a2 > 0 else 0.0
        e2_var = ((mv2 / (a2 ** 2)) + (((m2 ** 2) * av2) / (a2 ** 4))) if a2 > 0 else 0.0
        base_t2_eff[cat] = (e2_mu, e2_var)

    # Precompute FA vectors, position masks, ROS info, and play probability once
    fa_prepared = []
    for item in top_fa_pool:
        p_name = item["name"]
        norm_team = item["norm_team"]
        p_stats = item["stats"]
        cand_status = item["status"]
        resolved_pos = resolve_player_positions(p_name, p_stats, allow_yahoo_lookup=False)
        pos_list = _parse_positions(resolved_pos)
        fa_mask = tuple(_can_play_slot(pos_list, s) for s in active_slots)
        if not any(fa_mask):
            continue

        if cand_status == "DOUBTFUL":
            play_prob = 0.25
        elif cand_status and cand_status in _Q_TAGS:
            play_prob = 0.75
        else:
            play_prob = 1.0

        fa_vec = _stats_to_vec(p_stats)
        fa_contrib_vec = np.zeros(22, dtype=np.float64)
        fa_contrib_vec[:11] = play_prob * fa_vec[:11]
        fa_contrib_vec[11:] = play_prob * fa_vec[11:] + play_prob * (1.0 - play_prob) * (fa_vec[:11] ** 2)

        raw_rank_score = _compute_player_rank_score({"name": p_name}, p_stats, stats_source)
        # Discount starter bump rank slightly for Q/DOUBTFUL FAs so uncertain pickups don't bench healthy stars
        fa_eff_rank_score = raw_rank_score * (0.85 if play_prob < 0.5 else (0.94 if play_prob < 1.0 else 1.0))

        ros_rank, ros_z, fa_hold_tier = _resolve_player_ros(
            p_name=p_name,
            player_obj=None,
            ros_stats_pool=ros_stats_pool,
            fallback_stats=None,
        )
        cand_rank, _ = _extract_rank_and_z(p_stats)
        fa_prepared.append({
            **item,
            "resolved_pos": resolved_pos,
            "slot_mask": fa_mask,
            "play_prob": play_prob,
            "fa_vec": fa_vec,
            "fa_contrib_vec": fa_contrib_vec,
            "eff_rank_score": fa_eff_rank_score,
            "cand_rank": cand_rank,
            "ros_rank": ros_rank,
            "ros_z": round(float(ros_z), 2) if ros_z is not None else None,
            "is_ros_hold": fa_hold_tier != "STREAMABLE",
        })

    def _adjacent_b2b_pairs(dates_list):
        if len(dates_list) < 2:
            return []
        sorted_d = sorted(dates_list)
        pairs = []
        for i in range(len(sorted_d) - 1):
            d1 = pd.to_datetime(sorted_d[i])
            d2 = pd.to_datetime(sorted_d[i + 1])
            if (d2 - d1).days == 1:
                pairs.append([sorted_d[i], sorted_d[i + 1]])
        return pairs

    def evaluate_candidate_for_drop(drop_p):
        """
        Simulate picking up each free agent with exact daily positional lineup assignment
        and bench backfill when removing `drop_p` (or `None` for an open roster spot).
        """
        drop_name = drop_p.get("name") if drop_p else None
        drop_p_starts = get_player_starts(drop_name, window_date_strings) if drop_name else 0
        drop_p_stats = _get_safe_player_stats(drop_p, stats_source) if drop_p else None

        drop_p_details = None
        if drop_p and drop_p_stats:
            drop_fgm = float(drop_p_stats.get("mu_fgm") or 0.0)
            drop_fga = float(drop_p_stats.get("mu_fga") or 0.0)
            drop_ftm = float(drop_p_stats.get("mu_ftm") or 0.0)
            drop_fta = float(drop_p_stats.get("mu_fta") or 0.0)
            drop_fg_pct = round((drop_fgm / drop_fga) * 100, 1) if drop_fga > 0 else 0.0
            drop_ft_pct = round((drop_ftm / drop_fta) * 100, 1) if drop_fta > 0 else 0.0
            drop_z_val = get_player_z(drop_p)
            drop_rank, _ = _extract_rank_and_z(drop_p_stats)
            if drop_rank is None:
                drop_rank, _ = _extract_rank_and_z(drop_p)
            d_ros_rank, d_ros_z, d_hold_tier = _resolve_player_ros(
                p_name=drop_name,
                player_obj=drop_p,
                ros_stats_pool=ros_stats_pool,
                fallback_stats=drop_p_stats,
            )

            drop_p_details = {
                "name": drop_name,
                "rank": drop_rank,
                "ros_rank": d_ros_rank,
                "ros_z": round(float(d_ros_z), 2) if d_ros_z is not None else None,
                "hold_tier": d_hold_tier,
                "nba_team": normalize_nba_team(drop_p.get("nba_team")),
                "positions": (
                    drop_p.get("positions")
                    if drop_p.get("positions") and str(drop_p.get("positions")).upper() != "UTIL"
                    else resolve_player_positions(drop_name, drop_p_stats, allow_yahoo_lookup=False)
                ),
                "status": drop_p.get("status") or None,
                "selected_position": drop_p.get("selected_position") or None,
                "z_total": round(drop_z_val, 2),
                "starts": drop_p_starts,
                "mu_pts": round(float(drop_p_stats.get("mu_pts") or 0.0), 1),
                "mu_reb": round(float(drop_p_stats.get("mu_reb") or 0.0), 1),
                "mu_ast": round(float(drop_p_stats.get("mu_ast") or 0.0), 1),
                "mu_stl": round(float(drop_p_stats.get("mu_stl") or 0.0), 1),
                "mu_blk": round(float(drop_p_stats.get("mu_blk") or 0.0), 1),
                "mu_fg3m": round(float(drop_p_stats.get("mu_fg3m") or 0.0), 1),
                "mu_tov": round(float(drop_p_stats.get("mu_tov") or 0.0), 1),
                "fg_pct": drop_fg_pct,
                "ft_pct": drop_ft_pct,
                "mu_fgm": round(drop_fgm, 1),
                "mu_fga": round(drop_fga, 1),
                "mu_ftm": round(drop_ftm, 1),
                "mu_fta": round(drop_fta, 1),
            }

        # Pre-solve daily lineups for (roster \ {drop_p}) ONCE across the window
        rem_meta_by_date = {}
        without_drop_vec = {}
        without_drop_starters = {}
        without_drop_open_slot_idxs = {}
        without_drop_min_rank = {}
        bench_backfill_map = {}

        for d_str in date_strings:
            players_with_game = t1_sched.get(d_str, {})
            d_metas = []
            for p in t1_players:
                pn = p.get("name")
                if drop_name and pn == drop_name:
                    continue
                if pn not in players_with_game:
                    continue
                m = t1_meta_by_name.get(pn)
                if m and m["is_eligible_any"]:
                    d_metas.append(m)

            assigns = _solve_day_lineup_matrix(d_metas, active_slots)
            used_slots = {active_slots.index(s_name) for s_name, _ in assigns}
            open_idxs = [i for i in range(len(active_slots)) if i not in used_slots]
            starter_names = {d_metas[p_i]["name"] for _, p_i in assigns}
            d_vec = np.zeros(22, dtype=np.float64)
            min_r = float("inf")
            for _, p_i in assigns:
                sn = d_metas[p_i]["name"]
                d_vec += t1_vec_by_name[sn]
                if d_metas[p_i]["rank_score"] < min_r:
                    min_r = d_metas[p_i]["rank_score"]

            rem_meta_by_date[d_str] = d_metas
            without_drop_open_slot_idxs[d_str] = open_idxs
            without_drop_starters[d_str] = starter_names
            without_drop_vec[d_str] = d_vec
            without_drop_min_rank[d_str] = min_r
            backfills = starter_names - base_day_starters[d_str]
            if backfills:
                bench_backfill_map[d_str] = sorted(backfills)

        day_solve_cache = {}
        pool_recs = []

        for fa in fa_prepared:
            p_name = fa["name"]
            norm_team = fa["norm_team"]
            p_stats = fa["stats"]
            cand_status = fa["status"]
            fa_mask = fa["slot_mask"]
            fa_eff_rank = fa["eff_rank_score"]
            play_prob = fa["play_prob"]
            s_dates = team_game_dates.get(norm_team, set())

            startable_dates = []
            clashed_dates = []
            all_game_dates = [d for d in date_strings if d in s_dates]
            replaced_starters_notes = []

            after_window_vec = np.zeros(22, dtype=np.float64)
            after_total_starts = 0

            for d_str in date_strings:
                if d_str not in s_dates:
                    after_window_vec += without_drop_vec[d_str]
                    after_total_starts += len(without_drop_starters[d_str])
                    continue

                open_idxs = without_drop_open_slot_idxs[d_str]
                # Fast path 1: FA fits directly into an already-open starting slot
                if any(fa_mask[s_idx] for s_idx in open_idxs):
                    startable_dates.append(d_str)
                    after_window_vec += without_drop_vec[d_str] + fa["fa_contrib_vec"]
                    after_total_starts += len(without_drop_starters[d_str]) + 1
                    continue

                # Fast path 2: Zero empty slots AND FA ranks strictly worse than every active starter -> Bench clash
                if not open_idxs and fa_eff_rank <= without_drop_min_rank[d_str]:
                    clashed_dates.append(d_str)
                    after_window_vec += without_drop_vec[d_str]
                    after_total_starts += len(without_drop_starters[d_str])
                    continue

                # Exact Hungarian bipartite solve (handles chain shifts PG->Util/F->C AND bumping weak starters)
                cache_key = (d_str, fa_mask, round(fa_eff_rank, 2))
                cached = day_solve_cache.get(cache_key)
                if cached is None:
                    d_metas = rem_meta_by_date[d_str]
                    fa_idx = len(d_metas)
                    combined = d_metas + [{
                        "name": p_name,
                        "slot_mask": fa_mask,
                        "rank_score": fa_eff_rank,
                    }]
                    assigns = _solve_day_lineup_matrix(combined, active_slots)
                    fa_in = False
                    others_vec = np.zeros(22, dtype=np.float64)
                    others_names = set()
                    for _, p_i in assigns:
                        if p_i == fa_idx:
                            fa_in = True
                        else:
                            oname = combined[p_i]["name"]
                            others_names.add(oname)
                            others_vec += t1_vec_by_name[oname]
                    cached = (fa_in, others_vec, others_names)
                    day_solve_cache[cache_key] = cached

                fa_in, others_vec, others_names = cached
                if fa_in:
                    startable_dates.append(d_str)
                    after_window_vec += others_vec + fa["fa_contrib_vec"]
                    after_total_starts += len(others_names) + 1
                    bumped = without_drop_starters[d_str] - others_names
                    if bumped:
                        replaced_starters_notes.append(f"{d_str}: starts over {', '.join(sorted(bumped))}")
                else:
                    clashed_dates.append(d_str)
                    after_window_vec += without_drop_vec[d_str]
                    after_total_starts += len(without_drop_starters[d_str])

            startable_games = len(startable_dates)
            if startable_games == 0:
                continue

            total_games_in_window = len(all_game_dates)
            clashes = len(clashed_dates)
            week_dates_for_team = sorted(d for d in team_week_game_dates.get(norm_team, set()) if d > today_str)
            b2b_pairs = _adjacent_b2b_pairs(startable_dates if pickup_mode == "week" else sorted([today_str] + week_dates_for_team))
            backfill_count = len(bench_backfill_map)
            net_team_starts = after_total_starts - base_total_starts

            delta_vec = after_window_vec - base_window_vec

            cat_impacts = {}
            risk_flags = []
            if cand_status and cand_status in _Q_TAGS:
                pct_label = int(round(play_prob * 100))
                risk_flags.append(f"Injury status: {cand_status} (~{pct_label}% play est.)")

            if replaced_starters_notes:
                risk_flags.append(f"Lineup swap ({replaced_starters_notes[0]})")

            delta_e = 0.0
            raw_delta_e = 0.0

            for idx_c, cat in enumerate(counting_stats):
                # _VEC_MU_KEYS aligns first 7 entries: pts, reb, ast, stl, blk, tov, fg3m
                d_mu = float(delta_vec[idx_c])
                d_var = float(delta_vec[11 + idx_c])

                new_t1_mu = base_t1_mu_arr[cat] + d_mu
                new_t1_var = max(0.01, base_t1_var_arr[cat] + d_var)
                diff_mu = new_t1_mu - base_t2_mu_arr[cat]
                diff_var = max(0.01, new_t1_var + base_t2_var_arr[cat])

                if cat == "tov":
                    p_win = _prob_positive(-diff_mu, diff_var)
                else:
                    p_win = _prob_positive(diff_mu, diff_var)

                p_base = baseline_win_probs.get(cat, 0.5)
                cat_delta_p = p_win - p_base
                diag_status = category_diagnostics[cat]["status"]

                if not category_diagnostics[cat]["is_punted"]:
                    raw_delta_e += cat_delta_p
                delta_e += _weighted_cat_delta(p_base, p_win, diag_status)

                disp_cat = "3PM" if cat == "fg3m" else ("TO" if cat == "tov" else cat.upper())
                disp_gain = f"{'+' if d_mu >= 0 else ''}{d_mu:.1f}"
                cat_impacts[cat] = {
                    "cat": disp_cat,
                    "before_p": round(float(p_base), 3),
                    "after_p": round(float(p_win), 3),
                    "delta_p": round(float(cat_delta_p), 3),
                    "is_target": bool(category_diagnostics[cat]["target"]),
                    "is_punted": bool(category_diagnostics[cat]["is_punted"]),
                    "gain": disp_gain,
                }

                if cat == "tov" and not category_diagnostics[cat]["is_punted"] and cat_delta_p <= -0.04:
                    risk_flags.append(f"Turnover Risk ({d_mu:+.1f} TO)")

            for eff_idx, cat in enumerate(["fg", "ft"]):
                m_idx = 7 + eff_idx * 2
                a_idx = m_idx + 1
                new_t1_m = max(0.0, base_t1_mu_arr[f"{cat}m"] + float(delta_vec[m_idx]))
                new_t1_m_var = max(0.01, base_t1_var_arr[f"{cat}m"] + float(delta_vec[11 + m_idx]))
                new_t1_a = max(0.01, base_t1_mu_arr[f"{cat}a"] + float(delta_vec[a_idx]))
                new_t1_a_var = max(0.01, base_t1_var_arr[f"{cat}a"] + float(delta_vec[11 + a_idx]))

                new_t1_eff_mu = new_t1_m / new_t1_a
                new_t1_eff_var = (new_t1_m_var / (new_t1_a ** 2)) + (((new_t1_m ** 2) * new_t1_a_var) / (new_t1_a ** 4))
                t2_eff_mu, t2_eff_var = base_t2_eff[cat]

                diff_eff_mu = new_t1_eff_mu - t2_eff_mu
                diff_eff_var = max(new_t1_eff_var + t2_eff_var, 0.00001)

                cat_pct_key = f"{cat}%"
                p_win = _prob_positive(diff_eff_mu, diff_eff_var)
                p_base = baseline_win_probs.get(cat_pct_key, 0.5)
                cat_delta_p = p_win - p_base
                diag_status = category_diagnostics[cat_pct_key]["status"]

                if not category_diagnostics[cat_pct_key]["is_punted"]:
                    raw_delta_e += cat_delta_p
                delta_e += _weighted_cat_delta(p_base, p_win, diag_status)

                b_m = base_t1_mu_arr[f"{cat}m"]
                b_a = base_t1_mu_arr[f"{cat}a"]
                base_t1_rate = b_m / b_a if b_a > 0 else new_t1_eff_mu
                rate_diff = (new_t1_eff_mu - base_t1_rate) * 100

                if not category_diagnostics[cat_pct_key]["is_punted"] and cat_delta_p <= -0.04:
                    fa_a = float(p_stats.get(f"mu_{cat}a") or 0)
                    rate_pct = ((float(p_stats.get(f"mu_{cat}m") or 0) / fa_a) * 100) if fa_a > 0 else 0.0
                    risk_flags.append(f"Negative {cat.upper()}% impact ({rate_pct:.1f}%)")

                cat_impacts[cat_pct_key] = {
                    "cat": cat.upper() + "%",
                    "before_p": round(float(p_base), 3),
                    "after_p": round(float(p_win), 3),
                    "delta_p": round(float(cat_delta_p), 3),
                    "is_target": bool(category_diagnostics[cat_pct_key]["target"]),
                    "is_punted": bool(category_diagnostics[cat_pct_key]["is_punted"]),
                    "gain": f"{'+' if rate_diff >= 0 else ''}{rate_diff:.2f}%",
                }

            FIXED_9CAT_ORDER = ["pts", "reb", "ast", "stl", "blk", "fg3m", "fg%", "ft%", "tov"]
            boosted_cats = [cat_impacts[k] for k in FIXED_9CAT_ORDER if k in cat_impacts]

            fgm_pg = float(p_stats.get("mu_fgm") or 0.0)
            fga_pg = float(p_stats.get("mu_fga") or 0.0)
            ftm_pg = float(p_stats.get("mu_ftm") or 0.0)
            fta_pg = float(p_stats.get("mu_fta") or 0.0)
            fg_pct_pg = round((fgm_pg / fga_pg) * 100, 1) if fga_pg > 0 else 0.0
            ft_pct_pg = round((ftm_pg / fta_pg) * 100, 1) if fta_pg > 0 else 0.0

            vs_drop = None
            if drop_p and drop_p_details:
                stat_diffs = {}
                for idx_c, c in enumerate(["pts", "reb", "ast", "stl", "blk", "fg3m", "tov"]):
                    s_val = float(p_stats.get(f"mu_{c}") or 0.0)
                    d_val = float(drop_p_stats.get(f"mu_{c}") or 0.0)
                    diff_pg = round(s_val - d_val, 1)
                    net_wk = round(float(delta_vec[idx_c]), 1)
                    stat_diffs[c] = {
                        "streamer_pg": round(s_val, 1),
                        "drop_pg": round(d_val, 1),
                        "diff_pg": diff_pg,
                        "net_weekly": net_wk,
                    }
                stat_diffs["fg_pct"] = {
                    "streamer": fg_pct_pg,
                    "drop": drop_p_details["fg_pct"],
                    "diff": round(fg_pct_pg - drop_p_details["fg_pct"], 1),
                    "streamer_fgm": round(fgm_pg, 1),
                    "streamer_fga": round(fga_pg, 1),
                    "drop_fgm": round(drop_fgm, 1),
                    "drop_fga": round(drop_fga, 1),
                    "diff_fga": round(fga_pg - drop_fga, 1),
                }
                stat_diffs["ft_pct"] = {
                    "streamer": ft_pct_pg,
                    "drop": drop_p_details["ft_pct"],
                    "diff": round(ft_pct_pg - drop_p_details["ft_pct"], 1),
                    "streamer_ftm": round(ftm_pg, 1),
                    "streamer_fta": round(fta_pg, 1),
                    "drop_ftm": round(drop_ftm, 1),
                    "drop_fta": round(drop_fta, 1),
                    "diff_fta": round(fta_pg - drop_fta, 1),
                }
                vs_drop = {
                    "drop_name": drop_name,
                    "drop_team": drop_p_details["nba_team"],
                    "drop_starts": drop_p_starts,
                    "streamer_starts": startable_games,
                    "net_starts": net_team_starts,
                    "z_diff": round(fa["punt_z"] - drop_p_details["z_total"], 2),
                    "stats": stat_diffs,
                }

            pool_recs.append({
                "player": {
                    "name": p_name,
                    "status": cand_status,
                    "play_prob": play_prob,
                    "rank": fa["cand_rank"],
                    "ros_rank": fa["ros_rank"],
                    "ros_z": fa["ros_z"],
                    "is_ros_hold": fa["is_ros_hold"],
                    "nba_team": norm_team,
                    "positions": fa["resolved_pos"],
                    "z_total": round(fa["punt_z"], 2),
                    "mu_pts": round(float(p_stats.get("mu_pts") or 0), 1),
                    "mu_reb": round(float(p_stats.get("mu_reb") or 0), 1),
                    "mu_ast": round(float(p_stats.get("mu_ast") or 0), 1),
                    "mu_stl": round(float(p_stats.get("mu_stl") or 0), 1),
                    "mu_blk": round(float(p_stats.get("mu_blk") or 0), 1),
                    "mu_fg3m": round(float(p_stats.get("mu_fg3m") or 0), 1),
                    "mu_tov": round(float(p_stats.get("mu_tov") or 0), 1),
                    "fg_pct": fg_pct_pg,
                    "ft_pct": ft_pct_pg,
                    "mu_fgm": round(fgm_pg, 1),
                    "mu_fga": round(fga_pg, 1),
                    "mu_ftm": round(ftm_pg, 1),
                    "mu_fta": round(fta_pg, 1),
                },
                "schedule": {
                    "games_remaining": total_games_in_window,
                    "startable_games": startable_games,
                    "startable_dates": startable_dates,
                    "clashed_dates": clashed_dates,
                    "all_game_dates": all_game_dates,
                    "back_to_back_pairs": b2b_pairs,
                    "rest_of_week_dates": week_dates_for_team,
                    "bench_backfill_games": backfill_count,
                    "net_team_starts": net_team_starts,
                    "clashes": clashes,
                },
                "impact": {
                    "expected_win_delta": round(float(delta_e), 3),
                    "raw_win_delta": round(float(raw_delta_e), 3),
                    "primary_boost_categories": boosted_cats,
                    "risk_flags": risk_flags,
                },
                "drop_player": drop_p_details,
                "vs_drop": vs_drop,
            })

        pool_recs.sort(
            key=lambda r: (
                r["impact"]["expected_win_delta"],
                r["schedule"]["startable_games"],
                r["player"]["z_total"],
            ),
            reverse=True
        )
        max_de = pool_recs[0]["impact"]["expected_win_delta"] if pool_recs else -999.0
        return pool_recs, max_de, drop_p_details

    # 7. Evaluate all roster candidates + open slot (if any)
    available_candidates = list(t1_players)
    cand_max_de_map = {}
    candidate_evals = []
    for cand in available_candidates:
        c_recs, c_max_de, c_details = evaluate_candidate_for_drop(cand)
        c_starts = get_player_starts(cand.get("name"), window_date_strings)
        c_z = get_player_z(cand)
        c_ros_rank = c_details.get("ros_rank") if c_details else None
        c_ros_z = c_details.get("ros_z") if c_details else None
        c_hold_tier = c_details.get("hold_tier", "STREAMABLE") if c_details else "STREAMABLE"
        c_status = str(cand.get("status") or "").upper().strip()
        candidate_evals.append({
            "player": cand,
            "recs": c_recs,
            "max_delta_e": c_max_de,
            "details": c_details,
            "starts": c_starts,
            "z": c_z,
            "ros_rank": c_ros_rank,
            "ros_z": c_ros_z,
            "hold_tier": c_hold_tier,
            "status": c_status,
        })
        cand_max_de_map[cand.get("name")] = c_max_de

    def _build_action_for_eval(ev):
        bp_player = ev["player"]
        bp_name = bp_player.get("name")
        bp_status = ev["status"]
        bp_starts = ev["starts"]
        bp_z = ev["z"]
        bp_de = ev["max_delta_e"]
        bp_ros = ev["ros_rank"]
        bp_tier = ev["hold_tier"]

        if open_il_slots > 0 and bp_status in _OUT_TAGS:
            act_type = "MOVE_TO_IR"
            reason = (
                f"Suggested: Move {bp_name} ({bp_status} tag, not in IR) to open IL slot "
                f"({bp_starts} start{'s' if bp_starts != 1 else ''} {window_label}) to add a streamer with 0 drops."
            )
        elif bp_status in _OUT_TAGS or bp_status in _Q_TAGS:
            act_type = "TAGGED_SUGGESTION"
            reason = (
                f"Suggested: Bench / swap {bp_name} ({bp_status} tag — "
                f"{bp_starts} projected start{'s' if bp_starts != 1 else ''} {window_label}, Z: {bp_z:+.2f})."
            )
        elif bp_tier == "MUST_HOLD":
            act_type = "HOLD_WARNING"
            ros_txt = f"ROS #{bp_ros}" if bp_ros else f"ROS Z: {ev['ros_z']:+.2f}" if ev.get("ros_z") is not None else f"Z: {bp_z:+.2f}"
            reason = (
                f"Hold Caution: Dropping {bp_name} ({ros_txt}) sacrifices strong Rest-of-Season value "
                f"for a short-term pickup (ΔE: {bp_de:+.2f}). Only stream in must-win / playoff spots."
            )
        elif bp_z > fa_benchmark_z + 1.25 and bp_tier == "CORE_HOLD":
            act_type = "HOLD_WARNING"
            ros_txt = f"ROS #{bp_ros}" if bp_ros else f"Z: {bp_z:+.2f}"
            reason = (
                f"Hold Caution: {bp_name} ({ros_txt}, {bp_starts} start{'s' if bp_starts != 1 else ''} {window_label}) "
                f"exceeds Free Agent baseline (Z: {fa_benchmark_z:+.2f})."
            )
        else:
            act_type = "DROP"
            reason = (
                f"Suggested: Replace {bp_name} (Z: {bp_z:+.2f}, {bp_starts} start{'s' if bp_starts != 1 else ''} {window_label}) "
                f"— yields net category win probability gain (ΔE: {bp_de:+.2f})."
            )

        return {
            "type": act_type,
            "target_player": bp_name,
            "status_tag": bp_status or None,
            "drop_z": round(bp_z, 2),
            "ros_rank": bp_ros,
            "hold_tier": bp_tier,
            "drop_starts": bp_starts,
            "open_roster_spots": open_roster_spots,
            "open_il_slots": open_il_slots,
            "fa_benchmark_z": round(fa_benchmark_z, 2),
            "reason": reason,
        }

    def _finalize_rec_list(raw_recs, action_obj, drop_details, rec_limit):
        beneficial = [r for r in raw_recs if r["impact"]["expected_win_delta"] > 0]
        has_pos = len(beneficial) > 0
        out = []
        if has_pos:
            source_slice = beneficial[:rec_limit]
            for i, rec in enumerate(source_slice):
                copy_rec = dict(rec)
                copy_rec["action"] = action_obj
                if drop_details is None and not copy_rec.get("vs_drop"):
                    copy_rec["drop_player"] = None
                copy_rec["rank"] = i + 1
                copy_rec["is_beneficial"] = True
                copy_rec["is_negative"] = False
                out.append(copy_rec)
        else:
            source_slice = raw_recs[:rec_limit]
            for rec in source_slice:
                copy_rec = dict(rec)
                copy_rec["action"] = action_obj
                if drop_details is None and not copy_rec.get("vs_drop"):
                    copy_rec["drop_player"] = None
                copy_rec["rank"] = None
                copy_rec["is_beneficial"] = False
                copy_rec["is_negative"] = True
                out.append(copy_rec)
        return out, has_pos

    # Auto-recommendation priority:
    # 1. Open roster spot
    # 2. Eligible positive EV non-MUST_HOLD move (including MOVE_TO_IR of OUT players)
    # 3. Otherwise HOLD (never auto-recommend dropping a top-75 ROS stud for a weekly stream!)
    ir_move_evals = [
        e for e in candidate_evals
        if e["max_delta_e"] > 0 and open_il_slots > 0 and e["status"] in _OUT_TAGS
    ]
    safe_positive_evals = [
        e for e in candidate_evals
        if e["max_delta_e"] > 0 and e["hold_tier"] != "MUST_HOLD"
    ]
    any_positive_evals = [e for e in candidate_evals if e["max_delta_e"] > 0]

    best_eval = max(
        candidate_evals,
        key=lambda e: (e["max_delta_e"], -e["starts"], -e["z"])
    ) if candidate_evals else None

    open_slot_result = evaluate_candidate_for_drop(None) if open_roster_spots > 0 else None

    if open_roster_spots > 0:
        system_suggested_action = {
            "type": "OPEN_SLOT",
            "target_player": None,
            "drop_starts": 0,
            "open_roster_spots": open_roster_spots,
            "open_il_slots": open_il_slots,
            "fa_benchmark_z": round(fa_benchmark_z, 2),
            "reason": (
                f"You have {open_roster_spots} open roster spot{'s' if open_roster_spots != 1 else ''} "
                f"({len(t1_players)}/{standard_capacity} active/bench filled) — pick up a Free Agent directly without dropping or benching anyone."
            ),
        }
        system_suggested_target_name = None
        system_hold_recommended = False
        auto_eval = None
    elif ir_move_evals:
        auto_eval = max(ir_move_evals, key=lambda e: (e["max_delta_e"], -e["starts"], -e["z"]))
        system_suggested_action = _build_action_for_eval(auto_eval)
        system_suggested_target_name = auto_eval["player"].get("name")
        system_hold_recommended = False
    elif safe_positive_evals:
        # Prefer STREAMABLE over CORE_HOLD if both are clearly beneficial, otherwise pick highest ΔE
        auto_eval = max(
            safe_positive_evals,
            key=lambda e: (
                e["max_delta_e"] - (0.04 if e["hold_tier"] == "CORE_HOLD" else 0.0),
                -e["starts"],
                -e["z"],
            ),
        )
        system_suggested_action = _build_action_for_eval(auto_eval)
        system_suggested_target_name = auto_eval["player"].get("name")
        system_hold_recommended = False
    elif any_positive_evals:
        auto_eval = max(any_positive_evals, key=lambda e: (e["max_delta_e"], -e["starts"], -e["z"]))
        system_suggested_action = {
            "type": "HOLD",
            "target_player": None,
            "open_roster_spots": open_roster_spots,
            "open_il_slots": open_il_slots,
            "fa_benchmark_z": round(fa_benchmark_z, 2),
            "reason": (
                "Hold recommended: Positive short-term streams would require dropping a core ROS player "
                f"(e.g. {auto_eval['player'].get('name')}). Click any roster card above if you want to stream anyway."
            ),
        }
        system_suggested_target_name = None
        system_hold_recommended = True
    else:
        auto_eval = best_eval
        system_suggested_action = {
            "type": "HOLD",
            "target_player": None,
            "open_roster_spots": open_roster_spots,
            "open_il_slots": open_il_slots,
            "fa_benchmark_z": round(fa_benchmark_z, 2),
            "reason": (
                "Hold recommended: Dropping any player on your roster for available waiver options "
                "results in a net expected category loss (all available streamers have ΔE ≤ 0)."
            ),
        }
        system_suggested_target_name = None
        system_hold_recommended = True

    # Build instant-switch bundles for every candidate & open slot
    per_target_limit = max(int(limit or 15), 15)
    recommendations_by_target = {}

    if open_slot_result is not None:
        os_recs, _, _ = open_slot_result
        os_action = {
            "type": "OPEN_SLOT",
            "target_player": None,
            "drop_starts": 0,
            "open_roster_spots": open_roster_spots,
            "open_il_slots": open_il_slots,
            "fa_benchmark_z": round(fa_benchmark_z, 2),
            "reason": (
                f"Open Roster / IR Spot mode — evaluating Free Agents for "
                f"{'today only' if pickup_mode == 'today' else 'the rest of the week'} with no player dropped or benched."
            ),
        }
        os_final, os_has_pos = _finalize_rec_list(os_recs, os_action, None, per_target_limit)
        recommendations_by_target["__OPEN_SLOT__"] = {
            "roster_action": os_action,
            "drop_player": None,
            "has_beneficial_streamers": os_has_pos,
            "hold_recommended": not os_has_pos,
            "hold_reason": None if os_has_pos else "No free agents with positive category impact left in this window.",
            "recommendations": os_final,
        }

    for ev in candidate_evals:
        p_name = ev["player"].get("name")
        c_action = _build_action_for_eval(ev)
        c_final, c_has_pos = _finalize_rec_list(ev["recs"], c_action, ev["details"], per_target_limit)
        c_hold = (not c_has_pos)
        c_hold_reason = (
            f"Hold recommended: Replacing {p_name} with any available waiver option results in a net expected category loss (ΔE ≤ 0)."
            if c_hold else None
        )
        recommendations_by_target[p_name] = {
            "roster_action": c_action,
            "drop_player": ev["details"],
            "has_beneficial_streamers": c_has_pos,
            "hold_recommended": c_hold,
            "hold_reason": c_hold_reason,
            "recommendations": c_final,
        }

    # Resolve primary response payload for req_target
    req_target = str(target_drop_player or "").strip()
    if req_target in ("__OPEN_SLOT__", "NONE") and open_roster_spots > 0 and "__OPEN_SLOT__" in recommendations_by_target:
        selected_bundle = recommendations_by_target["__OPEN_SLOT__"]
        hold_recommended = selected_bundle["hold_recommended"]
        hold_reason = selected_bundle["hold_reason"]
        roster_action = selected_bundle["roster_action"]
        drop_player_details = None
        has_beneficial = selected_bundle["has_beneficial_streamers"]
        final_recs = selected_bundle["recommendations"][:per_target_limit]
    elif req_target and req_target not in ("__AUTO__", "__HOLD__") and req_target in recommendations_by_target:
        selected_bundle = recommendations_by_target[req_target]
        hold_recommended = selected_bundle["hold_recommended"]
        hold_reason = selected_bundle["hold_reason"]
        roster_action = selected_bundle["roster_action"]
        drop_player_details = selected_bundle["drop_player"]
        has_beneficial = selected_bundle["has_beneficial_streamers"]
        final_recs = selected_bundle["recommendations"][:per_target_limit]
    else:
        if open_roster_spots > 0 and "__OPEN_SLOT__" in recommendations_by_target:
            selected_bundle = recommendations_by_target["__OPEN_SLOT__"]
            raw_r, _, drop_player_details = open_slot_result
        elif auto_eval is not None:
            raw_r = auto_eval["recs"]
            drop_player_details = auto_eval["details"]
        else:
            raw_r = []
            drop_player_details = None
        roster_action = system_suggested_action
        final_recs, has_beneficial = _finalize_rec_list(raw_r, roster_action, drop_player_details, per_target_limit)
        hold_recommended = system_hold_recommended or not has_beneficial
        if hold_recommended:
            hold_reason = system_suggested_action["reason"] if system_hold_recommended else (
                f"Hold recommended: Replacing {drop_player_details.get('name') if drop_player_details else 'your current option'} results in a net expected category loss (ΔE ≤ 0)."
            )
        else:
            hold_reason = None

    # Build roster_candidates list for frontend player selector
    roster_candidates = []
    for ev in candidate_evals:
        p = ev["player"]
        p_name = p.get("name")
        s_week = get_player_starts(p_name, week_date_strings)
        s_today = get_player_starts(p_name, [today_str])
        s_win = s_today if pickup_mode == "today" else s_week
        is_tagged = ev["status"] in _OUT_TAGS or ev["status"] in _Q_TAGS
        p_max_de = cand_max_de_map.get(p_name, -999.0)
        roster_candidates.append({
            "name": p_name,
            "nba_team": p.get("nba_team"),
            "positions": p.get("positions"),
            "selected_position": p.get("selected_position"),
            "status": p.get("status") or None,
            "is_tagged": is_tagged,
            "z_total": round(ev["z"], 2),
            "ros_rank": ev["ros_rank"],
            "ros_z": round(float(ev["ros_z"]), 2) if ev.get("ros_z") is not None else None,
            "hold_tier": ev["hold_tier"],
            "starts_week": s_week,
            "starts_today": s_today,
            "starts_in_window": s_win,
            "max_delta_e": round(float(p_max_de), 3) if p_max_de != -999.0 else None,
            "is_suggested": bool(system_suggested_target_name and p_name == system_suggested_target_name),
        })

    roster_candidates.sort(
        key=lambda c: (
            0 if (c.get("max_delta_e") is not None and c["max_delta_e"] > 0 and c.get("hold_tier") != "MUST_HOLD") else (1 if (c.get("max_delta_e") is not None and c["max_delta_e"] > 0) else 2),
            -(c["max_delta_e"] if c.get("max_delta_e") is not None else -999.0),
            c["starts_in_window"],
            c["z_total"],
        )
    )

    return {
        "pickup_mode": pickup_mode,
        "punted_cats": sorted(punted_set),
        "has_beneficial_streamers": has_beneficial,
        "hold_recommended": hold_recommended,
        "hold_reason": hold_reason,
        "matchup_diagnostics": {
            "current_score": (
                baseline.get("accumulated_stats", {}).get("live_score")
                or baseline.get("accumulated_stats", {}).get("current_score", {})
            ),
            "categories": category_diagnostics,
        },
        "suggested_action": system_suggested_action,
        "roster_action": roster_action,
        "drop_player": drop_player_details if not (hold_recommended and (not req_target or req_target in ("__AUTO__", "__HOLD__"))) else None,
        "roster_candidates": roster_candidates,
        "open_roster_spots": open_roster_spots,
        "open_il_slots": open_il_slots,
        "recommendations": final_recs,
        "recommendations_by_target": recommendations_by_target,
    }


def get_top_free_agents(
    yahoo_query,
    player_stats_by_source,
    all_rostered_names=None,
    stats_source="ros_rankings",
    limit=20,
):
    """
    Returns top available (unrostered) NBA free agents formatted with the same stats shape
    as rostered Players so Trade Engine can model realistic waiver replacements.
    """
    rostered_set = set(all_rostered_names or [])
    rostered_clean = {clean_player_name(n).lower() for n in rostered_set if n}

    fa_info_map = _get_yahoo_fa_info_map(yahoo_query) if yahoo_query else {}
    resolve_pos = _build_position_resolver(yahoo_query=yahoo_query, fa_info_map=fa_info_map, teams=None)

    pool_map = {
        "ros": player_stats_by_source.get("ros_rankings", {}) or {},
        "ros_rankings": player_stats_by_source.get("ros_rankings", {}) or {},
        "ema": player_stats_by_source.get("ema", {}) or {},
        "weekly": player_stats_by_source.get("weekly_rankings", {}) or {},
        "weekly_rankings": player_stats_by_source.get("weekly_rankings", {}) or {},
        "weekly_stats": player_stats_by_source.get("weekly_rankings", {}) or {},
    }
    primary = pool_map.get(stats_source) or pool_map["ros"] or pool_map["ema"]

    candidates = []
    for p_name, p_stats in primary.items():
        clean_n = clean_player_name(p_name)
        if p_name in rostered_set or clean_n.lower() in rostered_clean:
            continue
        if (p_stats.get("games_played") or 0) < 3:
            continue
        if (p_stats.get("mu_min") or 0) < 13.0:
            continue

        fa_entry = (
            fa_info_map.get(clean_n)
            or fa_info_map.get(p_name)
            or fa_info_map.get(clean_n.lower())
            or fa_info_map.get(p_name.lower())
            or {}
        )
        y_status = str(fa_entry.get("status", "") if isinstance(fa_entry, dict) else "").upper().strip()
        db_status = str(p_stats.get("status") or p_stats.get("injury_status") or "").upper().strip()
        if y_status in _OUT_TAGS or db_status in _OUT_TAGS:
            continue

        z_val = p_stats.get("z_total")
        z_num = float(z_val) if z_val is not None else -99.0
        candidates.append((z_num, p_name, clean_n, p_stats, y_status or db_status or None))

    candidates.sort(key=lambda x: x[0], reverse=True)
    out = []
    for z_num, p_name, clean_n, _, status in candidates[:limit]:
        ros_d = dict(pool_map["ros"].get(p_name) or pool_map["ros"].get(clean_n) or {})
        ema_d = dict(pool_map["ema"].get(p_name) or pool_map["ema"].get(clean_n) or {})
        wk_d = dict(pool_map["weekly"].get(p_name) or pool_map["weekly"].get(clean_n) or {})
        pos_str = resolve_pos(p_name, ros_d or ema_d, allow_yahoo_lookup=False)
        raw_team = (ros_d or ema_d or wk_d).get("team")
        rank_val, _ = _extract_rank_and_z(ros_d or ema_d or wk_d)
        out.append({
            "name": clean_n or p_name,
            "nba_team": normalize_nba_team(raw_team),
            "positions": pos_str,
            "selected_position": "FA",
            "status": status,
            "rank": rank_val,
            "z_total": round(float(z_num), 4) if z_num > -99.0 else None,
            "ros_stats": ros_d,
            "ema_stats": ema_d,
            "weekly_stats": wk_d,
        })
    return out


def _sanitize_stats_dict(d):
    if not isinstance(d, dict):
        return {}
    cleaned = {}
    for k, v in d.items():
        if isinstance(v, float) and not math.isfinite(v):
            cleaned[k] = None
        else:
            cleaned[k] = v
    return cleaned


def _lookup_player_dict(pool_dict, clean_n, lower_index):
    if not pool_dict:
        return {}
    if clean_n in pool_dict:
        return _sanitize_stats_dict(pool_dict[clean_n])
    orig_k = lower_index.get(clean_n.lower())
    if orig_k and orig_k in pool_dict:
        return _sanitize_stats_dict(pool_dict[orig_k])
    return {}


def get_draft_pool(player_stats_by_source, limit=350):
    """
    Returns a standalone NBA draft pool straight from Databricks ranking tables
    (preseason_rankings, ros_rankings, ema) without requiring a Yahoo Fantasy league link.
    """
    stats_src = player_stats_by_source or {}
    preseason_pool = stats_src.get("preseason_rankings") or {}
    ros_pool = stats_src.get("ros_rankings") or {}
    ema_pool = stats_src.get("ema") or {}

    def _build_lower_idx(pool):
        idx = {}
        for raw_name in pool.keys():
            if not raw_name:
                continue
            cn = clean_player_name(raw_name) or raw_name
            idx.setdefault(cn.lower(), raw_name)
        return idx

    pre_idx = _build_lower_idx(preseason_pool)
    ros_idx = _build_lower_idx(ros_pool)
    ema_idx = _build_lower_idx(ema_pool)

    canonical_names = {}
    for pool in (preseason_pool, ros_pool, ema_pool):
        for raw_name in pool.keys():
            if not raw_name:
                continue
            cn = clean_player_name(raw_name) or raw_name
            canonical_names.setdefault(cn.lower(), cn)

    sources_available = []
    if len(preseason_pool) > 0:
        sources_available.append("preseason")
    if len(ros_pool) > 0:
        sources_available.append("ros")
    if len(ema_pool) > 0:
        sources_available.append("ema")

    if len(preseason_pool) >= 20:
        default_source = "preseason"
    elif len(ros_pool) >= 20:
        default_source = "ros"
    elif "ema" in sources_available:
        default_source = "ema"
    else:
        default_source = sources_available[0] if sources_available else "preseason"

    resolve_pos = _build_position_resolver(yahoo_query=None, fa_info_map=None, teams=None)

    candidates = []
    for lower_key, display_name in canonical_names.items():
        pre_d = _lookup_player_dict(preseason_pool, display_name, pre_idx)
        ros_d = _lookup_player_dict(ros_pool, display_name, ros_idx)
        ema_d = _lookup_player_dict(ema_pool, display_name, ema_idx)

        primary_d = (
            pre_d if (default_source == "preseason" and pre_d)
            else ros_d if (default_source == "ros" and ros_d)
            else ema_d or pre_d or ros_d
        )
        if not primary_d:
            continue

        has_signal = any(
            (d.get("z_total") is not None or d.get("mu_pts") is not None)
            for d in (pre_d, ros_d, ema_d) if d
        )
        if not has_signal:
            continue

        # Skip ultra-fringe non-rotation entries with negligible minutes and no projection rank
        best_min = max(
            float((d or {}).get("mu_min") or 0.0)
            for d in (pre_d, ros_d, ema_d)
        )
        _, z_pre = _extract_rank_and_z(pre_d)
        _, z_ros = _extract_rank_and_z(ros_d)
        _, z_ema = _extract_rank_and_z(ema_d)
        sort_z = (
            z_pre if (default_source == "preseason" and z_pre is not None)
            else z_ros if (default_source == "ros" and z_ros is not None)
            else z_ema if (default_source == "ema" and z_ema is not None)
            else (z_pre if z_pre is not None else z_ros if z_ros is not None else z_ema)
        )
        if best_min < 8.0 and sort_z is None:
            continue

        ref_d = pre_d or ros_d or ema_d
        pos_str = resolve_pos(display_name, ref_d, allow_yahoo_lookup=False)
        raw_team = (
            (pre_d or {}).get("team")
            or (ros_d or {}).get("team")
            or (ema_d or {}).get("team")
        )
        raw_status = (
            (pre_d or {}).get("status")
            or (pre_d or {}).get("injury_status")
            or (ros_d or {}).get("status")
            or (ros_d or {}).get("injury_status")
            or (ema_d or {}).get("status")
            or (ema_d or {}).get("injury_status")
            or None
        )
        rank_val, _ = _extract_rank_and_z(primary_d)

        candidates.append((
            float(sort_z) if sort_z is not None else -99.0,
            {
                "name": display_name,
                "nba_team": normalize_nba_team(raw_team),
                "positions": pos_str,
                "status": raw_status,
                "rank": rank_val,
                "z_total": round(float(sort_z), 4) if sort_z is not None else None,
                "preseason_stats": pre_d,
                "ros_stats": ros_d,
                "ema_stats": ema_d,
            },
        ))

    candidates.sort(key=lambda x: x[0], reverse=True)
    players = [item[1] for item in candidates[:max(1, int(limit or 350))]]

    return {
        "players": players,
        "sources_available": sources_available,
        "default_source": default_source,
        "total_in_db": len(candidates),
    }
