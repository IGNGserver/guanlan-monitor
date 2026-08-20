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
export { DESKTOP_CAPABILITIES, WEB_CAPABILITIES, emptyConsoleSnapshot, fallbackWindowMaterialCapabilities } from "./services/adapter";
