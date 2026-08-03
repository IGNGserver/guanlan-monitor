import type { HubUpdateStatus } from "@dsc/shared";
import { env } from "./config.js";
import { getUpdateInfo } from "./updates.js";

let status: HubUpdateStatus = {
  state: "idle",
  requestedVersion: null,
  requestedAt: null,
  message: null
};

export function getHubUpdateStatus() {
  return status;
}

export async function requestHubUpdate(version: string) {
  if (!env.DSC_HUB_UPDATE_ENABLED) {
    throw new HubUpdateError("hub_update_disabled", 503);
  }
  if (!env.DSC_GITHUB_TOKEN) {
    throw new HubUpdateError("hub_update_token_missing", 503);
  }

  if (status.state === "requested") {
    if (status.requestedVersion === version) return status;
    throw new HubUpdateError("another_hub_update_is_in_progress", 409);
  }

  const update = await getUpdateInfo({ platform: "hub" });
  if (!update.available || update.latestVersion !== version) {
    throw new HubUpdateError("requested_version_is_not_the_next_release", 409);
  }

  const workflow = env.DSC_RELEASE_CHANNEL === "stable"
    ? env.DSC_HUB_STABLE_UPDATE_WORKFLOW
    : env.DSC_HUB_TEST_UPDATE_WORKFLOW;

  const response = await fetch(
    `https://api.github.com/repos/${env.DSC_RELEASE_REPOSITORY}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.DSC_GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "device-state-console-hub-updater"
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          version,
          channel: env.DSC_RELEASE_CHANNEL
        }
      })
    }
  );

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    status = {
      state: "failed",
      requestedVersion: version,
      requestedAt: new Date().toISOString(),
      message: `github_workflow_dispatch_${response.status}`
    };
    throw new HubUpdateError(responseBody || "hub_update_dispatch_failed", 502);
  }

  status = {
    state: "requested",
    requestedVersion: version,
    requestedAt: new Date().toISOString(),
    message: "workflow_dispatched"
  };
  return status;
}

export class HubUpdateError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "HubUpdateError";
  }
}
