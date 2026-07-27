# Release And Deployment Policy

This repository has two separate tracks:

- `main` is the development track. It changes frequently and is not a stable
  installation source.
- A tag such as `v0.1.103` plus its GitHub Release is a tested release. It is
  not a formal production release unless that is explicitly requested.
- Until the user explicitly says “publish a formal release”, “publish a
  release” means a test release. Test releases must not be treated as stable
  installation sources or production deployments.

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

Production Compose pulls tested images from Docker Hub. It never clones the
repository and it does not build from the current checkout:

```bash
DSC_VERSION=0.1.111 docker compose pull
DSC_VERSION=0.1.111 docker compose up -d
```

To intentionally use the moving Docker Hub tag:

```bash
DSC_VERSION=latest docker compose pull
DSC_VERSION=latest docker compose up -d
```

The default image repositories are
`docker.io/igngserver/device-state-console-server` and
`docker.io/igngserver/device-state-console-web`. Override them with
`DSC_SERVER_IMAGE` and `DSC_WEB_IMAGE` when using a private or mirrored
repository. `docker-compose.cn.yml` only changes infrastructure image mirrors.
Do not run a production deployment from an unreviewed `main` checkout and do
not use `latest` unless it was explicitly selected.

The Docker publish workflow pushes a fixed version image for a version tag.
Updating `latest` requires a separate manual workflow run with
`publish_latest=true` and is therefore an explicit release decision.

## Version Rules

The root `VERSION` file is the shared version source. Build scripts inject it
into generated artifacts. Do not add another hard-coded application release
version to a Docker Compose file or Go source file.
Until explicitly authorized otherwise, only the patch number may increase;
the major and minor numbers must remain unchanged.

## Release Asset Names

Every release asset must identify its platform and delivery mode:

- `DeviceStateConsole-Windows-GUI-Setup-vX.Y.Z.exe`
- `DeviceStateConsole-Windows-GUI-Portable-vX.Y.Z.zip`
- `DeviceStateConsole-Windows-GUI-Update-vX.Y.Z.zip`
- `DeviceStateConsole-Windows-CLI-Install-vX.Y.Z.zip`
- `DeviceStateConsole-Linux-CLI-Install-vX.Y.Z.zip`
- `DeviceStateConsole-Android-vX.Y.Z.apk`
