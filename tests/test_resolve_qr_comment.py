import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".internal-tools" / "resolve_qr_comment.py"


def run_script(*args: str) -> dict[str, str]:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(result.stderr)

    values: dict[str, str] = {}
    for line in result.stdout.splitlines():
        key, value = line.split("=", 1)
        values[key] = value
    return values


class TestResolveQrComment(unittest.TestCase):
    def test_public_github_uses_pages_url_with_cache_buster(self) -> None:
        data = run_script(
            "--server-url",
            "https://github.com",
            "--current-repo",
            "open-resource-discovery/pr-preview-action",
            "--target-repo",
            "",
            "--target-branch",
            "main",
            "--preview-target-folder",
            "pr-preview/pr-42",
            "--preview-url",
            "https://open-resource-discovery.github.io/pr-preview/pr-42/",
            "--qr-enabled",
            "true",
        )

        self.assertEqual(
            data["qr_code_check_url"],
            "https://open-resource-discovery.github.io/pr-preview/pr-42/pr-preview-qr.png",
        )
        self.assertRegex(
            data["qr_code_url"],
            r"^https://open-resource-discovery\.github\.io/pr-preview/pr-42/pr-preview-qr\.png\?v=\d+$",
        )
        self.assertIn(data["qr_code_url"], data["qr_code_suffix"])
        self.assertIn('alt="QR code for preview link"', data["qr_code_suffix"])

    def test_ghes_same_repo_uses_relative_blob_raw_url(self) -> None:
        data = run_script(
            "--server-url",
            "https://github.tools.sap",
            "--current-repo",
            "CPA/pr-preview",
            "--target-repo",
            "",
            "--target-branch",
            "main",
            "--preview-target-folder",
            "pr-preview/pr-42",
            "--preview-url",
            "https://pages.github.tools.sap/CPA/pr-preview/pr-preview/pr-42/",
            "--qr-enabled",
            "true",
        )

        self.assertEqual(
            data["qr_code_url"],
            "../blob/main/pr-preview/pr-42/pr-preview-qr.png?raw=true",
        )
        self.assertEqual(
            data["qr_code_check_url"],
            "https://pages.github.tools.sap/CPA/pr-preview/pr-preview/pr-42/pr-preview-qr.png",
        )

    def test_ghes_cross_repo_uses_cross_repo_blob_raw_url(self) -> None:
        data = run_script(
            "--server-url",
            "https://github.tools.sap",
            "--current-repo",
            "CPA/pr-preview-lab",
            "--target-repo",
            "CPA/pr-preview",
            "--target-branch",
            "main",
            "--preview-target-folder",
            "pr-preview-lab/pr-15",
            "--preview-url",
            "https://pages.github.tools.sap/CPA/pr-preview/pr-preview-lab/pr-15/",
            "--qr-enabled",
            "true",
        )

        self.assertEqual(
            data["qr_code_url"],
            "../../../CPA/pr-preview/blob/main/pr-preview-lab/pr-15/pr-preview-qr.png?raw=true",
        )

    def test_disabled_qr_returns_empty_values(self) -> None:
        data = run_script(
            "--server-url",
            "https://github.com",
            "--current-repo",
            "open-resource-discovery/pr-preview-action",
            "--target-repo",
            "",
            "--target-branch",
            "main",
            "--preview-target-folder",
            "pr-preview/pr-42",
            "--preview-url",
            "https://open-resource-discovery.github.io/pr-preview/pr-42/",
            "--qr-enabled",
            "false",
        )

        self.assertEqual(data["qr_code_check_url"], "")
        self.assertEqual(data["qr_code_url"], "")
        self.assertEqual(data["qr_code_suffix"], "")

    def test_non_http_preview_url_returns_empty_values(self) -> None:
        data = run_script(
            "--server-url",
            "https://github.com",
            "--current-repo",
            "open-resource-discovery/pr-preview-action",
            "--target-repo",
            "",
            "--target-branch",
            "main",
            "--preview-target-folder",
            "pr-preview/pr-42",
            "--preview-url",
            "pr-preview/pr-42/",
            "--qr-enabled",
            "true",
        )

        self.assertEqual(data["qr_code_check_url"], "")
        self.assertEqual(data["qr_code_url"], "")
        self.assertEqual(data["qr_code_suffix"], "")


if __name__ == "__main__":
    unittest.main()
