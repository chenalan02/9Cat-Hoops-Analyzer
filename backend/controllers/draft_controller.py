from typing import Any

from backend.core.exceptions import ServiceUnavailableError
from backend.services.draft_service import get_draft_pool


def fetch_draft_pool(limit: int, player_stats: dict[str, Any] | None) -> dict[str, Any]:
    if not player_stats:
        raise ServiceUnavailableError("Projection tables are not loaded yet. Please retry shortly.")

    capped_limit = max(1, min(int(limit or 350), 600))
    return get_draft_pool(player_stats, limit=capped_limit)
