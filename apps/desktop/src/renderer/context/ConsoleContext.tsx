import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import type {
  DesktopSnapshot,
  MetricWindow,
  TrafficCalendarMode,
  DesktopConfigPatch,
  DesktopAgentControlAction,
  DesktopStartupSettings
} from "@dsc/shared";
import type { ConsoleNavTab, ConsoleState } from "../types";
import { dscBridge } from "../services/dscBridge";

interface ConsoleContextValue extends ConsoleState {
  refreshSnapshot: () => Promise<void>;
  selectDevice: (deviceId: string) => void;
  setMetricWindow: (w: MetricWindow) => void;
  setTrafficMode: (m: TrafficCalendarMode) => void;
  setActiveTab: (tab: ConsoleNavTab) => void;
  setDeviceSearchQuery: (q: string) => void;
  setDeviceFilterStatus: (s: "all" | "online" | "offline") => void;
  updatePendingPatch: (patchOrFn: Partial<DesktopConfigPatch> | ((prev: DesktopConfigPatch) => DesktopConfigPatch)) => void;
  applyPendingChanges: () => Promise<void>;
  discardPendingChanges: () => void;
  triggerCloudPush: () => Promise<void>;
  controlCollector: (action: DesktopAgentControlAction) => Promise<void>;
  saveSecret: (secret: string) => Promise<void>;
  loginHub: (accessKey: string) => Promise<void>;
  logoutHub: () => Promise<void>;
  submitFanNote: (fanId: string, note: string) => Promise<void>;
  saveStartupSettings: (settings: Partial<DesktopStartupSettings>) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
  exitApplication: () => Promise<void>;
  setAccessKeyModalOpen: (open: boolean) => void;
  setSecretModalOpen: (open: boolean) => void;
  setFanNoteModalOpen: (val: { deviceId: string; fanId: string; currentNote: string } | null) => void;
  showToast: (type: "info" | "success" | "warning" | "error", title: string, text: string) => void;
  dismissToast: () => void;
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null);

export const ConsoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<ConsoleNavTab>("fleet");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [metricWindow, setMetricWindow] = useState<MetricWindow>("5m");
  const [trafficMode, setTrafficMode] = useState<TrafficCalendarMode>("day");
  const [trafficAnchor, setTrafficAnchor] = useState<string | undefined>(undefined);
  const [deviceSearchQuery, setDeviceSearchQuery] = useState<string>("");
  const [deviceFilterStatus, setDeviceFilterStatus] = useState<"all" | "online" | "offline">("all");

  const [pendingConfigPatch, setPendingConfigPatch] = useState<DesktopConfigPatch>({});
  const [cloudPushStatus, setCloudPushStatus] = useState<"idle" | "pushing" | "success" | "error">("idle");
  const [cloudPushMessage, setCloudPushMessage] = useState<string | null>(null);

  const [accessKeyModalOpen, setAccessKeyModalOpen] = useState<boolean>(false);
  const [secretModalOpen, setSecretModalOpen] = useState<boolean>(false);
  const [fanNoteModalOpen, setFanNoteModalOpen] = useState<{ deviceId: string; fanId: string; currentNote: string } | null>(null);

  const [toastMessage, setToastMessage] = useState<{ type: "info" | "success" | "warning" | "error"; title: string; text: string } | null>(null);

  const showToast = useCallback((type: "info" | "success" | "warning" | "error", title: string, text: string) => {
    setToastMessage({ type, title, text });
    setTimeout(() => {
      setToastMessage(prev => (prev?.title === title ? null : prev));
    }, 4000);
  }, []);

  const dismissToast = useCallback(() => {
    setToastMessage(null);
  }, []);

  const loadInitialSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      const res = await dscBridge.getSnapshot({ metricWindow, selectedDeviceId, trafficMode, trafficAnchor });
      setSnapshot(res);
      if (!selectedDeviceId && res.devices.length > 0) {
        setSelectedDeviceId(res.selectedDeviceId || res.devices[0].deviceId);
      }
    } catch (err: any) {
      showToast("error", "Failed to Load Telemetry", err?.message || "Unknown IPC error");
    } finally {
      setLoading(false);
    }
  }, [metricWindow, selectedDeviceId, trafficMode, trafficAnchor, showToast]);

  const refreshSnapshot = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await dscBridge.refresh({ metricWindow, selectedDeviceId, trafficMode, trafficAnchor });
      setSnapshot(res);
    } catch (err: any) {
      showToast("error", "Refresh Failed", err?.message || "Unable to reach snapshot service");
    } finally {
      setRefreshing(false);
    }
  }, [metricWindow, selectedDeviceId, trafficMode, trafficAnchor, showToast]);

  // Subscribe to push updates from bridge
  useEffect(() => {
    loadInitialSnapshot();
    const unsubscribe = dscBridge.subscribe((newSnapshot) => {
      setSnapshot(newSnapshot);
    });
    return () => {
      unsubscribe();
    };
  }, [loadInitialSnapshot]);

  // Re-fetch snapshot when metricWindow or selectedDeviceId changes
  useEffect(() => {
    if (snapshot) {
      dscBridge.getSnapshot({ metricWindow, selectedDeviceId, trafficMode, trafficAnchor }).then(setSnapshot);
    }
  }, [metricWindow, selectedDeviceId, trafficMode, trafficAnchor]);

  // Keep the desktop view aligned with the backend/Hub state while the app is
  // open. The in-flight guard prevents slow Hub requests from stacking.
  useEffect(() => {
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await refreshSnapshot();
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => window.clearInterval(timer);
  }, [refreshSnapshot]);

  const selectDevice = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (activeTab === "fleet") {
      setActiveTab("device-detail");
    }
  }, [activeTab]);

  const hasPendingChanges = useMemo(() => {
    return Object.keys(pendingConfigPatch).length > 0;
  }, [pendingConfigPatch]);

  const updatePendingPatch = useCallback((patchOrFn: Partial<DesktopConfigPatch> | ((prev: DesktopConfigPatch) => DesktopConfigPatch)) => {
    setPendingConfigPatch(prev => {
      if (typeof patchOrFn === "function") {
        return patchOrFn(prev);
      }
      return { ...prev, ...patchOrFn };
    });
  }, []);

  const applyPendingChanges = useCallback(async () => {
    if (!hasPendingChanges) return;
    try {
      const res = await dscBridge.updateLocalConfig(pendingConfigPatch);
      setSnapshot(res);
      setPendingConfigPatch({});
      showToast("success", "Configuration Saved", "Local Agent configuration updated successfully.");
    } catch (err: any) {
      showToast("error", "Save Failed", err?.message || "Could not save local configuration");
    }
  }, [hasPendingChanges, pendingConfigPatch, showToast]);

  const discardPendingChanges = useCallback(() => {
    setPendingConfigPatch({});
    showToast("info", "Changes Discarded", "Reverted pending local configuration edits.");
  }, [showToast]);

  const triggerCloudPush = useCallback(async () => {
    setCloudPushStatus("pushing");
    setCloudPushMessage("Syncing local display configuration to Hub...");
    try {
      const res = await dscBridge.cloudPush();
      setSnapshot(res);
      setCloudPushStatus("success");
      setCloudPushMessage("Display configuration successfully pushed to Hub!");
      showToast("success", "Cloud Sync Complete", "Pushed local display configuration to global Hub.");
      setTimeout(() => { setCloudPushStatus("idle"); setCloudPushMessage(null); }, 3000);
    } catch (err: any) {
      setCloudPushStatus("error");
      setCloudPushMessage(err?.message || "Failed to push display config to Hub");
      showToast("error", "Cloud Sync Failed", err?.message || "Hub push rejected");
    }
  }, [showToast]);

  const controlCollector = useCallback(async (action: DesktopAgentControlAction) => {
    try {
      const res = await dscBridge.controlAgent(action);
      setSnapshot(res);
      showToast("info", "Collector Action", `Executed collector action: ${action}`);
    } catch (err: any) {
      showToast("error", "Collector Action Failed", err?.message || `Failed to perform ${action}`);
    }
  }, [showToast]);

  const saveSecret = useCallback(async (secret: string) => {
    try {
      const res = await dscBridge.setAgentSecret(secret);
      setSnapshot(res);
      setSecretModalOpen(false);
      showToast("success", "Secret Saved", "Agent connection secret updated securely.");
    } catch (err: any) {
      showToast("error", "Failed to Save Secret", err?.message || "Secret save failed");
    }
  }, [showToast]);

  const loginHub = useCallback(async (accessKey: string) => {
    try {
      const res = await dscBridge.login(accessKey);
      setSnapshot(res);
      setAccessKeyModalOpen(false);
      showToast("success", "Authenticated", "Logged in with global Hub access key.");
    } catch (err: any) {
      showToast("error", "Authentication Failed", err?.message || "Invalid access key");
    }
  }, [showToast]);

  const logoutHub = useCallback(async () => {
    try {
      const res = await dscBridge.logout();
      setSnapshot(res);
      showToast("info", "Logged Out", "Hub access key removed from active session.");
    } catch (err: any) {
      showToast("error", "Logout Error", err?.message || "Logout failed");
    }
  }, [showToast]);

  const submitFanNote = useCallback(async (fanId: string, note: string) => {
    if (!selectedDeviceId) return;
    try {
      const res = await dscBridge.saveFanNote(selectedDeviceId, fanId, note);
      setSnapshot(res);
      setFanNoteModalOpen(null);
      showToast("success", "Fan Note Saved", `Updated note for fan ${fanId}.`);
    } catch (err: any) {
      showToast("error", "Failed to Save Note", err?.message || "Fan note save failed");
    }
  }, [selectedDeviceId, showToast]);

  const saveStartupSettings = useCallback(async (settings: Partial<DesktopStartupSettings>) => {
    try {
      const res = await dscBridge.updateStartupSettings(settings);
      setSnapshot(res);
      showToast("success", "Startup Settings Updated", "App startup configuration updated.");
    } catch (err: any) {
      showToast("error", "Startup Update Failed", err?.message || "Failed to update startup settings");
    }
  }, [showToast]);

  const openExternalUrl = useCallback(async (url: string) => {
    await dscBridge.openExternal(url);
  }, []);

  const exitApplication = useCallback(async () => {
    await dscBridge.exit();
  }, []);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Focus search on '/' key
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        const searchInput = document.getElementById("device-search-input");
        if (searchInput) {
          (searchInput as HTMLInputElement).focus();
        }
      }
      // Refresh on F5 or Ctrl+R / Cmd+R
      if (e.key === "F5" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r")) {
        e.preventDefault();
        refreshSnapshot();
      }
      // Esc to clear search or close modals
      if (e.key === "Escape") {
        if (accessKeyModalOpen) setAccessKeyModalOpen(false);
        if (secretModalOpen) setSecretModalOpen(false);
        if (fanNoteModalOpen) setFanNoteModalOpen(null);
        if (deviceSearchQuery) setDeviceSearchQuery("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [accessKeyModalOpen, secretModalOpen, fanNoteModalOpen, deviceSearchQuery, refreshSnapshot]);

  const contextValue: ConsoleContextValue = {
    snapshot,
    loading,
    refreshing,
    activeTab,
    selectedDeviceId,
    metricWindow,
    trafficMode,
    trafficAnchor,
    deviceSearchQuery,
    deviceFilterStatus,
    pendingConfigPatch,
    hasPendingChanges,
    cloudPushStatus,
    cloudPushMessage,
    accessKeyModalOpen,
    secretModalOpen,
    fanNoteModalOpen,
    toastMessage,
    refreshSnapshot,
    selectDevice,
    setMetricWindow,
    setTrafficMode,
    setActiveTab,
    setDeviceSearchQuery,
    setDeviceFilterStatus,
    updatePendingPatch,
    applyPendingChanges,
    discardPendingChanges,
    triggerCloudPush,
    controlCollector,
    saveSecret,
    loginHub,
    logoutHub,
    submitFanNote,
    saveStartupSettings,
    openExternalUrl,
    exitApplication,
    setAccessKeyModalOpen,
    setSecretModalOpen,
    setFanNoteModalOpen,
    showToast,
    dismissToast
  };

  return <ConsoleContext.Provider value={contextValue}>{children}</ConsoleContext.Provider>;
};

export const useConsole = (): ConsoleContextValue => {
  const ctx = useContext(ConsoleContext);
  if (!ctx) {
    throw new Error("useConsole must be used within a ConsoleProvider");
  }
  return ctx;
};
