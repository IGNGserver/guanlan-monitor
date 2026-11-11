# Device State Console v3.0.163

## Android home screen widgets

- Added three One UI home screen widgets: **Fleet** (4×1 / 4×2 / 4×4), **Device** (2×2 / 4×2), and **Traffic** (2×2 / 4×2).
- Widgets use the app's One UI palette, tabular figures, system widget radius, and system light/dark resources. The CPU gauge, sparkline, and daily bars are drawn by Canvas so the widgets keep the app's visual language.
- Refresh runs through WorkManager at the Android minimum of 15 minutes, with a manual refresh action. The last successful snapshot is retained; offline, stale, and refresh-failure states are shown explicitly instead of fake readings.
- Device and Traffic widgets keep a per-instance device selection and support long-press reconfiguration.
- Tapping a widget row or card deep-links into the existing Device Detail or Traffic screen. If the app is not signed in yet, the destination is applied after auto-login.
- Logging out or changing the Hub clears the widget snapshot to avoid leaving another account's hostnames on the home screen.
- No server, Web, or desktop API changes.

## Validation

- Android: `:app:assembleDebug`, `:app:testDebugUnitTest`, `:app:lintDebug`, and a local unsigned `:app:assembleRelease` (R8) passed; the `Verify Android One UI client` CI job passed.
- `WidgetRenderTest` expands every RemoteViews variant, catching unsupported views and missing view ids that would fail at launcher inflation time.
- Release assets are built again by the version-tag release workflow.

## Known limitations

- Home screen refresh is bounded by the Android WorkManager minimum of 15 minutes; Doze and vendor battery policies may delay it further. The widget shows its last successful update and provides a manual refresh action.
- Android 12+ uses `previewLayout` for the picker preview; Android 10/11 show the app icon as the widget preview.
- Chart bitmaps use the theme colors at render time and are redrawn on the next refresh after a system theme change.
- There is no in-app widget settings screen yet; the refresh cadence is fixed at 15 minutes.
