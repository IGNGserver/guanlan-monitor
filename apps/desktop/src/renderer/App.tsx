import React from "react";
import { ConsoleProvider, useConsole } from "./context/ConsoleContext";
import { Sidebar } from "./components/Shell/Sidebar";
import { TopHeader } from "./components/Shell/TopHeader";
import { StatusBanner } from "./components/Shell/StatusBanner";
import { DeviceSelector } from "./components/Device/DeviceSelector";
import { OverviewCards } from "./components/Overview/OverviewCards";
import { TelemetryChart } from "./components/Charts/TelemetryChart";
import { InstanceDetailView } from "./components/DrillDown/InstanceDetailView";
import { LocalConfigView } from "./components/LocalConfig/LocalConfigView";
import { TrafficCalendarView } from "./components/Traffic/TrafficCalendarView";
import { DiagnosticsView } from "./components/Diagnostics/DiagnosticsView";
import { LoadingState } from "./components/Common/LoadingState";
import { AuthModal } from "./components/Modals/AuthModal";
import { GuanlanApp } from "../renderer-guanlan";


const ConsoleViewport: React.FC = () => {
  const { loading, activeTab } = useConsole();

  if (loading) {
    return <LoadingState />;
  }

  return (
    <main className="content-viewport">
      {activeTab === "fleet" && (
        <>
          <DeviceSelector />
        </>
      )}

      {activeTab === "device-detail" && (
        <>
          <OverviewCards />
          <TelemetryChart />
          <InstanceDetailView />
        </>
      )}

      {activeTab === "local-config" && (
        <>
          <LocalConfigView />
        </>
      )}

      {activeTab === "traffic-calendar" && (
        <>
          <TrafficCalendarView />
        </>
      )}

      {activeTab === "diagnostics" && (
        <>
          <DiagnosticsView />
        </>
      )}
    </main>
  );
};

const LegacyApp: React.FC = () => {
  React.useEffect(() => {
    document.documentElement.classList.add("legacy-active");
    document.documentElement.classList.remove("guanlan-active");
    return () => {
      document.documentElement.classList.remove("legacy-active");
    };
  }, []);

  return (
    <ConsoleProvider>
      <div className="app-container">
        <Sidebar />
        <div className="main-layout">
          <TopHeader />
          <StatusBanner />
          <ConsoleViewport />
        </div>
        <AuthModal />
      </div>
    </ConsoleProvider>
  );
};

function isLegacyModeRequested(): boolean {
  if (typeof window === "undefined") return false;
  const urlParams = new URLSearchParams(window.location.search);
  const uiParam = urlParams.get("ui");
  const legacyParam = urlParams.get("dsc_legacy_ui");

  if (uiParam === "legacy" || legacyParam === "true" || legacyParam === "1") {
    return true;
  }
  if (uiParam === "guanlan" || urlParams.get("guanlan") === "1") {
    return false;
  }
  return localStorage.getItem("dsc_legacy_ui") === "true";
}

const GuanlanAppWrapper: React.FC = () => {
  React.useEffect(() => {
    document.documentElement.classList.add("guanlan-active");
    document.documentElement.classList.remove("legacy-active");
    return () => {
      document.documentElement.classList.remove("guanlan-active");
    };
  }, []);

  return <GuanlanApp />;
};

export const App: React.FC = () => {
  const [isLegacy] = React.useState<boolean>(isLegacyModeRequested);

  if (isLegacy) {
    return <LegacyApp />;
  }

  return <GuanlanAppWrapper />;
};

export default App;
