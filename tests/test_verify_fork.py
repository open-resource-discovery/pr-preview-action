import importlib.util
import json
import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("verify_fork", ROOT / ".internal-tools" / "verify_fork.py")
verify_fork = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verify_fork)

REPO = "example/docs"
BASE = {"id": 1, "full_name": REPO}
FORK = {"id": 2, "full_name": "author/docs-fork", "owner": {"login": "author"}}
BRANCH = "feature/abc+docs"
SHA = "a" * 40
PULLS = "/repos/example/docs/pulls"


def event(numbers=()):
    return {
        "action": "completed",
        "repository": BASE.copy(),
        "workflow_run": {
            "repository": BASE.copy(),
            "head_repository": deepcopy(FORK),
            "head_branch": BRANCH,
            "head_sha": SHA,
            "pull_requests": [{"number": n} for n in numbers],
            "event": "pull_request",
            "status": "completed",
            "conclusion": "success",
        },
    }


def pull(number=12, state="open", sha=SHA):
    return {
        "number": number,
        "state": state,
        "base": {"repo": BASE.copy()},
        "head": {"repo": deepcopy(FORK), "sha": sha, "ref": BRANCH},
    }


class VerifyForkTest(unittest.TestCase):
    def test_association_uses_github_state_and_current_identity(self):
        for state, expected in (("open", "deploy"), ("closed", "remove")):
            with self.subTest(state=state):
                get = MagicMock(return_value=pull(state=state))
                self.assertEqual(verify_fork.resolve(event([12]), REPO, get), (12, expected))
                get.assert_called_once_with(f"{PULLS}/12")

    def test_failed_unrelated_and_ambiguous_runs_do_not_access_api(self):
        cases = [
            {"event": "push"}, {"conclusion": "failure"}, {"status": "in_progress"},
            {"repository": {"id": 7}}, {"head_repository": BASE.copy()},
            {"head_repository": None}, {"head_sha": "not-a-commit"},
            {"pull_requests": [{"number": 12}, {"number": 13}]},
            {"pull_requests": [{"number": "12"}]},
        ]
        for fields in cases:
            with self.subTest(fields=fields):
                data = event([12])
                data["workflow_run"].update(fields)
                get = MagicMock()
                self.assertIsNone(verify_fork.resolve(data, REPO, get))
                get.assert_not_called()
        get = MagicMock()
        self.assertIsNone(verify_fork.resolve(event([12]), "another/repo", get))
        get.assert_not_called()

    def test_pulls_must_match_repository_ids_sha_ref_and_number(self):
        mutations = [
            {"number": 99}, {"state": "unknown"}, {"base": {"repo": {"id": 9}}},
            {"head": {**pull()["head"], "sha": "b" * 40}},
            {"head": {**pull()["head"], "ref": "other"}},
            {"head": {**pull()["head"], "repo": {"id": 9}}},
            {"head": {**pull()["head"], "repo": None}},
        ]
        for fields in mutations:
            with self.subTest(fields=fields):
                self.assertIsNone(verify_fork.resolve(event([12]), REPO, lambda _: {**pull(), **fields}))

    def test_fallback_paginates_checks_identity_and_rechecks_selected_pr(self):
        calls = []

        def get(path):
            calls.append(path)
            split = urlsplit(path)
            if not split.query:
                self.assertEqual(path, f"{PULLS}/12")
                return pull(state="closed")
            self.assertEqual(split.path, PULLS)
            query = parse_qs(split.query)
            self.assertEqual(query["head"], [f"author:{BRANCH}"])
            self.assertEqual(query["state"], ["all"])
            self.assertEqual(query["per_page"], ["100"])
            return [pull(456, sha="b" * 40)] * 100 if query["page"] == ["1"] else [pull()]

        self.assertEqual(verify_fork.resolve(event(), REPO, get), (12, "remove"))
        self.assertEqual(len(calls), 3)

    def test_discovery_skips_missing_ambiguous_or_outdated_matches(self):
        self.assertIsNone(verify_fork.resolve(event(), REPO, lambda _: []))
        self.assertIsNone(verify_fork.resolve(event(), REPO, lambda _: [pull(), pull(13)]))
        get = MagicMock(side_effect=[[pull()], pull(sha="b" * 40)])
        self.assertIsNone(verify_fork.resolve(event(), REPO, get))

    def test_api_error_is_not_treated_as_successful_skip(self):
        get = MagicMock(side_effect=OSError("API unavailable"))
        with self.assertRaises(OSError):
            verify_fork.resolve(event(), REPO, get)

    def test_main_writes_only_verified_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            event_path = Path(tmp) / "event.json"
            output = Path(tmp) / "outputs"
            output.touch()
            env = {
                "GITHUB_EVENT_PATH": str(event_path), "GITHUB_OUTPUT": str(output),
                "GITHUB_API_URL": "https://api.github.test", "GITHUB_REPOSITORY": REPO,
                "GITHUB_TOKEN": "placeholder",
            }
            event_path.write_text(json.dumps(event([12])))
            with patch.dict(os.environ, env), patch.object(verify_fork, "build_opener") as build:
                response = build.return_value.open.return_value.__enter__.return_value
                response.read.return_value = json.dumps(pull()).encode()
                verify_fork.main()
                self.assertEqual(output.read_text(), "pr_number=12\noperation=deploy\n")
                response.read.return_value = json.dumps(pull(sha="f" * 40)).encode()
                verify_fork.main()
                self.assertEqual(output.read_text(), "pr_number=12\noperation=deploy\n")


if __name__ == "__main__":
    unittest.main()
