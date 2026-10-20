import assert from "node:assert/strict";
import test from "node:test";
import { startVisiblePolling } from "./visiblePolling.ts";

test("polling reads the current policy after each run, pauses hidden and resumes without overlap", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let hidden = false, callback = () => {}, delay = 10, runs = 0;
  const visibility = {
    get hidden() { return hidden; },
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => { callback = listener as () => void; },
    removeEventListener: () => { callback = () => {}; }
  };
  const stop = startVisiblePolling(async () => { runs++; delay = 100; }, () => delay, false, visibility);
  try {
    t.mock.timers.tick(10); await Promise.resolve(); await Promise.resolve();
    assert.equal(runs, 1);
    t.mock.timers.tick(99); assert.equal(runs, 1);
    hidden = true; callback();
    t.mock.timers.tick(500); assert.equal(runs, 1);
    hidden = false; callback(); callback();
    assert.equal(runs, 2);
    await Promise.resolve(); await Promise.resolve();
    stop(); t.mock.timers.tick(1000); assert.equal(runs, 2);
  } finally { stop(); t.mock.timers.reset(); }
});
