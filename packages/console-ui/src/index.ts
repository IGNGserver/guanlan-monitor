export { WorkspaceApp as GuanlanApp, WorkspaceApp as default } from "./workspace/WorkspaceApp";
export { WorkspaceApp } from "./workspace/WorkspaceApp";

/* Material 3 Expressive design system */
export {
  M3Button,
  M3Fab,
  M3IconButton,
  M3Chip,
  M3NavigationItem,
  M3SegmentedControl,
  M3Switch,
  M3Checkbox,
  M3TextField,
  M3Select,
  M3SearchBar,
  M3Tabs,
  M3Card,
  M3List,
  M3ListItem,
  M3LinearProgress,
  M3Badge,
  M3Dialog,
  M3Banner,
  M3Snackbar,
  M3DataTable,
  Icon
} from "./m3e";
export type {
  IconName,
  IconProps,
  M3ButtonProps,
  M3ButtonVariant,
  M3ButtonSize,
  M3FabProps,
  M3IconButtonProps,
  M3ChipProps,
  M3NavigationItemProps,
  M3SegmentedControlProps,
  M3SegmentedOption,
  M3SwitchProps,
  M3CheckboxProps,
  M3TextFieldProps,
  M3SelectProps,
  M3SelectOption,
  M3SearchBarProps,
  M3TabsProps,
  M3TabItem,
  M3CardProps,
  M3ListItemProps,
  M3DialogProps,
  M3DataTableProps,
  M3DataTableColumn
} from "./m3e";

export { hasDeviceOrderDraft } from "./workspace/deviceOrderDraft";
export { MockConsoleAdapter } from "./services/mockAdapter";
export type { WorkspaceRoute } from "./workspace/WorkspaceContext";
export type {
  ConsoleAdapter,
  ConsoleCapabilities,
  IGuanlanDataAdapter,
  WindowMaterial,
  WindowMaterialCapabilities,
  WindowState
} from "./services/adapter";
export type {
  ConsoleFleetPort,
  ConsoleLocalAgentPort,
  ConsoleReadPort,
  ConsoleSessionPort
} from "./services/ports";
export type { ConsoleSnapshot, ConsoleSnapshotRequest } from "@dsc/shared";
export { DESKTOP_CAPABILITIES, WEB_CAPABILITIES, emptyConsoleSnapshot, fallbackRuntimeProfile, fallbackWindowMaterialCapabilities, fallbackWindowState } from "./services/adapter";
