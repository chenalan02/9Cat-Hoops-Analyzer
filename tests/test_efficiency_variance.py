import unittest
from unittest.mock import patch

import numpy as np

from backend.services import matchup_service, streamer_service
from backend.services.stats_utils import (
    VEC_LEN,
    player_ratio_moments,
    prob_positive,
    ratio_mean_and_var,
    stats_to_vec,
)


def _exact_moments_player(
    name,
    nba_team,
    *,
    mu_fga=14.0,
    var_fga=18.0,
    fg_p=0.48,
    fg_sigma_p=0.02,
    mu_fta=4.2,
    var_fta=7.5,
    ft_p=0.81,
    ft_sigma_p=0.02,
    rank=50,
    z_total=2.0,
    status=None,
):
    mu_fgm = mu_fga * fg_p
    var_fgm = (
        (fg_p ** 2) * var_fga
        + mu_fga * fg_p * (1.0 - fg_p)
        + ((mu_fga ** 2) + var_fga - mu_fga) * (fg_sigma_p ** 2)
    )
    mu_ftm = mu_fta * ft_p
    var_ftm = (
        (ft_p ** 2) * var_fta
        + mu_fta * ft_p * (1.0 - ft_p)
        + ((mu_fta ** 2) + var_fta - mu_fta) * (ft_sigma_p ** 2)
    )
    stats = {
        "rank": rank,
        "z_total": z_total,
        "games_played": 20,
        "proj_games_played": 70,
        "team": nba_team,
        "mu_min": 32.0,
        "mu_pts": 18.0,
        "var_pts": 25.0,
        "mu_reb": 5.0,
        "var_reb": 4.0,
        "mu_ast": 4.5,
        "var_ast": 4.0,
        "mu_stl": 1.1,
        "var_stl": 1.0,
        "mu_blk": 0.6,
        "var_blk": 0.7,
        "mu_tov": 2.2,
        "var_tov": 1.5,
        "mu_fg3m": 2.0,
        "var_fg3m": 2.0,
        "mu_fgm": mu_fgm,
        "var_fgm": var_fgm,
        "mu_fga": mu_fga,
        "var_fga": var_fga,
        "mu_ftm": mu_ftm,
        "var_ftm": var_ftm,
        "mu_fta": mu_fta,
        "var_fta": var_fta,
        "z_pts": 0.6,
        "z_reb": 0.2,
        "z_ast": 0.3,
        "z_stl": 0.2,
        "z_blk": 0.1,
        "z_tov": -0.1,
        "z_fg3m": 0.3,
        "z_fg%": 0.2,
        "z_ft%": 0.2,
    }
    return {
        "name": name,
        "nba_team": nba_team,
        "positions": "PG,SG,SF,PF,C",
        "selected_position": "Util",
        "status": status,
        "z_total": z_total,
        "weekly_stats": dict(stats),
        "ema_stats": dict(stats),
        "ros_stats": dict(stats),
    }


def _zero_sb():
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


class TestEfficiencyVarianceFix(unittest.TestCase):
    def test_player_ratio_moments_and_mixed_rate_identity(self):
        # 1) Single-rate player over N games: equals (var_m - p^2 * var_a) / (N * mu_a^2)
        p = 0.80
        ma, va = 5.0, 9.0
        mm = ma * p
        vm = (p ** 2) * va + ma * p * (1.0 - p) + ((ma ** 2) + va - ma) * (0.025 ** 2)
        eff_vm, out_va, cov = player_ratio_moments(mm, vm, ma, va)
        self.assertEqual(eff_vm, vm)
        self.assertEqual(out_va, va)
        self.assertAlmostEqual(cov, p * va, places=10)

        n_games = 35
        mu_bar, var_bar = ratio_mean_and_var(
            n_games * mm,
            n_games * eff_vm,
            n_games * ma,
            n_games * out_va,
            n_games * cov,
        )
        expected_single = (vm - (p ** 2) * va) / (n_games * (ma ** 2))
        self.assertAlmostEqual(mu_bar, p, places=10)
        self.assertAlmostEqual(var_bar, expected_single, places=10)

        # 2) Mixed-rate team: 65% center + 40% guard -> preserves both pure shooting var AND volume-mix var!
        c_ma, c_va, c_p = 10.0, 9.0, 0.65
        c_mm = c_ma * c_p
        c_vm = (c_p ** 2) * c_va + c_ma * c_p * (1.0 - c_p) + 0.25

        g_ma, g_va, g_p = 14.0, 16.0, 0.40
        g_mm = g_ma * g_p
        g_vm = (g_p ** 2) * g_va + g_ma * g_p * (1.0 - g_p) + 0.35

        c_evm, _, c_cov = player_ratio_moments(c_mm, c_vm, c_ma, c_va)
        g_evm, _, g_cov = player_ratio_moments(g_mm, g_vm, g_ma, g_va)

        tot_m = c_mm + g_mm
        tot_a = c_ma + g_ma
        p_bar = tot_m / tot_a
        _, team_var = ratio_mean_and_var(tot_m, c_evm + g_evm, tot_a, c_va + g_va, c_cov + g_cov)

        expected_mixed_num = (
            (c_vm - (c_p ** 2) * c_va)
            + (g_vm - (g_p ** 2) * g_va)
            + ((c_p - p_bar) ** 2) * c_va
            + ((g_p - p_bar) ** 2) * g_va
        )
        self.assertAlmostEqual(team_var, expected_mixed_num / (tot_a ** 2), places=10)

        # 3) Noisy ML variance (var_m < p^2 * var_a) clamps to pure Binomial floor and never goes negative
        noisy_evm, noisy_va, noisy_cov = player_ratio_moments(4.0, 1.0, 5.0, 9.0)
        binom_floor = (0.8 ** 2) * 9.0 + 5.0 * 0.8 * 0.2
        self.assertAlmostEqual(noisy_evm, binom_floor, places=10)
        _, noisy_var = ratio_mean_and_var(4.0, noisy_evm, 5.0, noisy_va, noisy_cov)
        self.assertGreater(noisy_var, 0.0)
        self.assertAlmostEqual(noisy_var, (5.0 * 0.8 * 0.2) / 25.0, places=10)

        # Zero attempts safety
        self.assertEqual(player_ratio_moments(0.0, 0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
        self.assertEqual(ratio_mean_and_var(0.0, 0.0, 0.0, 0.0, 0.0), (0.0, 0.0))

    def test_analytical_vs_monte_carlo_agreement_full_and_midweek(self):
        np.random.seed(12345)
        slots = [{"position": "Util", "count": 10, "is_starting_position": True}]

        # 10 players per team across 7 days (alternating schedules -> 35 player-games each)
        t1_players = []
        t2_players = []
        for idx in range(5):
            # Mix high-% bigs & perimeter scorers
            t1_players.append(
                _exact_moments_player(
                    f"T1_Big_{idx}",
                    "BOS",
                    mu_fga=11.0,
                    var_fga=12.0,
                    fg_p=0.56,
                    fg_sigma_p=0.02,
                    mu_fta=4.5,
                    var_fta=6.5,
                    ft_p=0.79,
                    ft_sigma_p=0.02,
                    rank=20 + idx,
                )
            )
            t1_players.append(
                _exact_moments_player(
                    f"T1_Guard_{idx}",
                    "LAL",
                    mu_fga=16.0,
                    var_fga=20.0,
                    fg_p=0.45,
                    fg_sigma_p=0.02,
                    mu_fta=4.0,
                    var_fta=6.0,
                    ft_p=0.86,
                    ft_sigma_p=0.02,
                    rank=30 + idx,
                )
            )
            t2_players.append(
                _exact_moments_player(
                    f"T2_Big_{idx}",
                    "MIA",
                    mu_fga=11.0,
                    var_fga=12.0,
                    fg_p=0.51,
                    fg_sigma_p=0.02,
                    mu_fta=4.5,
                    var_fta=6.5,
                    ft_p=0.74,
                    ft_sigma_p=0.02,
                    rank=25 + idx,
                )
            )
            t2_players.append(
                _exact_moments_player(
                    f"T2_Guard_{idx}",
                    "OKC",
                    mu_fga=16.0,
                    var_fga=20.0,
                    fg_p=0.44,
                    fg_sigma_p=0.02,
                    mu_fta=4.0,
                    var_fta=6.0,
                    ft_p=0.81,
                    ft_sigma_p=0.02,
                    rank=35 + idx,
                )
            )

        # Mon 2026-11-16 .. Sun 2026-11-22: 3 or 4 games each (~35 games/team)
        sched = []
        for d in ("2026-11-16", "2026-11-18", "2026-11-20", "2026-11-22"):
            for tm in ("BOS", "MIA"):
                sched.append({"scheduled_date": d, "team": tm})
        for d in ("2026-11-17", "2026-11-19", "2026-11-21"):
            for tm in ("LAL", "OKC"):
                sched.append({"scheduled_date": d, "team": tm})

        team1 = {"team_id": 1, "players": t1_players}
        team2 = {"team_id": 2, "players": t2_players}

        def run_both(date_start, sb1, sb2):
            def fake_live(_yq, tid, _wk, _lk=None):
                return (dict(sb1), False) if tid == 1 else (dict(sb2), False)

            with patch("backend.services.matchup_service.resolve_league_key", return_value="466.l.1"), \
                 patch("backend.services.matchup_service.get_live_team_stats", side_effect=fake_live):
                anal = matchup_service.matchup_analysis(
                    object(), team1, team2, 5, date_start, slots, "weekly_stats", sched, live_progress_by_date={}
                )
                mc = matchup_service.matchup_analysis_monte_carlo(
                    object(),
                    team1,
                    team2,
                    5,
                    date_start,
                    slots,
                    "weekly_stats",
                    sched,
                    n_sims=30000,
                    live_progress_by_date={},
                )
                return anal, mc

        # 1) Full 35-game week
        anal_full, mc_full = run_both("2026-11-16", _zero_sb(), _zero_sb())
        for cat in ("fg%", "ft%"):
            gap = abs(anal_full["win_probs"][cat] - mc_full["win_pcts"][cat])
            self.assertLess(gap, 0.02, f"Full-week {cat} gap too high: {gap:.4f}")

        # 2) Mid-week (Thu 2026-11-19) with banked scoreboard stats
        sb1_mid = {**_zero_sb(), "fgm": 115.0, "fga": 230.0, "ftm": 62.0, "fta": 74.0}
        sb2_mid = {**_zero_sb(), "fgm": 108.0, "fga": 232.0, "ftm": 54.0, "fta": 70.0}
        anal_mid, mc_mid = run_both("2026-11-19", sb1_mid, sb2_mid)
        for cat in ("fg%", "ft%"):
            gap = abs(anal_mid["win_probs"][cat] - mc_mid["win_pcts"][cat])
            self.assertLess(gap, 0.02, f"Mid-week {cat} gap too high: {gap:.4f}")

    def test_monte_carlo_variance_recovery_pure_streaky_and_low_volume(self):
        # Single-player empirical simulation test via matchup_analysis_monte_carlo internals:
        # Pure Binomial (sigma_p=0), Streaky (sigma_p=0.04), and Low-volume (mu_a=0.8)
        slots = [{"position": "Util", "count": 1, "is_starting_position": True}]
        sched = [{"scheduled_date": "2026-11-16", "team": "BOS"}]

        for label, ma, va, p, sigma_p in [
            ("pure_binom", 4.5, 6.0, 0.80, 0.0),
            ("streaky", 14.0, 18.0, 0.48, 0.04),
            ("low_volume", 0.8, 1.2, 0.75, 0.0),
        ]:
            player = _exact_moments_player(
                f"P_{label}",
                "BOS",
                mu_fta=ma,
                var_fta=va,
                ft_p=p,
                ft_sigma_p=sigma_p,
                mu_fga=ma,
                var_fga=va,
                fg_p=p,
                fg_sigma_p=sigma_p,
            )
            expected_vm = player["weekly_stats"]["var_ftm"]
            np.random.seed(999)
            with patch("backend.services.matchup_service.resolve_league_key", return_value="466.l.1"), \
                 patch("backend.services.matchup_service.get_live_team_stats", return_value=(_zero_sb(), False)):
                anal = matchup_service.matchup_analysis(
                    object(),
                    {"team_id": 1, "players": [player]},
                    {"team_id": 2, "players": []},
                    5,
                    "2026-11-16",
                    slots,
                    "weekly_stats",
                    sched,
                    live_progress_by_date={},
                )
            self.assertGreater(anal["agg_dists"]["team1"]["ft%"]["var"], 0.0)
            self.assertAlmostEqual(anal["agg_dists"]["team1"]["ftm"]["var"], expected_vm, places=6)

            # Check MC directly matches theoretical makes mean & ratio mean without NaN/crash
            with patch("backend.services.matchup_service.resolve_league_key", return_value="466.l.1"), \
                 patch("backend.services.matchup_service.get_live_team_stats", return_value=(_zero_sb(), False)):
                mc = matchup_service.matchup_analysis_monte_carlo(
                    object(),
                    {"team_id": 1, "players": [player]},
                    {"team_id": 2, "players": []},
                    5,
                    "2026-11-16",
                    slots,
                    "weekly_stats",
                    sched,
                    n_sims=10000,
                    live_progress_by_date={},
                )
            self.assertAlmostEqual(mc["sim_avg"]["team1"]["fta"], ma, delta=0.1)
            self.assertAlmostEqual(mc["sim_avg"]["team1"]["ftm"], ma * p, delta=0.1)

    def test_streamer_service_matches_analytical_and_questionable_cov(self):
        slots = [
            {"position": "Util", "count": 2, "is_starting_position": True},
            {"position": "BN", "count": 2, "is_starting_position": False},
        ]
        sched = [
            {"scheduled_date": "2026-11-16", "team": "BOS"},
            {"scheduled_date": "2026-11-16", "team": "LAL"},
            {"scheduled_date": "2026-11-16", "team": "MIA"},
            {"scheduled_date": "2026-11-16", "team": "NYK"},
        ]

        t1_starter = _exact_moments_player(
            "T1_Starter", "BOS", mu_fga=15.0, var_fga=16.0, fg_p=0.50, mu_fta=5.0, var_fta=6.0, ft_p=0.84, rank=20
        )
        t2_starter = _exact_moments_player(
            "T2_Starter", "LAL", mu_fga=15.0, var_fga=16.0, fg_p=0.47, mu_fta=5.0, var_fta=6.0, ft_p=0.79, rank=25
        )
        fa_healthy = _exact_moments_player(
            "FA_Healthy", "MIA", mu_fga=12.0, var_fga=10.0, fg_p=0.58, mu_fta=4.0, var_fta=4.0, ft_p=0.88, rank=35
        )
        fa_q = _exact_moments_player(
            "FA_Questionable", "NYK", mu_fga=12.0, var_fga=10.0, fg_p=0.58, mu_fta=4.0, var_fta=4.0, ft_p=0.88, rank=36, status="GTD"
        )

        pool = {
            "FA_Healthy": fa_healthy["weekly_stats"],
            "FA_Questionable": fa_q["weekly_stats"],
        }
        fa_info_map = {
            "FA_Healthy": {"status": "", "positions": "PF,C"},
            "FA_Questionable": {"status": "GTD", "positions": "PF,C"},
        }
        sb1 = {**_zero_sb(), "fgm": 40.0, "fga": 80.0, "ftm": 20.0, "fta": 25.0}
        sb2 = {**_zero_sb(), "fgm": 38.0, "fga": 82.0, "ftm": 18.0, "fta": 24.0}

        def fake_live(_yq, tid, _wk, _lk=None):
            return (dict(sb1), False) if tid == 1 else (dict(sb2), False)

        with patch("backend.services.matchup_service.resolve_league_key", return_value="466.l.1"), \
             patch("backend.services.matchup_service.get_live_team_stats", side_effect=fake_live), \
             patch("backend.services.streamer_service.yahoo_client.get_yahoo_fa_info_map", return_value=fa_info_map), \
             patch(
                 "backend.services.streamer_service.yahoo_client.build_position_resolver",
                 return_value=lambda *a, **kw: "PF,C",
             ):
            # Open Util_2 slot so adding FA directly gives clean after-state comparison
            stream_res = streamer_service.get_streamer_recommendations(
                yahoo_query=object(),
                team1={"team_id": 1, "players": [t1_starter]},
                team2={"team_id": 2, "players": [t2_starter]},
                week_num=5,
                date_start="2026-11-16",
                roster_positions=slots,
                stats_source="weekly_stats",
                nba_schedule=sched,
                player_stats_pool=pool,
                all_rostered_names={"T1_Starter", "T2_Starter"},
                pickup_mode="today",
                ros_stats_pool=pool,
                live_progress_by_date={},
            )
            anal_base = matchup_service.matchup_analysis(
                object(),
                {"team_id": 1, "players": [t1_starter]},
                {"team_id": 2, "players": [t2_starter]},
                5,
                "2026-11-16",
                slots,
                "weekly_stats",
                sched,
                live_progress_by_date={},
            )
            anal_with_fa = matchup_service.matchup_analysis(
                object(),
                {"team_id": 1, "players": [t1_starter, fa_healthy]},
                {"team_id": 2, "players": [t2_starter]},
                5,
                "2026-11-16",
                slots,
                "weekly_stats",
                sched,
                live_progress_by_date={},
            )

        recs = {r["player"]["name"]: r for r in stream_res["recommendations"]}
        self.assertIn("FA_Healthy", recs)
        self.assertIn("FA_Questionable", recs)

        for cat_key in ("fg%", "ft%"):
            cat_imp = next(c for c in recs["FA_Healthy"]["impact"]["primary_boost_categories"] if c["cat"] == cat_key.upper())
            self.assertAlmostEqual(cat_imp["before_p"], round(anal_base["win_probs"][cat_key], 3), places=3)
            self.assertAlmostEqual(cat_imp["after_p"], round(anal_with_fa["win_probs"][cat_key], 3), places=3)

        # Verify Bernoulli mixture covariance for play_prob=0.75 questionable pickup manually
        fa_vec = stats_to_vec(fa_q["weekly_stats"])
        self.assertEqual(len(fa_vec), VEC_LEN)
        pp = 0.75
        base_t1 = anal_base["agg_dists"]["team1"]
        base_t2 = anal_base["agg_dists"]["team2"]
        t2_fg_mu, t2_fg_var = ratio_mean_and_var(
            base_t2["fgm"]["mu"], base_t2["fgm"]["var"], base_t2["fga"]["mu"], base_t2["fga"]["var"], base_t2["fgm"]["cov"]
        )
        new_m = base_t1["fgm"]["mu"] + pp * fa_vec[7]
        new_a = base_t1["fga"]["mu"] + pp * fa_vec[8]
        new_mv = base_t1["fgm"]["var"] + pp * fa_vec[18] + pp * (1.0 - pp) * (fa_vec[7] ** 2)
        new_av = base_t1["fga"]["var"] + pp * fa_vec[19] + pp * (1.0 - pp) * (fa_vec[8] ** 2)
        new_cov = base_t1["fgm"]["cov"] + pp * fa_vec[22] + pp * (1.0 - pp) * (fa_vec[7] * fa_vec[8])
        t1_fg_mu, t1_fg_var = ratio_mean_and_var(new_m, new_mv, new_a, new_av, new_cov)
        expected_q_p = round(prob_positive(t1_fg_mu - t2_fg_mu, t1_fg_var + t2_fg_var), 3)

        q_fg_imp = next(c for c in recs["FA_Questionable"]["impact"]["primary_boost_categories"] if c["cat"] == "FG%")
        self.assertAlmostEqual(q_fg_imp["after_p"], expected_q_p, places=3)


if __name__ == "__main__":
    unittest.main()
