/** Root offline HTML also serves device deep links. Keep every shared/lazy
 * application chunk and its media in the atomic shell, but not unrelated route
 * bootstrap or Pages-router build diagnostics. Unknown assets stay core: a
 * smaller number is not worth a partially usable offline application.
 */
export function classifyPwaAssets(paths) {
  const assets = ["/", "/manifest.json", "/favicon.png"];
  const runtimeAssets = ["/logo.png"];
  for (const path of paths) {
    if (!path.startsWith("/_next/static/") || /[?#\\]/.test(path) || new URL(path, "https://pwa.invalid").pathname !== path) throw new Error("invalid_pwa_asset");
    if (path.endsWith(".map")) continue;
    const runtime = /\/(?:_buildManifest|_ssgManifest)\.js$/.test(path)
      || /^\/_next\/static\/chunks\/app\/(?:devices\/|_not-found\/)/.test(path);
    (runtime ? runtimeAssets : assets).push(path);
  }
  return { assets: [...new Set(assets)].sort(), runtimeAssets: [...new Set(runtimeAssets)].sort() };
}
