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
    assert.equal(store.conflictAt("node"), null);
    assert.equal(await store.enroll("node", "other-installation", key), false);
    assert.equal(await store.enroll("node", "installation", "different"), false);
    assert.ok(store.conflictAt("node"), "a refused enrollment is remembered so the console can explain it");
    assert.equal(store.verify("other-node", "installation", key), false);
    assert.equal((await readFile(file, "utf8")).includes(key), false);
    const restarted = new AgentCredentials(file, "fixture-admin"); await restarted.load();
    assert.equal(restarted.verify("node", "installation", key), true);
    const rotated = new AgentCredentials(file, "rotated-admin"); await rotated.load();
    assert.equal(rotated.verify("node", "installation", key), false);
    assert.equal(await rotated.enroll("node", "installation", key), true);
    assert.equal(rotated.verify("node", "installation", key), true);
    assert.equal(rotated.conflictAt("node"), null, "a successful enrollment clears the conflict");
    await rotated.remove("node");
    assert.equal(rotated.verify("node", "installation", key), false);
    assert.equal((await readFile(file, "utf8")).includes("\"node\""), false, "removal is durable");
    assert.equal(await rotated.enroll("node", "reinstalled", key), true, "after removal the next installation is accepted");
    assert.equal(rotated.verify("node", "reinstalled", key), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("credential corruption fails closed instead of resetting trust", async () => {
  const directory = await mkdtemp(join(tmpdir(), "live-corruption-"));
  try {
    const file = join(directory, "credentials.json"); await writeFile(file, "{broken");
    await assert.rejects(new AgentCredentials(file, "fixture-admin").load());
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("records revoked by older Hubs no longer block the device forever", async () => {
  const directory = await mkdtemp(join(tmpdir(), "live-legacy-revoked-"));
  try {
    const file = join(directory, "credentials.json");
    await writeFile(file, JSON.stringify({ node: { instanceId: "old", digest: "a".repeat(64), credentialVersion: "x", revoked: true } }));
    const store = new AgentCredentials(file, "fixture-admin"); await store.load();
    assert.equal(store.verify("node", "old", "anything"), false);
    assert.equal(await store.enroll("node", "new-installation", "fixture-device-key"), true);
    assert.equal(store.verify("node", "new-installation", "fixture-device-key"), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
