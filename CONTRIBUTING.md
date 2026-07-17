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

Only a version tag such as `v0.1.103` and its GitHub Release represent a
stable delivery. Create the tag and publish release assets only after the
checks in [RELEASE.md](RELEASE.md) pass and the release has been explicitly
approved.

Production Docker deployments must use a specific release tag or image digest.
Do not deploy production by pulling `main` and running `docker compose up -d
--build`.

## Commit Guidance

- Keep changes focused.
- Explain user-visible behavior changes in the pull request.
- Avoid committing generated files such as `.next`, `dist`, or `*.tsbuildinfo`.
