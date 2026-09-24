# Contributing

## Development Setup

Local development may install dependencies and run `pnpm dev` for interactive
work, but it must not produce release artifacts or perform deployments. All
verification, builds, packaging, image publication, and deployment must run in
GitHub Actions.

## Before Opening a Pull Request

- Push the branch and inspect the required GitHub Actions checks.
- Review workflow artifacts, image tags, and deployment environment results in GitHub.
- Update documentation when behavior or deployment steps change

## Development And Release Boundaries

Pushes to `main` are development updates. They may contain changes that have
passed CI but have not completed manual acceptance, packaging, or production
verification. A push to `main` must not be treated as a user-installable
release.

Until the user explicitly requests a formal release, the phrase “publish a
release” means a tested release. A tested release must not be presented as a
stable production delivery. Only a version tag such as `v0.1.103` and its
GitHub Release, after explicit formal-release approval, represent a stable
delivery.

Production Docker deployments must pull a specific Docker Hub image tag or
image digest. `latest` is allowed only when explicitly selected. Do not deploy
production by building from `main` or another untested source checkout.

## Commit Guidance

- Keep changes focused.
- Explain user-visible behavior changes in the pull request.
- Avoid committing generated files such as `.next`, `dist`, or `*.tsbuildinfo`.
