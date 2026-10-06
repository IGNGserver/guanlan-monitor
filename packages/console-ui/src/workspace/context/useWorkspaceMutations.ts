import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  ConsoleSnapshot,
  DesktopAgentControlAction,
  DesktopConfigPatch,
  DesktopStartupSettings
} from "@dsc/shared";
import type { ConsoleAdapter } from "../../services/adapter";
import type { WorkspaceContextValue } from "./WorkspaceTypes";
import { formatWorkspaceError, isHubAddressSavedLoginFailure, type HubConnectionSaveResult } from "./WorkspaceTypes";

type Notice = WorkspaceContextValue["notice"];

export function useWorkspaceMutations({
  adapter,
  pendingMutationsRef,
  mutationEpochRef,
  setSnapshot,
  setNotice,
  setMutationPending
}: {
  adapter: ConsoleAdapter;
  pendingMutationsRef: MutableRefObject<number>;
  mutationEpochRef: MutableRefObject<number>;
  setSnapshot: Dispatch<SetStateAction<ConsoleSnapshot | null>>;
  setNotice: Dispatch<SetStateAction<Notice>>;
  setMutationPending: Dispatch<SetStateAction<boolean>>;
}) {
  const runMutation = useCallback(
    async (action: () => Promise<ConsoleSnapshot>, successText: string, errorText: string): Promise<boolean> => {
      pendingMutationsRef.current += 1;
      mutationEpochRef.current += 1;
      setMutationPending(true);
      try {
        const nextSnapshot = await action();
        setSnapshot(nextSnapshot);
        setNotice({ tone: "success", text: successText });
        return true;
      } catch (mutationError) {
        setNotice({ tone: "error", text: `${errorText}: ${formatWorkspaceError(mutationError, "未知错误")}` });
        return false;
      } finally {
        pendingMutationsRef.current = Math.max(0, pendingMutationsRef.current - 1);
        if (pendingMutationsRef.current === 0) setMutationPending(false);
      }
    },
    [mutationEpochRef, pendingMutationsRef, setMutationPending, setNotice, setSnapshot]
  );

  const updateLocalConfig = useCallback((patch: DesktopConfigPatch) => runMutation(
    () => adapter.updateLocalConfig ? adapter.updateLocalConfig(patch) : Promise.reject(new Error("local_agent_unavailable")),
    "本机配置已保存",
    "保存失败"
  ), [adapter, runMutation]);
  const controlAgent = useCallback((action: DesktopAgentControlAction) => runMutation(
    () => adapter.controlAgent ? adapter.controlAgent(action) : Promise.reject(new Error("local_agent_unavailable")),
    action === "restart" ? "Agent 已重启" : "Agent 操作已完成",
    action === "restart" ? "Agent 重启失败" : "Agent 操作失败"
  ), [adapter, runMutation]);
  /**
   * "Save and connect" has three honest outcomes: connected, address saved but
   * the Hub did not accept the credential, or nothing saved. The connection
   * page shows a different sentence for each instead of collapsing them into a
   * boolean that would report a saved address as lost.
   */
  const saveHubConnection = useCallback(async (serverUrl: string, accessKey: string): Promise<HubConnectionSaveResult> => {
    pendingMutationsRef.current += 1;
    mutationEpochRef.current += 1;
    setMutationPending(true);
    try {
      const nextSnapshot = await adapter.saveHubConnection(serverUrl, accessKey);
      setSnapshot(nextSnapshot);
      setNotice({ tone: "success", text: "中枢已连接，设备状态正在同步" });
      return "connected";
    } catch (mutationError) {
      if (isHubAddressSavedLoginFailure(mutationError)) {
        setNotice({ tone: "error", text: "中枢地址已保存，但认证未通过。请核对访问密钥与中枢服务状态后重试。" });
        return "saved-unauthenticated";
      }
      setNotice({ tone: "error", text: `连接保存失败: ${formatWorkspaceError(mutationError, "未知错误")}` });
      return "failed";
    } finally {
      pendingMutationsRef.current = Math.max(0, pendingMutationsRef.current - 1);
      if (pendingMutationsRef.current === 0) setMutationPending(false);
    }
  }, [adapter, mutationEpochRef, pendingMutationsRef, setMutationPending, setNotice, setSnapshot]);
  const updateStartupSettings = useCallback((settings: Partial<DesktopStartupSettings>) => runMutation(
    () => adapter.updateStartupSettings ? adapter.updateStartupSettings(settings) : Promise.reject(new Error("startup_settings_unavailable")),
    "启动设置已保存",
    "启动设置保存失败"
  ), [adapter, runMutation]);
  const cloudPush = useCallback(() => runMutation(
    () => adapter.cloudPush ? adapter.cloudPush() : Promise.reject(new Error("cloud_push_unavailable")),
    "配置已同步到中枢",
    "同步失败"
  ), [adapter, runMutation]);
  const saveFanNote = useCallback(
    (deviceId: string, fanId: string, note: string) => runMutation(() => adapter.saveFanNote(deviceId, fanId, note), "风扇备注已保存", "保存风扇备注失败"),
    [adapter, runMutation]
  );
  const deleteInstance = useCallback(
    (deviceId: string) => runMutation(() => adapter.deleteInstance(deviceId), "实例已删除；下次上报后会重新显示", "删除实例失败"),
    [adapter, runMutation]
  );
  const reorderInstances = useCallback(
    (deviceIds: string[]) => runMutation(() => adapter.reorderInstances(deviceIds), "实例顺序已保存", "保存排序失败"),
    [adapter, runMutation]
  );
  const minimizeWindow = useCallback(() => adapter.windowMinimize?.() ?? Promise.resolve(), [adapter]);
  const toggleMaximizeWindow = useCallback(() => adapter.windowToggleMaximize?.() ?? Promise.resolve(false), [adapter]);
  const closeWindow = useCallback(() => adapter.windowClose?.() ?? Promise.resolve(), [adapter]);
  const adapterDragStart = useCallback((screenX: number, screenY: number) => adapter.windowDragStart?.(screenX, screenY), [adapter]);
  const adapterDragMove = useCallback((screenX: number, screenY: number) => adapter.windowDragMove?.(screenX, screenY), [adapter]);
  const adapterDragEnd = useCallback(() => adapter.windowDragEnd?.(), [adapter]);
  const login = useCallback(async (accessKey: string): Promise<boolean> => {
    mutationEpochRef.current += 1;
    try {
      const nextSnapshot = await adapter.login(accessKey);
      setSnapshot(nextSnapshot);
      setNotice({ tone: "success", text: "已连接中枢" });
      return true;
    } catch (loginError) {
      setNotice({ tone: "error", text: `连接失败：${formatWorkspaceError(loginError, "认证失败")}` });
      return false;
    }
  }, [adapter, mutationEpochRef, setNotice, setSnapshot]);
  const logout = useCallback(
    () => runMutation(() => adapter.logout(), "已退出桌面查看；本机 Agent 仍可继续上报", "退出查看失败").then(() => undefined),
    [adapter, runMutation]
  );
  const disconnectAgent = useCallback(
    () => runMutation(() => adapter.disconnectAgent(), "已停止本机上报并清除凭据", "停止上报失败"),
    [adapter, runMutation]
  );

  return {
    updateLocalConfig,
    controlAgent,
    saveHubConnection,
    updateStartupSettings,
    cloudPush,
    saveFanNote,
    deleteInstance,
    reorderInstances,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
    adapterDragStart,
    adapterDragMove,
    adapterDragEnd,
    login,
    logout,
    disconnectAgent
  };
}
