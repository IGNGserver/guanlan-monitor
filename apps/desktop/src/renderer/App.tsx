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

export const App: React.FC = () => {
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

export default App;
