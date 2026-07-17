# Release And Deployment Policy

This repository has two separate tracks:

- `main` is the development track. It changes frequently and is not a stable
  installation source.
- A tag such as `v0.1.103` plus its GitHub Release is a stable delivery.

## Normal Development

AI or developers may commit and push completed development work to `main`.
The CI workflow checks type safety, application builds, Go builds, and version
consistency. Passing CI does not by itself create a public release.

Do not create or replace `latest`, upload release assets, or deploy production
as part of a normal development push.

## Release Steps

1. Update the root `VERSION` file. It is the source of truth for the release
   version. Keep `package.json` synchronized with it.
2. Run the repository checks:

   ```powershell
   pnpm install --frozen-lockfile
   pnpm verify:version
   pnpm typecheck
   pnpm build
   Set-Location agents
   go test ./...
   go build ./...
   Set-Location ..
   ```

3. Build and verify the required delivery artifacts using the Windows and
   Android runbooks.
4. Review the generated artifact names and SHA-256 values.
5. Commit the release preparation changes and create a tag matching `VERSION`:

   ```powershell
   git tag v0.1.103
   git push origin main --follow-tags
   ```

6. Publish the tag's assets with `deploy/publish-github-release.ps1` only after
   manual approval.

## User Installation Sources

- Windows setup, Windows update ZIP, Android APK, and CLI ZIP packages must
  come from a GitHub Release asset.
- A script from `main` is a development tool and must not silently build or
  install untested source code for production use.
- If a source checkout is used for development, record the commit SHA and do
  not use it as a stable deployment artifact.

## Docker Deployment

For development, building the current checkout is allowed:

```bash
DSC_VERSION=dev docker compose up -d --build
```

For production, check out a release tag first and pass the same explicit
version to Compose:

```bash
git fetch --tags
git checkout v0.1.103
DSC_VERSION=0.1.103 docker compose up -d --build
```

Do not run a production deployment from an unreviewed `main` checkout.

## Version Rules

The root `VERSION` file is the shared version source. Build scripts inject it
into generated artifacts. Do not add another hard-coded application release
version to a Docker Compose file or Go source file.
