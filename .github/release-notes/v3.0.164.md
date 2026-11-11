# Device State Console v3.0.164

## Safari web app icon

- Safari's **Add to Dock** now receives valid opaque 1024×1024 `any` and `maskable` icons. The previous set topped out at 512 px and the 512 "any" asset still had transparent rounded corners, so Safari fell back to a letter tile.
- Regenerated the 1024/512/192 and Apple touch icons from the existing 1254 px source, and served `/manifest.json` with `application/manifest+json`.
- Added `apps/web/scripts/pwa-icons.test.mjs` so every manifest icon is checked for declared dimensions, PNG signature, and opaque RGB color before release.

## Included from v3.0.163

- The three Android home screen widgets (**Fleet**, **Device**, **Traffic**) remain included: 15-minute WorkManager refresh, per-instance device configuration, stale/error states, and deep links into the app.

## Validation

- The new PWA icon regression test runs as part of `test:web-pwa`; the main CI run that merged #87 passed.
- Release assets and Docker images are rebuilt by the version-tag and stable workflows.

## Known limitations

- The Android widget refresh follows the Android WorkManager minimum of 15 minutes; Doze and vendor battery policies may delay it further.
- This release does not add an in-app widget settings screen or change any server API.
