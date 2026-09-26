import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkspaceHash, serializeWorkspaceRoute } from "./routes.ts";

test("workspace routes support the device directory and encoded deep links", () => {
  assert.deepEqual(parseWorkspaceHash("#devices"), { kind: "devices" });
  const route = { kind: "device", deviceId: "nas/primary" } as const;
  assert.deepEqual(parseWorkspaceHash(serializeWorkspaceRoute(route)), route);
  assert.deepEqual(parseWorkspaceHash("#settings/appearance"), { kind: "settings", section: "appearance" });
});

test("unknown or malformed workspace hashes fall back to overview", () => {
  assert.deepEqual(parseWorkspaceHash("#not-a-route"), { kind: "overview" });
  assert.deepEqual(parseWorkspaceHash("#device/%E0%A4%A"), { kind: "overview" });
});

// Bookmarks and chat screenshots still carry the retired hashes. Each one has to
// land on the page that absorbed its content rather than bounce to the overview.
test("retired section and hub hashes resolve to their replacements", () => {
  assert.deepEqual(parseWorkspaceHash("#settings/workspace"), { kind: "settings", section: "general" });
  assert.deepEqual(parseWorkspaceHash("#settings/session"), { kind: "settings", section: "connections" });
  assert.deepEqual(parseWorkspaceHash("#settings"), { kind: "settings", section: "general" });
  assert.deepEqual(parseWorkspaceHash("#hub/primary"), { kind: "overview" });
});

test("every settings section round-trips through the hash", () => {
  for (const section of ["general", "appearance", "connections", "agent", "data", "shortcuts", "about"] as const) {
    const route = { kind: "settings", section } as const;
    assert.deepEqual(parseWorkspaceHash(serializeWorkspaceRoute(route)), route, `#${section} must parse back to itself`);
  }
});

