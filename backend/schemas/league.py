import re

from pydantic import BaseModel, field_validator

_YAHOO_TEAM_URL_RE = re.compile(
    r"basketball\.fantasysports\.yahoo\.com/nba/(\d+)/(\d+)(?:[/?#]|$)",
    re.IGNORECASE,
)


def parse_yahoo_fantasy_link(fantasy_link: str) -> tuple[str, int]:
    match = _YAHOO_TEAM_URL_RE.search(fantasy_link.strip())
    if not match:
        raise ValueError(
            "Invalid Yahoo Fantasy Basketball team URL. "
            "Expected format: https://basketball.fantasysports.yahoo.com/nba/<league_id>/<team_id>"
        )
    return match.group(1), int(match.group(2))


class LeagueSyncRequest(BaseModel):
    fantasy_link: str

    @field_validator("fantasy_link")
    @classmethod
    def validate_fantasy_link(cls, value: str) -> str:
        cleaned = value.strip()
        parse_yahoo_fantasy_link(cleaned)
        return cleaned
