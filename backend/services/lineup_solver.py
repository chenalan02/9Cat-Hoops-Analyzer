import threading

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment

from backend.services.stats_utils import (
    IR_SLOTS,
    OUT_TAGS,
    compute_player_rank_score,
    get_safe_player_stats,
    normalize_nba_team,
)

# Reuse normalized schedule copy per Databricks DataFrame identity until daily refresh replaces it.
_SCHEDULE_CACHE = {"source": None, "prepared": None}
_SCHEDULE_LOCK = threading.Lock()


def get_prepared_schedule(nba_schedule):
    with _SCHEDULE_LOCK:
        if _SCHEDULE_CACHE["source"] is nba_schedule and _SCHEDULE_CACHE["prepared"] is not None:
            return _SCHEDULE_CACHE["prepared"]

    sched = nba_schedule.copy()
    if "scheduled_date" not in sched.columns and sched.index.name == "scheduled_date":
        sched = sched.reset_index()
    sched["scheduled_date"] = pd.to_datetime(sched["scheduled_date"]).dt.tz_localize(None).dt.floor("D")
    sched["team_normalized"] = sched["team"].map(normalize_nba_team)

    with _SCHEDULE_LOCK:
        _SCHEDULE_CACHE["source"] = nba_schedule
        _SCHEDULE_CACHE["prepared"] = sched
    return sched


def calculate_weekly_player_games(team1, team2, date_start, nba_schedule):
    date_start_dt = pd.to_datetime(date_start).tz_localize(None).floor("D")
    monday = (date_start_dt - pd.Timedelta(days=date_start_dt.weekday())).floor("D")
    next_monday = monday + pd.Timedelta(days=7)

    sched = get_prepared_schedule(nba_schedule)
    week_sched = sched[(sched["scheduled_date"] >= monday) & (sched["scheduled_date"] < next_monday)]
    team_total_games = week_sched.groupby("team_normalized")["scheduled_date"].count().to_dict()

    played_sched = week_sched[week_sched["scheduled_date"] < date_start_dt]
    team_played_games = played_sched.groupby("team_normalized")["scheduled_date"].count().to_dict()

    player_games = {"team1": {}, "team2": {}}
    for team_key, team in (("team1", team1), ("team2", team2)):
        for player in team.get("players", []):
            p_name = player.get("name")
            raw_nba_team = player.get("nba_team")
            nba_team_norm = normalize_nba_team(raw_nba_team)
            selected_pos = str(player.get("selected_position") or "").upper().strip()
            is_ir = selected_pos in IR_SLOTS

            raw_total = int(team_total_games.get(nba_team_norm, 0))
            raw_played = int(team_played_games.get(nba_team_norm, 0))

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
                "selected_position": player.get("selected_position"),
            }

    return player_games


def get_league_roster_slots(roster_positions):
    default_active = ["PG_1", "SG_1", "G_1", "SF_1", "PF_1", "F_1", "C_1", "C_2", "Util_1", "Util_2"]
    default_inactive = ["BN_1", "BN_2", "BN_3", "IL_1", "IL_2"]
    if not roster_positions:
        return default_active, default_inactive

    inactive_pos_names = {"BN", "IL", "IL+", "IR", "IR+", "NA"}
    active_slots = []
    inactive_slots = []
    for position in roster_positions:
        if isinstance(position, dict) and "roster_position" in position and isinstance(position["roster_position"], dict):
            position = position["roster_position"]

        if isinstance(position, dict):
            is_starting = position.get("is_starting_position")
            count = int(position.get("count", 0) or 0)
            pos_name = str(position.get("position", "") or "").strip()
        elif isinstance(position, (list, tuple)):
            if len(position) >= 4:
                pos_name = str(position[0] or "").strip()
                count = int(position[2] or 0)
                is_starting = position[3]
            elif len(position) == 3:
                pos_name = str(position[0] or "").strip()
                count = int(position[1] or 0)
                is_starting = position[2]
            else:
                continue
        else:
            is_starting = getattr(position, "is_starting_position", None)
            raw_count = getattr(position, "count", 0)
            count = int(raw_count or 0) if not callable(raw_count) else 0
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
            slot_label = f"{pos_name}_{i + 1}"
            if is_active:
                active_slots.append(slot_label)
            else:
                inactive_slots.append(slot_label)

    if not active_slots:
        active_slots = default_active

    return active_slots, inactive_slots


def parse_positions(raw_positions):
    if isinstance(raw_positions, str):
        return [p.strip().upper() for p in raw_positions.replace("/", ",").split(",") if p.strip()]
    if isinstance(raw_positions, (list, tuple, set)):
        return [str(p).strip().upper() for p in raw_positions if str(p).strip()]
    return []


def can_play_slot(pos_list, slot_name):
    slot_type = slot_name.split("_")[0].upper()
    if slot_type in ("UTIL", "BN"):
        return True
    if slot_type == "G":
        return any(pos in ("PG", "SG", "G") for pos in pos_list) or not pos_list
    if slot_type == "F":
        return any(pos in ("SF", "PF", "F") for pos in pos_list) or not pos_list
    return slot_type in pos_list or not pos_list


def can_play_active(pos_list, player_status, slot_name, selected_pos=""):
    if str(selected_pos or "").upper().strip() in IR_SLOTS:
        return False
    if str(player_status or "").upper().strip() in OUT_TAGS:
        return False
    return can_play_slot(pos_list, slot_name)


def solve_day_lineup_matrix(players_meta, active_slots):
    num_players = len(players_meta)
    num_slots = len(active_slots)
    if num_players == 0 or num_slots == 0:
        return []

    # Offset eligible costs below -50000 so Hungarian matching always prefers valid starters.
    cost_matrix = np.zeros((num_players, num_slots), dtype=np.float64)
    has_any = False
    for p_idx, p_info in enumerate(players_meta):
        weight = 100000.0 + float(p_info["rank_score"])
        for s_idx, eligible in enumerate(p_info["slot_mask"]):
            if eligible:
                cost_matrix[p_idx, s_idx] = -weight
                has_any = True

    if not has_any:
        return []

    row_ind, col_ind = linear_sum_assignment(cost_matrix)
    return [
        (active_slots[c], int(r))
        for r, c in zip(row_ind, col_ind)
        if cost_matrix[r, c] < -50000.0
    ]


def solve_optimal_lineup(team1, team2, date_start, roster_positions, stats_source, nba_schedule):
    team1_schedule = {}
    team2_schedule = {}

    date_start_dt = pd.to_datetime(date_start).tz_localize(None).floor("D")
    next_sunday = (date_start_dt + pd.Timedelta(days=(6 - date_start_dt.weekday()))).floor("D")

    sched = get_prepared_schedule(nba_schedule)
    window_sched = sched[(sched["scheduled_date"] >= date_start_dt) & (sched["scheduled_date"] <= next_sunday)]

    daily_games_by_date = {}
    for date_val, group in window_sched.groupby("scheduled_date"):
        daily_games_by_date[date_val.strftime("%Y-%m-%d")] = group.set_index("team_normalized").to_dict(orient="index")

    for date in pd.date_range(start=date_start_dt, end=next_sunday, freq="D"):
        date_str = date.strftime("%Y-%m-%d")
        games_info = daily_games_by_date.get(date_str, {})
        team1_schedule[date_str] = {}
        team2_schedule[date_str] = {}
        teams_set = set(games_info.keys())

        for player in team1.get("players", []):
            p_nba = normalize_nba_team(player.get("nba_team"))
            if p_nba in teams_set:
                team1_schedule[date_str][player["name"]] = games_info[p_nba]
        for player in team2.get("players", []):
            p_nba = normalize_nba_team(player.get("nba_team"))
            if p_nba in teams_set:
                team2_schedule[date_str][player["name"]] = games_info[p_nba]

    team_lineups = {"team1": {}, "team2": {}}
    active_slots, _ = get_league_roster_slots(roster_positions)

    for team_num, team in (("team1", team1), ("team2", team2)):
        players = team.get("players", [])
        player_meta = []
        for player in players:
            pos_list = parse_positions(player.get("positions"))
            player_stats = get_safe_player_stats(player, stats_source)
            status = player.get("status")
            selected_pos = player.get("selected_position")
            player_meta.append({
                "name": player["name"],
                "slot_mask": tuple(can_play_active(pos_list, status, slot, selected_pos) for slot in active_slots),
                "rank_score": compute_player_rank_score(player, player_stats, stats_source),
            })

        for date in pd.date_range(start=date_start_dt, end=next_sunday, freq="D"):
            date_str = date.strftime("%Y-%m-%d")
            team_lineups[team_num][date_str] = {}
            if not players or not active_slots:
                continue

            players_with_game = (
                team1_schedule[date_str].keys()
                if team_num == "team1"
                else team2_schedule[date_str].keys()
            )
            eligible_today = [m for m in player_meta if m["name"] in players_with_game]
            for slot_name, p_idx in solve_day_lineup_matrix(eligible_today, active_slots):
                team_lineups[team_num][date_str][slot_name] = eligible_today[p_idx]["name"]

    return team_lineups, {"team1": team1_schedule, "team2": team2_schedule}
