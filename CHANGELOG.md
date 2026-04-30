# CHANGELOG

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) rules.

## [unreleased]

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


