import datetime
import decimal
import gc
import math
from typing import Any

from databricks import sql

from backend.core.config import Settings
from backend.core.logging import logger

STATS_TABLES = ("ema", "ros_rankings", "weekly_rankings", "preseason_rankings")

SOURCE_KEY_ALIASES = {
    "weekly_stats": "weekly_rankings",
    "ros_stats": "ros_rankings",
    "preseason_stats": "preseason_rankings",
}


def resolve_table_key(stats_source: str) -> str:
    return SOURCE_KEY_ALIASES.get(stats_source, stats_source)


def _normalize_db_value(value: Any) -> Any:
    if isinstance(value, float):
        return None if not math.isfinite(value) else value
    if isinstance(value, decimal.Decimal):
        float_val = float(value)
        return None if not math.isfinite(float_val) else float_val
    return value


def _fetch_schedule_rows(cursor: Any) -> list[dict[str, Any]]:
    cursor.execute("SELECT * FROM nba_fantasy.gold.nba_games_schedule")
    columns = [desc[0] for desc in cursor.description]
    rows = cursor.fetchall()
    return [
        {col: _normalize_db_value(val) for col, val in zip(columns, row)}
        for row in rows
    ]


def _fetch_player_table_dict(cursor: Any, table_name: str) -> dict[str, dict[str, Any]]:
    cursor.execute(f"SELECT * FROM nba_fantasy.gold.{table_name}")
    columns = [desc[0] for desc in cursor.description]
    name_idx = columns.index("PLAYER_NAME")
    rows = cursor.fetchall()

    table_dict: dict[str, dict[str, Any]] = {}
    for row in rows:
        player_name = row[name_idx]
        if player_name is None:
            continue
        table_dict[player_name] = {
            col: _normalize_db_value(val)
            for idx, (col, val) in enumerate(zip(columns, row))
            if idx != name_idx
        }
    return table_dict


def refresh_databricks_cache(app_state: Any, settings: Settings) -> None:
    logger.info("Refreshing Databricks projection tables and NBA schedule.")

    with sql.connect(
        server_hostname=settings.databricks_url,
        http_path=settings.databricks_http_path,
        access_token=settings.databricks_token,
    ) as connection:
        with connection.cursor() as cursor:
            schedule_rows = _fetch_schedule_rows(cursor)
            player_stats: dict[str, dict[str, Any]] = {}
            for table in STATS_TABLES:
                player_stats[table] = _fetch_player_table_dict(cursor, table)

    app_state.nba_schedule = schedule_rows
    app_state.player_stats = player_stats
    app_state.last_refreshed = datetime.datetime.now(datetime.timezone.utc).isoformat()
    gc.collect()
    logger.info("Databricks cache updated (%d schedule rows).", len(schedule_rows))


def resolve_streamer_stats_pools(
    player_stats: dict[str, dict[str, Any]] | None,
    stats_source: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    stats_map = player_stats or {}
    pool_key = resolve_table_key(stats_source)
    primary_pool = stats_map.get(pool_key, {}) or {}
    ema_pool = stats_map.get("ema", {}) or {}

    if pool_key == "weekly_rankings" and primary_pool:
        # Tag EMA entries so streamer filtering excludes unprojected fringe players from weekly matchups.
        tagged_ema = {
            name: {**row, "is_ema_fallback": True}
            for name, row in ema_pool.items()
            if name not in primary_pool
        }
        merged_pool = {**tagged_ema, **primary_pool}
    else:
        merged_pool = {**ema_pool, **primary_pool}

    ros_stats_pool = stats_map.get("ros_rankings", {}) or {}
    return merged_pool, ros_stats_pool
