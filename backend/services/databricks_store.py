import datetime
from typing import Any

import numpy as np
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


def refresh_databricks_cache(app_state: Any, settings: Settings) -> None:
    logger.info("Refreshing Databricks projection tables and NBA schedule.")

    with sql.connect(
        server_hostname=settings.databricks_url,
        http_path=settings.databricks_http_path,
        access_token=settings.databricks_token,
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT * FROM nba_fantasy.gold.nba_games_schedule")
            schedule_df = cursor.fetchall_arrow().to_pandas()

            player_stats: dict[str, dict[str, Any]] = {}
            for table in STATS_TABLES:
                cursor.execute(f"SELECT * FROM nba_fantasy.gold.{table}")
                df = cursor.fetchall_arrow().to_pandas()
                player_stats[table] = (
                    df.replace({np.nan: None})
                    .set_index("PLAYER_NAME")
                    .to_dict(orient="index")
                )

    app_state.nba_schedule = schedule_df
    app_state.player_stats = player_stats
    app_state.last_refreshed = datetime.datetime.now(datetime.timezone.utc).isoformat()
    logger.info("Databricks cache updated (%d schedule rows).", len(schedule_df))


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
