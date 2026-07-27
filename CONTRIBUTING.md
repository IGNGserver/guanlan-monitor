# Contributing

## Development Setup

1. Copy `.env.example` to `.env`.
2. Install Node.js 22+, pnpm 10+, and Go 1.24+.
3. Run `pnpm install`.
4. Run `cd agents && go mod tidy`.
5. Start the application with `pnpm dev`.

## Before Opening a Pull Request

- Run `pnpm typecheck`
- Run `pnpm build`
- Run `pnpm verify:version`
- Run `go test ./...` and `go build ./...` from `agents`
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
