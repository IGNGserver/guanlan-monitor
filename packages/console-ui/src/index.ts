export { WorkspaceApp as GuanlanApp, WorkspaceApp as default } from "./workspace/WorkspaceApp";
export { WorkspaceApp } from "./workspace/WorkspaceApp";
export { MockConsoleAdapter } from "./services/mockAdapter";
export type { WorkspaceRoute } from "./workspace/WorkspaceContext";
export type {
  ConsoleAdapter,
  ConsoleCapabilities,
  IGuanlanDataAdapter,
  WindowMaterial,
  WindowMaterialCapabilities
} from "./services/adapter";
export type {
  ConsoleFleetPort,
  ConsoleLocalAgentPort,
  ConsoleReadPort,
  ConsoleSessionPort
} from "./services/ports";
export type { ConsoleSnapshot, ConsoleSnapshotRequest } from "@dsc/shared";
export { DESKTOP_CAPABILITIES, WEB_CAPABILITIES, emptyConsoleSnapshot, fallbackRuntimeProfile, fallbackWindowMaterialCapabilities } from "./services/adapter";
