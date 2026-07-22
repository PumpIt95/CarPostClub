from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SUBJECT_PATH = Path(__file__).with_name("facebook_publish_handoff_recovery.py")
SPEC = importlib.util.spec_from_file_location("facebook_publish_handoff_recovery", SUBJECT_PATH)
assert SPEC and SPEC.loader
SUBJECT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUBJECT)


def owner() -> dict:
    return {
        "owner": "facebook-ready-publisher",
        "handoff": True,
        "publishClicked": False,
        "backendLiveStatusWritten": False,
        "protectedComposerUrl": "https://www.facebook.com/marketplace/create/vehicle?step=audience",
        "albumId": "album-a1",
        "stock": "A1",
        "vin": "VINA1",
        "supportedClaimFailureCount": 2,
        "rebuildAttempted": False,
    }


def summary() -> dict:
    return {
        "ok": True,
        "readyToPublishItems": [{
            "albumId": "album-a1",
            "stockNumber": "A1",
            "vin": "VINA1",
        }],
    }


class HandoffRecoveryTests(unittest.TestCase):
    def classify(self, current_owner: dict | None = None, current_summary: dict | None = None, **kwargs):
        return SUBJECT.classify_rebuild(
            current_owner or owner(),
            current_summary or summary(),
            visible_state=kwargs.get("visible_state", "blank_or_unusable"),
            duplicate_state=kwargs.get("duplicate_state", "none"),
            original_session_state=kwargs.get("original_session_state", "inactive"),
        )

    def test_all_exact_fail_closed_proofs_allow_one_rebuild(self) -> None:
        result = self.classify()
        self.assertTrue(result["allowed"])
        self.assertEqual(result["status"], "rebuild_once_allowed")
        self.assertEqual(result["stockNumber"], "A1")

    def test_publish_or_backend_write_never_allows_rebuild(self) -> None:
        published = owner()
        published["publishClicked"] = True
        self.assertIn("publish_already_clicked", self.classify(published)["blockers"])
        backend = owner()
        backend["backendLiveStatusWritten"] = True
        self.assertIn("backend_already_written", self.classify(backend)["blockers"])

    def test_rebuild_requires_two_supported_claim_failures_and_only_runs_once(self) -> None:
        too_early = owner()
        too_early["supportedClaimFailureCount"] = 1
        self.assertFalse(self.classify(too_early)["allowed"])
        repeated = owner()
        repeated["rebuildAttempted"] = True
        self.assertIn("rebuild_already_attempted", self.classify(repeated)["blockers"])

    def test_rebuild_requires_exact_ready_target_and_no_live_duplicate(self) -> None:
        changed = summary()
        changed["readyToPublishItems"][0]["vin"] = "OTHER"
        self.assertIn("exact_target_not_currently_ready", self.classify(current_summary=changed)["blockers"])
        self.assertIn("duplicate_state_live", self.classify(duplicate_state="live")["blockers"])

    def test_rebuild_requires_blank_composer_and_inactive_original_session(self) -> None:
        self.assertIn("composer_visible_state_recoverable", self.classify(visible_state="recoverable")["blockers"])
        self.assertIn("original_session_active", self.classify(original_session_state="active")["blockers"])


if __name__ == "__main__":
    unittest.main()
