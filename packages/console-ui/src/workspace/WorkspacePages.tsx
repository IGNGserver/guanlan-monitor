import React from "react";
import { useWorkspace } from "./WorkspaceContext";
import { OverviewPage } from "./pages/OverviewPage";
import { DevicesPage } from "./pages/DevicesPage";
import { DeviceDetailsPage } from "./pages/DeviceDetailsPage";
import { HubPage } from "./pages/HubPage";
import { SettingsPage } from "./pages/SettingsPage";
import { EmptyState, ErrorSurface, LoadingSurface } from "./pages/shared";

/** Route-only assembly. Pages own their data view and interaction state. */
export function RouteView() {
  const { route, error, refresh, loading, snapshot } = useWorkspace();
  if (route.kind === "settings") return <SettingsPage />;
  if (loading && !snapshot) return <LoadingSurface />;
  if (route.kind === "devices") return <DevicesPage />;
  if (route.kind === "device") return <DeviceDetailsPage />;
  if (route.kind === "hub") return <HubPage />;
  if (error) return <ErrorSurface title="无法同步设备状态" detail={error} onRetry={() => void refresh()} />;
  return <OverviewPage />;
}

export { EmptyState };
