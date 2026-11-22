import datetime
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.error_handler import register_exception_handlers
from backend.api.routes import v1_router
from backend.services.databricks_store import _fetch_game_logs
from backend.services.player_rankings_service import get_player_game_logs, get_player_rankings


def _make_log_row(
    idx,
    game_date,
    matchup,
    team="DEN",
    wl="W",
    minutes=34,
    pts=24,
    reb=10,
    ast=8,
    stl=1,
    blk=1,
    fg3m=2,
    fg3a=5,
    fgm=9,
    fga=18,
    ftm=4,
    fta=5,
    tov=3,
    plus_minus=8,
    is_home=True,
    opponent="LAL",
):
    return {
        "game_id": f"0022600{100 + idx}",
        "game_date": game_date,
        "season_id": "22026",
        "team": team,
        "matchup": matchup,
        "opponent": opponent,
        "is_home": is_home,
        "wl": wl,
        "min": minutes,
        "pts": pts,
        "reb": reb,
        "oreb": 2,
        "dreb": max(0, reb - 2),
        "ast": ast,
        "stl": stl,
        "blk": blk,
        "fg3m": fg3m,
        "fg3a": fg3a,
        "fgm": fgm,
        "fga": fga,
        "ftm": ftm,
        "fta": fta,
        "tov": tov,
        "pf": 2,
        "plus_minus": plus_minus,
        "fg_pct": round(fgm / fga, 4) if fga > 0 else None,
        "ft_pct": round(ftm / fta, 4) if fta > 0 else None,
        "fg3_pct": round(fg3m / fg3a, 4) if fg3a > 0 else None,
    }


class TestDatabricksGameLogIngest(unittest.TestCase):
    def test_fetch_game_logs_normalization(self):
        columns = [
            "PLAYER_NAME", "GAME_ID", "GAME_DATE", "SEASON_ID", "TEAM_ABBREVIATION",
            "MATCHUP", "WL", "MIN", "PTS", "REB", "OREB", "DREB", "AST", "STL", "BLK",
            "FG3M", "FG3A", "FGM", "FGA", "FTM", "FTA", "TOV", "PF", "PLUS_MINUS",
        ]
        rows = [
            (
                "Nikola Jokić", "0022600201", datetime.date(2026, 11, 20), "22026", "DEN",
                "DEN vs. LAL", "W", 36, 30, 12, 3, 9, 10, 2, 1,
                2, 4, 12, 20, 4, 5, 3, 2, 14,
            ),
            (
                "Nikola Jokic", "0022600190", datetime.date(2026, 11, 18), "22026", "DEN",
                "DEN @ GS", "L", 32, 20, 10, 2, 8, 6, 1, 0,
                0, 2, 10, 15, 0, 0, 4, 3, -6,
            ),
        ]

        class FakeCursor:
            description = [(col,) for col in columns]

            def execute(self, sql_query):
                self.last_query = sql_query

            def fetchall(self):
                return rows

        cur = FakeCursor()
        grouped = _fetch_game_logs(cur)
        self.assertIn("Nikola Jokic", grouped)
        self.assertEqual(len(grouped["Nikola Jokic"]), 2)

        g1, g2 = grouped["Nikola Jokic"]
        self.assertEqual(g1["game_date"], "2026-11-20")
        self.assertTrue(g1["is_home"])
        self.assertEqual(g1["opponent"], "LAL")
        self.assertAlmostEqual(g1["fg_pct"], 0.6, places=4)
        self.assertAlmostEqual(g1["ft_pct"], 0.8, places=4)
        self.assertAlmostEqual(g1["fg3_pct"], 0.5, places=4)

        self.assertEqual(g2["opponent"], "GSW")
        self.assertFalse(g2["is_home"])
        self.assertIsNone(g2["ft_pct"])


class TestPlayerRankingsAndLogsService(unittest.TestCase):
    def setUp(self):
        # 8 newest-first games: top 5 at 36 min / 30 pts, bottom 3 at 28 min / 14 pts
        self.jokic_logs = [
            _make_log_row(
                i,
                f"2026-11-{20 - i:02d}",
                "DEN vs. MIA" if i % 2 == 0 else "DEN @ BOS",
                wl="W" if i % 2 == 0 else "L",
                minutes=36 if i < 5 else 28,
                pts=30 if i < 5 else 14,
                reb=12 if i < 2 else 8,
                ast=10 if i == 0 else 7,
                fgm=11,
                fga=20,
                ftm=6,
                fta=7,
                is_home=(i % 2 == 0),
                opponent="MIA" if i % 2 == 0 else "BOS",
            )
            for i in range(8)
        ]

        self.stats_by_source = {
            "ema": {
                "Nikola Jokic": {
                    "team": "DEN",
                    "rank": 1,
                    "z_total": 12.4,
                    "mu_min": 35.0,
                    "mu_pts": 28.0,
                    "games_played": 8,
                },
                "bench guy": {
                    "team": "GS",
                    "rank": 220,
                    "z_total": -2.1,
                    "mu_min": 14.0,
                    "mu_pts": 6.0,
                    "games_played": 5,
                },
            },
            "ros_rankings": {
                "Nikola Jokic": {"team": "DEN", "rank": 1, "z_total": 11.8, "mu_pts": 27.5},
                "Injured Star": {"team": "PHI", "rank": 15, "z_total": 5.2, "status": "OUT", "mu_pts": 25.0},
            },
            "weekly_rankings": {},
            "preseason_rankings": {
                "Nikola Jokic": {"team": "DEN", "rank": 1, "z_total": 11.5, "mu_pts": 27.0},
            },
        }
        self.game_logs = {"Nikola Jokic": self.jokic_logs}

    def test_get_player_rankings_and_recent_form(self):
        res = get_player_rankings(self.stats_by_source, game_logs=self.game_logs)
        self.assertEqual(res["total"], 3)
        self.assertEqual(res["latest_game_date"], "2026-11-20")
        self.assertEqual(res["season_id"], "22026")
        self.assertEqual(res["sources_available"], ["ema", "ros", "preseason"])

        first = res["players"][0]
        self.assertEqual(first["name"], "Nikola Jokic")
        self.assertEqual(first["nba_team"], "DEN")
        rf = first["recent_form"]
        self.assertEqual(rf["games_logged"], 8)
        self.assertEqual(rf["last_game_date"], "2026-11-20")
        # season avg min = (5*36 + 3*28)/8 = 33.0, l5 min = 36.0 -> trend +3.0
        self.assertEqual(rf["season_min"], 33.0)
        self.assertEqual(rf["l5_min"], 36.0)
        self.assertEqual(rf["min_trend"], 3.0)
        self.assertEqual(rf["last_3_pts"], [30, 30, 30])

        # Second should be Injured Star (fallback ROS z_total = 5.2)
        self.assertEqual(res["players"][1]["name"], "Injured Star")
        self.assertEqual(res["players"][1]["status"], "OUT")
        self.assertIsNone(res["players"][1]["recent_form"])

    def test_get_player_game_logs_splits_consistency_and_empty(self):
        res = get_player_game_logs(self.game_logs, "nikola jokić")
        self.assertEqual(res["player_name"], "Nikola Jokic")
        self.assertEqual(res["total_games"], 8)
        self.assertEqual(res["season_id"], "22026")

        # Game 0 has 30/12/10 (TD & DD), Game 1 has 30/12/7 (DD)
        self.assertTrue(res["logs"][0]["triple_double"])
        self.assertTrue(res["logs"][0]["double_double"])
        self.assertFalse(res["logs"][1]["triple_double"])
        self.assertTrue(res["logs"][1]["double_double"])

        splits = res["splits"]
        self.assertEqual(splits["season"]["gp"], 8)
        self.assertEqual(splits["last_15"]["gp"], 8)
        self.assertEqual(splits["last_7"]["gp"], 7)
        self.assertEqual(splits["last_3"]["gp"], 3)
        self.assertEqual(splits["last_3"]["pts"], 30.0)
        self.assertAlmostEqual(splits["season"]["fg_pct"], 11 / 20, places=4)
        self.assertAlmostEqual(splits["season"]["ft_pct"], 6 / 7, places=4)

        cons = res["consistency"]
        self.assertEqual(cons["triple_doubles"], 1)
        self.assertEqual(cons["double_doubles"], 2)
        self.assertEqual(cons["pts_high"], 30)
        self.assertEqual(cons["pts_low"], 14)
        self.assertEqual(cons["games_30_plus_min"], 5)
        self.assertAlmostEqual(cons["games_30_plus_min_pct"], 0.625, places=3)
        self.assertEqual(cons["wins"], 4)
        self.assertEqual(cons["losses"], 4)
        self.assertEqual(cons["home_gp"], 4)
        self.assertEqual(cons["away_gp"], 4)
        self.assertGreater(cons["pts_std"], 0.0)

        empty = get_player_game_logs(self.game_logs, "Unknown Player")
        self.assertEqual(empty["total_games"], 0)
        self.assertEqual(empty["logs"], [])
        self.assertEqual(empty["splits"], {})
        self.assertEqual(empty["consistency"], {})

    def test_fastapi_routes_and_health(self):
        app = FastAPI()
        register_exception_handlers(app)
        app.include_router(v1_router)

        with TestClient(app) as client:
            # Uninitialized state returns 503
            r_uninit = client.get("/v1/players/rankings")
            self.assertEqual(r_uninit.status_code, 503)

            app.state.player_stats = self.stats_by_source
            app.state.nba_schedule = [{"scheduled_date": "2026-11-20", "team": "DEN"}]
            app.state.game_logs = self.game_logs
            app.state.last_refreshed = "2026-11-22T08:30:00+00:00"

            r_health = client.get("/v1/health")
            self.assertEqual(r_health.status_code, 200)
            self.assertEqual(r_health.json()["game_log_players_loaded"], 1)

            r_rank = client.get("/v1/players/rankings")
            self.assertEqual(r_rank.status_code, 200)
            body_rank = r_rank.json()
            self.assertEqual(body_rank["total"], 3)
            self.assertEqual(body_rank["players"][0]["name"], "Nikola Jokic")

            r_logs = client.get("/v1/players/Nikola%20Jokic/game-logs")
            self.assertEqual(r_logs.status_code, 200)
            body_logs = r_logs.json()
            self.assertEqual(body_logs["total_games"], 8)
            self.assertEqual(body_logs["splits"]["last_3"]["pts"], 30.0)

            r_empty = client.get("/v1/players/No%20Games/game-logs")
            self.assertEqual(r_empty.status_code, 200)
            self.assertEqual(r_empty.json()["total_games"], 0)


if __name__ == "__main__":
    unittest.main()
