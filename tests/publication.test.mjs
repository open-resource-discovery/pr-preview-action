import assert from "node:assert/strict";
import test from "node:test";
import { buildFileChanges, publishFiles } from "../.internal-tools/publish-static-preview.mjs";

const SHA = "a".repeat(40);
const config = {
  apiUrl: "https://api.example.test",
  graphqlUrl: "https://api.example.test/graphql",
  repository: "ORD/repo",
  token: "fixture",
  branch: "github-pages",
  pr: "2",
  action: "synchronize",
  sha: SHA,
};
const files = new Map([["index.html", { oid: SHA, contents: "aGVsbG8=" }]]);
function api({ stale = false, signed = true, exists = false } = {}) {
  const commits = [];
  const fetchImpl = async (url, options) => {
    let body;
    if (options.method === "POST") {
      commits.push(JSON.parse(options.body).variables.input);
      body =
        stale && commits.length === 1
          ? { errors: [{ type: "STALE_DATA", message: "Branch moved" }] }
          : {
              data: {
                createCommitOnBranch: {
                  commit: {
                    oid: "f".repeat(40),
                    signature: { isValid: signed, wasSignedByGitHub: signed, state: signed ? "VALID" : "UNSIGNED" },
                  },
                },
              },
            };
    } else if (url.includes("git/ref/")) body = { object: { sha: commits.length ? "e".repeat(40) : SHA } };
    else if (url.includes("git/commits/")) body = { tree: { sha: "b".repeat(40) } };
    else if (url.includes("recursive=1"))
      body = { tree: [{ path: "old.html", type: "blob", mode: "100644", sha: SHA }] };
    else
      body = {
        tree: [
          { path: ".nojekyll", type: "blob", mode: "100644", sha: SHA },
          ...(exists ? [{ path: "pr-2", type: "tree", sha: "c".repeat(40) }] : []),
        ],
      };
    return new Response(JSON.stringify(body));
  };
  return { commits, fetchImpl, sleep: async () => {}, log: () => {} };
}
test("publishes with an expected branch head and verified GitHub signature", async () => {
  const mock = api();
  const result = await publishFiles(config, files, mock);
  assert.equal(result.changed, true);
  assert.equal(mock.commits[0].expectedHeadOid, SHA);
  assert.deepEqual(
    mock.commits[0].fileChanges.additions.map((f) => f.path),
    ["pr-2/index.html"],
  );
});
test("refuses to report success for a commit without a valid GitHub signature", async () => {
  await assert.rejects(publishFiles(config, files, api({ signed: false })), /verified GitHub signature/);
});
test("rebuilds the diff after a concurrent branch update", async () => {
  const mock = api({ stale: true });
  let guards = 0;
  await publishFiles(config, files, {
    ...mock,
    beforeCommit: async () => {
      guards++;
      return true;
    },
  });
  assert.equal(mock.commits.length, 2);
  assert.equal(mock.commits[1].expectedHeadOid, "e".repeat(40));
  assert.equal(guards, 2);
});
test("cleanup removes only this PR namespace and skips a nonexistent preview", async () => {
  const mock = api({ exists: true });
  const result = await publishFiles({ ...config, action: "closed" }, new Map(), mock);
  assert.equal(result.removed, true);
  assert.deepEqual(mock.commits[0].fileChanges.deletions, [{ path: "pr-2/old.html" }]);
  assert.deepEqual(mock.commits[0].fileChanges.additions, []);
  const empty = api();
  assert.equal((await publishFiles({ ...config, action: "closed" }, new Map(), empty)).changed, false);
  assert.equal(empty.commits.length, 0);
});

test("updates preserve existing nested previews while close cleanup removes the whole PR", () => {
  const state = {
    hasNojekyll: true,
    files: new Map([
      ["search-index.json", { oid: SHA }],
      ["guides/pr-guide/old.html", { oid: SHA }],
      ["guides/pr-2345/index.html", { oid: SHA }],
    ]),
  };
  const update = buildFileChanges({ pr: "2", action: "synchronize", files: new Map(), state });
  assert.deepEqual(update.deletions, [{ path: "pr-2/guides/pr-guide/old.html" }, { path: "pr-2/search-index.json" }]);
  const cleanup = buildFileChanges({ pr: "2", action: "closed", files: new Map(), state });
  assert.deepEqual(cleanup.deletions, [
    { path: "pr-2/guides/pr-2345/index.html" },
    { path: "pr-2/guides/pr-guide/old.html" },
    { path: "pr-2/search-index.json" },
  ]);
});
