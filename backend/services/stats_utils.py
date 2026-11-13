import datetime
import math

import numpy as np

from backend.utils import clean_player_name

_DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y %H:%M:%S", "%m/%d/%Y", "%Y-%m-%d %H:%M:%S")


def parse_iso_date(value):
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Invalid date value: {value!r}")

    text = value.strip()
    try:
        return datetime.date.fromisoformat(text)
    except ValueError:
        pass
    try:
        return datetime.datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    for fmt in _DATE_FORMATS:
        try:
            return datetime.datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unrecognized date format: {value!r}")


def iter_dates(start_date, end_date):
    current = start_date
    while current <= end_date:
        yield current
        current += datetime.timedelta(days=1)

OUT_TAGS = frozenset({"O", "INJ", "OUT", "IL", "INJURED", "SUSP", "NA", "IR"})
Q_TAGS = frozenset({"Q", "GTD", "DTD", "DOUBTFUL"})
IR_SLOTS = frozenset({"IL", "IL+", "IR", "IR+", "NA"})

CAT_ALIASES = {
    "PTS": "pts",
    "REB": "reb",
    "AST": "ast",
    "STL": "stl",
    "BLK": "blk",
    "TO": "tov",
    "TOV": "tov",
    "3PM": "fg3m",
    "FG3M": "fg3m",
    "FG%": "fg%",
    "FG": "fg%",
    "FT%": "ft%",
    "FT": "ft%",
}

CAT_DB_Z_KEYS = {
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

VEC_MU_KEYS = ("pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fgm", "fga", "ftm", "fta")

_SQRT2 = math.sqrt(2.0)


def prob_positive(mu, var):
    # Pure-math equivalent to scipy.stats.norm.sf(0, loc=mu, scale=sqrt(var)) without wrapper overhead.
    if var is None or not var > 0:
        return 1.0 if mu > 0 else (0.0 if mu < 0 else 0.5)
    return 0.5 * math.erfc(-mu / (math.sqrt(var) * _SQRT2))


def normalize_nba_team(abbr):
    if not abbr:
        return ""
    cleaned = str(abbr).upper().strip()
    return NBA_TEAM_ALIASES.get(cleaned, cleaned)


def parse_yahoo_stat_value(value):
    if value is None or not str(value).strip() or str(value).strip() == "-":
        return 0.0
    return float(value)


def canonical_cat(cat_key):
    if not cat_key:
        return ""
    key = str(cat_key).upper().strip()
    return CAT_ALIASES.get(key, key.lower())


def get_safe_player_stats(player_info, stats_source):
    if not player_info:
        player_info = {}
    ema_fallback = player_info.get("ema_stats", {}) or {}
    stats = player_info.get(stats_source, {}) or {}
    defaults = {"rank": 999, "proj_games_played": None}
    for stat in ("pts", "reb", "ast", "stl", "blk", "tov", "fg3m"):
        defaults[f"mu_{stat}"] = 0.0
        defaults[f"var_{stat}"] = 0.0
    for stat in ("fg", "ft"):
        defaults[f"mu_{stat}a"] = 0.0
        defaults[f"var_{stat}a"] = 0.0
        defaults[f"mu_{stat}m"] = 0.0
        defaults[f"var_{stat}m"] = 0.0

    return {
        **defaults,
        **{k: v for k, v in ema_fallback.items() if v is not None},
        **{k: v for k, v in stats.items() if v is not None},
    }


def stats_to_vec(p_stats_dict):
    vec = np.zeros(22, dtype=np.float64)
    if not p_stats_dict:
        return vec
    for idx, key in enumerate(VEC_MU_KEYS):
        vec[idx] = float(p_stats_dict.get(f"mu_{key}") or 0.0)
        vec[11 + idx] = max(0.0, float(p_stats_dict.get(f"var_{key}") or 0.0))
    return vec


def compute_player_rank_score(player_obj, player_stats, stats_source):
    raw_rank = player_stats.get("rank", 999) if player_stats else 999
    if raw_rank is not None:
        try:
            rank_val = float(raw_rank)
            if rank_val < 999:
                return max(1.0, 1000.0 - rank_val)
        except (ValueError, TypeError):
            pass

    z_val = None
    if player_stats and player_stats.get("z_total") is not None:
        z_val = player_stats.get("z_total")
    elif isinstance(player_obj, dict):
        src_dict = player_obj.get(stats_source, {}) or {}
        if src_dict.get("z_total") is not None:
            z_val = src_dict.get("z_total")
        elif player_obj.get("z_total") is not None:
            z_val = player_obj.get("z_total")
        else:
            z_val = (player_obj.get("ema_stats", {}) or {}).get("z_total")
    return max(1.0, 500.0 + (float(z_val) * 25.0 if z_val is not None else 0.0))


def weighted_cat_delta(p_base, p_after, status):
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


def extract_rank_and_z(stats_dict):
    if not isinstance(stats_dict, dict):
        return None, None
    r_val = None
    for key in ("rank", "ros_rank", "weekly_rank", "preseason_rank"):
        raw = stats_dict.get(key)
        if raw is not None:
            try:
                candidate = int(float(raw))
                if 0 < candidate < 999:
                    r_val = candidate
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


def resolve_player_ros(p_name, player_obj=None, ros_stats_pool=None, fallback_stats=None):
    ros_dict = None
    if isinstance(player_obj, dict):
        candidate = player_obj.get("ros_stats")
        if isinstance(candidate, dict) and (candidate.get("z_total") is not None or candidate.get("rank") is not None):
            ros_dict = candidate
    if ros_dict is None and ros_stats_pool and p_name:
        cleaned = clean_player_name(p_name)
        ros_dict = (
            ros_stats_pool.get(p_name)
            or ros_stats_pool.get(cleaned)
            or ros_stats_pool.get(p_name.lower())
            or ros_stats_pool.get(cleaned.lower())
        )

    r_val, z_val = extract_rank_and_z(ros_dict)
    if r_val is None and fallback_stats:
        _, fb_z = extract_rank_and_z(fallback_stats)
        if z_val is None:
            z_val = fb_z
        tier = (
            "MUST_HOLD" if (z_val is not None and z_val >= 2.0)
            else "CORE_HOLD" if (z_val is not None and z_val >= 0.6)
            else "STREAMABLE"
        )
        return r_val, z_val, tier

    if (r_val is not None and r_val <= 75) or (z_val is not None and z_val >= 2.0):
        hold_tier = "MUST_HOLD"
    elif (r_val is not None and r_val <= 115) or (z_val is not None and z_val >= 0.6):
        hold_tier = "CORE_HOLD"
    else:
        hold_tier = "STREAMABLE"
    return r_val, z_val, hold_tier


def sanitize_stats_dict(d):
    if not isinstance(d, dict):
        return {}
    return {
        k: (None if isinstance(v, float) and not math.isfinite(v) else v)
        for k, v in d.items()
    }


def build_inactive_players(team1, team2, player_games):
    inactive_players = {"team1": [], "team2": []}
    for team_key, team in (("team1", team1), ("team2", team2)):
        for player in team.get("players", []):
            p_name = player.get("name")
            status = player.get("status")
            selected_pos = str(player.get("selected_position") or "").upper().strip()
            is_ir = selected_pos in IR_SLOTS
            is_injured = (status is not None and status != "") or is_ir
            sched_games = player_games.get(team_key, {}).get(p_name, {}).get("total", 0)
            if is_injured or sched_games == 0:
                display_status = (
                    f"{status} ({selected_pos})"
                    if (status and is_ir and status != selected_pos)
                    else (status or (selected_pos if is_ir else None))
                )
                inactive_players[team_key].append({
                    "name": p_name,
                    "status": display_status,
                    "proj_games_played": 0 if (is_ir or status in {"O", "INJ", "IL", "OUT"}) else sched_games,
                })
    return inactive_players
