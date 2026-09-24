import React from "react";
import type { ConsoleAdapter } from "../services/adapter";
import { WorkspaceProvider, type WorkspaceRoute } from "./WorkspaceContext";
import { WorkspaceFrame } from "./shell/WorkspaceFrame";
import { RouteView } from "./WorkspacePages";

/**
 * Composition root for the shared Web/Electron workspace. Page implementations
 * live under pages/ while state and platform capabilities stay behind
 * WorkspaceContext and the adapter boundary.
 */
export function WorkspaceApp({ adapter, initialRoute }: { adapter: ConsoleAdapter; initialRoute?: WorkspaceRoute }) {
  return <WorkspaceProvider adapter={adapter} initialRoute={initialRoute}><WorkspaceFrame><RouteView /></WorkspaceFrame></WorkspaceProvider>;
}

export default WorkspaceApp;
