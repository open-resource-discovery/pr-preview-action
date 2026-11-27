import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hideDocumentationSearch, preparePreview, SEARCH_STYLE } from "../.internal-tools/prepare-preview.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = join(ROOT, ".internal-tools/prepare-preview.mjs");
const DOC_HTML =
  '<!doctype html><html><head><meta name="generator" content="Docusaurus v3.10.2">' +
  '<script>const sample = "</head>";</script></head><body>' +
  '<div class="navbar__search"><input aria-label="Search"></div>' +
  "<main>Documentation ü</main></body></html>";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "prepare-preview-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "build with spaces");
  const destination = join(root, "preview");
  mkdirSync(source);
  return {
    root,
    source,
    destination,
    write(name, content) {
      const path = join(source, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
  };
}

function snapshot(directory, prefix = "") {
  const files = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = join(prefix, entry.name);
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, snapshot(path, name));
    else if (entry.isFile()) files[name] = readFileSync(path);
  }
  return files;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf-8", ...options });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function stepScript(name) {
  const action = readFileSync(join(ROOT, "action.yml"), "utf-8");
  return action
    .split("    - name: " + name + "\n")[1]
    .split("      run: |\n")[1]
    .split("\n    - name:")[0]
    .split("\n")
    .map((line) => line.slice(8))
    .join("\n");
}

test("omits plain, hashed, contextual, and compressed indexes without changing source", (t) => {
  const f = fixture(t);
  const indexes = [
    "search-index.json",
    "search-index-ab123.json",
    "fr/search-index-docs.json",
    "version-1/search-index.json.gz",
    "search-index.json.br",
  ];
  for (const name of indexes) f.write(name, "synthetic-index-content");
  f.write("index.html", DOC_HTML);
  f.write("docs/page.html", DOC_HTML);
  f.write("tools/index.html", '<html><head></head><body><input type="search"></body></html>');
  f.write("assets/data.json", '{"message":"keep"}');
  const original = snapshot(f.source);
  assert.equal(preparePreview(f.source, f.destination), indexes.length);
  assert.deepEqual(snapshot(f.source), original);
  for (const name of indexes) assert.equal(existsSync(join(f.destination, name)), false);
  for (const name of ["index.html", "docs/page.html"]) {
    assert.equal(
      readFileSync(join(f.destination, name), "utf-8"),
      DOC_HTML.replace("</script></head>", "</script>" + SEARCH_STYLE + "</head>"),
    );
  }
  for (const name of ["tools/index.html", "assets/data.json"])
    assert.deepEqual(readFileSync(join(f.destination, name)), original[name]);
});

test("opt-in keeps indexes and search controls", (t) => {
  const f = fixture(t);
  f.write("search-index.json", "[]");
  f.write("index.html", DOC_HTML);
  assert.equal(preparePreview(f.source, f.destination, true), 0);
  assert.deepEqual(snapshot(f.source), snapshot(f.destination));
});

test("sites without indexes are copied unchanged", (t) => {
  const f = fixture(t);
  f.write("index.html", DOC_HTML);
  assert.equal(preparePreview(f.source, f.destination), 0);
  assert.deepEqual(snapshot(f.source), snapshot(f.destination));
});

test("build root can contain staging", (t) => {
  const f = fixture(t);
  f.write("index.html", "page");
  const destination = join(f.source, ".pr-preview-static.example");
  mkdirSync(destination);
  preparePreview(f.source, destination);
  assert.deepEqual(snapshot(destination), { "index.html": Buffer.from("page") });
  assert.equal(existsSync(join(destination, basename(destination))), false);
});

test("symlinks do not modify or copy external content", (t) => {
  const f = fixture(t);
  const external = join(f.root, "outside.html");
  writeFileSync(external, DOC_HTML);
  symlinkSync(external, join(f.source, "linked.html"));
  symlinkSync(external, join(f.source, "search-index.json"));
  preparePreview(f.source, f.destination);
  assert.equal(lstatSync(join(f.destination, "linked.html")).isSymbolicLink(), true);
  assert.equal(readlinkSync(join(f.destination, "linked.html")), external);
  assert.equal(existsSync(join(f.destination, "search-index.json")), false);
  assert.equal(readFileSync(external, "utf-8"), DOC_HTML);
});

test("HTML handling preserves comments, raw text, quoted attributes, and existing styles", () => {
  const html = DOC_HTML.replace("<meta", '<!-- <meta name="generator" content="other"> </head> -->\n<META')
    .replace('name="generator" content="Docusaurus v3.10.2"', "content='Docusaurus v3.10.2' NAME=generator")
    .replace("</head><body>", '\n<TITLE>Sample </head></TITLE><meta content="a > b">\n</HEAD><body>');
  const updated = hideDocumentationSearch(html);
  assert.ok(updated.includes(SEARCH_STYLE + "</HEAD>"));
  assert.equal(updated.replace(SEARCH_STYLE, ""), html);
  assert.equal(hideDocumentationSearch(updated), updated);
  assert.equal(
    hideDocumentationSearch('<html><head><script>"<meta name=generator content=Docusaurus>"</script></head></html>'),
    '<html><head><script>"<meta name=generator content=Docusaurus>"</script></head></html>',
  );
});

test("invalid source and destination fail before copying", (t) => {
  const f = fixture(t);
  for (const [source, destination] of [
    [join(f.root, "missing"), f.destination],
    [f.source, f.source],
    [f.source, f.root],
  ]) {
    assert.throws(() => preparePreview(source, destination));
  }
});

test("non-UTF8 pages are preserved", (t) => {
  const f = fixture(t);
  f.write("search-index.json", "[]");
  f.write("index.html", Buffer.from([0xff, 0xfe, 0x61]));
  preparePreview(f.source, f.destination);
  assert.deepEqual(readFileSync(join(f.destination, "index.html")), readFileSync(join(f.source, "index.html")));
});

test("action prepares and cleans its deployment copy", (t) => {
  const f = fixture(t);
  f.write("search-index.json", "[]");
  f.write("index.html", DOC_HTML);
  const original = snapshot(f.source);
  const output = join(f.root, "output");
  const env = {
    ...process.env,
    PATH: dirname(process.execPath) + delimiter + process.env.PATH,
    GITHUB_WORKSPACE: f.root,
    GITHUB_ACTION_PATH: ROOT,
    GITHUB_OUTPUT: output,
    BUILD_DIR: basename(f.source),
    INCLUDE_SEARCH_INDEXES: "false",
  };
  run("bash", ["-e", "-c", stepScript("Prepare preview files")], { env });
  const folder = readFileSync(output, "utf-8").trim().split("=")[1];
  const prepared = join(f.root, folder);
  assert.ok(existsSync(join(prepared, "index.html")));
  assert.equal(existsSync(join(prepared, "search-index.json")), false);
  const deploy = readFileSync(join(ROOT, "action.yml"), "utf-8")
    .split("    - name: Deploy preview\n")[1]
    .split("\n    - name:")[0];
  assert.ok(deploy.includes("folder: $" + "{{ steps.prepare.outputs.folder }}"));
  assert.ok(deploy.includes("target-folder: $" + "{{ steps.setup.outputs.preview_target_folder }}"));
  assert.ok(deploy.includes("clean: true"));
  run("bash", ["-e", "-c", stepScript("Remove prepared preview files")], { env: { ...env, PREVIEW_DIR: folder } });
  assert.equal(existsSync(prepared), false);
  assert.deepEqual(snapshot(f.source), original);
});

test("CLI rejects invalid arguments before copying", (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [HELPER, f.source, f.destination, "invalid"], { encoding: "utf-8" });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("usage:"));
  assert.equal(existsSync(f.destination), false);
});

test("clean deployment removes stale indexes only in the current preview", (t) => {
  if (spawnSync("rsync", ["--version"]).error) return t.skip("rsync is required by the deployment action");
  const f = fixture(t);
  f.write("index.html", DOC_HTML);
  f.write("search-index.json", "[]");
  preparePreview(f.source, f.destination);
  const target = join(f.root, "pages");
  const current = join(target, "specification/pr-1234");
  const neighbors = [join(target, "global-registry/pr-567"), join(target, "specification/pr-1235")];
  for (const directory of [current, ...neighbors]) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "search-index.json"), "old-index");
  }
  const before = neighbors.map((directory) => snapshot(directory));
  run("rsync", ["-a", "--delete", f.destination + "/.", current]);
  assert.deepEqual(snapshot(current), snapshot(f.destination));
  neighbors.forEach((directory, i) => assert.deepEqual(snapshot(directory), before[i]));
});
