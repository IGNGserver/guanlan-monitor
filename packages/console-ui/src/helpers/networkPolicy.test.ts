import assert from "node:assert/strict";
import test from "node:test";
import { networkPolicy, pollDelay, storedNetworkMode } from "./networkPolicy.ts";

test("auto uses measured duration or explicit hints, standard is a full-data fallback", () => {
  assert.equal(networkPolicy("auto").constrained, false);
  for (const hints of [{ saveData: true }, { effectiveType: "3g" }, { rtt: 300 }, { downlink: 0.5 }]) {
    assert.equal(networkPolicy("auto", 0, hints).constrained, true);
    assert.equal(networkPolicy("standard", 9000, hints).pointBudget, undefined);
  }
  assert.equal(networkPolicy("auto", 2000).constrained, true);
  assert.deepEqual(networkPolicy("saver"), { constrained: true, concurrency: 1, minimumPollMs: 30000, pointBudget: 120, pushIntervalMs: 30000 });
  assert.equal(storedNetworkMode(), "auto");
});

test("automatic failure backoff is bounded and successful recovery resets it", () => {
  assert.equal(pollDelay(10000, 0, 0), 10000);
  assert.equal(pollDelay(10000, 0, 2), 40000);
  assert.equal(pollDelay(5000, 30000, 1), 60000);
  assert.equal(pollDelay(30000, 30000, 99), 120000);
  assert.equal(pollDelay(10000, 0, 0), 10000);
});
