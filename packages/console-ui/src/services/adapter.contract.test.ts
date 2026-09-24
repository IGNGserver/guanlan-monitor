import assert from "node:assert/strict";
import test from "node:test";
import type { ConsoleAdapter } from "./adapter.ts";
import { DESKTOP_CAPABILITIES, WEB_CAPABILITIES, emptyConsoleSnapshot } from "./adapter.ts";
import { MockConsoleAdapter } from "./mockAdapter.ts";

function assertSnapshotContract(snapshot: Awaited<ReturnType<ConsoleAdapter["getSnapshot"]>>) {
  assert.equal(typeof snapshot.generatedAt, "string");
  assert.ok(["empty", "live", "cache"].includes(snapshot.source));
  assert.equal(typeof snapshot.cache.available, "boolean");
  assert.equal(typeof snapshot.session.authenticated, "boolean");
  assert.ok(Array.isArray(snapshot.devices));
  assert.ok("selectedDeviceId" in snapshot);
  assert.ok("metrics" in snapshot);
  assert.ok("overviewMetrics" in snapshot);
  assert.ok("trafficCalendar" in snapshot);
  assert.ok("update" in snapshot);
  assert.ok("startup" in snapshot);
}

test("platform capabilities keep Web and Electron responsibilities explicit", () => {
  assert.equal(WEB_CAPABILITIES.canManageLocalAgent, false);
  assert.equal(WEB_CAPABILITIES.canControlNativeWindow, false);
  assert.equal(WEB_CAPABILITIES.requiresAuthentication, true);
  assert.equal(DESKTOP_CAPABILITIES.canManageLocalAgent, true);
  assert.equal(DESKTOP_CAPABILITIES.canControlNativeWindow, true);
  assert.equal(DESKTOP_CAPABILITIES.requiresAuthentication, false);
  assertSnapshotContract(emptyConsoleSnapshot());
});

test("MockConsoleAdapter satisfies the shared read, session, and fleet contract", async () => {
  const adapter: ConsoleAdapter = new MockConsoleAdapter();
  assert.deepEqual(adapter.capabilities, WEB_CAPABILITIES);

  const initial = await adapter.getSnapshot();
  assertSnapshotContract(initial);
  assert.equal(initial.session.authenticated, false);

  const loggedIn = await adapter.login("contract-test-key");
  assertSnapshotContract(loggedIn);
  assert.equal(loggedIn.session.authenticated, true);
  assert.equal(loggedIn.session.accessKeyConfigured, true);

  const layout = await adapter.getWidgetLayout({ scopeKey: "device:test", templateKey: "default" });
  assert.equal(layout.scopeKey, "device:test");
  assert.equal(layout.templateKey, "default");
  assert.deepEqual(layout.templates, []);

  const loggedOut = await adapter.logout();
  assertSnapshotContract(loggedOut);
  assert.equal(loggedOut.session.authenticated, false);
});
