import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_LIMITS, readStaticArchive, safeArchivePath } from "./static-archive.mjs";
import { prepareStaticPreview } from "./preview-content.mjs";
import { publishFiles } from "./publish-static-preview.mjs";

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const OID = /^[a-f0-9]{40}$/;
const WORKFLOW = /^[A-Za-z0-9_.-]+\.ya?ml$/;

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Missing " + label);
  return value;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error("Invalid " + label);
  return number;
}

function httpsUrl(value, label) {
  const url = new URL(requireString(value, label));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Invalid " + label);
  return url;
}

export function loadWorkerConfig(env = process.env) {
  const api = httpsUrl(env.GITHUB_API_URL, "GitHub API URL");
  const graphql = httpsUrl(env.GITHUB_GRAPHQL_URL, "GitHub GraphQL URL");
  if (api.origin !== graphql.origin) throw new Error("GitHub API origins differ");
  const mode = requireString(env.WORKER_MODE, "worker mode");
  if (!["workflow-run", "download-verified"].includes(mode)) throw new Error("Unsupported trusted worker mode");
  const repository = requireString(env.GITHUB_REPOSITORY, "source repository");
  const producer = requireString(env.PRODUCER_WORKFLOW, "producer workflow");
  if (!REPOSITORY.test(repository) || !WORKFLOW.test(producer))
    throw new Error("Invalid repository or producer workflow");
  const config = {
    mode,
    repository,
    sourceToken: requireString(env.SOURCE_TOKEN, "source token"),
    token: env.PUBLICATION_TOKEN || env.SOURCE_TOKEN,
    apiUrl: api.href.replace(/\/+$/, ""),
    graphqlUrl: graphql.href,
    eventName: env.GITHUB_EVENT_NAME,
    eventPath: requireString(env.GITHUB_EVENT_PATH, "event path"),
    runId: positiveInteger(env.PRODUCER_RUN_ID, "producer run ID"),
    currentRunId: positiveInteger(env.GITHUB_RUN_ID, "current run ID"),
    producer,
    expectedBranch: env.EXPECTED_BASE_BRANCH || "main",
    artifactName: requireString(env.STATIC_ARTIFACT_NAME, "artifact name"),
    targetRepository: env.TARGET_REPOSITORY || repository,
    branch: env.TARGET_BRANCH || "main",
    pathPrefix: env.PREVIEW_PATH_PREFIX || "",
    pagesBaseUrl: env.PAGES_BASE_URL || "",
    commentHeader: env.COMMENT_HEADER || "pr-preview",
    commentTitle: env.COMMENT_TITLE || "PR Preview",
    commentFooter: env.COMMENT_FOOTER || "",
    qr: env.QR_CODE !== "false",
    includeSearchIndexes: (env.INCLUDE_SEARCH_INDEXES ?? "").toLowerCase() === "true",
    outputFile: env.GITHUB_OUTPUT,
    tempRoot: env.RUNNER_TEMP || os.tmpdir(),
    jsonOnly: mode === "download-verified" && env.ARTIFACT_FORMAT !== "static",
    jsonPathPrefix: env.JSON_PATH_PREFIX || "",
    allowedPattern: null,
    allowedPaths: env.EXPECTED_ARTIFACT_FILES ? JSON.parse(env.EXPECTED_ARTIFACT_FILES) : null,
    limits: { ...DEFAULT_LIMITS },
  };
  if (
    !REPOSITORY.test(config.targetRepository) ||
    !/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(config.branch) ||
    config.branch.split("/").some((p) => !p || p.startsWith(".") || p.endsWith(".") || p.endsWith(".lock")) ||
    config.branch.includes("..")
  ) {
    throw new Error("Invalid trusted publication target");
  }
  if (config.pathPrefix) safeArchivePath(config.pathPrefix, true);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(config.commentHeader)) throw new Error("Invalid comment marker");
  if (config.pagesBaseUrl) httpsUrl(config.pagesBaseUrl, "Pages URL");
  if (
    config.allowedPaths !== null &&
    (!Array.isArray(config.allowedPaths) ||
      !config.allowedPaths.length ||
      config.allowedPaths.some((p) => typeof p !== "string"))
  ) {
    throw new Error("Expected artifact paths must be a nonempty array");
  }
  if (env.ARTIFACT_FORMAT && !["json", "static"].includes(env.ARTIFACT_FORMAT))
    throw new Error("Unsupported artifact format");
  if (config.jsonPathPrefix) safeArchivePath(config.jsonPathPrefix, true);
  if (env.EXPECTED_ARTIFACT_PATTERN) {
    const pattern = env.EXPECTED_ARTIFACT_PATTERN;
    if (pattern.length > 1024 || !pattern.startsWith("^") || !pattern.endsWith("$"))
      throw new Error("Artifact pattern must be a bounded anchored trusted expression");
    config.allowedPattern = new RegExp(pattern);
  }
  if (config.mode === "download-verified" && !config.allowedPaths && !config.allowedPattern)
    throw new Error("Data downloads require an exact or pattern file allowlist");
  return config;
}

export function createSourceClient(config, fetchImpl = globalThis.fetch) {
  async function request(resource, method = "GET", body) {
    const response = await fetchImpl(config.apiUrl + "/repos/" + config.repository + (resource ? "/" + resource : ""), {
      method,
      redirect: "manual",
      headers: {
        "authorization": "Bearer " + config.sourceToken,
        "accept": "application/vnd.github+json",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(60000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error("GitHub metadata request failed (HTTP " + response.status + ")");
    return response.json();
  }
  async function list(resource, field) {
    const values = [];
    for (let page = 1; page <= 1000; page++) {
      const response = await request(resource + (resource.includes("?") ? "&" : "?") + "per_page=100&page=" + page);
      const entries = field ? response[field] : response;
      if (!Array.isArray(entries)) throw new Error("Invalid GitHub paginated response");
      values.push(...entries);
      if (entries.length < 100) return values;
    }
    throw new Error("GitHub metadata pagination exceeds limits");
  }
  return { get: request, request, list };
}

export async function verifyProducer(config, event, client) {
  if (config.mode === "workflow-run") {
    if (config.eventName !== "workflow_run" || event.workflow_run?.id !== config.runId)
      throw new Error("Worker is not associated with its workflow_run event");
  } else if (!["schedule", "workflow_dispatch"].includes(config.eventName) || config.currentRunId !== config.runId) {
    throw new Error("Data worker must consume its own trusted scheduled or manual run");
  }
  const repo = await client.get("");
  const workflow = await client.get("actions/workflows/" + encodeURIComponent(config.producer));
  const run = await client.get("actions/runs/" + config.runId);
  if (
    !Number.isSafeInteger(repo.id) ||
    repo.full_name?.toLowerCase() !== config.repository.toLowerCase() ||
    workflow.path !== ".github/workflows/" + config.producer ||
    run.workflow_id !== workflow.id ||
    run.repository?.id !== repo.id ||
    run.head_repository?.id !== repo.id ||
    !OID.test(run.head_sha || "")
  ) {
    throw new Error("Producer workflow or repository association is invalid");
  }
  if (config.mode === "download-verified") {
    const ref = await client.get("git/ref/heads/" + encodeURIComponent(config.expectedBranch));
    if (
      repo.default_branch !== config.expectedBranch ||
      run.head_branch !== config.expectedBranch ||
      !["schedule", "workflow_dispatch"].includes(run.event) ||
      ref.object?.sha !== run.head_sha
    ) {
      throw new Error("Data producer is not the current protected default-branch revision");
    }
    return { repo, run, sha: run.head_sha };
  }
  if (run.event !== "pull_request" || run.status !== "completed")
    throw new Error("Unexpected preview producer event or status");
  let associations = run.pull_requests;
  if (!Array.isArray(associations) || !associations.length)
    associations = await client.list("commits/" + run.head_sha + "/pulls");
  if (associations.length !== 1 || !Number.isSafeInteger(associations[0].number) || associations[0].number <= 0)
    throw new Error("Ambiguous producer PR association");
  const association = associations[0];
  const pr = await client.get("pulls/" + association.number);
  if (
    pr.number !== association.number ||
    pr.base?.repo?.id !== repo.id ||
    pr.base.ref !== config.expectedBranch ||
    pr.head?.repo?.id !== repo.id
  ) {
    throw new Error("Preview PR origin or base branch is not permitted");
  }
  const expectedHead = association.head?.sha || run.head_sha;
  if (!OID.test(expectedHead)) throw new Error("Invalid producer head");
  if (pr.state === "closed") return { repo, run, pr, sha: expectedHead, action: "closed" };
  if (pr.state !== "open" || pr.draft || pr.head.sha !== expectedHead) return { skipped: true };
  if (run.head_sha !== expectedHead) {
    const commit = await client.get("git/commits/" + run.head_sha);
    if (
      !Array.isArray(commit.parents) ||
      commit.parents.length !== 2 ||
      !commit.parents.some((parent) => parent.sha === expectedHead)
    ) {
      throw new Error("Producer revision does not match the current PR head or its test merge");
    }
  }
  if (run.conclusion !== "success") return { skipped: true };
  return { repo, run, pr, sha: expectedHead, action: "synchronize" };
}

export async function downloadArchive(config, artifact, fetchImpl = globalThis.fetch) {
  if (
    !Number.isSafeInteger(artifact.id) ||
    artifact.id <= 0 ||
    artifact.expired ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes < 0 ||
    artifact.size_in_bytes > Math.max(config.limits.compressedBytes, config.limits.unpackedBytes || 0)
  )
    throw new Error("Invalid or oversized artifact metadata");
  const endpoint = config.apiUrl + "/repos/" + config.repository + "/actions/artifacts/" + artifact.id + "/zip";
  let currentUrl = endpoint;
  let response = await fetchImpl(endpoint, {
    redirect: "manual",
    headers: { authorization: "Bearer " + config.sourceToken, accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(60000),
  });
  for (let attempt = 0; [301, 302, 303, 307, 308].includes(response.status); attempt++) {
    if (attempt >= 3) throw new Error("Too many artifact redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error("Artifact redirect is missing its destination");
    const redirect = new URL(location, currentUrl);
    if (redirect.protocol !== "https:" || redirect.username || redirect.password)
      throw new Error("Unsafe artifact redirect");
    // Storage redirects originate from the authenticated GitHub API. Never forward its token.
    currentUrl = redirect.href;
    response = await fetchImpl(currentUrl, { redirect: "manual", signal: AbortSignal.timeout(60000) });
  }
  if (!response.ok || !response.body) throw new Error("Artifact download failed");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > config.limits.compressedBytes)
    throw new Error("Artifact download exceeds compressed limit");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > config.limits.compressedBytes) throw new Error("Artifact download exceeds compressed limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readArtifact(config, producer, client, fetchImpl) {
  const artifacts = await client.list("actions/runs/" + producer.run.id + "/artifacts", "artifacts");
  const matching = artifacts.filter((artifact) => artifact.name === config.artifactName && !artifact.expired);
  if (matching.length !== 1) throw new Error("Expected exactly one named artifact for the verified producer run");
  const artifact = matching[0];
  if (
    artifact.workflow_run &&
    (artifact.workflow_run.id !== producer.run.id || artifact.workflow_run.head_sha !== producer.run.head_sha)
  )
    throw new Error("Artifact is associated with another run or revision");
  const buffer = await downloadArchive(config, artifact, fetchImpl);
  return readStaticArchive(buffer, {
    limits: config.limits,
    allowedPaths: config.allowedPaths,
    allowedPattern: config.allowedPattern,
    jsonOnly: config.jsonOnly,
    jsonPathPrefix: config.jsonPathPrefix,
  });
}

async function saveValidatedFiles(files, root) {
  const directory = await mkdtemp(path.join(root, "verified-static-artifact-"));
  for (const [name, entry] of files) {
    safeArchivePath(name);
    const destination = path.join(directory, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.from(entry.contents, "base64"), { flag: "wx", mode: 0o600 });
  }
  return directory;
}

async function upsertComment(config, producer, client, result, files) {
  const marker = "<!-- " + config.commentHeader + " -->";
  const prefix = config.pathPrefix ? config.pathPrefix + "/" : "";
  const previewUrl = config.pagesBaseUrl.replace(/\/+$/, "") + "/" + prefix + "pr-" + producer.pr.number + "/";
  let body;
  if (producer.action === "closed") {
    if (!result.removed) return;
    body = marker + "\n" + config.commentTitle + " was removed because this PR is closed.";
  } else {
    body = marker + "\n" + config.commentTitle + ": " + previewUrl;
    const qr = files.get("pr-preview-qr.png");
    if (
      config.qr &&
      qr &&
      Buffer.from(qr.contents, "base64")
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      body += "\n\n[![QR code for the preview](" + previewUrl + "pr-preview-qr.png)](" + previewUrl + ")";
    }
    if (config.commentFooter) body += "\n\n" + config.commentFooter;
  }
  const comments = await client.list("issues/" + producer.pr.number + "/comments");
  const existing = comments.find(
    (comment) =>
      comment.user?.type === "Bot" &&
      comment.user.login === "github-actions[bot]" &&
      typeof comment.body === "string" &&
      comment.body.includes(marker),
  );
  if (existing) await client.request("issues/comments/" + existing.id, "PATCH", { body });
  else await client.request("issues/" + producer.pr.number + "/comments", "POST", { body });
  return previewUrl;
}

export async function runTrustedWorker(config, { fetchImpl = globalThis.fetch, event, log = console.log } = {}) {
  const payload = event || JSON.parse(await readFile(config.eventPath, "utf8"));
  const client = createSourceClient(config, fetchImpl);
  const producer = await verifyProducer(config, payload, client);
  if (producer.skipped) return { skipped: true };
  let files = producer.action === "closed" ? new Map() : await readArtifact(config, producer, client, fetchImpl);
  if (config.mode === "workflow-run" && producer.action !== "closed")
    files = prepareStaticPreview(files, config.includeSearchIndexes);
  if (config.mode === "download-verified") {
    const current = await client.get("git/ref/heads/" + encodeURIComponent(config.expectedBranch));
    if (current.object?.sha !== producer.sha)
      throw new Error("Default branch changed while downloading the data artifact");
    const directory = await saveValidatedFiles(files, config.tempRoot);
    if (config.outputFile)
      await appendFile(config.outputFile, "artifact-directory=" + directory + "\nsource-sha=" + producer.sha + "\n");
    return { directory, files };
  }
  const stillCurrent = async () => {
    const latest = await client.get("pulls/" + producer.pr.number);
    return (
      latest.base?.repo?.id === producer.repo.id &&
      latest.head?.repo?.id === producer.repo.id &&
      latest.base.ref === config.expectedBranch &&
      (producer.action === "closed"
        ? latest.state === "closed"
        : latest.state === "open" && !latest.draft && latest.head.sha === producer.sha)
    );
  };
  const publication = {
    ...config,
    repository: config.targetRepository,
    pr: String(producer.pr.number),
    sha: producer.sha,
    action: producer.action,
  };
  const result = await publishFiles(publication, files, { fetchImpl, log, beforeCommit: stillCurrent });
  if (result.skipped || !(await stillCurrent())) return { skipped: true };
  const previewUrl = await upsertComment(config, producer, client, result, files);
  if (config.outputFile)
    await appendFile(config.outputFile, "removed=" + result.removed + "\npreview-url=" + (previewUrl || "") + "\n");
  return { ...result, previewUrl };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await runTrustedWorker(loadWorkerConfig());
  } catch (error) {
    console.error("::error::" + error.message.replace(/[\r\n]/g, " "));
    process.exitCode = 1;
  }
}
