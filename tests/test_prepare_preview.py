import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("prepare_preview", ROOT / ".internal-tools/prepare_preview.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

DOC_HTML = (
    '<!doctype html><html><head><meta name="generator" content="Docusaurus v3.10.2">'
    '<script>const sample = "</head>";</script></head><body>'
    '<div class="navbar__search"><input aria-label="Search"></div>'
    '<main>Documentation ü</main></body></html>'
)


class TestPreparePreview(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "build"
        self.source.mkdir()
        self.destination = self.root / "preview"

    def write(self, name, content):
        path = self.source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def snapshot(self, directory):
        return {p.relative_to(directory): p.read_bytes() for p in directory.rglob("*") if p.is_file()}

    def test_omits_plain_hashed_context_and_compressed_indexes_without_changing_source(self):
        indexes = (
            "search-index.json", "search-index-ab123.json",
            "fr/search-index-docs.json", "version-1/search-index.json.gz",
            "search-index.json.br",
        )
        for name in indexes:
            self.write(name, b"synthetic-index-content")
        self.write("index.html", DOC_HTML.encode())
        self.write("docs/page.html", DOC_HTML.encode())
        self.write("tools/index.html", b'<html><head></head><body><input type="search"></body></html>')
        self.write("assets/data.json", b'{"message":"keep"}')
        original = self.snapshot(self.source)

        count = MODULE.prepare_preview(self.source, self.destination)

        self.assertEqual(count, len(indexes))
        self.assertEqual(self.snapshot(self.source), original)
        for name in indexes:
            self.assertFalse((self.destination / name).exists())
        for name in ("index.html", "docs/page.html"):
            self.assertEqual((self.destination / name).read_bytes(), DOC_HTML.replace(
                '</script></head>', '</script>' + MODULE.SEARCH_STYLE + '</head>',
            ).encode())
        for name in ("tools/index.html", "assets/data.json"):
            self.assertEqual((self.destination / name).read_bytes(), original[Path(name)])

    def test_opt_in_keeps_indexes_and_search_controls(self):
        self.write("search-index.json", b"[]")
        self.write("index.html", DOC_HTML.encode())
        self.assertEqual(MODULE.prepare_preview(self.source, self.destination, True), 0)
        self.assertEqual(self.snapshot(self.source), self.snapshot(self.destination))

    def test_sites_without_indexes_are_copied_unchanged(self):
        self.write("index.html", DOC_HTML.encode())
        self.assertEqual(MODULE.prepare_preview(self.source, self.destination), 0)
        self.assertEqual(self.snapshot(self.source), self.snapshot(self.destination))

    def test_build_root_can_contain_the_staging_directory(self):
        self.write("index.html", b"page")
        destination = self.source / ".pr-preview-static.example"
        destination.mkdir()
        MODULE.prepare_preview(self.source, destination)
        self.assertEqual(self.snapshot(destination), {Path("index.html"): b"page"})
        self.assertFalse((destination / destination.name).exists())

    def test_symlinks_do_not_modify_or_copy_external_content(self):
        external = self.root / "outside.html"
        external.write_text(DOC_HTML)
        (self.source / "linked.html").symlink_to(external)
        (self.source / "search-index.json").symlink_to(external)
        MODULE.prepare_preview(self.source, self.destination)
        self.assertTrue((self.destination / "linked.html").is_symlink())
        self.assertFalse((self.destination / "search-index.json").exists())
        self.assertEqual(external.read_text(), DOC_HTML)

    def test_search_style_handles_multiline_uppercase_and_is_idempotent(self):
        html = DOC_HTML.replace("<meta", "\n<META").replace("</head>", "\n</HEAD>")
        updated = MODULE.hide_documentation_search(html)
        self.assertIn(MODULE.SEARCH_STYLE + "</HEAD>", updated)
        self.assertEqual(MODULE.hide_documentation_search(updated), updated)

    def test_invalid_source_and_destination_fail_before_copying(self):
        for source, destination in (
            (self.root / "missing", self.destination),
            (self.source, self.source),
            (self.source, self.root),
        ):
            with self.subTest(source=source, destination=destination):
                with self.assertRaises(ValueError):
                    MODULE.prepare_preview(source, destination)

    def test_action_prepares_and_cleans_the_deployment_copy(self):
        self.write("search-index.json", b"[]")
        self.write("index.html", DOC_HTML.encode())
        original = self.snapshot(self.source)
        action = (ROOT / "action.yml").read_text()
        step = action.split("    - name: Prepare preview files\n", 1)[1]
        script = step.split("      run: |\n", 1)[1].split("\n    - name:", 1)[0]
        output = self.root / "output"
        env = {**os.environ, "GITHUB_WORKSPACE": str(self.root),
               "GITHUB_ACTION_PATH": str(ROOT), "GITHUB_OUTPUT": str(output),
               "BUILD_DIR": "build", "INCLUDE_SEARCH_INDEXES": "false"}
        subprocess.run(["bash", "-e", "-c", textwrap.dedent(script)], env=env, check=True)
        folder = output.read_text().strip().split("=", 1)[1]
        prepared = self.root / folder
        self.assertTrue((prepared / "index.html").exists())
        self.assertFalse((prepared / "search-index.json").exists())
        deploy = action.split("    - name: Deploy preview\n", 1)[1].split("\n    - name:", 1)[0]
        self.assertIn("folder: ${{ steps.prepare.outputs.folder }}", deploy)
        self.assertIn("target-folder: ${{ steps.setup.outputs.preview_target_folder }}", deploy)
        self.assertIn("clean: true", deploy)
        cleanup = action.split("    - name: Remove prepared preview files\n", 1)[1]
        script = cleanup.split("      run: |\n", 1)[1].split("\n    - name:", 1)[0]
        subprocess.run(["bash", "-e", "-c", textwrap.dedent(script)],
                       env={**env, "PREVIEW_DIR": folder}, check=True)
        self.assertFalse(prepared.exists())
        self.assertEqual(self.snapshot(self.source), original)

    @unittest.skipUnless(shutil.which("rsync"), "rsync is required by the deployment action")
    def test_clean_deploy_removes_stale_indexes_only_in_current_preview(self):
        self.write("index.html", DOC_HTML.encode())
        self.write("search-index.json", b"[]")
        MODULE.prepare_preview(self.source, self.destination)
        target = self.root / "pages"
        current = target / "specification/pr-1234"
        sibling = target / "global-registry/pr-567"
        other_pr = target / "specification/pr-1235"
        for directory in (current, sibling, other_pr):
            directory.mkdir(parents=True)
            (directory / "search-index.json").write_bytes(b"old-index")
        before = {p: self.snapshot(p) for p in (sibling, other_pr)}
        # Mirrors the pinned deploy action's rsync --delete into target-folder.
        subprocess.run(["rsync", "-a", "--delete", f"{self.destination}/.", str(current)], check=True)
        self.assertEqual(self.snapshot(current), self.snapshot(self.destination))
        for directory in before:
            self.assertEqual(self.snapshot(directory), before[directory])


if __name__ == "__main__":
    unittest.main()
