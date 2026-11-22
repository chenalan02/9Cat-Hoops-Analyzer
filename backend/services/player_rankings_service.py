from typing import Any

import numpy as np

from backend.services import yahoo_client
from backend.services.stats_utils import extract_rank_and_z, normalize_nba_team, sanitize_stats_dict
from backend.utils import clean_player_name

_SPLITS_WINDOWS = (
    ("season", None),
    ("last_15", 15),
    ("last_7", 7),
    ("last_3", 3),
)


def _build_lower_index(pool: dict[str, Any]) -> dict[str, str]:
    idx: dict[str, str] = {}
    for raw_name in pool.keys():
        if not raw_name:
            continue
        cleaned = clean_player_name(raw_name) or raw_name
        idx.setdefault(cleaned.lower(), raw_name)
    return idx


def _lookup_player_dict(
    pool_dict: dict[str, Any],
    clean_name: str,
    lower_index: dict[str, str],
) -> dict[str, Any]:
    if not pool_dict:
        return {}
    if clean_name in pool_dict:
        return sanitize_stats_dict(pool_dict[clean_name])
    orig_key = lower_index.get(clean_name.lower())
    if orig_key and orig_key in pool_dict:
        return sanitize_stats_dict(pool_dict[orig_key])
    return {}


def _resolve_player_logs(
    game_logs: dict[str, list[dict[str, Any]]] | None,
    player_name: str,
    logs_lower_index: dict[str, str] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    cleaned = clean_player_name(player_name) or str(player_name or "").strip()
    if not game_logs or not cleaned:
        return cleaned, []

    if player_name in game_logs:
        return str(player_name), game_logs[player_name]
    if cleaned in game_logs:
        return cleaned, game_logs[cleaned]

    target_lower = cleaned.lower()
    if logs_lower_index and target_lower in logs_lower_index:
        matched = logs_lower_index[target_lower]
        return matched, game_logs.get(matched, [])

    raw_lower = str(player_name or "").strip().lower()
    for key, rows in game_logs.items():
        k_clean = (clean_player_name(key) or key).lower()
        if k_clean == target_lower or str(key).lower() == raw_lower:
            return key, rows

    return cleaned, []


def _dd_td_flags(row: dict[str, Any]) -> tuple[bool, bool]:
    tens = sum(
        1
        for key in ("pts", "reb", "ast", "stl", "blk")
        if (row.get(key) or 0) >= 10
    )
    return tens >= 2, tens >= 3


def _compute_split_summary(logs_slice: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not logs_slice:
        return None

    gp = len(logs_slice)
    sums = {
        key: sum(int(row.get(key) or 0) for row in logs_slice)
        for key in ("min", "pts", "reb", "ast", "stl", "blk", "fg3m", "fg3a", "fgm", "fga", "ftm", "fta", "tov")
    }
    pm_vals = [int(row["plus_minus"]) for row in logs_slice if row.get("plus_minus") is not None]

    total_fgm = sums["fgm"]
    total_fga = sums["fga"]
    total_ftm = sums["ftm"]
    total_fta = sums["fta"]
    total_fg3m = sums["fg3m"]
    total_fg3a = sums["fg3a"]

    return {
        "gp": gp,
        "min": round(sums["min"] / gp, 1),
        "pts": round(sums["pts"] / gp, 1),
        "reb": round(sums["reb"] / gp, 1),
        "ast": round(sums["ast"] / gp, 1),
        "stl": round(sums["stl"] / gp, 1),
        "blk": round(sums["blk"] / gp, 1),
        "fg3m": round(total_fg3m / gp, 1),
        "tov": round(sums["tov"] / gp, 1),
        "fgm": round(total_fgm / gp, 1),
        "fga": round(total_fga / gp, 1),
        "ftm": round(total_ftm / gp, 1),
        "fta": round(total_fta / gp, 1),
        "fg_pct": round(total_fgm / total_fga, 4) if total_fga > 0 else None,
        "ft_pct": round(total_ftm / total_fta, 4) if total_fta > 0 else None,
        "fg3_pct": round(total_fg3m / total_fg3a, 4) if total_fg3a > 0 else None,
        "plus_minus": round(sum(pm_vals) / len(pm_vals), 1) if pm_vals else None,
        "total_fgm": total_fgm,
        "total_fga": total_fga,
        "total_ftm": total_ftm,
        "total_fta": total_fta,
    }


def _compute_consistency(logs: list[dict[str, Any]]) -> dict[str, Any]:
    if not logs:
        return {}

    pts_list = [int(row.get("pts") or 0) for row in logs]
    min_list = [int(row.get("min") or 0) for row in logs]

    dd_count = 0
    td_count = 0
    games_30_plus = 0
    wins = 0
    losses = 0
    home_pts: list[int] = []
    away_pts: list[int] = []

    for row in logs:
        is_dd, is_td = _dd_td_flags(row)
        if is_dd:
            dd_count += 1
        if is_td:
            td_count += 1
        if int(row.get("min") or 0) >= 30:
            games_30_plus += 1
        wl = str(row.get("wl") or "").upper().strip()
        if wl == "W":
            wins += 1
        elif wl == "L":
            losses += 1
        if row.get("is_home") is True:
            home_pts.append(int(row.get("pts") or 0))
        elif row.get("is_home") is False:
            away_pts.append(int(row.get("pts") or 0))

    gp = len(logs)
    pts_std = round(float(np.std(pts_list, ddof=1)), 1) if gp >= 2 else 0.0
    min_std = round(float(np.std(min_list, ddof=1)), 1) if gp >= 2 else 0.0

    return {
        "pts_std": pts_std,
        "min_std": min_std,
        "pts_high": max(pts_list),
        "pts_low": min(pts_list),
        "min_high": max(min_list),
        "min_low": min(min_list),
        "double_doubles": dd_count,
        "triple_doubles": td_count,
        "games_30_plus_min": games_30_plus,
        "games_30_plus_min_pct": round(games_30_plus / gp, 3),
        "wins": wins,
        "losses": losses,
        "home_gp": len(home_pts),
        "away_gp": len(away_pts),
        "home_pts": round(sum(home_pts) / len(home_pts), 1) if home_pts else None,
        "away_pts": round(sum(away_pts) / len(away_pts), 1) if away_pts else None,
    }


def _build_recent_form(logs: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not logs:
        return None

    gp = len(logs)
    season_min = round(sum(int(r.get("min") or 0) for r in logs) / gp, 1)
    season_pts = round(sum(int(r.get("pts") or 0) for r in logs) / gp, 1)
    l5 = logs[:5]
    l5_min = round(sum(int(r.get("min") or 0) for r in l5) / len(l5), 1)
    l5_pts = round(sum(int(r.get("pts") or 0) for r in l5) / len(l5), 1)

    return {
        "games_logged": gp,
        "last_game_date": logs[0].get("game_date") or None,
        "season_min": season_min,
        "l5_min": l5_min,
        "min_trend": round(l5_min - season_min, 1),
        "season_pts": season_pts,
        "l5_pts": l5_pts,
        "pts_trend": round(l5_pts - season_pts, 1),
        "last_3_pts": [int(r.get("pts") or 0) for r in logs[:3]],
    }


def get_player_rankings(
    player_stats_by_source: dict[str, dict[str, Any]] | None,
    game_logs: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    stats_src = player_stats_by_source or {}
    ema_pool = stats_src.get("ema") or {}
    ros_pool = stats_src.get("ros_rankings") or {}
    weekly_pool = stats_src.get("weekly_rankings") or {}
    preseason_pool = stats_src.get("preseason_rankings") or {}

    ema_idx = _build_lower_index(ema_pool)
    ros_idx = _build_lower_index(ros_pool)
    weekly_idx = _build_lower_index(weekly_pool)
    pre_idx = _build_lower_index(preseason_pool)
    logs_map = game_logs or {}
    logs_idx = _build_lower_index(logs_map) if logs_map else {}

    canonical_names: dict[str, str] = {}
    for pool in (ema_pool, ros_pool, weekly_pool, preseason_pool):
        for raw_name in pool.keys():
            if not raw_name:
                continue
            cleaned = clean_player_name(raw_name) or raw_name
            canonical_names.setdefault(cleaned.lower(), cleaned)

    sources_available = []
    if ema_pool:
        sources_available.append("ema")
    if ros_pool:
        sources_available.append("ros")
    if weekly_pool:
        sources_available.append("weekly")
    if preseason_pool:
        sources_available.append("preseason")

    resolve_pos = yahoo_client.build_position_resolver(yahoo_query=None, fa_info_map=None, teams=None)

    latest_game_date: str | None = None
    season_id: str | None = None
    for rows in logs_map.values():
        if not rows:
            continue
        row_dt = rows[0].get("game_date")
        if row_dt and (latest_game_date is None or row_dt > latest_game_date):
            latest_game_date = row_dt
        if season_id is None and rows[0].get("season_id"):
            season_id = rows[0]["season_id"]

    candidates: list[tuple[float, str, dict[str, Any]]] = []
    for display_name in canonical_names.values():
        ema_d = _lookup_player_dict(ema_pool, display_name, ema_idx)
        ros_d = _lookup_player_dict(ros_pool, display_name, ros_idx)
        wk_d = _lookup_player_dict(weekly_pool, display_name, weekly_idx)
        pre_d = _lookup_player_dict(preseason_pool, display_name, pre_idx)

        has_signal = any(
            (d.get("z_total") is not None or d.get("mu_pts") is not None)
            for d in (ema_d, ros_d, wk_d, pre_d)
            if d
        )
        if not has_signal:
            continue

        _, z_ema = extract_rank_and_z(ema_d)
        _, z_ros = extract_rank_and_z(ros_d)
        _, z_wk = extract_rank_and_z(wk_d)
        _, z_pre = extract_rank_and_z(pre_d)
        sort_z = (
            z_ema if z_ema is not None
            else z_ros if z_ros is not None
            else z_pre if z_pre is not None
            else z_wk
        )

        _, player_logs = _resolve_player_logs(logs_map, display_name, logs_idx)
        recent_form = _build_recent_form(player_logs)

        ref_d = ema_d or ros_d or pre_d or wk_d
        pos_str = resolve_pos(display_name, ref_d, allow_yahoo_lookup=False)
        raw_team = (
            (ema_d or {}).get("team")
            or (ros_d or {}).get("team")
            or (wk_d or {}).get("team")
            or (pre_d or {}).get("team")
            or (player_logs[0].get("team") if player_logs else None)
        )
        raw_status = (
            (ema_d or {}).get("status")
            or (ema_d or {}).get("injury_status")
            or (ros_d or {}).get("status")
            or (ros_d or {}).get("injury_status")
            or (pre_d or {}).get("status")
            or (pre_d or {}).get("injury_status")
            or None
        )

        candidates.append((
            -(float(sort_z) if sort_z is not None else -99.0),
            display_name.lower(),
            {
                "name": display_name,
                "nba_team": normalize_nba_team(raw_team),
                "positions": pos_str,
                "status": raw_status,
                "z_total": round(float(sort_z), 4) if sort_z is not None else None,
                "ema_stats": ema_d,
                "ros_stats": ros_d,
                "weekly_stats": wk_d,
                "preseason_stats": pre_d,
                "recent_form": recent_form,
            },
        ))

    candidates.sort(key=lambda item: (item[0], item[1]))
    players = [item[2] for item in candidates]

    return {
        "players": players,
        "sources_available": sources_available,
        "total": len(players),
        "latest_game_date": latest_game_date,
        "season_id": season_id,
    }


def get_player_game_logs(
    game_logs: dict[str, list[dict[str, Any]]] | None,
    player_name: str,
) -> dict[str, Any]:
    canonical_name, logs = _resolve_player_logs(game_logs, player_name)
    if not logs:
        return {
            "player_name": canonical_name,
            "season_id": None,
            "total_games": 0,
            "logs": [],
            "splits": {},
            "consistency": {},
        }

    enriched_logs: list[dict[str, Any]] = []
    for row in logs:
        is_dd, is_td = _dd_td_flags(row)
        enriched_logs.append(
            {
                **row,
                "double_double": is_dd,
                "triple_double": is_td,
            }
        )

    splits: dict[str, Any] = {}
    for split_key, window_n in _SPLITS_WINDOWS:
        sliced = enriched_logs if window_n is None else enriched_logs[:window_n]
        summary = _compute_split_summary(sliced)
        if summary is not None:
            splits[split_key] = summary

    season_id = next((row.get("season_id") for row in enriched_logs if row.get("season_id")), None)
    return {
        "player_name": canonical_name,
        "season_id": season_id,
        "total_games": len(enriched_logs),
        "logs": enriched_logs,
        "splits": splits,
        "consistency": _compute_consistency(enriched_logs),
    }
