import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DeviceUpdates, compareVersions, selectUpdate, type FeedRelease } from "./device-updates.ts";

function release(version: string, prerelease = false): FeedRelease {
  const name = `DeviceStateConsole-Windows-Setup-v${version}.exe`;
  return { tag_name: `v${version}`, draft: false, prerelease, html_url: `https://github.com/IGNGserver/guanlan-monitor/releases/tag/v${version}`, assets: [{ name, state: "uploaded", size: 100, digest: `sha256:${"a".repeat(64)}`, browser_download_url: `https://github.com/IGNGserver/guanlan-monitor/releases/download/v${version}/${name}` }] };
}
test("channel selection is numeric SemVer, skips incomplete assets and never downgrades", () => {
  assert.equal(compareVersions("1.0.0-beta.10", "1.0.0-beta.2"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.9"), 1);
  assert.equal(compareVersions("1.0.0+one", "1.0.0+two"), 0);
  assert.equal(compareVersions("1.0.0-beta.01", "1.0.0"), null);
  const incomplete = release("3.0.0"); incomplete.assets = [];
  const list = [incomplete, release("2.0.0", true), release("1.1.0"), release("1.2.0-beta.1")];
  assert.equal(selectUpdate(list, "1.0.0", "stable", "windows-gui", "x64").latestVersion, "1.1.0");
  assert.equal(selectUpdate(list, "1.0.0", "preview", "windows-gui", "x64").latestVersion, "2.0.0");
  assert.equal(selectUpdate(list, "2.0.0", "stable", "windows-gui", "x64").available, false);
  assert.equal(selectUpdate(list, "1.0.0", "stable", "windows-gui", "arm64").available, false);
  const bad = release("1.1.0"); bad.assets[0].browser_download_url = "https://evil.example/update.exe";
  assert.equal(selectUpdate([bad], "1.0.0", "preview", "windows-gui", "x64").available, false);
});
test("oversized responses, malformed timestamps and malformed persisted releases fail closed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "guanlan-update-test-"));
  try {
    const file = path.join(dir, "state.json");
    let calls = 0;
    await writeFile(file, JSON.stringify({ releases: {}, nextRequestAt: 500_000 }));
    const request: typeof fetch = async () => { calls++; return new Response(" ".repeat(4 * 1024 * 1024 + 1)); };
    const corrupt = new DeviceUpdates(file, "1.0.0", "windows-gui", "x64", request, () => 100_000);
    assert.equal((await corrupt.check("preview", true)).available, false);
    assert.equal(calls, 0);
    const oversized = new DeviceUpdates(path.join(dir, "oversized.json"), "1.0.0", "windows-gui", "x64", request, () => 100_000);
    assert.match((await oversized.check("preview", true)).message ?? "", /暂不可用/);
    const invalid: typeof fetch = async () => Response.json({ schemaVersion: 1, repository: "IGNGserver/guanlan-monitor", generatedAt: "invalid", releases: [release("2.0.0")] });
    assert.equal((await new DeviceUpdates(path.join(dir, "invalid.json"), "1.0.0", "windows-gui", "x64", invalid, () => 100_000).check("preview", true)).available, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("singleflight, persisted throttle, ETag and six hour automatic cache", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "guanlan-update-test-"));
  try {
    let now = 100_000, calls = 0;
    const request: typeof fetch = async (_url, init) => {
      calls++;
      if (calls === 2) { assert.equal((init?.headers as Record<string, string>)["If-None-Match"], '"feed1"'); return new Response(null, { status: 304 }); }
      return Response.json({ schemaVersion: 1, generatedAt: "2026-10-25T12:00:00Z", repository: "IGNGserver/guanlan-monitor", releases: [release("1.1.0"), release("2.0.0", true)] }, { headers: { ETag: '"feed1"' } });
    };
    const file = path.join(dir, "state.json");
    const updater = new DeviceUpdates(file, "1.0.0", "windows-gui", "x64", request, () => now);
    await Promise.all([updater.check("preview"), updater.check("preview")]);
    assert.equal(calls, 1);
    assert.equal(updater.cached("stable").latestVersion, "1.1.0");
    assert.equal(updater.cached("preview").latestVersion, "2.0.0");
    now += 60_001;
    await updater.check("preview"); assert.equal(calls, 1);
    await updater.check("stable", true); assert.equal(calls, 2);
    const restarted = new DeviceUpdates(file, "1.0.0", "windows-gui", "x64", request, () => now);
    await restarted.check("preview", true); assert.equal(calls, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("rate-limit retry deadline survives restarts and manual checks", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "guanlan-update-test-"));
  try {
    let calls = 0, now = 100_000;
    const request: typeof fetch = async () => { calls++; return new Response("limited", { status: 429, headers: { "Retry-After": "3600" } }); };
    const file = path.join(dir, "state.json");
    await new DeviceUpdates(file, "1.0.0", "windows-gui", "x64", request, () => now).check("preview", true);
    now += 600_000;
    await new DeviceUpdates(file, "1.0.0", "windows-gui", "x64", request, () => now).check("preview", true);
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
