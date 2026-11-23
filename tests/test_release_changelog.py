import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOT = "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>"


class TestReleaseChangelog(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        checkout = Path(temp.name) / "checkout"
        checkout.mkdir()
        subprocess.run(["git", "init", "--quiet"], cwd=checkout, check=True)
        subprocess.run(
            ["sh", ROOT / ".internal-tools/prepare-changelog-commit.sh"], cwd=checkout, check=True
        )
        # The release action commits in a copy, after staging the raw generator output.
        self.repo = Path(temp.name) / "release-copy"
        shutil.copytree(checkout, self.repo)
        self.env = {**os.environ, "GITHUB_WORKSPACE": str(ROOT)}
        self.expected = "# Changelog\n\n## [unreleased]\n\n## [1.0.0]\n\n- Release notes\n\n## [0.9.0]\n"
        generated = self.expected.replace("\n\n## [unreleased]", "\n\n\n## [unreleased]").replace(
            "\n\n## [0.9.0]", "\n\n\n## [0.9.0]"
        )
        (self.repo / "CHANGELOG.md").write_text(generated, encoding="utf-8")

    def git(self, *args, check=True):
        return subprocess.run(
            ["git", *args], cwd=self.repo, env=self.env, check=check, capture_output=True, text=True
        )

    def test_formats_the_committed_blob_and_signs_off_once(self):
        self.git("add", "--", "CHANGELOG.md")
        self.assertEqual(self.git("show", ":CHANGELOG.md").stdout, self.expected)
        self.git("commit", "-m", "Update changelog")
        self.assertEqual(self.git("show", "HEAD:CHANGELOG.md").stdout, self.expected)
        self.git("add", "--", "CHANGELOG.md")
        self.git("diff", "--cached", "--exit-code")
        self.git("commit", "--amend", "--no-edit")
        self.assertEqual(self.git("show", "-s", "--format=%an <%ae>", "HEAD").stdout.strip(), BOT)
        self.assertEqual(
            self.git("show", "-s", "--format=%(trailers:key=Signed-off-by,valueonly)", "HEAD").stdout.strip(),
            BOT,
        )

    def test_formatter_failure_blocks_the_commit(self):
        self.env["GITHUB_WORKSPACE"] = str(self.repo)  # No formatter installed in this copy.
        self.assertNotEqual(self.git("add", "--", "CHANGELOG.md", check=False).returncode, 0)
        self.assertNotEqual(self.git("commit", "-m", "Update changelog", check=False).returncode, 0)
        self.assertNotEqual(self.git("rev-parse", "--verify", "HEAD", check=False).returncode, 0)
