import assert from "node:assert/strict";
import { test } from "node:test";
import { stableObjectKey } from "./configKeys.ts";

test("stableObjectKey ignores insertion order but detects real changes", () => {
  const a = stableObjectKey({ disk: ["sda", "sdb"], gpu: ["gpu-0"] });
  const b = stableObjectKey({ gpu: ["gpu-0"], disk: ["sda", "sdb"] });
  assert.equal(a, b);

  assert.notEqual(a, stableObjectKey({ disk: ["sdb", "sda"], gpu: ["gpu-0"] }));
  assert.notEqual(a, stableObjectKey({ disk: ["sda"], gpu: ["gpu-0"] }));
  assert.notEqual(a, stableObjectKey({ disk: ["sda", "sdb"], gpu: [] }));
});

test("stableObjectKey treats missing and empty maps alike", () => {
  assert.equal(stableObjectKey(undefined), "");
  assert.equal(stableObjectKey(null), "");
  assert.equal(stableObjectKey({}), "");
});
