# CHANGELOG

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) rules.

## [unreleased]

## [[0.1.0](https://github.com/open-resource-discovery/pr-preview-action/releases/tag/v0.1.0)] - 2026-11-23

### Changed

- When upgrading fork previews, copy any custom `target-repo`, `target-branch`, `umbrella-dir` and `pages-base-url` values from the PR build into the trusted `workflow_run` worker. The destinations must match. Set custom QR and PR comment options on the worker as well.
- Fork artifact uploads use `actions/upload-artifact@v7` on GitHub.com and `@v3-node20` on GitHub Enterprise Server. The worker and cleanup steps use `actions/checkout@v7`, which requires Actions Runner 2.327.1 or later.
- Renovate now tracks dependency updates. Repository development tooling requires Node.js 22.22.1 or later. CI tests it on 22.22.1 and 26.

### Fixed

- Deployment, cleanup and PR comment links use the current repository when `target-repo` is empty. An empty `token` falls back to the job's `GITHUB_TOKEN`.
- Preview and QR availability checks now use a per-request timeout and read at most eight bytes from each response.

### Security

- Before publishing or removing a fork preview, the worker verifies the fork, branch, commit and current PR state against GitHub. It skips stale or ambiguous runs.
- The worker parses JSON and legacy `.env` artifact metadata as plain data. It rejects mismatched destinations, unsafe archive paths, symbolic links and oversized files before extracting the preview.

## [[0.0.1](https://github.com/open-resource-discovery/pr-preview-action/releases/tag/v0.0.1)] - 2026-04-30

### Added

- Added internal QR code generation for PR preview links using vendored `segno`.
- Added QR PNG deployment alongside the preview output.
- Added asset reachability checks before posting the PR preview comment.
- Added cache-busted QR image URLs to avoid stale or broken image rendering.

### Changed

- Replaced the external QR provider with fully local QR generation.
- QR codes are now enabled by default without sending preview URLs to third-party services.
- PR comments now use the validated QR image URL after preview deployment.

### Security

- Removed third-party QR provider usage to prevent preview URL leakage.
- Reduced MITM, tracking, and external service dependency risks for QR generation.
