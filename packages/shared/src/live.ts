/** Read-only, ephemeral queries. These must never enter the telemetry replay spool. */
export type LiveTopic = "metrics" | "processes" | "docker";

export interface LiveConnection {
  state: "disconnected" | "connecting" | "ready";
  sessionId: string | null;
  capabilities: LiveTopic[];
  connectedAt: string | null;
  /** When the Hub last refused this device's enrollment because its installation identity changed. Absent from older Hubs. */
  identityConflictAt?: string | null;
}

export interface LiveProcess {
  id: string;
  pid: number;
  parentPid: number | null;
  name: string;
  startedAt: string | null;
  cpuPercent: number | null;
  /** The busiest GPU engine for this process, or null when the platform/provider cannot report it. */
  gpuPercent: number | null;
  memoryBytes: number | null;
  threads: number | null;
  status: string | null;
}

export interface LiveProcesses {
  observedAt: string;
  /** Percent of total logical CPU capacity, not the single-core `top` scale. */
  cpuScale: "host";
  memoryKind: "rss";
  totalCount: number;
  truncated: boolean;
  items: LiveProcess[];
}

export interface LiveContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  project: string | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  networkRxBytes: number | null;
  networkTxBytes: number | null;
  blockReadBytes: number | null;
  blockWriteBytes: number | null;
}

export interface LiveDocker {
  observedAt: string;
  engineId: string;
  totalCount: number;
  truncated: boolean;
  items: LiveContainer[];
  /** Running containers that wanted resource stats, and how many were read. Absent from older Agents. */
  statsCandidates?: number;
  statsRead?: number;
}

/** Fast values only; each is null until its own sampling window exists. Hardware probes stay on the history path. */
export interface LiveMetrics {
  observedAt: string;
  cpuPercent: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  diskReadBytesPerSec: number | null;
  diskWriteBytesPerSec: number | null;
  networkRxBytesPerSec: number | null;
  networkTxBytesPerSec: number | null;
}

export interface LiveDataMap {
  metrics: LiveMetrics;
  processes: LiveProcesses;
  docker: LiveDocker;
}

export interface LiveSnapshot<T extends LiveTopic = LiveTopic> {
  deviceId: string;
  sessionId: string;
  requestId: string;
  topic: T;
  receivedAt: string;
  data: LiveDataMap[T];
}

export interface ConsoleLivePort {
  getLiveConnection(deviceId: string): Promise<LiveConnection>;
  readLive<T extends LiveTopic>(deviceId: string, topic: T): Promise<LiveSnapshot<T>>;
  /** Drops the device's live enrollment so a reinstalled Agent can enroll again. */
  resetLiveCredentials?(deviceId: string): Promise<void>;
}
