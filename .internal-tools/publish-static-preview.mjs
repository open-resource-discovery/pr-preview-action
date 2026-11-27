const COMMIT_MUTATION = `
  mutation PublishPreview($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      commit {
        oid
        signature {
          isValid
          wasSignedByGitHub
          state
        }
      }
    }
  }
`;
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function validatePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe preview file path: ${JSON.stringify(value)}.`);
  }
  return value;
}

function validateOid(value, label) {
  if (typeof value !== "string" || !OID.test(value)) throw new Error(`Invalid ${label} from GitHub.`);
  return value;
}

export class GitHubApiError extends Error {
  constructor(message, { status, errors } = {}) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.errors = errors;
  }
}

export function createApiClient(config, fetchImpl = globalThis.fetch) {
  async function request(url, method, body) {
    const response = await fetchImpl(url, {
      method,
      redirect: "manual",
      headers: {
        "authorization": `Bearer ${config.token}`,
        "accept": "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "ord-trusted-static-preview",
      },
      signal: AbortSignal.timeout(60_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new GitHubApiError(`GitHub ${method} returned a non-JSON response (HTTP ${response.status}).`, {
        status: response.status,
      });
    }
    if (!response.ok) {
      throw new GitHubApiError(`GitHub ${method} failed (HTTP ${response.status})`, {
        status: response.status,
      });
    }
    return data;
  }
  const repository = config.repository.split("/").map(encodeURIComponent).join("/");
  return {
    get: (resource) => request(`${config.apiUrl}/repos/${repository}/${resource}`, "GET"),
    async commit(input) {
      const result = await request(config.graphqlUrl, "POST", { query: COMMIT_MUTATION, variables: { input } });
      if (result.errors?.length) {
        throw new GitHubApiError(
          `GitHub commit mutation failed: ${result.errors.map((error) => error.message).join("; ")}`,
          { errors: result.errors },
        );
      }
      const commit = result.data?.createCommitOnBranch?.commit;
      if (!commit) throw new GitHubApiError("GitHub did not return the new preview commit.");
      validateOid(commit.oid, "preview commit OID");
      if (
        commit.signature?.isValid !== true ||
        commit.signature?.wasSignedByGitHub !== true ||
        commit.signature?.state !== "VALID"
      ) {
        throw new GitHubApiError(
          `Preview commit ${commit.oid} did not receive a verified GitHub signature; check Enterprise web commit signing.`,
        );
      }
      return commit;
    },
  };
}

function requireTree(response, label) {
  if (response?.truncated) throw new Error(`${label} is truncated; refusing to publish an incomplete preview diff.`);
  if (!Array.isArray(response?.tree)) throw new Error(`${label} did not contain a file tree.`);
  for (const entry of response.tree) validatePath(entry?.path);
  return response.tree;
}

export async function readPreviewState(client, config) {
  const branch = config.branch.split("/").map(encodeURIComponent).join("/");
  const ref = await client.get(`git/ref/heads/${branch}`);
  const head = validateOid(ref?.object?.sha, "branch head");
  const commit = await client.get(`git/commits/${head}`);
  const treeOid = validateOid(commit?.tree?.sha, "root tree OID");
  const root = requireTree(await client.get(`git/trees/${treeOid}`), "Pages root tree");
  let parent = root;
  if (config.pathPrefix) {
    validatePath(config.pathPrefix);
    for (const component of config.pathPrefix.split("/")) {
      const entry = parent.find((item) => item.path === component);
      if (!entry) {
        parent = [];
        break;
      }
      if (entry.type !== "tree") throw new Error("Preview prefix is not a directory");
      parent = requireTree(
        await client.get("git/trees/" + validateOid(entry.sha, "prefix tree OID")),
        "Preview prefix tree",
      );
    }
  }
  const folder = parent.find((entry) => entry.path === "pr-" + config.pr);
  const marker = root.find((entry) => entry.path === ".nojekyll");
  if (marker && (marker.type !== "blob" || marker.mode !== "100644")) {
    throw new Error("The Pages .nojekyll marker is not a regular file.");
  }
  const files = new Map();
  if (folder) {
    if (folder.type !== "tree") throw new Error(`pr-${config.pr} is not a preview directory.`);
    const entries = requireTree(
      await client.get(`git/trees/${validateOid(folder.sha, "preview tree OID")}?recursive=1`),
      "Existing preview tree",
    );
    for (const entry of entries) {
      if (entry.type === "tree") continue;
      if (files.has(entry.path)) throw new Error(`Duplicate existing preview path: ${entry.path}.`);
      files.set(entry.path, { oid: validateOid(entry.sha, "preview file OID"), mode: entry.mode });
    }
  }
  return { head, files, exists: Boolean(folder), hasNojekyll: Boolean(marker) };
}

export function buildFileChanges({ pr, action, files, state, pathPrefix = "" }) {
  if (!/^[1-9]\d*$/.test(pr)) throw new Error("PR must be a positive pull request number.");
  if (pathPrefix) validatePath(pathPrefix);
  const prefix = (pathPrefix ? pathPrefix + "/" : "") + "pr-" + pr + "/";
  const additions = [];
  const deletions = [];
  const desired = action === "closed" ? new Map() : files;
  for (const [file, entry] of desired) {
    validatePath(file);
    const previous = state.files.get(file);
    if (previous && previous.mode !== "100644") throw new Error(`Unsupported existing preview file mode: ${file}.`);
    if (previous?.oid !== entry.oid) additions.push({ path: prefix + file, contents: entry.contents });
  }
  for (const file of state.files.keys()) {
    validatePath(file);
    const nestedPreview = file
      .split("/")
      .slice(0, -1)
      .some((part) => part.startsWith("pr-"));
    if (!desired.has(file) && (action === "closed" || !nestedPreview)) deletions.push({ path: prefix + file });
  }
  if (!state.hasNojekyll) additions.push({ path: ".nojekyll", contents: "" });
  additions.sort((a, b) => a.path.localeCompare(b.path));
  deletions.sort((a, b) => a.path.localeCompare(b.path));
  return { additions, deletions };
}

function isStaleHead(error) {
  return (
    error instanceof GitHubApiError &&
    error.errors?.length > 0 &&
    error.errors.every((entry) =>
      [entry.type, entry.extensions?.code, entry.extensions?.type].some((value) => value === "STALE_DATA"),
    )
  );
}

export async function publishFiles(
  config,
  files,
  {
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = console.log,
    beforeCommit = async () => true,
  } = {},
) {
  const client = createApiClient(config, fetchImpl);
  let removed = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const state = await readPreviewState(client, config);
    removed ||= config.action === "closed" && state.exists;
    if (config.action === "closed" && !state.exists) return { removed, changed: false, oid: state.head };
    if (!(await beforeCommit())) return { skipped: true, removed: false, changed: false, oid: state.head };
    const fileChanges = buildFileChanges({
      pr: config.pr,
      action: config.action,
      files,
      state,
      pathPrefix: config.pathPrefix,
    });
    if (fileChanges.additions.length === 0 && fileChanges.deletions.length === 0) {
      log("No changes to publish.");

      return { removed, changed: false, oid: state.head };
    }
    try {
      const commit = await client.commit({
        branch: { repositoryNameWithOwner: config.repository, branchName: config.branch },
        expectedHeadOid: state.head,
        message: {
          headline:
            config.action === "closed"
              ? `preview: remove pr-${config.pr} (PR closed)`
              : `preview: pr-${config.pr} @ ${config.sha.slice(0, 7)}`,
        },
        fileChanges,
      });
      log(`Published verified GitHub-signed preview commit ${commit.oid}.`);

      return { removed, changed: true, oid: commit.oid };
    } catch (error) {
      if (!isStaleHead(error)) throw error;
      if (attempt === 5) throw new Error("Pages branch kept changing; failed to publish the preview after 5 attempts.");
      log(`Pages branch changed; rebuilding the preview diff (attempt ${attempt + 1}).`);
      await sleep(1000);
    }
  }
}
