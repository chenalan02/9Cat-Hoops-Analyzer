from backend.services import yahoo_client
from backend.services.stats_utils import extract_rank_and_z, normalize_nba_team, sanitize_stats_dict
from backend.utils import clean_player_name


def _build_lower_index(pool):
    idx = {}
    for raw_name in pool.keys():
        if not raw_name:
            continue
        cleaned = clean_player_name(raw_name) or raw_name
        idx.setdefault(cleaned.lower(), raw_name)
    return idx


def _lookup_player_dict(pool_dict, clean_n, lower_index):
    if not pool_dict:
        return {}
    if clean_n in pool_dict:
        return sanitize_stats_dict(pool_dict[clean_n])
    orig_key = lower_index.get(clean_n.lower())
    if orig_key and orig_key in pool_dict:
        return sanitize_stats_dict(pool_dict[orig_key])
    return {}


def get_draft_pool(player_stats_by_source, limit=350):
    stats_src = player_stats_by_source or {}
    preseason_pool = stats_src.get("preseason_rankings") or {}
    ros_pool = stats_src.get("ros_rankings") or {}
    ema_pool = stats_src.get("ema") or {}

    pre_idx = _build_lower_index(preseason_pool)
    ros_idx = _build_lower_index(ros_pool)
    ema_idx = _build_lower_index(ema_pool)

    canonical_names = {}
    for pool in (preseason_pool, ros_pool, ema_pool):
        for raw_name in pool.keys():
            if not raw_name:
                continue
            cleaned = clean_player_name(raw_name) or raw_name
            canonical_names.setdefault(cleaned.lower(), cleaned)

    sources_available = []
    if preseason_pool:
        sources_available.append("preseason")
    if ros_pool:
        sources_available.append("ros")
    if ema_pool:
        sources_available.append("ema")

    if len(preseason_pool) >= 20:
        default_source = "preseason"
    elif len(ros_pool) >= 20:
        default_source = "ros"
    elif "ema" in sources_available:
        default_source = "ema"
    else:
        default_source = sources_available[0] if sources_available else "preseason"

    resolve_pos = yahoo_client.build_position_resolver(yahoo_query=None, fa_info_map=None, teams=None)

    candidates = []
    for display_name in canonical_names.values():
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
            for d in (pre_d, ros_d, ema_d)
            if d
        )
        if not has_signal:
            continue

        best_min = max(float((d or {}).get("mu_min") or 0.0) for d in (pre_d, ros_d, ema_d))
        _, z_pre = extract_rank_and_z(pre_d)
        _, z_ros = extract_rank_and_z(ros_d)
        _, z_ema = extract_rank_and_z(ema_d)
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
        raw_team = (pre_d or {}).get("team") or (ros_d or {}).get("team") or (ema_d or {}).get("team")
        raw_status = (
            (pre_d or {}).get("status")
            or (pre_d or {}).get("injury_status")
            or (ros_d or {}).get("status")
            or (ros_d or {}).get("injury_status")
            or (ema_d or {}).get("status")
            or (ema_d or {}).get("injury_status")
            or None
        )
        rank_val, _ = extract_rank_and_z(primary_d)

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

    candidates.sort(key=lambda item: item[0], reverse=True)
    players = [item[1] for item in candidates[:max(1, int(limit or 350))]]

    return {
        "players": players,
        "sources_available": sources_available,
        "default_source": default_source,
        "total_in_db": len(candidates),
    }
