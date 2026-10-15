import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentCredentials } from "./credentials.js";

test("enrollment is durable, idempotent and bound to both device and installation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "live-credentials-")); const file = join(directory, "credentials.json");
  const key = "fixture-device-key-not-a-production-secret";
  try {
    const store = new AgentCredentials(file, "fixture-admin"); await store.load();
    assert.equal(await store.enroll("node", "installation", key), true);
    assert.equal(await store.enroll("node", "installation", key), true);
    assert.equal(await store.enroll("node", "other-installation", key), false);
    assert.equal(await store.enroll("node", "installation", "different"), false);
    assert.equal(store.verify("other-node", "installation", key), false);
    assert.equal((await readFile(file, "utf8")).includes(key), false);
    const restarted = new AgentCredentials(file, "fixture-admin"); await restarted.load();
    assert.equal(restarted.verify("node", "installation", key), true);
    const rotated = new AgentCredentials(file, "rotated-admin"); await rotated.load();
    assert.equal(rotated.verify("node", "installation", key), false);
    assert.equal(await rotated.enroll("node", "installation", key), true);
    assert.equal(rotated.verify("node", "installation", key), true);
    await rotated.revoke("node");
    assert.equal(rotated.verify("node", "installation", key), false);
    assert.equal(await rotated.enroll("node", "installation", key), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("credential corruption fails closed instead of resetting trust", async () => {
  const directory = await mkdtemp(join(tmpdir(), "live-corruption-"));
  try {
    const file = join(directory, "credentials.json"); await writeFile(file, "{broken");
    await assert.rejects(new AgentCredentials(file, "fixture-admin").load());
  } finally { await rm(directory, { recursive: true, force: true }); }
});
