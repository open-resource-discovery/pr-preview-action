import assert from "node:assert/strict";
import test from "node:test";
import { prepareStaticPreview, SEARCH_STYLE } from "../.internal-tools/preview-content.mjs";
const entry = (value) => ({ oid: "a".repeat(40), contents: Buffer.from(value).toString("base64") });
test("verified previews retain main's search-index omission and hide Docusaurus search", () => {
  const html = '<head><meta name="generator" content="Docusaurus v3"><script>"</head>"</script></head>';
  const files = new Map([
    ["index.html", entry(html)],
    ["fr/search-index.json.gz", entry("index")],
    ["assets/search-index.json/logo.svg", entry("logo")],
  ]);
  const result = prepareStaticPreview(files);
  assert.equal(result.has("fr/search-index.json.gz"), false);
  assert.equal(result.has("assets/search-index.json/logo.svg"), true);
  assert.ok(Buffer.from(result.get("index.html").contents, "base64").toString().includes(SEARCH_STYLE));
  assert.notEqual(result.get("index.html").oid, files.get("index.html").oid);
  assert.equal(files.size, 3);
  assert.deepEqual(prepareStaticPreview(files, true), files);
});
test("invalid UTF-8 HTML remains unchanged when indexes are omitted", () => {
  const html = entry(Buffer.from([255, 254]));
  const files = new Map([
    ["index.html", html],
    ["search-index.json", entry("[]")],
  ]);
  assert.equal(prepareStaticPreview(files).get("index.html"), html);
});
