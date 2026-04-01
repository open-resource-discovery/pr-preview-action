import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".internal-tools" / "generate_qr_svg.py"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


class TestGenerateQrSvg(unittest.TestCase):
    def test_generates_png_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output = Path(tmp_dir) / "nested" / "qr.png"
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "https://example.com/pr-123/", str(output)],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertTrue(output.exists())
            self.assertGreater(output.stat().st_size, 0)
            self.assertEqual(output.read_bytes()[:8], PNG_MAGIC)

    def test_fails_on_missing_args(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT)],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("usage: generate_qr_svg.py", result.stderr)


if __name__ == "__main__":
    unittest.main()
