import React from "react";
import { useWorkspace } from "../WorkspaceContext";
import { DevicesPage } from "./DevicesPage";
import { DeviceDetailsPage } from "./DeviceDetailsPage";

/**
 * TabletSplitView provides an adaptive Master-Detail layout for tablet users in landscape.
 * Left column: Device list with instant search and status indicators
 * Right column: Selected device details or overview
 */
export function TabletSplitView() {
  const { route, allDevices } = useWorkspace();
  const selectedDeviceId = route.kind === "device" ? route.deviceId : allDevices[0]?.deviceId;

  return (
    <div className="guanlan-tablet-split-view">
      <div className="guanlan-tablet-split-master">
        <DevicesPage />
      </div>
      <div className="guanlan-tablet-split-detail">
        {selectedDeviceId ? (
          <DeviceDetailsPage />
        ) : (
          <div className="guanlan-tablet-empty-detail">
            <p>请在左侧选择一台设备查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}
