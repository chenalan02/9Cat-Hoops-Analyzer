from fastapi import APIRouter

from backend.api.routes.draft import router as draft_router
from backend.api.routes.free_agents import router as free_agents_router
from backend.api.routes.health import router as health_router
from backend.api.routes.leagues import router as leagues_router
from backend.api.routes.matchups import router as matchups_router
from backend.api.routes.streamers import router as streamers_router

v1_router = APIRouter(prefix="/v1")
v1_router.include_router(health_router)
v1_router.include_router(leagues_router)
v1_router.include_router(matchups_router)
v1_router.include_router(streamers_router)
v1_router.include_router(free_agents_router)
v1_router.include_router(draft_router)
