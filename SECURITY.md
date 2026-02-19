# Security Policy

SAP takes the security of our software products and services seriously. This includes all source code repositories managed through SAP’s GitHub organizations.

## Supported Versions

Security fixes are provided for the latest released major version of this project.

- **Supported:** latest `v1.x.y` release
- **Not supported:** older major versions

If you are using an older version, please upgrade to the latest release before reporting issues, if possible.

## Reporting Security Issues

Please **do not** report security vulnerabilities through public GitHub issues.

Instead, please report them via the SAP Trust Center:
https://www.sap.com/about/trust-center/security/incident-management.html

If you prefer email, send your report to:
secure@sap.com

If possible, encrypt your message with SAP’s public PGP key (available via the Trust Center).

Please include (as much as possible):

- Repository name / URL
- Type of issue (e.g., injection, auth bypass, information disclosure)
- Affected file paths and location (tag/branch/commit or direct URL)
- Any particular configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof of concept (if available)
- Impact assessment (how it could be exploited)

## Preferred Language

Please communicate in **English**.

## Disclosure

Please follow SAP’s disclosure guidelines for security advisories (linked from the Trust Center).

## Notes for GitHub Actions / This Project

This repository contains a GitHub Action used in CI/CD contexts.

- **Do not** include secrets, tokens, or sensitive data in issues, logs, or example workflows.
- Treat artifacts produced by fork PR workflows as **untrusted input** and avoid executing or evaluating untrusted content in privileged workflows.
- If you suspect a vulnerability related to token usage, fork handling, or deployment behavior, report it via the channels above.
