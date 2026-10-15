/** Read-only, ephemeral queries. These must never enter the telemetry replay spool. */
export type LiveTopic = "metrics" | "processes" | "docker";

export interface LiveConnection {
  state: "disconnected" | "connecting" | "ready";
  sessionId: string | null;
  capabilities: LiveTopic[];
  connectedAt: string | null;
}

export interface LiveProcess {
  id: string;
  pid: number;
  parentPid: number | null;
  name: string;
  startedAt: string | null;
  cpuPercent: number | null;
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
}

export interface LiveDataMap {
  metrics: import("./index.js").AgentMetricsPayload;
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
}
