import assert from "node:assert/strict";
import test from "node:test";
import { markLoadingMilestone } from "./loadingPerformance.ts";

test("loading milestones are bounded and contain only fixed labels", () => {
  const entries = new Map<string, unknown[]>();
  const timeline = { getEntriesByName: (name: string) => entries.get(name) ?? [], mark: (name: string) => entries.set(name, [{}]) };
  for (let i = 0; i < 100; i++) markLoadingMilestone("hub-summary-committed", timeline);
  markLoadingMilestone("cache-committed", timeline);
  assert.deepEqual([...entries.keys()], ["guanlan:hub-summary-committed", "guanlan:cache-committed"]);
  assert.equal(entries.get("guanlan:hub-summary-committed")?.length, 1);
});

test("unavailable timing does not block application startup", () => {
  assert.doesNotThrow(() => markLoadingMilestone("shell-committed", { getEntriesByName: () => { throw Error("denied"); }, mark: () => {} }));
});
