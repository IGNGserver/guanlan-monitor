# Device State Console v3.0.164

## Safari web app icon

- The Web PWA now ships a 1024×1024 opaque, full-bleed maskable icon, plus matching 512/192 `any` and `maskable` variants and a 180×180 `apple-touch-icon`. Safari's macOS "Add to Dock" uses the largest opaque, full-bleed icon; the previous set topped out at 512 and the 512 `any` asset still had transparent rounded corners, so Safari fell back to a letter tile.
- All PWA icon sizes use the same heartbeat mark. The manifest declares 1024 `any` and `maskable` entries, and `/manifest.json` is served as `application/manifest+json`.
- A PWA asset regression test now checks that every manifest icon exists, its declared size matches the PNG metadata, and all icons are opaque RGB.

## Notes

- Existing Safari web apps keep the icon captured when they were added. Remove the old web app from the Dock/Applications and add it again after updating to this release.
- No server, Web API, or desktop changes.

## Validation

- PWA asset tests, version consistency, and the Web boundary check pass.
- The feature PR and the post-merge CI passed all checks.
- Release assets are built again by the version-tag release workflow.
