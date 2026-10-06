import type { DesktopConfigPatch } from "@dsc/shared";
import type { AgentBackendConfig } from "./types.js";

/** Renderer-visible code for "the address is saved, the login was not accepted". */
export const HUB_ADDRESS_SAVED_LOGIN_FAILED = "hub_address_saved_login_failed";

/**
 * The Hub rejected the credential (or could not answer) after the address was
 * already written. Callers must report a split outcome instead of "not saved".
 */
export class HubAddressSavedLoginError extends Error {
  constructor() {
    super(HUB_ADDRESS_SAVED_LOGIN_FAILED);
    this.name = "HubAddressSavedLoginError";
  }
}

/** The local-Agent surface a connection save needs. */
export interface ConnectionSaveAgentPort {
  start(): Promise<{ config: AgentBackendConfig }>;
  updateConfig(config: AgentBackendConfig): Promise<void>;
}

/** The Hub surface a connection save needs. */
export interface ConnectionSaveHubPort {
  login(credential: string): Promise<void>;
}

export function mergeAgentConfig(current: AgentBackendConfig, patch: DesktopConfigPatch): AgentBackendConfig {
  const connectionPatch = patch.connection ?? {};
  const merged = {
    ...current,
    configVersion: patch.configVersion ?? current.configVersion ?? 1,
    // Renderer patches never carry the Agent credential. The combined Hub
    // connection action is the only user-facing path that synchronizes it.
    connection: {
      ...current.connection,
      serverUrl: connectionPatch.serverUrl ?? current.connection.serverUrl,
      deviceId: connectionPatch.deviceId ?? current.connection.deviceId,
      hostname: connectionPatch.hostname ?? current.connection.hostname
    },
    sampling: { ...current.sampling, ...(patch.sampling ?? {}) },
    enabledMetrics: patch.enabledMetrics ?? current.enabledMetrics,
    enabledDeviceIds: patch.enabledDeviceIds ?? current.enabledDeviceIds,
    instanceMetricConfig: patch.instanceMetricConfig ?? current.instanceMetricConfig,
    probeSelections: patch.probeSelections ?? current.probeSelections,
    cloudSyncEnabled: patch.cloudSyncEnabled ?? current.cloudSyncEnabled,
    dataRecordingEnabled: patch.dataRecordingEnabled ?? current.dataRecordingEnabled,
    autoRestartCollector: patch.autoRestartCollector ?? current.autoRestartCollector,
    autoStartCollector: patch.autoStartCollector ?? current.autoStartCollector
  };
  delete (merged as typeof merged & Record<string, unknown>).virtualization;
  return merged;
}

/**
 * Persist the Hub address before the network round-trip, then verify the
 * credential.
 *
 * The address is the one setting a user needs when the Hub is unreachable or
 * has moved, so a failed login must never discard it. The previous ordering
 * (login first, write second) left a Hub outage or a rejected key with the
 * stale address on disk, and the next poll restored it in memory too.
 *
 * The credential is still written only after the Hub accepts it, so a
 * mistyped key cannot end up in the Agent config.
 */
export async function saveHubConnectionResiliently(
  agent: ConnectionSaveAgentPort,
  hub: ConnectionSaveHubPort,
  serverUrl: string,
  credential: string
): Promise<void> {
  const rawState = await agent.start();
  const addressConfig = mergeAgentConfig(rawState.config, { connection: { serverUrl } });
  await agent.updateConfig(addressConfig);
  try {
    await hub.login(credential);
  } catch {
    // The address is already on disk; report the split outcome instead.
    throw new HubAddressSavedLoginError();
  }
  const authenticatedConfig: AgentBackendConfig = {
    ...addressConfig,
    connection: { ...addressConfig.connection, secret: credential }
  };
  await agent.updateConfig(authenticatedConfig);
}
