import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / ".internal-tools" / "unpack_preview.py"
spec = importlib.util.spec_from_file_location("unpack_preview", SCRIPT)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class TestUnpackPreview(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = self.root / "preview.zip"
        self.stage = self.root / "staging"
        self.stage.mkdir()
        self.env = dict(PR_NUMBER="37", OPERATION="deploy", GITHUB_REPOSITORY="org/source",
                        TARGET_REPO="org/pages", TARGET_BRANCH="gh-pages",
                        UMBRELLA_DIR="api/docs", PAGES_BASE_URL="https://pages.example/site")
        self.meta = dict(pr_number="37", worker_action="deploy", target_repo="org/pages",
                         target_branch="gh-pages", umbrella_dir="api/docs",
                         pages_base_url="https://pages.example/site/")
        self.page = ("docs/index.html", "<h1>Preview</h1>")

    def write(self, entries):
        with zipfile.ZipFile(self.path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, value in entries:
                archive.writestr(name, value)

    def write_json(self, *assets, **fields):
        self.write([(worker.JSON_META, json.dumps({**self.meta, **fields})), *assets])

    def unpack(self):
        return worker.unpack(self.path, self.stage, self.env)

    def test_cli_publishes_static_files_only_and_writes_one_output(self):
        self.write_json(self.page, (worker.PR_MARKER, "37\n"), ("empty/", ""))
        output = self.root / "output"
        subprocess.run([sys.executable, str(SCRIPT), str(self.path), str(self.stage)],
                       check=True, env={**os.environ, **self.env, "GITHUB_OUTPUT": str(output)})
        self.assertEqual(output.read_text(), "deployment_action=deploy\n")
        self.assertEqual((self.stage / self.page[0]).read_text(), self.page[1])
        self.assertEqual(sorted(p.name for p in self.stage.iterdir()), ["docs"])

    def test_same_repository_default_and_legacy_metadata(self):
        self.env.update(TARGET_REPO="org/source", UMBRELLA_DIR="my docs")
        legacy = "\n".join(["PR_NUMBER=37", "WORKER_ACTION=deploy", "TARGET_REPO=",
                            "TARGET_BRANCH=gh-pages", r"UMBRELLA_DIR=my\ docs",
                            "PAGES_BASE_URL=https://pages.example/site", "COMMENT_TITLE=Preview"])
        self.write([(worker.LEGACY_META, legacy), self.page])
        self.assertEqual(self.unpack(), "deploy")
        self.assertFalse((self.stage / worker.LEGACY_META).exists())

    def test_configuration_and_identity_must_match(self):
        for changed in (dict(pr_number="38"), dict(pr_number=37), dict(worker_action="other"),
                        dict(target_repo="org/elsewhere"), dict(target_branch="main"),
                        dict(umbrella_dir="other"), dict(pages_base_url="https://elsewhere.example")):
            with self.subTest(changed=changed):
                self.write_json(self.page, **changed)
                with self.assertRaises(ValueError):
                    self.unpack()
                self.assertEqual(list(self.stage.iterdir()), [])

    def test_metadata_file_and_consistent_legacy_marker(self):
        cases = [[self.page], [(worker.JSON_META, "{}"), self.page],
                 [(worker.JSON_META, "[]"), self.page],
                 [(worker.JSON_META, json.dumps(self.meta)), (worker.LEGACY_META, ""), self.page],
                 [(worker.JSON_META, json.dumps(self.meta)), (worker.PR_MARKER, "15"), self.page]]
        for entries in cases:
            with self.subTest(control_files=[name for name, _ in entries]):
                self.write(entries)
                with self.assertRaises(ValueError):
                    self.unpack()

    def test_stale_operation_is_skipped_and_remove_needs_no_static_payload(self):
        self.write_json(worker_action="remove")
        self.assertEqual(self.unpack(), "skip")
        self.env["OPERATION"] = "remove"
        self.assertEqual(self.unpack(), "remove")
        self.assertEqual(list(self.stage.iterdir()), [])

    def test_empty_deploy_is_rejected(self):
        self.write_json((worker.PR_MARKER, "37"))
        with self.assertRaisesRegex(ValueError, "no static files"):
            self.unpack()

    def test_control_files_and_inconsistent_entries_are_rejected(self):
        cases = [[(".github/settings.yml", "x")], [("docs/.git/config", "x")],
                 [("docs/" + worker.JSON_META, "{}")], [("a", "b"), ("a/b", "c")],
                 [("img/icon.png", "a"), ("IMG/other.png", "b")]]
        for assets in cases:
            with self.subTest(assets=assets):
                self.write_json(*assets)
                with self.assertRaises(ValueError):
                    self.unpack()
                self.assertEqual(list(self.stage.iterdir()), [])

    def test_link_member_is_rejected(self):
        link = zipfile.ZipInfo("readme-link")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.write_json(self.page, (link, "docs/index.html"))
        with self.assertRaisesRegex(ValueError, "regular files"):
            self.unpack()

    def test_archive_limits_and_fresh_staging(self):
        self.write_json(self.page)
        for limit in ("MAX_ARCHIVE", "MAX_INDEX", "MAX_MEMBERS", "MAX_METADATA",
                      "MAX_TOTAL", "MAX_FILE"):
            with self.subTest(limit=limit), patch.object(worker, limit, 1):
                with self.assertRaises(ValueError):
                    self.unpack()
        (self.stage / "existing.txt").write_text("keep")
        with self.assertRaisesRegex(ValueError, "fresh and empty"):
            self.unpack()
        self.assertEqual((self.stage / "existing.txt").read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
