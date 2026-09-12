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
