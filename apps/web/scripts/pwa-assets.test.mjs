import assert from "node:assert/strict";
import test from "node:test";
import { classifyPwaAssets } from "./pwa-assets.mjs";

test("atomic core retains shared, lazy and media dependencies but excludes unrelated route bootstrap", () => {
  const paths = ["/_next/static/chunks/app/page-abcd1234.js", "/_next/static/chunks/app/layout-abcd1234.js", "/_next/static/chunks/guanlan-device.abcd1234.js", "/_next/static/chunks/guanlan-settings.abcd1234.js", "/_next/static/media/icon.abcd1234.png", "/_next/static/css/abcd1234.css", "/_next/static/chunks/app/devices/[deviceId]/page-abcd1234.js", "/_next/static/chunks/app/_not-found/page-abcd1234.js", "/_next/static/build-id/_buildManifest.js", "/_next/static/chunks/app/page.js.map"];
  const { assets, runtimeAssets } = classifyPwaAssets(paths);
  assert.ok(assets.includes("/"));
  for (const path of paths.slice(0, 6)) assert.ok(assets.includes(path), path);
  for (const path of paths.slice(6, 9)) assert.ok(runtimeAssets.includes(path) && !assets.includes(path), path);
  assert.ok(!assets.includes("/logo.png") && runtimeAssets.includes("/logo.png"));
  assert.ok(![...assets, ...runtimeAssets].some((path) => path.endsWith(".map")));
});

test("manifest generation rejects non-static, traversal and query paths", () => {
  for (const path of ["/api/instances", "/_next/static/../../api/instances", "/_next/static/one.js?q=1", "/_next/static\\other.js"]) assert.throws(() => classifyPwaAssets([path]));
});
