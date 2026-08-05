import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import type {
  DesktopSnapshot,
  DesktopSnapshotRequest,
  DesktopConfigPatch,
  DesktopAgentControlAction,
  DesktopStartupSettings,
  MetricWindow,
  TrafficCalendarMode
} from "@dsc/shared";
import type { IGuanlanDataAdapter, MockStateFlags } from "../services/adapter";
import { MockGuanlanDataAdapter } from "../services/mockAdapter";
import { BridgeGuanlanDataAdapter } from "../services/bridgeAdapter";

export type GuanlanNavTab = "overview" | "devices" | "history" | "this-device" | "diagnostics" | "settings";

export interface ToastItem {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  text: string;
}

interface GuanlanContextType {
  activeTab: GuanlanNavTab;
  setActiveTab: (tab: GuanlanNavTab) => void;
  snapshot: DesktopSnapshot | null;
  loading: boolean;
  error: string | null;
  selectedDeviceId: string | null;
  setSelectedDeviceId: (id: string | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  statusFilter: "all" | "online" | "offline";
  setStatusFilter: (filter: "all" | "online" | "offline") => void;
  metricWindow: MetricWindow;
  setMetricWindow: (window: MetricWindow) => void;
  trafficMode: TrafficCalendarMode;
  setTrafficMode: (mode: TrafficCalendarMode) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, "id">) => void;
  removeToast: (id: string) => void;

  // Adapter actions
  refresh: () => Promise<void>;
  updateLocalConfig: (patch: DesktopConfigPatch) => Promise<void>;
  controlAgent: (action: DesktopAgentControlAction | "restart") => Promise<void>;
  setAgentSecret: (secret: string) => Promise<void>;
  saveFanNote: (deviceId: string, fanId: string, note: string) => Promise<void>;
  updateStartupSettings: (settings: Partial<DesktopStartupSettings>) => Promise<void>;
  cloudPush: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;

  // Simulation / Bridge controls
  isMockAdapter: boolean;
  mockFlags: MockStateFlags;
  setMockFlags: (flags: Partial<MockStateFlags>) => void;
  useRealBridge: boolean;
  setUseRealBridge: (useReal: boolean) => void;
}

const GuanlanContext = createContext<GuanlanContextType | null>(null);

function detectDefaultUseRealBridge(): boolean {
  if (typeof window === "undefined") return false;
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get("mock") === "1" || searchParams.get("mock") === "true") {
    return false;
  }
  const storedMock = localStorage.getItem("dsc_mock_preview");
  if (storedMock === "true") {
    return false;
  }
  // Default to real bridge if window.dsc exists or in standard desktop mode
  return typeof (window as any).dsc !== "undefined";
}

export const GuanlanProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [useRealBridge, setUseRealBridgeState] = useState<boolean>(detectDefaultUseRealBridge);
  const [adapter, setAdapter] = useState<IGuanlanDataAdapter>(() => {
    return useRealBridge ? new BridgeGuanlanDataAdapter() : new MockGuanlanDataAdapter();
  });
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<GuanlanNavTab>("overview");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>("dev-win-01");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline">("all");
  const [metricWindow, setMetricWindow] = useState<MetricWindow>("1h");
  const [trafficMode, setTrafficMode] = useState<TrafficCalendarMode>("day");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const setUseRealBridge = (useReal: boolean) => {
    setUseRealBridgeState(useReal);
    localStorage.setItem("dsc_mock_preview", useReal ? "false" : "true");
  };

  useEffect(() => {
    const newAdapter: IGuanlanDataAdapter = useRealBridge
      ? new BridgeGuanlanDataAdapter()
      : new MockGuanlanDataAdapter();
    setAdapter(newAdapter);
  }, [useRealBridge]);

  const fetchSnapshot = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const req: DesktopSnapshotRequest = {
        selectedDeviceId,
        metricWindow,
        trafficMode
      };
      const snap = await adapter.getSnapshot(req);
      setSnapshot(snap);
    } catch (err: any) {
      console.error("Failed to load snapshot:", err);
      setError(err?.message || "无法连接数据适配器/Bridge 通道");
    } finally {
      setLoading(false);
    }
  }, [adapter, selectedDeviceId, metricWindow, trafficMode]);

  useEffect(() => {
    fetchSnapshot();
    const unsubscribe = adapter.subscribe((newSnap) => {
      setSnapshot(newSnap);
    });
    return () => unsubscribe();
  }, [adapter, fetchSnapshot]);

  const addToast = (toast: Omit<ToastItem, "id">) => {
    const id = Math.random().toString(36).slice(2);
    const item: ToastItem = { ...toast, id };
    setToasts((prev) => [...prev, item]);
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Keyboard navigation & shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setCommandPaletteOpen(true);
      } else if (e.key === "Escape") {
        setCommandPaletteOpen(false);
      } else if (e.key === "F5" || (e.ctrlKey && e.key === "r")) {
        e.preventDefault();
        fetchSnapshot();
        addToast({ type: "info", title: "数据已刷新", text: "已从数据源获取最新系统状态" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fetchSnapshot]);

  const refresh = async () => {
    try {
      setLoading(true);
      setError(null);
      const req: DesktopSnapshotRequest = {
        selectedDeviceId,
        metricWindow,
        trafficMode
      };
      const snap = await adapter.refresh(req);
      setSnapshot(snap);
      addToast({ type: "success", title: "状态更新", text: "成功刷新仪表盘数据" });
    } catch (err: any) {
      setError(err?.message || "刷新快照失败");
      addToast({ type: "error", title: "刷新失败", text: err?.message || "断开通信连接" });
    } finally {
      setLoading(false);
    }
  };

  const updateLocalConfig = async (patch: DesktopConfigPatch) => {
    try {
      const snap = await adapter.updateLocalConfig(patch);
      setSnapshot(snap);
      addToast({ type: "success", title: "配置已保存", text: "本机 Agent 配置更新成功" });
    } catch (err: any) {
      addToast({ type: "error", title: "保存失败", text: err?.message || "更新配置失败" });
    }
  };

  const controlAgent = async (action: DesktopAgentControlAction | "restart") => {
    try {
      let snap: DesktopSnapshot;
      if (action === "restart") {
        addToast({ type: "info", title: "正在重启 Agent", text: "正在先停止再启动本机 Agent 服务..." });
        await adapter.controlAgent("stop");
        snap = await adapter.controlAgent("start");
      } else {
        snap = await adapter.controlAgent(action);
      }
      setSnapshot(snap);
      const textMap: Record<string, string> = {
        start: "启动",
        stop: "停止",
        restart: "重启",
        "check-connection": "检查连接",
        "detect-probes": "检测探针"
      };
      addToast({ type: "info", title: "Agent 指令已发送", text: `本机 Agent 已执行 ${textMap[action] || action} 动作` });
    } catch (err: any) {
      addToast({ type: "error", title: "操作失败", text: err?.message || "Agent 控制指令执行失败" });
    }
  };

  const setAgentSecret = async (secret: string) => {
    try {
      const snap = await adapter.setAgentSecret(secret);
      setSnapshot(snap);
      addToast({ type: "success", title: "密钥已更新", text: "Agent 通信 Secret 已重新保存" });
    } catch (err: any) {
      addToast({ type: "error", title: "密钥设置失败", text: err?.message || "Secret 更新失败" });
    }
  };

  const saveFanNote = async (deviceId: string, fanId: string, note: string) => {
    try {
      const snap = await adapter.saveFanNote(deviceId, fanId, note);
      setSnapshot(snap);
      addToast({ type: "success", title: "风扇备注已保存", text: `已记录风扇 ${fanId} 的自定义备注` });
    } catch (err: any) {
      addToast({ type: "error", title: "保存失败", text: err?.message || "风扇备注更新失败" });
    }
  };

  const updateStartupSettings = async (settings: Partial<DesktopStartupSettings>) => {
    try {
      const snap = await adapter.updateStartupSettings(settings);
      setSnapshot(snap);
      addToast({ type: "info", title: "开机项已修改", text: "开机自启策略更新成功" });
    } catch (err: any) {
      addToast({ type: "error", title: "修改失败", text: err?.message || "开机设置更新失败" });
    }
  };

  const cloudPush = async () => {
    try {
      const snap = await adapter.cloudPush();
      setSnapshot(snap);
      addToast({ type: "success", title: "云端同步", text: "显示与指标配置已推送至 Hub" });
    } catch (err: any) {
      addToast({ type: "error", title: "推送失败", text: err?.message || "云端同步失败" });
    }
  };

  const openExternal = async (url: string) => {
    await adapter.openExternal(url);
  };

  const mockFlags: MockStateFlags = adapter.getMockFlags ? adapter.getMockFlags() : {
    simulateEmpty: false,
    simulateCached: false,
    simulateAgentStopped: false,
    simulateError: false
  };

  const setMockFlags = (flags: Partial<MockStateFlags>) => {
    if (adapter.setMockFlags) {
      adapter.setMockFlags(flags);
    }
  };

  return (
    <GuanlanContext.Provider
      value={{
        activeTab,
        setActiveTab,
        snapshot,
        loading,
        error,
        selectedDeviceId,
        setSelectedDeviceId,
        searchQuery,
        setSearchQuery,
        statusFilter,
        setStatusFilter,
        metricWindow,
        setMetricWindow,
        trafficMode,
        setTrafficMode,
        commandPaletteOpen,
        setCommandPaletteOpen,
        toasts,
        addToast,
        removeToast,
        refresh,
        updateLocalConfig,
        controlAgent,
        setAgentSecret,
        saveFanNote,
        updateStartupSettings,
        cloudPush,
        openExternal,
        isMockAdapter: !useRealBridge,
        mockFlags,
        setMockFlags,
        useRealBridge,
        setUseRealBridge
      }}
    >
      {children}
    </GuanlanContext.Provider>
  );
};

export const useGuanlan = (): GuanlanContextType => {
  const context = useContext(GuanlanContext);
  if (!context) {
    throw new Error("useGuanlan must be used within a GuanlanProvider");
  }
  return context;
};
