/**
 * Guanlan Spectrum Adaptive - Main Application Shell
 * Design system: Guanlan Spectrum Adaptive
 * Architecture: Clean-room Electron Renderer isolated directory (apps/desktop/src/renderer-guanlan)
 */

import React from "react";
import { ThemeProvider } from "./context/ThemeContext";
import { LayoutProvider, useLayout } from "./context/LayoutContext";
import { GuanlanProvider, useGuanlan } from "./context/GuanlanContext";
import { GuanlanHeader } from "./components/Shell/GuanlanHeader";
import { GuanlanNav } from "./components/Shell/GuanlanNav";
import { CommandPalette } from "./components/Shell/CommandPalette";
import { ToastRegion } from "./components/Shell/ToastRegion";

import { OverviewView } from "./components/Views/OverviewView";
import { DeviceListView } from "./components/Views/DeviceListView";
import { HistoryView } from "./components/Views/HistoryView";
import { LocalDeviceView } from "./components/Views/LocalDeviceView";
import { DiagnosticsView } from "./components/Views/DiagnosticsView";
import { SettingsView } from "./components/Views/SettingsView";

import "./styles/tokens.css";
import "./styles/layout.css";
import "./styles/components.css";

const ViewportContent: React.FC = () => {
  const { activeTab } = useGuanlan();

  return (
    <main className="guanlan-content-viewport" id="guanlan-main-content">
      {activeTab === "overview" && <OverviewView />}
      {activeTab === "devices" && <DeviceListView />}
      {activeTab === "history" && <HistoryView />}
      {activeTab === "this-device" && <LocalDeviceView />}
      {activeTab === "diagnostics" && <DiagnosticsView />}
      {activeTab === "settings" && <SettingsView />}
    </main>
  );
};

const GuanlanAppInner: React.FC = () => {
  const { layoutClass } = useLayout();

  return (
    <div className={`guanlan-app-root gl-layout-${layoutClass}`}>
      <GuanlanHeader />
      <div className="guanlan-shell-body">
        <GuanlanNav />
        <ViewportContent />
      </div>
      <CommandPalette />
      <ToastRegion />
    </div>
  );
};

export const GuanlanApp: React.FC = () => {
  return (
    <ThemeProvider>
      <LayoutProvider>
        <GuanlanProvider>
          <GuanlanAppInner />
        </GuanlanProvider>
      </LayoutProvider>
    </ThemeProvider>
  );
};

export default GuanlanApp;
