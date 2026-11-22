import datetime
import unittest
from unittest.mock import patch

import numpy as np
import pytz

from backend.services import live_scoreboard, matchup_service, streamer_service
from backend.services.lineup_solver import calculate_weekly_player_games

_ET = pytz.timezone("America/New_York")


def _make_player(
    name,
    nba_team,
    positions="PG,SG",
    selected_position="PG",
    status=None,
    rank=50,
    z_total=2.0,
    pts=20.0,
    reb=5.0,
    ast=5.0,
    stl=1.2,
    blk=0.6,
    tov=2.4,
    fg3m=2.5,
    fgm=7.0,
    fga=15.0,
    ftm=3.5,
    fta=4.2,
):
    stats = {
        "rank": rank,
        "z_total": z_total,
        "games_played": 15,
        "proj_games_played": 70,
        "team": nba_team,
        "mu_min": 32.0,
        "mu_pts": pts,
        "var_pts": 25.0,
        "mu_reb": reb,
        "var_reb": 4.0,
        "mu_ast": ast,
        "var_ast": 4.0,
        "mu_stl": stl,
        "var_stl": 1.2,
        "mu_blk": blk,
        "var_blk": 0.8,
        "mu_tov": tov,
        "var_tov": 1.6,
        "mu_fg3m": fg3m,
        "var_fg3m": 2.2,
        "mu_fgm": fgm,
        "var_fgm": 6.0,
        "mu_fga": fga,
        "var_fga": 16.0,
        "mu_ftm": ftm,
        "var_ftm": 4.0,
        "mu_fta": fta,
        "var_fta": 6.0,
        "z_pts": 1.0,
        "z_reb": 0.2,
        "z_ast": 0.4,
        "z_stl": 0.2,
        "z_blk": 0.1,
        "z_tov": -0.1,
        "z_fg3m": 0.5,
        "z_fg%": 0.1,
        "z_ft%": 0.2,
    }
    return {
        "name": name,
        "nba_team": nba_team,
        "positions": positions,
        "selected_position": selected_position,
        "status": status,
        "z_total": z_total,
        "weekly_stats": dict(stats),
        "ema_stats": dict(stats),
        "ros_stats": dict(stats),
    }


def _roster_slots(n_util=10, n_bn=3):
    slots = [{"position": "Util", "count": n_util, "is_starting_position": True}]
    if n_bn > 0:
        slots.append({"position": "BN", "count": n_bn, "is_starting_position": False})
    return slots


def _zero_scoreboard():
    return {
        "pts": 0.0,
        "reb": 0.0,
        "ast": 0.0,
        "stl": 0.0,
        "blk": 0.0,
        "tov": 0.0,
        "fg3m": 0.0,
        "fgm": 0.0,
        "fga": 0.0,
        "ftm": 0.0,
        "fta": 0.0,
    }


class TestLiveScoreboardService(unittest.TestCase):
    def setUp(self):
        live_scoreboard.clear_scoreboard_cache()

    def tearDown(self):
        live_scoreboard.clear_scoreboard_cache()

    def test_compute_remaining_fraction_all_states(self):
        pre = {"type": {"state": "pre", "name": "STATUS_SCHEDULED", "shortDetail": "7:30 PM"}}
        self.assertEqual(live_scoreboard.compute_remaining_fraction(pre), ("pre", 1.0, "STATUS_SCHEDULED", "7:30 PM"))

        q1_start = {"period": 1, "clock": 720.0, "type": {"state": "in", "name": "STATUS_IN_PROGRESS", "shortDetail": "12:00 - 1st"}}
        self.assertEqual(live_scoreboard.compute_remaining_fraction(q1_start)[1], 1.0)

        q1_end = {"period": 1, "clock": 0.0, "type": {"state": "in", "name": "STATUS_END_PERIOD"}}
        self.assertAlmostEqual(live_scoreboard.compute_remaining_fraction(q1_end)[1], 0.75, places=4)

        halftime = {"period": 2, "clock": 0.0, "type": {"state": "in", "name": "STATUS_HALFTIME", "shortDetail": "Halftime"}}
        self.assertAlmostEqual(live_scoreboard.compute_remaining_fraction(halftime)[1], 0.5, places=4)

        q3_mid = {"period": 3, "clock": 360.0, "type": {"state": "in", "name": "STATUS_IN_PROGRESS"}}
        self.assertAlmostEqual(live_scoreboard.compute_remaining_fraction(q3_mid)[1], 0.375, places=4)

        q4_mid = {"period": 4, "clock": 360.0, "type": {"state": "in", "name": "STATUS_IN_PROGRESS"}}
        self.assertAlmostEqual(live_scoreboard.compute_remaining_fraction(q4_mid)[1], 0.125, places=4)

        q4_zero = {"period": 4, "clock": 0.0, "type": {"state": "in", "name": "STATUS_IN_PROGRESS"}}
        self.assertEqual(live_scoreboard.compute_remaining_fraction(q4_zero)[1], 0.0)

        ot1_half = {"period": 5, "clock": 150.0, "type": {"state": "in", "name": "STATUS_IN_PROGRESS"}}
        self.assertAlmostEqual(live_scoreboard.compute_remaining_fraction(ot1_half)[1], round(150.0 / 2880.0, 4), places=4)

        post = {"period": 4, "clock": 0.0, "type": {"state": "post", "completed": True, "name": "STATUS_FINAL", "shortDetail": "Final"}}
        self.assertEqual(live_scoreboard.compute_remaining_fraction(post), ("post", 0.0, "STATUS_FINAL", "Final"))

        postponed = {"type": {"state": "pre", "name": "STATUS_POSTPONED", "shortDetail": "Postponed"}}
        self.assertEqual(live_scoreboard.compute_remaining_fraction(postponed), ("post", 0.0, "STATUS_POSTPONED", "Postponed"))

        # Malformed or missing payload defaults safely
        self.assertEqual(live_scoreboard.compute_remaining_fraction(None)[:2], ("pre", 1.0))
        self.assertEqual(live_scoreboard.compute_remaining_fraction({})[:2], ("pre", 1.0))

    def test_parse_espn_scoreboard_team_aliases(self):
        payload = {
            "events": [
                {
                    "id": "101",
                    "competitions": [{
                        "status": {"period": 2, "clock": 0.0, "type": {"state": "in", "name": "STATUS_HALFTIME", "shortDetail": "Halftime"}},
                        "competitors": [
                            {"team": {"abbreviation": "GS"}},
                            {"team": {"abbreviation": "NO"}},
                        ],
                    }],
                },
                {
                    "id": "102",
                    "competitions": [{
                        "status": {"period": 4, "clock": 0.0, "type": {"state": "post", "completed": True, "name": "STATUS_FINAL", "shortDetail": "Final"}},
                        "competitors": [
                            {"team": {"abbreviation": "NY"}},
                            {"team": {"abbreviation": "SA"}},
                        ],
                    }],
                },
                {
                    "id": "103",
                    "competitions": [{
                        "status": {"period": 0, "clock": 0.0, "type": {"state": "pre", "name": "STATUS_SCHEDULED", "shortDetail": "10:00 PM"}},
                        "competitors": [
                            {"team": {"abbreviation": "UTAH"}},
                            {"team": {"abbreviation": "WSH"}},
                        ],
                    }],
                },
            ]
        }
        parsed = live_scoreboard.parse_espn_scoreboard(payload)
        self.assertEqual(set(parsed.keys()), {"GSW", "NOP", "NYK", "SAS", "UTA", "WAS"})
        self.assertEqual(parsed["GSW"]["remaining_fraction"], 0.5)
        self.assertEqual(parsed["NOP"]["state"], "in")
        self.assertEqual(parsed["NYK"]["remaining_fraction"], 0.0)
        self.assertEqual(parsed["SAS"]["state"], "post")
        self.assertEqual(parsed["UTA"]["remaining_fraction"], 1.0)
        self.assertEqual(parsed["WAS"]["state"], "pre")

        summary = live_scoreboard.summarize_live_progress({"2026-11-20": parsed}, "2026-11-20")
        self.assertEqual(summary, {
            "active": True,
            "in_progress_games": 1,
            "final_games_today": 1,
            "scheduled_games_today": 1,
        })

    def test_cache_hit_ttl_error_backoff_and_max_entries(self):
        class FakeResp:
            def __init__(self, payload):
                self._payload = payload

            def raise_for_status(self):
                return None

            def json(self):
                return self._payload

        payload = {
            "events": [{
                "id": "200",
                "competitions": [{
                    "status": {"period": 3, "clock": 360.0, "type": {"state": "in", "name": "STATUS_IN_PROGRESS"}},
                    "competitors": [{"team": {"abbreviation": "BOS"}}, {"team": {"abbreviation": "LAL"}}],
                }],
            }]
        }
        target = datetime.date(2026, 11, 20)

        with patch.object(live_scoreboard._SESSION, "get", return_value=FakeResp(payload)) as mock_get:
            with patch("backend.services.live_scoreboard.time.time", side_effect=[100.0, 100.0, 110.0, 200.0, 200.0]):
                d1 = live_scoreboard.fetch_espn_scoreboard_for_date(target)
                d2 = live_scoreboard.fetch_espn_scoreboard_for_date(target)
                d3 = live_scoreboard.fetch_espn_scoreboard_for_date(target)
                self.assertEqual(d1["BOS"]["remaining_fraction"], 0.375)
                self.assertEqual(d2["BOS"]["remaining_fraction"], 0.375)
                self.assertEqual(d3["BOS"]["remaining_fraction"], 0.375)
                self.assertEqual(mock_get.call_count, 2)

        live_scoreboard.clear_scoreboard_cache()
        with patch.object(live_scoreboard._SESSION, "get", side_effect=RuntimeError("network down")) as mock_err:
            with patch("backend.services.live_scoreboard.time.time", side_effect=[100.0, 100.0, 110.0, 135.0, 135.0]):
                self.assertEqual(live_scoreboard.fetch_espn_scoreboard_for_date(target), {})
                self.assertEqual(live_scoreboard.fetch_espn_scoreboard_for_date(target), {})
                self.assertEqual(live_scoreboard.fetch_espn_scoreboard_for_date(target), {})
                # Error backoff is 30s -> only re-fetched once t=135s
                self.assertEqual(mock_err.call_count, 2)

        # Max entries bound enforcement
        live_scoreboard.clear_scoreboard_cache()
        with patch.object(live_scoreboard._SESSION, "get", return_value=FakeResp({"events": []})):
            for idx in range(live_scoreboard._MAX_CACHE_ENTRIES + 5):
                live_scoreboard.fetch_espn_scoreboard_for_date(datetime.date(2026, 11, 1) + datetime.timedelta(days=idx))
        self.assertLessEqual(len(live_scoreboard._SCOREBOARD_CACHE), live_scoreboard._MAX_CACHE_ENTRIES)

    def test_date_gating_and_past_midnight_carryover(self):
        now_wed_early = _ET.localize(datetime.datetime(2026, 11, 18, 1, 15))  # Wed 1:15 AM ET
        now_mon_early = _ET.localize(datetime.datetime(2026, 11, 16, 1, 15))  # Mon 1:15 AM ET

        # Distant date makes zero HTTP calls
        with patch("backend.services.live_scoreboard.fetch_espn_scoreboard_for_date") as mock_fetch:
            res = live_scoreboard.get_live_game_progress("2026-10-10", now_et=now_wed_early)
            self.assertEqual(res, {})
            mock_fetch.assert_not_called()

        live_game = {"LAL": {"event_id": "1", "state": "in", "remaining_fraction": 0.25}}
        post_game = {"LAL": {"event_id": "1", "state": "post", "remaining_fraction": 0.0}}
        pre_today = {"BOS": {"event_id": "2", "state": "pre", "remaining_fraction": 1.0}}

        # Wed 1:15 AM ET with live Tuesday game carries over 2026-11-17
        def side_effect_live(d):
            return pre_today if d == datetime.date(2026, 11, 18) else live_game

        with patch("backend.services.live_scoreboard.fetch_espn_scoreboard_for_date", side_effect=side_effect_live):
            res = live_scoreboard.get_live_game_progress("2026-11-18", now_et=now_wed_early)
            self.assertIn("2026-11-18", res)
            self.assertIn("2026-11-17", res)

        # Wed 1:15 AM ET with finished Tuesday game does NOT include 2026-11-17
        def side_effect_post(d):
            return pre_today if d == datetime.date(2026, 11, 18) else post_game

        with patch("backend.services.live_scoreboard.fetch_espn_scoreboard_for_date", side_effect=side_effect_post):
            res = live_scoreboard.get_live_game_progress("2026-11-18", now_et=now_wed_early)
            self.assertEqual(list(res.keys()), ["2026-11-18"])

        # Mon 1:15 AM ET NEVER carries over Sunday's previous-week game even if live
        with patch("backend.services.live_scoreboard.fetch_espn_scoreboard_for_date", return_value=live_game) as mock_fetch:
            res = live_scoreboard.get_live_game_progress("2026-11-16", now_et=now_mon_early)
            self.assertEqual(list(res.keys()), ["2026-11-16"])
            self.assertEqual(mock_fetch.call_count, 1)


class TestMatchupAndLineupIntegration(unittest.TestCase):
    def test_calculate_weekly_player_games_live_states(self):
        # Week of Mon 2026-11-16 .. Sun 2026-11-22, date_start = Wed 2026-11-18
        schedule = [
            {"scheduled_date": "2026-11-16", "team": "BOS"},
            {"scheduled_date": "2026-11-18", "team": "BOS"},
            {"scheduled_date": "2026-11-20", "team": "BOS"},
            {"scheduled_date": "2026-11-18", "team": "LAL"},
            {"scheduled_date": "2026-11-21", "team": "LAL"},
            {"scheduled_date": "2026-11-18", "team": "MIA"},
        ]
        team1 = {
            "team_id": 1,
            "players": [
                _make_player("P_Final", "BOS"),
                _make_player("P_Live", "LAL"),
                _make_player("P_Pre", "MIA"),
                _make_player("P_IR", "BOS", selected_position="IL"),
            ],
        }
        team2 = {"team_id": 2, "players": []}
        live_map = {
            "2026-11-18": {
                "BOS": {"event_id": "1", "state": "post", "detail": "Final", "remaining_fraction": 0.0},
                "LAL": {"event_id": "2", "state": "in", "detail": "Halftime", "remaining_fraction": 0.5},
                "MIA": {"event_id": "3", "state": "pre", "detail": "8:00 PM", "remaining_fraction": 1.0},
            }
        }
        pg = calculate_weekly_player_games(team1, team2, "2026-11-18", schedule, live_progress_by_date=live_map)["team1"]

        self.assertEqual((pg["P_Final"]["played"], pg["P_Final"]["total"], pg["P_Final"]["remaining"]), (2, 3, 1))
        self.assertEqual(pg["P_Final"]["live_status"], "post")
        self.assertEqual(pg["P_Final"]["remaining_fraction"], 0.0)

        self.assertEqual((pg["P_Live"]["played"], pg["P_Live"]["total"], pg["P_Live"]["remaining"]), (0, 2, 2))
        self.assertEqual(pg["P_Live"]["live_status"], "in")
        self.assertEqual(pg["P_Live"]["live_detail"], "Halftime")
        self.assertEqual(pg["P_Live"]["remaining_fraction"], 0.5)

        self.assertEqual((pg["P_Pre"]["played"], pg["P_Pre"]["total"], pg["P_Pre"]["remaining"]), (0, 1, 1))
        self.assertEqual(pg["P_Pre"]["live_status"], "pre")
        self.assertEqual(pg["P_Pre"]["remaining_fraction"], 1.0)

        self.assertEqual((pg["P_IR"]["played"], pg["P_IR"]["total"], pg["P_IR"]["remaining"]), (0, 0, 0))
        self.assertIsNone(pg["P_IR"]["live_status"])
        self.assertIsNone(pg["P_IR"]["remaining_fraction"])

    def _run_matchup(self, team1, team2, schedule, date_start, sb1, sb2, live_map, monte_carlo=False, n_sims=10000):
        def fake_live_stats(_yq, team_id, _week, _lk=None):
            return (dict(sb1), False) if team_id == team1["team_id"] else (dict(sb2), False)

        with patch("backend.services.matchup_service.resolve_league_key", return_value="466.l.1"), \
             patch("backend.services.matchup_service.get_live_team_stats", side_effect=fake_live_stats):
            if monte_carlo:
                return matchup_service.matchup_analysis_monte_carlo(
                    yahoo_query=object(),
                    team1=team1,
                    team2=team2,
                    week_num=5,
                    date_start=date_start,
                    roster_positions=_roster_slots(),
                    stats_source="weekly_stats",
                    nba_schedule=schedule,
                    n_sims=n_sims,
                    live_progress_by_date=live_map,
                )
            return matchup_service.matchup_analysis(
                yahoo_query=object(),
                team1=team1,
                team2=team2,
                week_num=5,
                date_start=date_start,
                roster_positions=_roster_slots(),
                stats_source="weekly_stats",
                nba_schedule=schedule,
                live_progress_by_date=live_map,
            )

    def test_analytical_final_live_heavy_slate_carryover_and_fallback(self):
        # Wed 2026-11-18 + Fri 2026-11-20; Tue 2026-11-17 for carry-over
        p1 = _make_player("T1_Post", "BOS", pts=20.0, rank=10)
        p2 = _make_player("T1_Live", "LAL", pts=30.0, rank=20)
        t2_p1 = _make_player("T2_Pre", "MIA", pts=24.0, rank=15)

        team1 = {"team_id": 1, "players": [p1, p2]}
        team2 = {"team_id": 2, "players": [t2_p1]}
        schedule = [
            {"scheduled_date": "2026-11-18", "team": "BOS"},
            {"scheduled_date": "2026-11-20", "team": "BOS"},
            {"scheduled_date": "2026-11-18", "team": "LAL"},
            {"scheduled_date": "2026-11-18", "team": "MIA"},
        ]
        sb1 = {**_zero_scoreboard(), "pts": 50.0}
        sb2 = _zero_scoreboard()
        live_map = {
            "2026-11-18": {
                "BOS": {"event_id": "1", "state": "post", "remaining_fraction": 0.0},
                "LAL": {"event_id": "2", "state": "in", "remaining_fraction": 0.5},
                "MIA": {"event_id": "3", "state": "pre", "remaining_fraction": 1.0},
            }
        }
        res = self._run_matchup(team1, team2, schedule, "2026-11-18", sb1, sb2, live_map)
        # BOS post today (0) + BOS Fri (20) + LAL live half (15) + scoreboard (50) = 85.0
        self.assertAlmostEqual(res["agg_dists"]["team1"]["pts"]["mu"], 85.0, places=5)
        self.assertAlmostEqual(res["agg_dists"]["team1"]["pts"]["var"], 37.5, places=5)  # 1.5 * 25.0
        self.assertAlmostEqual(res["agg_dists"]["team2"]["pts"]["mu"], 24.0, places=5)
        self.assertTrue(res["accumulated_stats"]["has_live_stats"])
        self.assertEqual(res["live_adjustment"]["final_games_today"], 1)
        self.assertEqual(res["live_adjustment"]["in_progress_games"], 1)

        # Fallback empty live_map reverts cleanly to full projections
        res_fb = self._run_matchup(team1, team2, schedule, "2026-11-18", sb1, sb2, {})
        self.assertAlmostEqual(res_fb["agg_dists"]["team1"]["pts"]["mu"], 120.0, places=5)

        # Heavy slate: 12 players play today (5 BOS finished rank 1..5, 7 LAL pre rank 6..12).
        # Bench #11 and #12 MUST NOT be promoted into active 10 slots!
        heavy_players = [
            _make_player(f"Starter_Post_{i}", "BOS", pts=20.0, rank=i) for i in range(1, 6)
        ] + [
            _make_player(f"Starter_Pre_{i}", "LAL", pts=10.0, rank=i) for i in range(6, 11)
        ] + [
            _make_player(f"Bench_Pre_{i}", "LAL", pts=100.0, rank=i) for i in range(11, 13)
        ]
        heavy_sched = [
            {"scheduled_date": "2026-11-18", "team": "BOS"},
            {"scheduled_date": "2026-11-18", "team": "LAL"},
        ]
        heavy_live = {
            "2026-11-18": {
                "BOS": {"event_id": "10", "state": "post", "remaining_fraction": 0.0},
                "LAL": {"event_id": "11", "state": "pre", "remaining_fraction": 1.0},
            }
        }
        res_heavy = self._run_matchup(
            {"team_id": 1, "players": heavy_players},
            {"team_id": 2, "players": []},
            heavy_sched,
            "2026-11-18",
            _zero_scoreboard(),
            _zero_scoreboard(),
            heavy_live,
        )
        self.assertAlmostEqual(res_heavy["agg_dists"]["team1"]["pts"]["mu"], 50.0, places=5)

        # Past-midnight ET carry-over: prev_day 2026-11-17 has live game (0.25) and finished game (0.0)
        carry_sched = [
            {"scheduled_date": "2026-11-17", "team": "BOS"},
            {"scheduled_date": "2026-11-17", "team": "LAL"},
        ]
        carry_live = {
            "2026-11-17": {
                "BOS": {"event_id": "20", "state": "post", "remaining_fraction": 0.0},
                "LAL": {"event_id": "21", "state": "in", "remaining_fraction": 0.25},
            }
        }
        res_carry = self._run_matchup(team1, team2, carry_sched, "2026-11-18", sb1, sb2, carry_live)
        # Scoreboard 50 + 0.0*20 + 0.25*30 = 57.5
        self.assertAlmostEqual(res_carry["agg_dists"]["team1"]["pts"]["mu"], 57.5, places=5)

    def test_monte_carlo_exact_post_and_unbiased_low_fraction_splits(self):
        np.random.seed(42)
        p_post = _make_player("PostPlayer", "BOS", pts=25.0)
        p_tiny = _make_player("TinyRemPlayer", "LAL", pts=20.0, fgm=8.0, fga=16.0, ftm=4.0, fta=5.0)
        schedule = [
            {"scheduled_date": "2026-11-18", "team": "BOS"},
            {"scheduled_date": "2026-11-18", "team": "LAL"},
        ]
        sb1 = {**_zero_scoreboard(), "pts": 60.0}
        sb2 = {**_zero_scoreboard(), "pts": 55.0}

        # Case 1: All games final -> MC equals exact scoreboard deterministically
        live_post = {
            "2026-11-18": {
                "BOS": {"event_id": "1", "state": "post", "remaining_fraction": 0.0},
                "LAL": {"event_id": "2", "state": "post", "remaining_fraction": 0.0},
            }
        }
        mc_post = self._run_matchup(
            {"team_id": 1, "players": [p_post]},
            {"team_id": 2, "players": []},
            schedule,
            "2026-11-18",
            sb1,
            sb2,
            live_post,
            monte_carlo=True,
            n_sims=1000,
        )
        self.assertAlmostEqual(mc_post["sim_avg"]["team1"]["pts"], 60.0, places=6)
        self.assertEqual(mc_post["win_pcts"]["pts"], 1.0)

        # Case 2: 0.5 remaining fraction + tiny 0.05 remaining fraction on another team checks unbiased rates
        live_half = {
            "2026-11-18": {
                "LAL": {"event_id": "2", "state": "in", "remaining_fraction": 0.5},
            }
        }
        mc_half = self._run_matchup(
            {"team_id": 1, "players": [p_tiny]},
            {"team_id": 2, "players": []},
            [{"scheduled_date": "2026-11-18", "team": "LAL"}],
            "2026-11-18",
            _zero_scoreboard(),
            _zero_scoreboard(),
            live_half,
            monte_carlo=True,
            n_sims=10000,
        )
        self.assertAlmostEqual(mc_half["sim_avg"]["team1"]["pts"], 10.0, delta=0.5)
        self.assertAlmostEqual(mc_half["sim_avg"]["team1"]["fga"], 8.0, delta=0.4)
        self.assertAlmostEqual(
            mc_half["sim_avg"]["team1"]["fgm"] / mc_half["sim_avg"]["team1"]["fga"],
            0.5,
            delta=0.025,
        )

        # Tiny 5% remaining fraction must NOT distort shooting % or blow up Beta variance
        live_tiny = {
            "2026-11-18": {
                "LAL": {"event_id": "2", "state": "in", "remaining_fraction": 0.05},
            }
        }
        mc_tiny = self._run_matchup(
            {"team_id": 1, "players": [p_tiny]},
            {"team_id": 2, "players": []},
            [{"scheduled_date": "2026-11-18", "team": "LAL"}],
            "2026-11-18",
            _zero_scoreboard(),
            _zero_scoreboard(),
            live_tiny,
            monte_carlo=True,
            n_sims=20000,
        )
        self.assertAlmostEqual(mc_tiny["sim_avg"]["team1"]["fga"], 0.8, delta=0.1)
        self.assertAlmostEqual(
            mc_tiny["sim_avg"]["team1"]["fgm"] / mc_tiny["sim_avg"]["team1"]["fga"],
            0.5,
            delta=0.04,
        )

    def test_streamer_locking_and_consistency(self):
        # Mon 2026-11-16 schedule for 3 teams:
        # BOS: post today, also plays Wed; MIA: pre today (starts 10 PM); OKC: live today; NYK: pre today
        # Team 1 roster (1 active Util slot for crisp test):
        # - Starter_Locked (BOS, rank 10 -> starts in Util_1, post today)
        # - Bench_Locked (OKC, rank 150 -> sits on BN, in-progress today)
        # - Unlocked_Drop (OKC? Wait: give Unlocked_Drop a pre-game NYK team so dropping opens/keeps pre slot cleanly, OR test dropping Starter_Locked!)
        roster_slots = [{"position": "Util", "count": 1, "is_starting_position": True}, {"position": "BN", "count": 2, "is_starting_position": False}]
        starter_locked = _make_player("Starter_Locked", "BOS", positions="PG", rank=10, z_total=4.0, pts=25.0)
        bench_locked = _make_player("Bench_Locked", "OKC", positions="PG", rank=150, z_total=-0.5, pts=8.0)

        team1 = {"team_id": 1, "players": [starter_locked, bench_locked]}
        team2 = {"team_id": 2, "players": [_make_player("Opp1", "MIA", pts=18.0)]}

        schedule = [
            {"scheduled_date": "2026-11-16", "team": "BOS"},
            {"scheduled_date": "2026-11-18", "team": "BOS"},
            {"scheduled_date": "2026-11-16", "team": "OKC"},
            {"scheduled_date": "2026-11-16", "team": "MIA"},
            {"scheduled_date": "2026-11-16", "team": "NYK"},
            {"scheduled_date": "2026-11-18", "team": "NYK"},
            {"scheduled_date": "2026-11-18", "team": "LAC"},
        ]

        pool = {
            "FA_Locked_Post": _make_player("FA_Locked_Post", "BOS", rank=40, z_total=2.5, pts=22.0)["weekly_stats"],
            "FA_Locked_Live": _make_player("FA_Locked_Live", "OKC", rank=41, z_total=2.5, pts=22.0)["weekly_stats"],
            "FA_Unlocked_Pre": _make_player("FA_Unlocked_Pre", "NYK", rank=42, z_total=2.4, pts=21.0)["weekly_stats"],
            "FA_Future_Only": _make_player("FA_Future_Only", "LAC", rank=43, z_total=2.4, pts=21.0)["weekly_stats"],
        }
        fa_info_map = {
            name: {"status": "", "positions": "PG"} for name in pool
        }
        live_today = {
            "2026-11-16": {
                "BOS": {"event_id": "1", "state": "post", "remaining_fraction": 0.0},
                "OKC": {"event_id": "2", "state": "in", "remaining_fraction": 0.5},
                "NYK": {"event_id": "3", "state": "pre", "remaining_fraction": 1.0},
                "MIA": {"event_id": "4", "state": "pre", "remaining_fraction": 1.0},
            }
        }

        def fake_live_stats(_yq, team_id, _week, _lk=None):
            return ({**_zero_scoreboard(), "pts": 20.0}, False)

        def fake_pos_resolver(yahoo_query=None, fa_info_map=None, teams=None):
            return lambda p_name, p_stats_dict=None, allow_yahoo_lookup=True: "PG"

        with patch("backend.services.matchup_service.resolve_league_key", return_value="466.l.1"), \
             patch("backend.services.matchup_service.get_live_team_stats", side_effect=fake_live_stats), \
             patch("backend.services.streamer_service.yahoo_client.get_yahoo_fa_info_map", return_value=fa_info_map), \
             patch("backend.services.streamer_service.yahoo_client.build_position_resolver", side_effect=fake_pos_resolver):
            # 1) pickup_mode="today": locked FAs (BOS post, OKC live) are excluded; FA_Unlocked_Pre is included.
            # Notice Util_1 today is ALREADY filled by Starter_Locked (BOS post), so even FA_Unlocked_Pre cannot steal a locked starter's spot!
            res_today = streamer_service.get_streamer_recommendations(
                yahoo_query=object(),
                team1=team1,
                team2=team2,
                week_num=5,
                date_start="2026-11-16",
                roster_positions=roster_slots,
                stats_source="weekly_stats",
                nba_schedule=schedule,
                player_stats_pool=pool,
                all_rostered_names={"Starter_Locked", "Bench_Locked", "Opp1"},
                pickup_mode="today",
                ros_stats_pool=pool,
                live_progress_by_date=live_today,
            )
            cands_by_name = {c["name"]: c for c in res_today["roster_candidates"]}
            self.assertEqual(cands_by_name["Starter_Locked"]["starts_today"], 0)
            self.assertEqual(cands_by_name["Bench_Locked"]["starts_today"], 0)
            # Locked starter cannot be swapped today, and locked bench cannot backfill today -> hold recommended!
            self.assertTrue(res_today["hold_recommended"])
            self.assertEqual(res_today["recommendations"], [])

            # 1b) With an open Util slot on today's slate, unlocked FA_Unlocked_Pre IS recommended while locked FAs are excluded
            res_today_open = streamer_service.get_streamer_recommendations(
                yahoo_query=object(),
                team1={"team_id": 1, "players": [starter_locked]},
                team2=team2,
                week_num=5,
                date_start="2026-11-16",
                roster_positions=[{"position": "Util", "count": 2, "is_starting_position": True}, {"position": "BN", "count": 1, "is_starting_position": False}],
                stats_source="weekly_stats",
                nba_schedule=schedule,
                player_stats_pool=pool,
                all_rostered_names={"Starter_Locked", "Opp1"},
                pickup_mode="today",
                ros_stats_pool=pool,
                live_progress_by_date=live_today,
            )
            open_rec_names = [r["player"]["name"] for r in res_today_open["recommendations"]]
            self.assertEqual(open_rec_names, ["FA_Unlocked_Pre"])
            self.assertNotIn("FA_Locked_Post", open_rec_names)
            self.assertNotIn("FA_Locked_Live", open_rec_names)

            # 2) All-post slate in pickup_mode="today" -> clean hold with empty recommendations
            live_all_post = {
                "2026-11-16": {
                    k: {"event_id": str(i), "state": "post", "remaining_fraction": 0.0}
                    for i, k in enumerate(("BOS", "OKC", "NYK", "MIA"), 1)
                }
            }
            res_all_post = streamer_service.get_streamer_recommendations(
                yahoo_query=object(),
                team1=team1,
                team2=team2,
                week_num=5,
                date_start="2026-11-16",
                roster_positions=roster_slots,
                stats_source="weekly_stats",
                nba_schedule=schedule,
                player_stats_pool=pool,
                all_rostered_names={"Starter_Locked", "Bench_Locked", "Opp1"},
                pickup_mode="today",
                ros_stats_pool=pool,
                live_progress_by_date=live_all_post,
            )
            self.assertTrue(res_all_post["hold_recommended"])
            self.assertEqual(res_all_post["recommendations"], [])

            # 3) pickup_mode="week": FA_Locked_Post (BOS, post today, plays Wed) only gets Wed (1 game left),
            # while FA_Unlocked_Pre (NYK, pre today, plays Mon + Wed) gets BOTH Mon and Wed!
            # Open 1 roster spot by giving team1 only Bench_Locked (OKC live, sitting on BN because we add an unused Util? Wait: use Util_1 + Util_2 and put only Starter_Locked so Bench_Locked doesn't interfere)
            res_week = streamer_service.get_streamer_recommendations(
                yahoo_query=object(),
                team1={"team_id": 1, "players": [starter_locked]},
                team2=team2,
                week_num=5,
                date_start="2026-11-16",
                roster_positions=[{"position": "Util", "count": 2, "is_starting_position": True}, {"position": "BN", "count": 1, "is_starting_position": False}],
                stats_source="weekly_stats",
                nba_schedule=schedule,
                player_stats_pool=pool,
                all_rostered_names={"Starter_Locked", "Opp1"},
                pickup_mode="week",
                ros_stats_pool=pool,
                live_progress_by_date=live_today,
            )
            recs_by_name = {r["player"]["name"]: r for r in res_week["recommendations"]}
            self.assertNotIn("2026-11-16", recs_by_name["FA_Locked_Post"]["schedule"]["all_game_dates"])
            self.assertEqual(recs_by_name["FA_Locked_Post"]["schedule"]["startable_dates"], ["2026-11-18"])
            self.assertNotIn("FA_Locked_Live", recs_by_name)  # OKC only plays Mon and is locked today -> 0 games left
            self.assertEqual(recs_by_name["FA_Unlocked_Pre"]["schedule"]["startable_dates"], ["2026-11-16", "2026-11-18"])

    def test_backend_analysis_compat_import(self):
        import backend.analysis as analysis_compat

        self.assertTrue(hasattr(analysis_compat, "matchup_analysis"))
        self.assertTrue(hasattr(analysis_compat, "matchup_analysis_monte_carlo"))
        self.assertTrue(hasattr(analysis_compat, "get_streamer_recommendations"))


if __name__ == "__main__":
    unittest.main()
