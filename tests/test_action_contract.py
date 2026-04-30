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


if __name__ == "__main__":
    unittest.main()
