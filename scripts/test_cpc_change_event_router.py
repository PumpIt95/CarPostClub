from __future__ import annotations

import contextlib
import datetime as dt
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SUBJECT_PATH = Path(__file__).with_name("cpc_change_event_router.py")
SPEC = importlib.util.spec_from_file_location("cpc_change_event_router", SUBJECT_PATH)
assert SPEC and SPEC.loader
SUBJECT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUBJECT)


def ready_item(stock: str, *, dealership: str = "15", inventory_type: str = "2") -> dict:
    return {
        "albumId": f"album-{stock.lower()}",
        "stockNumber": stock,
        "vin": f"VIN{stock}",
        "dealershipId": dealership,
        "inventoryTypeId": inventory_type,
        "mediaCount": 12,
        "updatedAt": "2026-07-19T12:00:00.000Z",
    }


def summary(*, cpc: str = "cpc-a", membership: str = "members-a", price: str = "price-a", details: str = "details-a", membership_run: str = "", price_run: str = "", details_run: str = "", ready=None) -> dict:
    return {
        "ok": True,
        "generatedAt": "2026-07-19T15:00:00Z",
        "readyToPublishItems": list(ready or []),
        "automationSignals": {
            "version": 1,
            "cpc": {"packageFingerprint": cpc},
            "oregans": {
                "membershipFingerprint": membership,
                "priceFingerprint": price,
                "detailsFingerprint": details,
                "latestMembershipChangeRunId": membership_run,
                "latestPriceChangeRunId": price_run,
                "latestDetailsChangeRunId": details_run,
            },
        },
    }


class ChangeEventRouterTests(unittest.TestCase):
    def test_daily_window_matches_production_nine_to_seven(self) -> None:
        self.assertTrue(SUBJECT.within_daily_window(dt.datetime(2026, 7, 19, 9, 0, tzinfo=SUBJECT.LOCAL_TZ)))
        self.assertTrue(SUBJECT.within_daily_window(dt.datetime(2026, 7, 19, 18, 59, tzinfo=SUBJECT.LOCAL_TZ)))
        self.assertFalse(SUBJECT.within_daily_window(dt.datetime(2026, 7, 19, 19, 0, tzinfo=SUBJECT.LOCAL_TZ)))

    def test_ready_filter_excludes_new_and_untracked_dealerships(self) -> None:
        view = SUBJECT.candidate_view({
            "readyToPublishItems": [
                ready_item("USED1"),
                ready_item("NEW1", inventory_type="1"),
                ready_item("OTHER1", dealership="99"),
            ],
        })
        self.assertEqual(view["readyCount"], 1)
        self.assertEqual(view["stocks"], ["USED1"])

    def test_owner_targets_are_stable_and_separate(self) -> None:
        targets = SUBJECT.owner_targets(summary())
        self.assertEqual(targets["photo-package-readiness-monitor"], "cpc-a")
        self.assertEqual(targets["live-facebook-listing-sync"], "members-a")
        self.assertEqual(len(targets["listing-disclosure-audit-and-fix"]), 64)
        self.assertEqual(targets, SUBJECT.owner_targets(summary()))

    def test_first_fingerprint_observation_is_baseline_only(self) -> None:
        pending = {}
        changed = SUBJECT.sync_change_pending(
            pending,
            {},
            SUBJECT.owner_targets(summary()),
            dt.datetime(2026, 7, 19, 12, 0, tzinfo=SUBJECT.LOCAL_TZ),
        )
        self.assertEqual(changed, [])
        self.assertEqual(pending, {})

    def test_each_changed_signal_routes_to_its_exact_owner(self) -> None:
        previous = SUBJECT.owner_targets(summary())
        current = SUBJECT.owner_targets(summary(
            cpc="cpc-b",
            membership="members-b",
            price="price-b",
            price_run="price-run-b",
        ))
        pending = {}
        changed = SUBJECT.sync_change_pending(
            pending,
            previous,
            current,
            dt.datetime(2026, 7, 19, 12, 0, tzinfo=SUBJECT.LOCAL_TZ),
        )
        self.assertEqual(set(changed), set(SUBJECT.OWNER_TARGETS))
        self.assertEqual(pending["live-facebook-listing-sync"]["signal"], "oregans_membership")
        self.assertEqual(pending["listing-disclosure-audit-and-fix"]["signal"], "oregans_details")
        self.assertEqual(pending["photo-package-readiness-monitor"]["signal"], "cpc_package")

    def test_membership_change_does_not_duplicate_listing_details_work(self) -> None:
        previous = SUBJECT.owner_targets(summary())
        current = SUBJECT.owner_targets(summary(
            membership="members-b",
            membership_run="membership-run-b",
            price="price-b",
            details="details-b",
        ))
        pending = {}
        changed = SUBJECT.sync_change_pending(
            pending,
            previous,
            current,
            dt.datetime(2026, 7, 19, 12, 0, tzinfo=SUBJECT.LOCAL_TZ),
        )
        self.assertEqual(changed, ["live-facebook-listing-sync"])
        self.assertNotIn("listing-disclosure-audit-and-fix", pending)

    def test_transient_details_change_routes_from_persisted_run_id(self) -> None:
        previous = SUBJECT.owner_targets(summary(details_run="details-run-a"))
        current = SUBJECT.owner_targets(summary(details_run="details-run-b"))
        pending = {}
        changed = SUBJECT.sync_change_pending(
            pending,
            previous,
            current,
            dt.datetime(2026, 7, 19, 12, 0, tzinfo=SUBJECT.LOCAL_TZ),
        )
        self.assertEqual(changed, ["listing-disclosure-audit-and-fix"])

    def test_change_run_id_routes_transient_membership_change_even_when_final_fingerprint_matches(self) -> None:
        previous = SUBJECT.owner_targets(summary(membership_run="run-a"))
        current = SUBJECT.owner_targets(summary(membership_run="run-b"))
        pending = {}
        changed = SUBJECT.sync_change_pending(
            pending,
            previous,
            current,
            dt.datetime(2026, 7, 19, 12, 0, tzinfo=SUBJECT.LOCAL_TZ),
        )
        self.assertEqual(changed, ["live-facebook-listing-sync"])

    def test_one_owner_is_selected_in_safety_priority_order(self) -> None:
        pending = {
            owner: {"lastAttemptEpoch": 0, "signal": signal}
            for owner, signal in SUBJECT.OWNER_TARGETS.items()
        }
        pending[SUBJECT.PUBLISHER_ID] = {"lastAttemptEpoch": 0, "signal": "ready_to_publish"}
        selected = SUBJECT.next_pending_owner(pending, 10_000)
        self.assertEqual(selected[0], "live-facebook-listing-sync")

    def test_publisher_retries_unchanged_only_after_cooldown(self) -> None:
        candidate = SUBJECT.candidate_view({"readyToPublishItems": [ready_item("A1")]})
        publisher = {
            "lastAttemptSignature": candidate["signature"],
            "lastAttemptEpoch": 1_000,
            "lastRunStatus": "done",
        }
        self.assertFalse(SUBJECT.publisher_should_queue(candidate, publisher, 1_100))
        self.assertTrue(SUBJECT.publisher_should_queue(
            candidate,
            publisher,
            1_000 + SUBJECT.PUBLISHER_UNCHANGED_RETRY_SECONDS,
        ))

    def test_ready_package_can_be_handled_by_publisher_without_a_second_readiness_run(self) -> None:
        previous = SUBJECT.owner_targets(summary(cpc="cpc-a"))
        current_summary = summary(cpc="cpc-b", ready=[ready_item("A1")])
        pending = {}
        changed = SUBJECT.sync_change_pending(
            pending,
            previous,
            SUBJECT.owner_targets(current_summary),
            dt.datetime(2026, 7, 19, 12, 0, tzinfo=SUBJECT.LOCAL_TZ),
        )
        publisher_queued = SUBJECT.sync_publisher_pending(
            pending,
            {},
            SUBJECT.candidate_view(current_summary),
            dt.datetime(2026, 7, 19, 12, 0, tzinfo=SUBJECT.LOCAL_TZ),
        )
        SUBJECT.coalesce_ready_package_work(pending, changed, publisher_queued)
        self.assertTrue(publisher_queued)
        self.assertIn(SUBJECT.PUBLISHER_ID, pending)
        self.assertNotIn("photo-package-readiness-monitor", pending)

    def test_cli_baselines_then_routes_a_membership_change_without_running(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_path = root / "state.json"
            summary_path = root / "summary.json"
            summary_path.write_text(json.dumps(summary()), encoding="utf-8")
            base_argv = [
                str(SUBJECT_PATH),
                "--summary-file", str(summary_path),
                "--state-path", str(state_path),
                "--now", "2026-07-19T12:00:00-03:00",
                "--dry-run",
            ]
            with mock.patch.object(sys, "argv", base_argv), mock.patch.object(
                SUBJECT, "availability_blocker", return_value=""
            ), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(SUBJECT.main(), 0)

            summary_path.write_text(json.dumps(summary(membership="members-b")), encoding="utf-8")
            stdout = io.StringIO()
            with mock.patch.object(sys, "argv", base_argv), mock.patch.object(
                SUBJECT, "availability_blocker", return_value=""
            ), contextlib.redirect_stdout(stdout):
                self.assertEqual(SUBJECT.main(), 0)
            output = json.loads(stdout.getvalue())
            self.assertEqual(output["status"], "would_trigger")
            self.assertEqual(output["owner"], "live-facebook-listing-sync")
            self.assertEqual(output["signal"], "oregans_membership")

    def test_ready_only_fallback_does_not_erase_last_fingerprint_baseline(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_path = root / "state.json"
            summary_path = root / "summary.json"
            baseline = SUBJECT.owner_targets(summary())
            state_path.write_text(json.dumps({"observedOwnerTargets": baseline}), encoding="utf-8")
            summary_path.write_text(json.dumps({"ok": True, "readyToPublishItems": []}), encoding="utf-8")
            argv = [
                str(SUBJECT_PATH),
                "--summary-file", str(summary_path),
                "--state-path", str(state_path),
                "--now", "2026-07-19T12:00:00-03:00",
                "--dry-run",
            ]
            with mock.patch.object(sys, "argv", argv), mock.patch.object(
                SUBJECT, "availability_blocker", return_value=""
            ), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(SUBJECT.main(), 0)
            self.assertEqual(json.loads(state_path.read_text())["observedOwnerTargets"], baseline)


if __name__ == "__main__":
    unittest.main()
