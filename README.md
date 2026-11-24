# pr-preview-action

## About this project

This repository provides a Composite GitHub Action to deploy PR previews (including fork PRs) to a target repository (e.g. GitHub Pages branch/folder).
It supports:

- Direct deploy/remove for local PRs
- Fork-safe flow via artifact upload (PR workflow) + deploy/remove (workflow_run worker)

## How it works

### Local PRs

On `pull_request`:

- opened/reopened/synchronize -> deploy
- closed -> remove (deletes the preview directory from the target branch)

### Fork PRs

On `pull_request` from forks:

- Build runs without secrets, uploads an artifact (static output + meta)
  On `workflow_run`:
- The worker verifies the originating run against the current GitHub pull request. A matching open PR can publish static files. A matching closed PR can remove its preview. Stale or ambiguous runs are skipped.
- Set the preview repository, branch, umbrella directory and Pages base URL in the trusted worker workflow. Use the same values in the PR build workflow. Existing cross-repository deployments must copy any custom settings into the worker when upgrading. The worker rejects an artifact that names a different destination. Configure custom comment text and QR settings on the worker as well.
- The example serializes worker runs for the same fork and head branch. Static fork artifacts support up to 10,000 entries, 256 MiB compressed, 512 MiB extracted and 128 MiB per file.
- The worker token needs pull request access on the source for lookup and comments, Actions read on the source for artifact download, and Contents write on the preview target. The worker checkout uses the job token with Contents read.

> Note: Secrets (except GITHUB_TOKEN) are not available to workflows triggered from forks. This is why the worker pattern exists.

## Why not use existing PR preview actions?

We reviewed existing marketplace options (e.g. `rossjrw/pr-preview-action`). The main differences are:

- **Fork support:** many preview actions focus on same-repo PRs, fork PRs are often not supported out of the box.
- **Security model:** our default approach keeps secrets out of the untrusted fork PR run by using an artifact + `workflow_run` worker pattern.
- **Cross-repo deploy clarity:** we explicitly support deploying to a separate target repo/branch and document the required PAT + `persist-credentials: false` checkout setting.

If you only need same-repo PR previews for GitHub Pages, marketplace actions may be enough. If you need reliable fork-safe previews and cross-repo deploy/cleanup, this action provides a consistent pattern.

## Requirements

- Runner needs `bash`, `curl` and `python` available.
- Target repo must accept pushes to the configured branch.
- For GitHub Pages, the target branch/folder must be configured accordingly.

## Inputs

| Input          | Required | Default      | Description                                                                                                      |
| -------------- | -------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| fork           | no       | false        | Enable fork support (upload artifact on fork PRs).                                                               |
| build-dir      | no       | build        | Directory containing built output.                                                                               |
| token          | no       | GITHUB_TOKEN | Token used for API + deploy/remove (PAT recommended for cross-repo).                                             |
| target-repo    | no       |              | Repo hosting previews. If empty, deploys to the current repository.                                              |
| target-branch  | no       | main         | Branch to deploy to.                                                                                             |
| pages-base-url | no       | ""           | Base URL used in the PR comment link.                                                                            |
| qr-code        | no       | true         | Adds an internally generated QR code to the PR comment. Set to `false` to disable.                               |
| umbrella-dir   | no       | ""           | Top-level directory inside the target repo. If not set, a smart default is chosen (see "Preview folder layout"). |
| comment-\*     | no       | ...          | Sticky PR comment configuration.                                                                                 |

GitHub Pages can take up to 10 minutes to publish a change. By default, the action checks the preview URL up to 180 times (`wait-poll-attempts`) with a five-second pause between attempts (`wait-poll-interval-seconds`). This allows about 15 minutes of pauses for delayed publication. HTTP requests add to the elapsed time. The check ends as soon as the preview responds successfully. [GitHub Pages publishing times](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site#viewing-your-published-site).

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

## Example: two-workflow setup (fork-safe)

See `examples/`.

## Security

- Do NOT use self-hosted runners for public repos when running untrusted PR code.
- Serve fork previews as static files on an isolated origin without application credentials. Fork HTML and JavaScript run in the viewer’s browser. Configure branch-based Pages to serve raw static files, for example with `.nojekyll` at the publishing root.

## Support, Feedback, Contributing

This project is open to feature requests, bug reports etc. via GitHub issues.
For contribution details, see CONTRIBUTING.md.

## Security / Disclosure

Please do not report security vulnerabilities via public GitHub issues.
Follow the instructions in SECURITY.md.

## Licensing

Copyright SAP SE or an SAP affiliated Company and Open Resource Discovery contributors.

This project is licensed under [Apache-2.0](./LICENSE). Licensing metadata follows [REUSE](https://reuse.software/) and is recorded in [REUSE.toml](./REUSE.toml).
