import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import yazl from "yazl";
const { loadWorkerConfig, runTrustedWorker } = await import(
  process.env.TEST_WORKER_BUNDLE === "1"
    ? "../.internal-tools/trusted-preview.bundle.mjs"
    : "../.internal-tools/trusted-preview.mjs"
);

const SHA = "a".repeat(40);
async function zip() {
  const archive = new yazl.ZipFile();
  archive.addBuffer(Buffer.from('{"value":1}'), "data.json", { mode: 0o100644 });
  archive.end();
  const chunks = [];
  for await (const chunk of archive.outputStream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
test("stages only verified JSON from the current scheduled run in a fresh directory", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "worker-test-"));
  try {
    const archive = await zip();
    const repo = { id: 123, full_name: "ORD/repo", default_branch: "main" };
    const records = {
      "": repo,
      "actions/workflows/data.yml": { id: 9, path: ".github/workflows/data.yml" },
      "actions/runs/7": {
        id: 7,
        workflow_id: 9,
        repository: repo,
        head_repository: repo,
        head_branch: "main",
        head_sha: SHA,
        event: "schedule",
      },
      "git/ref/heads/main": { object: { sha: SHA } },
      "actions/runs/7/artifacts": {
        artifacts: [
          {
            id: 4,
            name: "data",
            size_in_bytes: archive.length,
            expired: false,
            workflow_run: { id: 7, head_sha: SHA },
          },
        ],
      },
    };
    let writes = 0;
    const config = loadWorkerConfig({
      GITHUB_API_URL: "https://api.example.test",
      GITHUB_GRAPHQL_URL: "https://api.example.test/graphql",
      WORKER_MODE: "download-verified",
      GITHUB_REPOSITORY: "ORD/repo",
      GITHUB_EVENT_NAME: "schedule",
      GITHUB_EVENT_PATH: "/unused-fixture-event.json",
      GITHUB_RUN_ID: "7",
      SOURCE_TOKEN: "fixture",
      PRODUCER_WORKFLOW: "data.yml",
      PRODUCER_RUN_ID: "7",
      STATIC_ARTIFACT_NAME: "data",
      EXPECTED_BASE_BRANCH: "main",
      EXPECTED_ARTIFACT_FILES: '["data.json"]',
      INCLUDE_SEARCH_INDEXES: "TRUE",
      RUNNER_TEMP: tempRoot,
    });
    assert.equal(config.includeSearchIndexes, true);
    const fetchImpl = async (url, options) => {
      if (options.method && options.method !== "GET") writes++;
      const key = url
        .replace(config.apiUrl + "/repos/ORD/repo", "")
        .replace(/^[/]/, "")
        .split("?")[0];
      if (key === "actions/artifacts/4/zip") return new Response(archive);
      assert.ok(key in records, key);
      return new Response(JSON.stringify(records[key]));
    };
    const result = await runTrustedWorker(config, { fetchImpl, event: {} });
    assert.deepEqual(await readdir(result.directory), ["data.json"]);
    assert.deepEqual(JSON.parse(await readFile(path.join(result.directory, "data.json"), "utf8")), { value: 1 });
    assert.equal(writes, 0);
    records["git/ref/heads/main"].object.sha = "b".repeat(40);
    await assert.rejects(runTrustedWorker(config, { fetchImpl, event: {} }), /current protected/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
