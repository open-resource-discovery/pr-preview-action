# pr-preview-action

## About this project

This repository provides a composite GitHub Action to deploy previews for same-repository pull requests. It can publish to GitHub Pages in the source repository or a separate preview repository.

## How it works

On `pull_request` from the same repository:

- opened/reopened/synchronize -> deploy
- closed -> remove (deletes the preview directory from the target branch)

The action skips fork pull requests and events other than `pull_request`.

When upgrading a fork-enabled setup, delete the `pr-preview-worker.yml` workflow and use the same-repository job guard from the example below. Remove the `fork` input from the caller. The action ignores this legacy input so existing callers continue to load without an unknown-input warning.

## Requirements

- Runner needs `bash`, `curl`, `node` and `python` available.
- Target repo must accept pushes to the configured branch.
- For GitHub Pages, the target branch/folder must be configured accordingly.

## Inputs

| Input                  | Required | Default      | Description                                                                                                      |
| ---------------------- | -------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| build-dir              | no       | build        | Directory containing built output.                                                                               |
| include-search-indexes | no       | false        | Publish generated search indexes and keep documentation search controls. Enable when testing search changes.     |
| token                  | no       | GITHUB_TOKEN | Token used for API + deploy/remove (PAT recommended for cross-repo).                                             |
| target-repo            | no       |              | Repo hosting previews. If empty, deploys to the current repository.                                              |
| target-branch          | no       | main         | Branch to deploy to.                                                                                             |
| pages-base-url         | no       | ""           | Base URL used in the PR comment link.                                                                            |
| qr-code                | no       | true         | Adds an internally generated QR code to the PR comment. Set to `false` to disable.                               |
| umbrella-dir           | no       | ""           | Top-level directory inside the target repo. If not set, a smart default is chosen (see "Preview folder layout"). |
| comment-\*             | no       | ...          | Sticky PR comment configuration.                                                                                 |

GitHub Pages can take up to 10 minutes to publish a change. By default, the action checks the preview URL up to 180 times (`wait-poll-attempts`) with a five-second pause between attempts (`wait-poll-interval-seconds`). This allows about 15 minutes of pauses for delayed publication. HTTP requests add to the elapsed time. The check ends as soon as the preview responds successfully. [GitHub Pages publishing times](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site#viewing-your-published-site).

## Search indexes

Previews exclude `search-index*.json` files at every directory level, including their `.gz` and `.br` variants.
These generated files duplicate source content in a dense format that makes secret-scanning findings difficult to trace.
The action prepares a temporary deployment copy, so the original build output remains available for other workflow steps.
When indexes are excluded, Docusaurus pages hide the desktop and mobile documentation search controls.
Other HTML pages and application filters are unchanged.

Set `include-search-indexes: true` when a pull request needs to test documentation search.

Each deployment removes obsolete files within its own PR preview directory, including indexes left by earlier deployments.
Other preview directories are preserved.
Existing previews receive this cleanup when redeployed or removed on PR closure.
This does not remove files from Git history or resolve historical secret-scanning alerts.
Source files and rendered pages still require review if a finding represents an actual secret.

## Preview folder layout (umbrella-dir behavior)

The `umbrella-dir` input has a default value of `""`, but the action applies a **runtime default** when it is not provided to avoid collisions.

### Rules

- Each directory component in `umbrella-dir` may contain ASCII letters, digits, dots, underscores and hyphens. Use slashes to separate components. The special components `.`, `..` and `.git` are reserved. Choose a destination with no symbolic links in its path.
- Else, if `target-repo` is empty or equals the current repository: `umbrella-dir` defaults to `pr-preview`.
- Else (deploying to a different target repo): `umbrella-dir` defaults to the sanitized source repo name (`<repo>` from `owner/repo`).

### Resulting folder structure

Previews are deployed to:

`<umbrella-dir>/pr-<number>/`

Examples:

- Same-repo deploy (own `gh-pages`): `pr-preview/pr-123/`
- Cross-repo deploy (central previews repo): `<source-repo>/pr-123/`

## QR code in PR comment

By default, the action adds an internally generated QR code to the PR comment.

The QR code is generated locally during the workflow and deployed together with the preview output. No external QR provider is used, so preview URLs are not sent to third-party services.

- Enabled by default: `qr-code: true`
- Disable: `qr-code: false`

## Example workflow

Copy [the example workflow](./examples/pr-preview.yml) and replace `REPLACE_WITH_RELEASE_COMMIT_SHA` with the full commit SHA of the action release you are using. For a separate preview repository, configure the target repository, Pages URL, and `PR_PREVIEW_TOKEN` secret. The token needs permission to write to the preview branch and update the pull request comment in the source repository.

## Security

- Keep the same-repository guard at the job level so it runs before checkout, build, and access to preview credentials.
- Use GitHub-hosted runners for workflow jobs that run untrusted PR code in public repositories.

## Support, Feedback, Contributing

This project is open to feature requests, bug reports etc. via GitHub issues.
For contribution details, see CONTRIBUTING.md.

## Security / Disclosure

Please do not report security vulnerabilities via public GitHub issues.
Follow the instructions in SECURITY.md.

## Licensing

Copyright SAP SE or an SAP affiliated Company and Open Resource Discovery contributors.

This project is licensed under [Apache-2.0](./LICENSE). Licensing metadata follows [REUSE](https://reuse.software/) and is recorded in [REUSE.toml](./REUSE.toml).

## Trusted static worker

Use mode: workflow-run from a publisher workflow defined on the protected default branch.
The producer remains read-only and uploads a fixed-name static artifact.
Set producer-workflow, producer-run-id (the triggering workflow_run ID), artifact-name, expected-base-branch, and the trusted publication target/URL.
The worker verifies the run and unique current same-repository PR, validates the complete ZIP before reading file contents, and publishes through GitHub's signed commit API.
It performs close cleanup without requiring a successful build or an artifact.
Grant only actions: read, contents: write, and pull-requests: write to the publisher.
Do not check out or execute PR code or restore producer caches in that job.
The worker requires Node.js 20 or newer and a target branch that already exists.

Use mode: download-verified in the publishing job of a scheduled/manual workflow.
Set producer-run-id to the current run ID, the workflow filename, artifact name, and expected-artifact-files to a JSON array of exact JSON filenames.
Only artifacts from that workflow's current default-branch revision are accepted.
The artifact-directory output points to a fresh temporary directory; copy only the explicitly configured files into a trusted checkout.
No install or build is needed to use either mode because the reviewed ZIP parser is bundled.

The archive limits are 128 MiB compressed, 512 MiB total unpacked, 64 MiB per file, and 100,000 entries.
Traversal, Git control paths, symlinks, special/executable files, duplicates and case conflicts, encryption, and unexpected data filenames are rejected.
Storage redirects receive no GitHub authorization header.
The default legacy mode preserves existing direct-deploy callers; paused previews should stay paused until their trusted publisher is reviewed and merged.

For a scheduled/manual artifact containing a built site, use artifact-format: static and a trusted anchored expected-artifact-pattern.
Use json-path-prefix (for example data/) to require JSON validation of report files while allowing site assets in a separate namespace.
The filename pattern is trusted caller configuration and must never come from the artifact.
For preview producers, mode: generate-qr reuses the existing QR generator without any publication or token inputs; pass the complete preview URL as pages-base-url and the static output as build-dir.
