export { WorkspaceApp as GuanlanApp, WorkspaceApp as default } from "./workspace/WorkspaceApp";
export { WorkspaceApp } from "./workspace/WorkspaceApp";
export { M3Button, M3Chip, M3IconButton, M3NavigationItem, M3SegmentedControl, M3Switch, M3TextField } from "./workspace/m3";
export type { M3ButtonProps, M3ButtonVariant, M3ChipProps, M3IconButtonProps, M3NavigationItemProps, M3SegmentedControlProps, M3SegmentedOption, M3SwitchProps, M3TextFieldProps } from "./workspace/m3";
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
