import test from "node:test";
import assert from "node:assert/strict";
import { WebDeviceUpdates, WEB_UPDATE_FEED, WEB_UPDATE_STORAGE, compareWebVersions } from "./device-updates.ts";
function store() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const feed = { schemaVersion: 1, repository: "IGNGserver/guanlan-monitor", generatedAt: "2026-10-25T12:00:00Z", releases: [
  { tag_name: "v1.1.0", prerelease: false, draft: false, html_url: "https://github.com/IGNGserver/guanlan-monitor/releases/tag/v1.1.0" },
  { tag_name: "v2.0.0", prerelease: true, draft: false, html_url: "https://github.com/IGNGserver/guanlan-monitor/releases/tag/v2.0.0" }
] };
test("browser checks repo without cookies or preflight, revalidates HTTP cache and persists channel/cooldown", async () => {
  let now = 100_000, calls = 0;
  const storage = store();
  const request: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, WEB_UPDATE_FEED);
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.referrerPolicy, "no-referrer");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.headers, undefined, "custom conditional headers would trigger a rejected Raw GitHub preflight");
    assert.equal(init?.cache, "no-cache");
    if (calls === 2) return new Response(null, { status: 304 });
    return Response.json(feed, { headers: { ETag: '"feed1"' } });
  };
  const service = new WebDeviceUpdates("1.0.0", () => now, storage, request);
  service.setChannel("stable");
  const results = await Promise.all([service.check(), service.check()]);
  assert.equal(calls, 1); assert.equal(results[0].latestVersion, "1.1.0");
  assert.equal(service.setChannel("preview").latestVersion, "2.0.0");
  const restarted = new WebDeviceUpdates("1.0.0", () => now, storage, request);
  assert.equal((await restarted.check(true)).latestVersion, "2.0.0"); assert.equal(calls, 1);
  now += 60_001;
  await restarted.check(); assert.equal(calls, 1);
  await restarted.check(true); assert.equal(calls, 2);
  assert.equal(new WebDeviceUpdates("2.1.0", () => now, storage, request).cached().available, false);
  assert.equal(compareWebVersions("1.0.0-beta.10", "1.0.0-beta.2"), 1);
  assert.equal(compareWebVersions("1.0.0+.", "1.0.0"), null);
});
test("rate deadlines survive restart and manual checks cannot bypass them", async () => {
  const storage = store(); let calls = 0, now = 100_000;
  const request: typeof fetch = async () => { calls++; return new Response("limited", { status: 429, headers: { "Retry-After": "3600" } }); };
  await new WebDeviceUpdates("1.0.0", () => now, storage, request).check(true);
  now += 600_000;
  await new WebDeviceUpdates("1.0.0", () => now, storage, request).check(true);
  assert.equal(calls, 1);
});
test("oversized feed and corrupt local releases fail closed; blocked storage makes no request", async () => {
  const storage = store(); let calls = 0;
  const request: typeof fetch = async () => { calls++; return new Response(" ".repeat(4 * 1024 * 1024 + 1)); };
  assert.match((await new WebDeviceUpdates("1.0.0", () => 100_000, storage, request).check()).message ?? "", /暂不可用/);
  storage.setItem(WEB_UPDATE_STORAGE, JSON.stringify({ releases: {}, nextRequest: 999_999 }));
  assert.equal((await new WebDeviceUpdates("1.0.0", () => 100_000, storage, request).check(true)).available, false);
  assert.equal(calls, 1);
  assert.match((await new WebDeviceUpdates("1.0.0", () => 100_000, null, request).check(true)).message ?? "", /存储/);
  assert.equal(calls, 1);
});
