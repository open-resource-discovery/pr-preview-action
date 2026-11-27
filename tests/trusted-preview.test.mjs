import assert from "node:assert/strict";
import test from "node:test";
import { downloadArchive, verifyProducer } from "../.internal-tools/trusted-preview.mjs";
import { buildFileChanges, publishFiles } from "../.internal-tools/publish-static-preview.mjs";

const SHA = "a".repeat(40);
const config = {
  mode: "workflow-run",
  eventName: "workflow_run",
  runId: 7,
  currentRunId: 8,
  producer: "preview.yml",
  repository: "ORD/repo",
  expectedBranch: "main",
};
function fixture(overrides = {}) {
  const repo = { id: 123, full_name: "ORD/repo", default_branch: "main" };
  const pr = {
    number: 2,
    state: "open",
    draft: false,
    base: { ref: "main", repo },
    head: { sha: SHA, repo },
    ...overrides.pr,
  };
  const run = {
    id: 7,
    repository: repo,
    head_repository: repo,
    workflow_id: 9,
    head_sha: SHA,
    status: "completed",
    conclusion: "success",
    event: "pull_request",
    pull_requests: [{ number: 2, head: { sha: SHA } }],
    ...overrides.run,
  };
  const records = {
    "": repo,
    "actions/workflows/preview.yml": { id: 9, path: ".github/workflows/preview.yml" },
    "actions/runs/7": run,
    "pulls/2": pr,
    "git/ref/heads/main": { object: { sha: SHA } },
    ...overrides.records,
  };
  return {
    get: async (key) => {
      assert.ok(key in records, "Unexpected metadata request: " + key);
      return records[key];
    },
    list: async () => {
      throw new Error("Unexpected fallback association request");
    },
  };
}

test("accepts one current same-repository PR association", async () => {
  const producer = await verifyProducer(config, { workflow_run: { id: 7 } }, fixture());
  assert.equal(producer.pr.number, 2);
  assert.equal(producer.sha, SHA);
});
test("rejects mismatched workflow runs and ambiguous PRs", async () => {
  await assert.rejects(verifyProducer(config, { workflow_run: { id: 10 } }, fixture()), /associated/);
  await assert.rejects(
    verifyProducer(config, { workflow_run: { id: 7 } }, fixture({ run: { workflow_id: 99 } })),
    /association/,
  );
  await assert.rejects(
    verifyProducer(
      config,
      { workflow_run: { id: 7 } },
      fixture({ run: { pull_requests: [{ number: 2 }, { number: 3 }] } }),
    ),
    /Ambiguous/,
  );
});
test("skips stale and draft PR heads and rejects fork origins", async () => {
  assert.equal(
    (
      await verifyProducer(
        config,
        { workflow_run: { id: 7 } },
        fixture({ pr: { head: { sha: "b".repeat(40), repo: { id: 123 } } } }),
      )
    ).skipped,
    true,
  );
  assert.equal(
    (await verifyProducer(config, { workflow_run: { id: 7 } }, fixture({ pr: { draft: true } }))).skipped,
    true,
  );
  await assert.rejects(
    verifyProducer(config, { workflow_run: { id: 7 } }, fixture({ pr: { head: { sha: SHA, repo: { id: 456 } } } })),
    /origin/,
  );
});
test("accepts a verified test-merge revision without confusing it with the PR head", async () => {
  const merge = "c".repeat(40);
  const producer = await verifyProducer(
    config,
    { workflow_run: { id: 7 } },
    fixture({
      run: { head_sha: merge },
      records: { ["git/commits/" + merge]: { parents: [{ sha: SHA }, { sha: "d".repeat(40) }] } },
    }),
  );
  assert.equal(producer.sha, SHA);
});
test("closed PR cleanup does not require a successful build or an artifact", async () => {
  const producer = await verifyProducer(
    config,
    { workflow_run: { id: 7 } },
    fixture({ pr: { state: "closed" }, run: { conclusion: "failure" } }),
  );
  assert.equal(producer.action, "closed");
});
test("data downloads are restricted to their own current default-branch run", async () => {
  const dataConfig = { ...config, mode: "download-verified", eventName: "schedule", currentRunId: 7 };
  const client = fixture({ run: { event: "schedule", head_branch: "main" } });
  assert.equal((await verifyProducer(dataConfig, {}, client)).sha, SHA);
  await assert.rejects(verifyProducer({ ...dataConfig, eventName: "pull_request" }, {}, client), /own trusted/);
  await assert.rejects(
    verifyProducer(
      dataConfig,
      {},
      fixture({
        run: { event: "schedule", head_branch: "main" },
        records: { "git/ref/heads/main": { object: { sha: "e".repeat(40) } } },
      }),
    ),
    /current protected/,
  );
});
test("artifact redirects never receive the GitHub token", async () => {
  const downloadConfig = {
    apiUrl: "https://api.example.test",
    repository: "ORD/repo",
    sourceToken: "fixture-token",
    limits: { compressedBytes: 100 },
  };
  const seen = [];
  const result = await downloadArchive(
    downloadConfig,
    { id: 4, size_in_bytes: 3, expired: false },
    async (url, options) => {
      seen.push({ url, options });
      return seen.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "https://storage.example.test/archive?signature=fixture" },
          })
        : new Response(Buffer.from("zip"));
    },
  );
  assert.equal(result.toString(), "zip");
  assert.equal(seen[0].options.headers.authorization, "Bearer fixture-token");
  assert.equal(seen[1].options.headers, undefined);
});
test("rejects unsafe redirects and oversized download streams", async () => {
  const downloadConfig = {
    apiUrl: "https://api.example.test",
    repository: "ORD/repo",
    sourceToken: "fixture-token",
    limits: { compressedBytes: 2 },
  };
  await assert.rejects(
    downloadArchive(
      downloadConfig,
      { id: 4, size_in_bytes: 1 },
      async () => new Response(null, { status: 302, headers: { location: "http://storage.example.test/archive" } }),
    ),
    /Unsafe/,
  );
  await assert.rejects(
    downloadArchive(downloadConfig, { id: 4, size_in_bytes: 1 }, async () => new Response(Buffer.from("large"))),
    /compressed limit/,
  );
});
test("file changes stay within the configured preview namespace", () => {
  const changes = buildFileChanges({
    pr: "2",
    action: "synchronize",
    files: new Map([["index.html", { oid: SHA, contents: "aGVsbG8=" }]]),
    state: { files: new Map(), hasNojekyll: true },
    pathPrefix: "repo",
  });
  assert.deepEqual(
    changes.additions.map((f) => f.path),
    ["repo/pr-2/index.html"],
  );
  assert.throws(
    () =>
      buildFileChanges({
        pr: "2",
        action: "synchronize",
        files: new Map(),
        state: { files: new Map(), hasNojekyll: true },
        pathPrefix: "../escape",
      }),
    /Unsafe/,
  );
});
test("late stale-head checks prevent any publication mutation", async () => {
  let mutations = 0;
  const publication = {
    apiUrl: "https://api.example.test",
    graphqlUrl: "https://api.example.test/graphql",
    repository: "ORD/repo",
    token: "fixture-token",
    branch: "github-pages",
    pr: "2",
    action: "synchronize",
    sha: SHA,
  };
  const fetchImpl = async (url, options) => {
    if (options.method === "POST") mutations++;
    const body = url.includes("git/ref/")
      ? { object: { sha: SHA } }
      : url.includes("git/commits/")
        ? { tree: { sha: "b".repeat(40) } }
        : { tree: [{ path: ".nojekyll", type: "blob", mode: "100644", sha: SHA }] };
    return new Response(JSON.stringify(body));
  };
  const result = await publishFiles(publication, new Map([["index.html", { oid: SHA, contents: "aGVsbG8=" }]]), {
    fetchImpl,
    beforeCommit: async () => false,
    log: () => {},
  });
  assert.equal(result.skipped, true);
  assert.equal(mutations, 0);
});

test("accepts GHES v3 raw-size metadata while bounding the compressed stream", async () => {
  const config = {
    apiUrl: "https://api.example.test",
    repository: "ORD/repo",
    sourceToken: "fixture",
    limits: { compressedBytes: 10, unpackedBytes: 100 },
  };
  const artifact = { id: 4, size_in_bytes: 50, expired: false };
  assert.equal(
    (await downloadArchive(config, artifact, async () => new Response(Buffer.from("zip")))).toString(),
    "zip",
  );
  await assert.rejects(
    downloadArchive(config, artifact, async () => new Response(Buffer.alloc(11))),
    /compressed limit/,
  );
});
