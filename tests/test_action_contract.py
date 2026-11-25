import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACTION_YML = ROOT / "action.yml"


class TestActionContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = ACTION_YML.read_text(encoding="utf-8")

    def test_references_internal_helper_scripts(self) -> None:
        for needle in (
            ".internal-tools/generate_qr_svg.py",
            ".internal-tools/resolve_qr_comment.py",
            ".internal-tools/wait_for_asset.py",
        ):
            self.assertIn(needle, self.text)

    def test_contains_wait_steps(self) -> None:
        for needle in (
            "Wait for preview URL",
            "Wait for QR asset (public GitHub only)",
            "Resolve QR code suffix",
        ):
            self.assertIn(needle, self.text)

    def test_contains_required_wait_inputs(self) -> None:
        for needle in (
            "wait-poll-attempts:",
            "wait-poll-interval-seconds:",
            "qr-wait-poll-attempts:",
            "qr-wait-poll-interval-seconds:",
        ):
            self.assertIn(needle, self.text)

    def test_keeps_ghes_qr_behavior(self) -> None:
        self.assertIn("github.server_url == 'https://github.com'", self.text)
        self.assertIn(
            "Keeping QR image in comment because access-controlled Pages may redirect the runner to login.",
            self.text,
        )

    def run_setup(self, event: str, head_repo_id: str, action: str) -> dict[str, str]:
        setup_step = self.text.split("    - name: Setup environment\n", 1)[1]
        run_block = setup_step.split("      run: |\n", 1)[1].split("\n    - name:", 1)[0]
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "output"
            subprocess.run(
                ["bash", "-e", "-c", textwrap.dedent(run_block)],
                env={
                    "PATH": os.environ["PATH"],
                    "GITHUB_ACTION_PATH": str(ROOT),
                    "GITHUB_EVENT_NAME": event,
                    "GITHUB_OUTPUT": str(output),
                    "GITHUB_REPOSITORY": "org/source",
                    "GITHUB_REPOSITORY_ID": "123",
                    "GITHUB_SERVER_URL": "https://github.com",
                    "HEAD_REPOSITORY_ID": head_repo_id,
                    "PR_ACTION": action,
                    "PR_NUMBER": "37",
                    "TARGET_REPO": "org/pages",
                    "TARGET_BRANCH": "main",
                    "UMBRELLA_DIR": "",
                    "PAGES_BASE_URL": "https://org.github.io/pages",
                    "QR_ENABLED": "false",
                },
                check=True,
                timeout=10,
            )
            return dict(line.split("=", 1) for line in output.read_text().splitlines() if "=" in line)

    def test_same_repository_pull_request_deploys_and_cleans_up(self) -> None:
        events = {"opened": "deploy", "synchronize": "deploy", "reopened": "deploy", "closed": "remove"}
        for event_action, expected in events.items():
            with self.subTest(action=event_action):
                output = self.run_setup("pull_request", "123", event_action)
                self.assertEqual(output["deployment_action"], expected)
                self.assertEqual(output["preview_target_folder"], "source/pr-37")

    def test_forks_and_privileged_events_are_skipped(self) -> None:
        for event, repo, action in (
            ("pull_request", "456", "opened"),
            ("pull_request", "456", "closed"),
            ("pull_request", "", "closed"),
            ("pull_request_target", "123", "opened"),
            ("workflow_run", "123", "completed"),
        ):
            with self.subTest(event=event, repo=repo, action=action):
                self.assertEqual(self.run_setup(event, repo, action), {"deployment_action": "skip"})

    def test_fork_input_cannot_enable_any_action_steps(self) -> None:
        self.assertIn("  fork:\n", self.text)
        self.assertNotIn("inputs.fork", self.text)
        self.assertNotIn("steps.worker", self.text)
        self.assertFalse((ROOT / "examples" / "pr-preview-worker.yml").exists())


if __name__ == "__main__":
    unittest.main()
