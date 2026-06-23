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
- Update documentation when behavior or deployment steps change

## Commit Guidance

- Keep changes focused.
- Explain user-visible behavior changes in the pull request.
- Avoid committing generated files such as `.next`, `dist`, or `*.tsbuildinfo`.
