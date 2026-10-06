import assert from "node:assert/strict";
import test from "node:test";
import type { AgentBackendConfig } from "./types.ts";
import {
  HUB_ADDRESS_SAVED_LOGIN_FAILED,
  HubAddressSavedLoginError,
  saveHubConnectionResiliently
} from "./agent-connection.ts";
import type { ConnectionSaveAgentPort, ConnectionSaveHubPort } from "./agent-connection.ts";

const OLD_URL = "https://old.example";

function baseConfig(): AgentBackendConfig {
  return {
    configVersion: 1,
    connection: { serverUrl: OLD_URL, secret: "old-secret", deviceId: "device-1", hostname: "主机" },
    sampling: { normalIntervalSeconds: 30, slowIntervalSeconds: 30 },
    enabledMetrics: ["cpuUsage"],
    enabledDeviceIds: {},
    instanceMetricConfig: {},
    probeSelections: [],
    cloudSyncEnabled: false,
    dataRecordingEnabled: true,
    autoRestartCollector: true,
    autoStartCollector: true
  };
}

function fakeAgent(options: { startError?: Error } = {}) {
  const writes: AgentBackendConfig[] = [];
  const events: string[] = [];
  const agent: ConnectionSaveAgentPort = {
    async start() {
      events.push("start");
      if (options.startError) throw options.startError;
      return { config: baseConfig() };
    },
    async updateConfig(config) {
      events.push("updateConfig");
      writes.push(structuredClone(config));
    }
  };
  return { agent, writes, events };
}

function fakeHub(options: { reject?: boolean } = {}) {
  const events: string[] = [];
  const hub: ConnectionSaveHubPort = {
    async login(credential) {
      events.push(`login:${credential}`);
      if (options.reject) throw new Error("login_failed");
    }
  };
  return { hub, events };
}

test("writes the address before the login attempt and keeps it when the hub rejects the credential", async () => {
  const { agent, writes, events: agentEvents } = fakeAgent();
  const { hub, events: hubEvents } = fakeHub({ reject: true });
  await assert.rejects(
    saveHubConnectionResiliently(agent, hub, "https://new.example", "new-secret"),
    (error: unknown) => error instanceof HubAddressSavedLoginError && error.message === HUB_ADDRESS_SAVED_LOGIN_FAILED
  );
  assert.deepEqual(agentEvents, ["start", "updateConfig"]);
  assert.deepEqual(hubEvents, ["login:new-secret"]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].connection.serverUrl, "https://new.example");
  assert.equal(writes[0].connection.secret, "old-secret");
});

test("persists the credential only after the hub accepts it", async () => {
  const { agent, writes, events: agentEvents } = fakeAgent();
  const { hub, events: hubEvents } = fakeHub();
  await saveHubConnectionResiliently(agent, hub, "https://new.example", "new-secret");
  assert.deepEqual(agentEvents, ["start", "updateConfig", "updateConfig"]);
  assert.deepEqual(hubEvents, ["login:new-secret"]);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].connection.serverUrl, "https://new.example");
  assert.equal(writes[0].connection.secret, "old-secret");
  assert.equal(writes[1].connection.serverUrl, "https://new.example");
  assert.equal(writes[1].connection.secret, "new-secret");
});

test("persists nothing when the local agent cannot start", async () => {
  const startError = new Error("local_agent_unavailable");
  const { agent, writes } = fakeAgent({ startError });
  const { hub } = fakeHub();
  await assert.rejects(saveHubConnectionResiliently(agent, hub, "https://new.example", "new-secret"), /local_agent_unavailable/);
  assert.equal(writes.length, 0);
});
