import type {
  AgentLocalConfig,
  DesktopAgentBackendState
} from "@dsc/shared";

export interface AgentBackendConfig extends AgentLocalConfig {
  dataRecordingEnabled?: boolean;
  autoStartCollector?: boolean;
}

export interface RawAgentBackendState {
  running: boolean;
  backendStartedAt: string;
  frontendParentPid: number;
  childStartedAt?: string;
  connectionStatus: string;
  lastChildLog?: string;
  lastUploadAt?: string;
  lastCloudSyncAt?: string;
  lastCloudSyncError?: string;
  cloudConfigPending: boolean;
  lastDetectAt?: string;
  lastExitAt?: string;
  lastRestartAt?: string;
  restartCount: number;
  lastExitCode?: number | null;
  autoRestartPending: boolean;
  effectiveUploadIntervalSeconds: number;
  lastIssueCategory?: string;
  lastIssueDetail?: string;
  lastIssueAt?: string;
  lastIssueCount: number;
  lastIssueRecoveredAt?: string;
  configPath: string;
  configFileExists: boolean;
  syncStatePath: string;
  syncStateFileExists: boolean;
  diagnosticsPath: string;
  diagnosticsFileExists: boolean;
  pendingStatePath: string;
  pendingStateFileExists: boolean;
  pendingSampleCount: number;
  pendingBytes: number;
  oldestPendingAt?: string;
  lastUploadError?: string;
  config: AgentBackendConfig;
  supportedProbePlans: DesktopAgentBackendState["supportedProbePlans"];
  detectedTargets: DesktopAgentBackendState["detectedTargets"];
}
