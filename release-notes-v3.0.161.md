# Device State Console v3.0.161

## Loading performance

- Improved loading behavior across Web, installed PWA, desktop, and Android: cached content is prioritized, summaries load before charts, and optional work is scheduled around network conditions.
- Reduced the homepage/device-page First Load JS bundle from 213 kB to 137 kB (about 36%). This is a bundle-size reduction, not a claim of a 36% faster startup.

## Validation and known limitations

- In the final fixed weak-network Chromium run, installed-PWA cached content committed at P75 368.4 ms and cold-Web interaction reached P75 3835.3 ms.
- Cold-Web online summary committed at P75 3804.8 ms, above the 3000 ms target; further cold-start/resource optimization remains necessary.
- Domestic no-proxy network conditions and representative cold starts on physical Android/Electron devices have not yet been measured.
