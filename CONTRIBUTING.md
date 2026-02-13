# Contributing to an SAP Open Source Project

## Code of Conduct

All members of the project community must abide by the [SAP Open Source Code of Conduct](https://github.com/SAP/.github/blob/main/CODE_OF_CONDUCT.md).

Instances of abusive, harassing, or otherwise unacceptable behavior may be reported by creating a GitHub issue in this repository.

Contributors will be asked to accept a DCO before they submit the first pull request to this project, this happens in an automated fashion during the submission process.
SAP uses [the standard DCO text of the Linux Foundation](https://developercertificate.org/).

## Contributing with AI-generated code

- If you are a new contributor, see: [Steps to Contribute](#steps-to-contribute)
- Before implementing your change, create an issue that describes the problem you would like to solve or the code that should be enhanced. Please note that you are willing to work on that issue.
- The team will review the issue and decide whether it should be implemented as a pull request. In that case, they will assign the issue to you.
- If the team decides against picking up the issue, the team will post a comment with an explanation.

## Steps to Contribute

Should you wish to work on an issue, please claim it first by commenting on the GitHub issue that you want to work on. This is to prevent duplicated efforts from other contributors on the same issue.

If you have questions about one of the issues, please comment on them, and one of the maintainers will clarify.

## Contributing Code (Composite GitHub Action)

This project is a **Composite GitHub Action** (`action.yml`) based on bash steps and existing third-party actions.

- Keep changes focused and minimal.
- Prefer portability: bash scripts should run on common Linux runners.
- Avoid breaking backwards compatibility of inputs/outputs unless discussed in an issue first.

### Local formatting and git hooks (optional)

This repository uses Prettier for Markdown/YAML formatting and Husky + lint-staged for an optional pre-commit hook.

Enable it locally:

```sh
npm ci
npx husky install
```

Format everything:

```sh
npm run prettier
```

## Contributing Code or Documentation

You are welcome to contribute code in order to fix a bug or to implement a new feature that is logged as an issue.

The following rule governs code contributions:

- Contributions must be licensed under the [Apache 2.0 License](./LICENSE)

## Security Issues

Please **do not** report security vulnerabilities via public GitHub issues.

Instead, report them through the SAP Trust Center:
https://www.sap.com/about/trust-center/security/incident-management.html
