import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


ACTION = Path(__file__).resolve().parents[1] / "action.yml"
TARGET_BRANCH = "pages"
PREVIEW_DIR = "source/pr-37"


class TestRemovePreview(unittest.TestCase):
    def setUp(self) -> None:
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        root = Path(folder.name)
        self.remote = root / "pages.git"
        self.cleanup = root / "cleanup"
        self.publisher = root / "publisher"
        self.queue = root / "concurrent-updates"
        self.env = {
            "PATH": os.environ["PATH"],
            "HOME": str(root),
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_ALLOW_PROTOCOL": "file",
            "GIT_AUTHOR_NAME": "Preview test",
            "GIT_AUTHOR_EMAIL": "preview@example.test",
            "GIT_COMMITTER_NAME": "Preview test",
            "GIT_COMMITTER_EMAIL": "preview@example.test",
            "PREVIEW_DIR": PREVIEW_DIR,
            "TARGET_BRANCH": TARGET_BRANCH,
            "PR_NUMBER": "37",
            "CONCURRENT_CHECKOUT": str(self.publisher),
            "CONCURRENT_UPDATES": str(self.queue),
        }
        self.git(root, "init", "--bare", "--initial-branch", TARGET_BRANCH, str(self.remote))
        self.git(root, "clone", str(self.remote), str(self.publisher))
        self.add_preview(PREVIEW_DIR)
        self.git(self.publisher, "push", "origin", TARGET_BRANCH)
        self.git(root, "clone", str(self.remote), str(self.cleanup))

    def git(self, folder: Path, *args: str) -> str:
        return subprocess.run(
            ["git", "-C", str(folder), *args], env=self.env, check=True,
            capture_output=True, text=True, timeout=10,
        ).stdout.strip()

    def add_preview(self, folder: str) -> str:
        preview = self.publisher / folder / "index.html"
        preview.parent.mkdir(parents=True)
        preview.write_text("preview\n", encoding="utf-8")
        self.git(self.publisher, "add", "--", folder)
        self.git(self.publisher, "commit", "-m", f"Publish {folder}")
        return self.git(self.publisher, "rev-parse", "HEAD")

    def remove_preview(self) -> str:
        self.git(self.publisher, "rm", "-r", "--", PREVIEW_DIR)
        self.git(self.publisher, "commit", "-m", "Remove preview from another run")
        return self.git(self.publisher, "rev-parse", "HEAD")

    def run_cleanup(self, *concurrent_commits: str) -> subprocess.CompletedProcess[str]:
        self.queue.write_text("".join(commit + "\n" for commit in concurrent_commits), encoding="utf-8")
        step = ACTION.read_text(encoding="utf-8").split("    - name: Remove preview directory (remove)\n", 1)[1]
        script = step.split("      run: |\n", 1)[1].split("\n    - name:", 1)[0]
        # Let the publisher advance the real local remote just before each cleanup push.
        interleave = textwrap.dedent(r'''
            git() {
              if [[ "$1" == push ]] && read -r commit < "$CONCURRENT_UPDATES"; then
                sed -i '1d' "$CONCURRENT_UPDATES" || exit 2
                command git -C "$CONCURRENT_CHECKOUT" push origin "$commit:refs/heads/$TARGET_BRANCH" || exit 2
              fi
              command git "$@"
            }
        ''')
        return subprocess.run(
            ["bash", "-c", interleave + textwrap.dedent(script)], cwd=self.cleanup, env=self.env,
            capture_output=True, text=True, timeout=30,
        )

    def test_cleanup_preserves_concurrent_publication(self) -> None:
        other_commit = self.add_preview("source/pr-38")
        result = self.run_cleanup(other_commit)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git(self.remote, "rev-parse", "HEAD^"), other_commit)
        self.assertEqual(self.git(self.remote, "ls-tree", "-r", "--name-only", "HEAD"), "source/pr-38/index.html")

    def test_concurrent_removal_counts_as_success(self) -> None:
        other_commit = self.remove_preview()
        result = self.run_cleanup(other_commit)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git(self.remote, "rev-parse", "HEAD"), other_commit)
        self.assertEqual(self.git(self.remote, "ls-tree", "-r", "--name-only", "HEAD"), "")

    def test_retry_limit_keeps_all_concurrent_updates(self) -> None:
        commits = [self.add_preview(f"source/pr-{number}") for number in range(38, 44)]
        result = self.run_cleanup(*commits)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("after 5 attempts", result.stderr)
        self.assertEqual(self.git(self.remote, "rev-parse", "HEAD"), commits[-2])
        self.assertEqual(self.queue.read_text(encoding="utf-8").splitlines(), [commits[-1]])

    def test_removal_during_final_attempt_counts_as_success(self) -> None:
        commits = [self.add_preview(f"source/pr-{number}") for number in range(38, 42)]
        other_commit = self.remove_preview()
        result = self.run_cleanup(*commits, other_commit)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git(self.remote, "rev-parse", "HEAD"), other_commit)


if __name__ == "__main__":
    unittest.main()
