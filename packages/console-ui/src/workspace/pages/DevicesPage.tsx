import React, { useEffect, useRef, useState } from "react";
import type { DeviceSummary } from "@dsc/shared";
import { useWorkspace } from "../WorkspaceContext";
import { Button, Icon, Surface } from "../ui";
import { selectDeviceDirectory, type DeviceDirectorySort, type DeviceDirectoryStatus } from "../selectors";
import { mergeDeviceOrder, registerDeviceOrderDraftGuard } from "../deviceOrderDraft";
import { CarbonDeviceTable, ConfirmDialog, DeviceCardGrid, DeviceDirectoryFilterBar, EmptyState, ErrorSurface, LoadingSurface, PageIntro, SnapshotFreshnessNotice } from "./shared";

export function DevicesPage() {
  const { snapshot, allDevices, loading, error, refresh, deleteInstance, reorderInstances, mutationPending, openSettings } = useWorkspace();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DeviceDirectoryStatus>("all");
  const [sort, setSort] = useState<DeviceDirectorySort>("order");
  const [manageMode, setManageMode] = useState(false);
  const [orderDraft, setOrderDraft] = useState<string[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeviceSummary | null>(null);
  const serverOrder = allDevices.map((device) => device.deviceId);
  const serverOrderKey = serverOrder.join("\u0000");
  const effectiveOrder = mergeDeviceOrder(orderDraft ?? serverOrder, serverOrder);
  const orderDirty = Boolean(orderDraft && JSON.stringify(effectiveOrder) !== JSON.stringify(serverOrder));
  const orderDirtyRef = useRef(false);
  useEffect(() => {
    const unregisterGuard = registerDeviceOrderDraftGuard(() => orderDirtyRef.current);
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!orderDirtyRef.current) return;
      const proceed = window.confirm("设备顺序修改尚未保存，离开后顺序草稿将丢失。是否继续退出？");
      if (!proceed) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      unregisterGuard();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);
  useEffect(() => {
    if (!manageMode) {
      setOrderDraft(null);
      return;
    }
    setOrderDraft((current) => current ? mergeDeviceOrder(current, serverOrder) : current);
  }, [manageMode, serverOrderKey]);
  orderDirtyRef.current = orderDirty;
  if (loading && !snapshot) return <LoadingSurface />;
  if (!snapshot) return <ErrorSurface title="无法读取设备目录" detail={error ?? "尚未取得设备快照"} onRetry={() => void refresh()} />;

  const canManage = snapshot.source === "live" && snapshot.session.authenticated;
  const orderPosition = new Map(effectiveOrder.map((deviceId, index) => [deviceId, index]));
  const orderedDevices = allDevices
    .slice()
    .sort((left, right) => (orderPosition.get(left.deviceId) ?? Number.MAX_SAFE_INTEGER) - (orderPosition.get(right.deviceId) ?? Number.MAX_SAFE_INTEGER))
    .map((device, index) => ({ ...device, sortOrder: index }));
  const visibleDevices = selectDeviceDirectory(orderedDevices, { query, status: statusFilter, sort: manageMode ? "order" : sort });
  const beginManage = () => {
    if (!canManage || mutationPending) return;
    setOrderDraft(serverOrder);
    setSort("order");
    setManageMode(true);
  };
  const cancelManage = () => {
    if (mutationPending) return;
    setOrderDraft(null);
    setManageMode(false);
  };
  const saveManage = async () => {
    if (!canManage || !orderDraft || mutationPending) return;
    const saved = await reorderInstances(effectiveOrder);
    if (saved) {
      setOrderDraft(null);
      setManageMode(false);
    }
  };
  const moveInstance = (deviceId: string, direction: -1 | 1) => {
    if (!canManage || !manageMode || mutationPending) return;
    const current = effectiveOrder;
    const currentIndex = current.indexOf(deviceId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= current.length) return;
    const next = [...current];
    [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
    setOrderDraft(next);
  };

  // One empty directory says exactly one thing. With nothing connected the
  // table used to answer "没有匹配设备 · 尝试清空搜索或调整状态筛选" *and*, right
  // below it, "还没有设备接入" — the first is a lie in that case, and it sent the
  // reader to a filter box instead of the hub connection.
  const emptyDirectory = allDevices.length
    ? <EmptyState
      title="没有匹配设备"
      detail={`${allDevices.length} 台已接入设备里没有符合当前搜索或筛选的；清除后即可看到全部设备。`}
      action={<Button variant="quiet" onClick={() => { setQuery(""); setStatusFilter("all"); }}>清除筛选</Button>}
    />
    : <EmptyState
      title="还没有设备接入"
      detail="目标设备上的 Agent 上报一次后，就会自动出现在这里；也可以先检查中枢连接。"
      action={<Button variant="primary" onClick={() => openSettings("connections")}>连接设置</Button>}
    />;

  return <div className="workspace-page workspace-page--devices">
    <PageIntro
      eyebrow="设备"
      title="全部设备"
      description={snapshot.source === "cache" ? "当前显示离线缓存；可以搜索和查看，管理操作已禁用。" : "搜索、筛选、排序和管理接入当前中枢的全部设备。"}
    />
    <SnapshotFreshnessNotice />
    <DeviceDirectoryFilterBar
      devices={allDevices}
      query={query}
      onQueryChange={setQuery}
      statusFilter={statusFilter}
      onStatusFilterChange={setStatusFilter}
      sort={sort}
      onSortChange={setSort}
      sortDisabled={manageMode}
      actions={!manageMode ? <Button variant="secondary" onClick={beginManage} disabled={!canManage}><Icon name="device" size={15} />管理顺序</Button> : <div className="workspace-order-actions"><Button variant="primary" onClick={() => void saveManage()} disabled={!orderDirty || mutationPending}>保存顺序</Button><Button variant="quiet" onClick={cancelManage} disabled={mutationPending}>取消</Button></div>}
    />
    {manageMode && <div className="workspace-inline-note" role="status">调整只生成草稿，点“保存顺序”才会写入中枢；未保存就离开会被提示。</div>}
    {!canManage && <div className="workspace-inline-note" role="status">{snapshot.source === "cache" ? "离线缓存为只读快照。" : "需要实时连接并完成认证后才能删除或调整设备顺序。"}</div>}
    <Surface className="workspace-directory-surface guanlan-data-table-surface">
      {visibleDevices.length > 0 && (
        <div className="guanlan-fleet-cards-wrap" style={{ padding: "16px 16px 0 16px" }}>
          <DeviceCardGrid devices={visibleDevices} />
        </div>
      )}
      {visibleDevices.length > 0 && <div className="workspace-directory-scroll-hint" role="note">左右滑动查看更多字段 · 点按设备行查看详情</div>}
      <div className="workspace-directory-table-scroll">
        <CarbonDeviceTable
          devices={visibleDevices}
          order={effectiveOrder}
          manageMode={manageMode && canManage && !mutationPending}
          onMove={moveInstance}
          onDelete={setDeleteTarget}
          emptyState={emptyDirectory}
        />
      </div>
    </Surface>
    {deleteTarget && <ConfirmDialog title={`删除“${deleteTarget.hostname}”？`} detail="删除后该设备不再出现在中枢列表；宿主机或 Agent 下次上报时，它会重新出现。" confirmLabel="删除设备" disabled={mutationPending} onConfirm={() => { const deviceId = deleteTarget.deviceId; setDeleteTarget(null); void deleteInstance(deviceId); }} onCancel={() => setDeleteTarget(null)} />}
  </div>;
}

