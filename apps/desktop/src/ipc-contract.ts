export const IPC_CHANNELS = {
  getSnapshot: "dsc:get-snapshot",
  refresh: "dsc:refresh",
  updateLocalConfig: "dsc:update-local-config",
  controlAgent: "dsc:control-agent",
  setAgentSecret: "dsc:set-agent-secret",
  login: "dsc:login",
  logout: "dsc:logout",
  cloudPush: "dsc:cloud-push",
  saveFanNote: "dsc:save-fan-note",
  updateStartupSettings: "dsc:update-startup-settings",
  openExternal: "dsc:open-external",
  exit: "dsc:exit",
  snapshot: "dsc:snapshot"
} as const;
