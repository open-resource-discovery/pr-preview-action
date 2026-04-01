import collections
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".internal-tools" / "wait_for_asset.py"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


class TestHandler(BaseHTTPRequestHandler):
    attempts = collections.Counter()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/preview":
            self._send(200, "text/html", b"<html>ok</html>")
            return

        if self.path == "/png":
            self._send(200, "image/png", PNG_MAGIC + b"payload")
            return

        if self.path == "/not-png":
            self._send(200, "text/html", b"<html>not png</html>")
            return

        if self.path == "/eventual":
            type(self).attempts[self.path] += 1
            if type(self).attempts[self.path] < 2:
                self._send(404, "text/plain", b"missing")
            else:
                self._send(200, "text/html", b"<html>ready</html>")
            return

        self._send(404, "text/plain", b"missing")

    def _send(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


class TestWaitForAsset(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), TestHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def setUp(self) -> None:
        TestHandler.attempts.clear()

    def run_script(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_succeeds_for_reachable_preview(self) -> None:
        result = self.run_script(
            "--url",
            f"{self.base_url}/preview",
            "--attempts",
            "1",
            "--interval-seconds",
            "0",
            "--label",
            "preview",
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("Preview is reachable", result.stdout)

    def test_retries_and_then_succeeds(self) -> None:
        result = self.run_script(
            "--url",
            f"{self.base_url}/eventual",
            "--attempts",
            "2",
            "--interval-seconds",
            "0",
            "--label",
            "preview",
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("Preview check attempt 1/2: status=404", result.stdout)
        self.assertIn("Preview is reachable (attempt 2/2).", result.stdout)

    def test_validates_png_assets(self) -> None:
        result = self.run_script(
            "--url",
            f"{self.base_url}/png",
            "--attempts",
            "1",
            "--interval-seconds",
            "0",
            "--label",
            "qr asset",
            "--expect",
            "png",
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("valid PNG", result.stdout)

    def test_fails_for_non_png_when_png_is_required(self) -> None:
        result = self.run_script(
            "--url",
            f"{self.base_url}/not-png",
            "--attempts",
            "1",
            "--interval-seconds",
            "0",
            "--label",
            "qr asset",
            "--expect",
            "png",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("status=200, content-type=text/html", result.stdout)
        self.assertIn("Timed out waiting for qr asset", result.stderr)

    def test_skips_non_absolute_url(self) -> None:
        result = self.run_script(
            "--url",
            "preview/pr-42/",
            "--attempts",
            "1",
            "--interval-seconds",
            "0",
            "--label",
            "preview",
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("Preview URL is not absolute. Skipping.", result.stdout)


if __name__ == "__main__":
    unittest.main()
