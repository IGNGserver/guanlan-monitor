import React, { useEffect, useMemo, useRef, useState } from "react";
import { normalizeDeviceGroupName } from "@dsc/shared";
import type { DeviceSummary, SamplePoint } from "@dsc/shared";
import { useWorkspace } from "../WorkspaceContext";
import { M3Badge, useRipple } from "../m3";
import { Button, Icon, StatusDot, Surface } from "../ui";
import { formatPercent } from "../formatters";
import {
  normalizeDeviceGroup,
  selectDeviceDirectory,
  selectDeviceGroups,
  selectExistingGroupNames,
  type DeviceDirectorySort,
  type DeviceDirectoryStatus,
  type DeviceGroupFilter,
  type DeviceGroupSummary
} from "../selectors";
import { mergeDeviceOrder, registerDeviceOrderDraftGuard } from "../deviceOrderDraft";
import {
  DeviceTable,
  ConfirmDialog,
  PromptDialog,
  DeviceGroupDialog,
  BatchGroupManageDialog,
  DeviceDirectoryFilterBar,
  EmptyState,
  ErrorSurface,
  LoadingSurface,
  PageIntro,
  SnapshotFreshnessNotice
} from "./shared";

const COLLAPSED_GROUPS_STORAGE_KEY = "dsc-collapsed-groups";

function readCollapsedGroups(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.filter((item): item is string => typeof item === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function storeCollapsedGroups(groups: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify([...groups]));
  } catch {
    /* Optional preference. */
  }
}

export function DevicesPage() {
  const {
    route,
    navigate,
    snapshot,
    allDevices,
    loading,
    error,
    refresh,
    deleteInstance,
    reorderInstances,
    updateDeviceGroup,
    mutationPending,
    openSettings,
    healthThresholds
  } = useWorkspace();
  const overviewInstances = snapshot?.overviewMetrics?.instances;
  const cpuTrends = useMemo(() => new Map((overviewInstances ?? []).map((instance) => [instance.deviceId, instance.cpuUsagePercent])), [overviewInstances]);
  const routeGroup = route.kind === "devices" && route.group ? route.group : "all";
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DeviceDirectoryStatus>("all");
  const [groupFilter, setGroupFilter] = useState<DeviceGroupFilter>(routeGroup);
  const [sort, setSort] = useState<DeviceDirectorySort>("order");
  const [manageMode, setManageMode] = useState(false);
  const [orderDraft, setOrderDraft] = useState<string[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(readCollapsedGroups);
  const [deleteTarget, setDeleteTarget] = useState<DeviceSummary | null>(null);
  const [groupTargetIds, setGroupTargetIds] = useState<string[] | null>(null);
  const [batchGroupInitial, setBatchGroupInitial] = useState<string | null | undefined>(undefined);
  const [renamingGroup, setRenamingGroup] = useState<DeviceGroupSummary | null>(null);
  const [dissolvingGroup, setDissolvingGroup] = useState<DeviceGroupSummary | null>(null);

  useEffect(() => {
    setGroupFilter(routeGroup);
  }, [routeGroup]);

  const changeGroupFilter = (nextGroup: DeviceGroupFilter) => {
    setGroupFilter(nextGroup);
    if (route.kind === "devices") {
      const normalized = nextGroup === "all" ? undefined : nextGroup;
      if (route.group !== normalized) {
        navigate(normalized ? { kind: "devices", group: normalized } : { kind: "devices" });
      }
    }
  };

  const serverOrder = useMemo(() => allDevices.map((device) => device.deviceId), [allDevices]);
  const serverOrderKey = useMemo(() => serverOrder.join("\u0000"), [serverOrder]);
  const effectiveOrder = useMemo(() => mergeDeviceOrder(orderDraft ?? serverOrder, serverOrder), [orderDraft, serverOrder]);
  const orderDirty = useMemo(
    () => Boolean(orderDraft && effectiveOrder.length === serverOrder.length && effectiveOrder.some((id, index) => id !== serverOrder[index])),
    [orderDraft, effectiveOrder, serverOrder]
  );
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
      setSelectedIds(new Set());
      return;
    }
    setOrderDraft((current) => current ? mergeDeviceOrder(current, serverOrder) : current);
  }, [manageMode, serverOrderKey]);
  orderDirtyRef.current = orderDirty;
  const orderPosition = useMemo(() => new Map(effectiveOrder.map((deviceId, index) => [deviceId, index])), [effectiveOrder]);
  const orderedDevices = useMemo(() => allDevices
    .slice()
    .sort((left, right) => (orderPosition.get(left.deviceId) ?? Number.MAX_SAFE_INTEGER) - (orderPosition.get(right.deviceId) ?? Number.MAX_SAFE_INTEGER))
    .map((device, index) => ({ ...device, sortOrder: index })), [allDevices, orderPosition]);

  const allGroups = useMemo(() => selectDeviceGroups(orderedDevices, healthThresholds), [orderedDevices, healthThresholds]);
  const existingGroupNames = useMemo(() => selectExistingGroupNames(orderedDevices), [orderedDevices]);
  const hasNamedGroups = existingGroupNames.length > 0;

  useEffect(() => {
    if (groupFilter !== "all" && allDevices.length > 0 && !allGroups.some((group) => group.key === groupFilter)) {
      setGroupFilter("all");
      if (route.kind === "devices" && route.group) {
        navigate({ kind: "devices" });
      }
    }
  }, [allDevices.length, allGroups, groupFilter, navigate, route]);

  const activeGroupSummary = useMemo(
    () => (groupFilter === "all" ? null : allGroups.find((group) => group.key === groupFilter) ?? null),
    [allGroups, groupFilter]
  );

  const visibleDevices = useMemo(
    () => selectDeviceDirectory(orderedDevices, {
      query,
      status: statusFilter,
      group: groupFilter,
      sort: manageMode ? "order" : sort
    }),
    [groupFilter, manageMode, orderedDevices, query, sort, statusFilter]
  );

  const visibleGroups = useMemo(
    () => selectDeviceGroups(visibleDevices, healthThresholds),
    [visibleDevices, healthThresholds]
  );

  // Every hook above runs on every render. The early returns used to sit before
  // the three memos, so a failed first read followed by a successful retry
  // rendered more hooks than the previous pass and React tore the page down.
  if (loading && !snapshot) return <LoadingSurface />;
  if (!snapshot) return <ErrorSurface title="无法读取设备目录" detail={error ?? "尚未取得设备快照"} onRetry={() => void refresh()} />;

  const canManage = snapshot.source === "live" && snapshot.session.authenticated;
  const beginManage = () => {
    if (!canManage || mutationPending) return;
    setOrderDraft(serverOrder);
    setSort("order");
    setManageMode(true);
  };
  const cancelManage = () => {
    if (mutationPending) return;
    setOrderDraft(null);
    setSelectedIds(new Set());
    setManageMode(false);
  };
  const saveManage = async () => {
    if (!canManage || !orderDraft || mutationPending) return;
    const saved = await reorderInstances(effectiveOrder);
    if (saved) {
      setOrderDraft(null);
      setSelectedIds(new Set());
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
  const toggleSelectDevice = (deviceId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(deviceId);
      else next.delete(deviceId);
      return next;
    });
  };
  const toggleGroupCollapse = (groupKey: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      storeCollapsedGroups(next);
      return next;
    });
  };
  const allVisibleGroupsCollapsed = visibleGroups.length > 0 && visibleGroups.every((group) => collapsedGroups.has(group.key));
  const toggleAllGroupsCollapse = () => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (allVisibleGroupsCollapsed) {
        visibleGroups.forEach((group) => next.delete(group.key));
      } else {
        visibleGroups.forEach((group) => next.add(group.key));
      }
      storeCollapsedGroups(next);
      return next;
    });
  };

  const groupDialogDevices = groupTargetIds
    ? allDevices.filter((device) => groupTargetIds.includes(device.deviceId))
    : [];
  const groupDialogCurrentGroup = groupDialogDevices.length === 1
    ? normalizeDeviceGroup(groupDialogDevices[0].group)
    : groupDialogDevices.length > 1 && new Set(groupDialogDevices.map((d) => normalizeDeviceGroup(d.group))).size === 1
      ? normalizeDeviceGroup(groupDialogDevices[0].group)
      : null;

  // One empty directory says exactly one thing. With nothing connected the
  // table used to answer "没有匹配设备 · 尝试清空搜索或调整状态筛选" *and*, right
  // below it, "还没有设备接入" — the first is a lie in that case, and it sent the
  // reader to a filter box instead of the hub connection.
  const emptyDirectory = allDevices.length
    ? <EmptyState
      title="没有匹配设备"
      detail={`${allDevices.length} 台已接入设备里没有符合当前搜索或筛选的；清除后即可看到全部设备。`}
      action={<Button variant="quiet" onClick={() => { setQuery(""); setStatusFilter("all"); changeGroupFilter("all"); }}>清除筛选</Button>}
    />
    : <EmptyState
      title="还没有设备接入"
      detail="目标设备上的 Agent 上报一次后，就会自动出现在这里；也可以先检查中枢连接。"
      action={<Button variant="primary" onClick={() => openSettings("connections")}>连接设置</Button>}
    />;

  const showGroupedSections = hasNamedGroups && !manageMode && sort === "order" && visibleGroups.length > 0;

  return <div className="workspace-page workspace-page--devices">
    <PageIntro
      eyebrow={activeGroupSummary ? "设备 · 设备组" : "设备"}
      title={activeGroupSummary ? activeGroupSummary.name : "全部设备"}
      description={snapshot.source === "cache"
        ? "当前显示离线缓存；可以搜索和查看，管理操作已禁用。"
        : activeGroupSummary
          ? [
              `组内 ${activeGroupSummary.online}/${activeGroupSummary.total} 台在线`,
              activeGroupSummary.offline > 0 ? `${activeGroupSummary.offline} 台离线` : "",
              activeGroupSummary.overThreshold > 0 ? `${activeGroupSummary.overThreshold} 台超限` : "",
              activeGroupSummary.avgCpuPercent != null ? `平均 CPU ${formatPercent(activeGroupSummary.avgCpuPercent)}` : "",
              activeGroupSummary.avgMemoryPercent != null ? `平均内存 ${formatPercent(activeGroupSummary.avgMemoryPercent)}` : ""
            ].filter(Boolean).join(" · ")
          : "搜索、按组筛选、排序和管理接入当前中枢的全部设备。"}
      actions={activeGroupSummary ? (
        <>
          <Button variant="quiet" onClick={() => changeGroupFilter("all")}>全部设备</Button>
          {canManage && !activeGroupSummary.isUngrouped && (
            <>
              <Button variant="secondary" onClick={() => setBatchGroupInitial(activeGroupSummary.name)} disabled={mutationPending}>
                管理组成员
              </Button>
              <Button variant="quiet" onClick={() => setRenamingGroup(activeGroupSummary)} disabled={mutationPending}>
                重命名
              </Button>
              <Button variant="quiet" onClick={() => setDissolvingGroup(activeGroupSummary)} disabled={mutationPending}>
                解散分组
              </Button>
            </>
          )}
        </>
      ) : undefined}
    />
    <SnapshotFreshnessNotice />
    <DeviceDirectoryFilterBar
      devices={orderedDevices}
      query={query}
      onQueryChange={setQuery}
      statusFilter={statusFilter}
      onStatusFilterChange={setStatusFilter}
      groupFilter={groupFilter}
      onGroupFilterChange={changeGroupFilter}
      groups={allGroups}
      sort={sort}
      onSortChange={setSort}
      sortDisabled={manageMode}
      allGroupsCollapsed={allVisibleGroupsCollapsed}
      onToggleAllGroupsCollapse={showGroupedSections && visibleGroups.length > 1 ? toggleAllGroupsCollapse : undefined}
      onOpenBatchGroup={canManage && !manageMode && allDevices.length > 0 ? () => setBatchGroupInitial(activeGroupSummary && !activeGroupSummary.isUngrouped ? activeGroupSummary.name : "") : undefined}
      actions={!manageMode
        ? <div className="workspace-order-actions">
            {!hasNamedGroups && canManage && allDevices.length > 0 && (
              <Button variant="quiet" onClick={() => setBatchGroupInitial("")} disabled={mutationPending}>
                批量分组
              </Button>
            )}
            <Button variant="secondary" onClick={beginManage} disabled={!canManage}><Icon name="device" size={15} />管理顺序</Button>
          </div>
        : <div className="workspace-order-actions">
            {selectedIds.size > 0 && (
              <Button variant="secondary" onClick={() => setGroupTargetIds([...selectedIds])} disabled={mutationPending}>
                批量设组 ({selectedIds.size})
              </Button>
            )}
            <Button variant="primary" onClick={() => void saveManage()} disabled={!orderDirty || mutationPending}>保存顺序</Button>
            <Button variant="quiet" onClick={cancelManage} disabled={mutationPending}>取消</Button>
          </div>}
    />
    {manageMode && (
      <div className="workspace-inline-note" role="status">
        <span>调整只生成草稿，点“保存顺序”才会写入中枢；未保存就离开会被提示。可勾选多台设备批量设置分组。</span>
        {visibleDevices.length > 0 && (
          <Button
            variant="quiet"
            onClick={() => {
              const allVisibleSelected = visibleDevices.every((d) => selectedIds.has(d.deviceId));
              if (allVisibleSelected) setSelectedIds(new Set());
              else setSelectedIds(new Set(visibleDevices.map((d) => d.deviceId)));
            }}
          >
            {visibleDevices.every((d) => selectedIds.has(d.deviceId)) ? "取消全选" : "全选当前列表"}
          </Button>
        )}
      </div>
    )}
    {!canManage && <div className="workspace-inline-note" role="status">{snapshot.source === "cache" ? "离线缓存为只读快照。" : "需要连接中枢并完成认证后才能删除、分组或调整设备顺序。"}</div>}

    {showGroupedSections ? (
      <div className="workspace-group-sections">
        {visibleGroups.map((group) => (
          <DeviceGroupSection
            key={group.key}
            group={group}
            collapsed={groupFilter === "all" && collapsedGroups.has(group.key)}
            onToggleCollapse={() => toggleGroupCollapse(group.key)}
            canManage={canManage && !mutationPending}
            onEditDeviceGroup={canManage ? (device) => setGroupTargetIds([device.deviceId]) : undefined}
            onDeleteDevice={canManage ? setDeleteTarget : undefined}
            onManageMembers={canManage ? () => setBatchGroupInitial(group.isUngrouped ? "" : group.name) : undefined}
            onRenameGroup={!group.isUngrouped && canManage ? () => setRenamingGroup(group) : undefined}
            onDissolveGroup={!group.isUngrouped && canManage ? () => setDissolvingGroup(group) : undefined}
            cpuTrends={cpuTrends}
          />
        ))}
      </div>
    ) : (
      <Surface className="workspace-directory-surface guanlan-data-table-surface">
        <div className="workspace-directory-table-scroll">
          <DeviceTable
            devices={visibleDevices}
            order={effectiveOrder}
            manageMode={manageMode && canManage && !mutationPending}
            showGroupBadge={groupFilter === "all"}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelectDevice}
            onMove={moveInstance}
            onDelete={canManage ? setDeleteTarget : undefined}
            onEditGroup={canManage ? (device) => setGroupTargetIds([device.deviceId]) : undefined}
            emptyState={emptyDirectory}
            cpuTrends={cpuTrends}
          />
        </div>
      </Surface>
    )}

    {deleteTarget && (
      <ConfirmDialog
        title={`删除“${deleteTarget.hostname}”？`}
        detail="将从中枢移除该采集设备（与设备组无关）。如果该设备上的 Agent 仍在运行，下次上报时会自动重新注册并加回列表。"
        confirmLabel="删除设备"
        disabled={mutationPending}
        onConfirm={() => {
          const deviceId = deleteTarget.deviceId;
          setDeleteTarget(null);
          void deleteInstance(deviceId);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    )}

    {groupTargetIds && groupDialogDevices.length > 0 && (
      <DeviceGroupDialog
        title={groupDialogDevices.length === 1 ? `设置“${groupDialogDevices[0].hostname}”的分组` : `为 ${groupDialogDevices.length} 台设备设置分组`}
        detail={groupDialogDevices.length === 1
          ? "选择已有分组或直接输入新分组名称，保存后立即生效；留空即可移出分组。"
          : `已选中 ${groupDialogDevices.map((d) => d.hostname).slice(0, 4).join("、")}${groupDialogDevices.length > 4 ? ` 等 ${groupDialogDevices.length} 台设备` : ""}。`}
        currentGroup={groupDialogCurrentGroup}
        existingGroups={existingGroupNames}
        disabled={mutationPending}
        onConfirm={(nextGroup) => {
          const targetIds = groupTargetIds;
          setGroupTargetIds(null);
          setSelectedIds(new Set());
          void updateDeviceGroup(targetIds, nextGroup);
        }}
        onCancel={() => setGroupTargetIds(null)}
      />
    )}

    {batchGroupInitial !== undefined && (
      <BatchGroupManageDialog
        devices={orderedDevices}
        existingGroups={existingGroupNames}
        initialGroup={batchGroupInitial}
        disabled={mutationPending}
        onConfirm={(targetIds, nextGroup) => {
          setBatchGroupInitial(undefined);
          void updateDeviceGroup(targetIds, nextGroup);
        }}
        onCancel={() => setBatchGroupInitial(undefined)}
      />
    )}

    {renamingGroup && (
      <PromptDialog
        title={`重命名分组“${renamingGroup.name}”`}
        detail={`组内 ${renamingGroup.total} 台设备将一并归入新分组名。`}
        initialValue={renamingGroup.name}
        confirmLabel="保存名称"
        disabled={mutationPending}
        onConfirm={(nextName) => {
          const canonicalName = normalizeDeviceGroupName(nextName)?.slice(0, 64);
          if (!canonicalName) return;
          const ids = renamingGroup.devices.map((device) => device.deviceId);
          const wasSelected = groupFilter === renamingGroup.key;
          setRenamingGroup(null);
          if (wasSelected) changeGroupFilter(canonicalName);
          void updateDeviceGroup(ids, canonicalName);
        }}
        onCancel={() => setRenamingGroup(null)}
      />
    )}

    {dissolvingGroup && (
      <ConfirmDialog
        title={`解散分组“${dissolvingGroup.name}”？`}
        detail={`解散后，组内 ${dissolvingGroup.total} 台设备不会被删除，而是恢复为“未分组”状态。`}
        confirmLabel="解散分组"
        disabled={mutationPending}
        onConfirm={() => {
          const ids = dissolvingGroup.devices.map((device) => device.deviceId);
          const wasSelected = groupFilter === dissolvingGroup.key;
          setDissolvingGroup(null);
          if (wasSelected) changeGroupFilter("all");
          void updateDeviceGroup(ids, null);
        }}
        onCancel={() => setDissolvingGroup(null)}
      />
    )}
  </div>;
}

function DeviceGroupSection({
  group,
  collapsed,
  onToggleCollapse,
  canManage,
  onEditDeviceGroup,
  onDeleteDevice,
  onManageMembers,
  onRenameGroup,
  onDissolveGroup,
  cpuTrends
}: {
  group: DeviceGroupSummary;
  collapsed: boolean;
  onToggleCollapse: () => void;
  canManage: boolean;
  onEditDeviceGroup?: (device: DeviceSummary) => void;
  onDeleteDevice?: (device: DeviceSummary) => void;
  onManageMembers?: () => void;
  onRenameGroup?: () => void;
  onDissolveGroup?: () => void;
  cpuTrends?: ReadonlyMap<string, readonly SamplePoint[]>;
}) {
  const { onPointerDown, rippleNodes } = useRipple<HTMLButtonElement>();
  return (
    <Surface className={`workspace-group-section guanlan-data-table-surface${collapsed ? " is-collapsed" : ""}`}>
      <div className="workspace-group-section__header">
        <button
          type="button"
          className="workspace-group-section__toggle m3e-state-host"
          onPointerDown={onPointerDown}
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "展开" : "收起"}分组 ${group.name}`}
        >
          <span className="workspace-group-section__chevron" aria-hidden="true">
            <Icon name="chevron" size={18} />
          </span>
          <StatusDot state={group.state} />
          <strong className="workspace-group-section__title">{group.name}</strong>
          <M3Badge tone={group.online === 0 ? "neutral" : group.offline > 0 ? "primary" : "success"}>
            {`${group.online}/${group.total} 在线`}
          </M3Badge>
          {group.offline > 0 && (
            <M3Badge tone="neutral">{`${group.offline} 台离线`}</M3Badge>
          )}
          {group.overThreshold > 0 && (
            <M3Badge tone={group.criticalCount > 0 ? "error" : "warning"}>{`${group.overThreshold} 台超限`}</M3Badge>
          )}
          {rippleNodes}
        </button>

        <div className="workspace-group-section__meta">
          {(group.avgCpuPercent != null || group.avgMemoryPercent != null) && (
            <span className="workspace-group-section__averages">
              {group.avgCpuPercent != null ? `平均 CPU ${formatPercent(group.avgCpuPercent)}` : ""}
              {group.avgCpuPercent != null && group.avgMemoryPercent != null ? " · " : ""}
              {group.avgMemoryPercent != null ? `平均内存 ${formatPercent(group.avgMemoryPercent)}` : ""}
            </span>
          )}
          {canManage && (
            <div className="workspace-group-section__actions">
              {onManageMembers && (
                <button type="button" className="guanlan-table-live-action" onClick={onManageMembers}>
                  {group.isUngrouped ? "批量设组" : "管理成员"}
                </button>
              )}
              {!group.isUngrouped && onRenameGroup && (
                <button type="button" className="guanlan-table-live-action" onClick={onRenameGroup}>
                  重命名
                </button>
              )}
              {!group.isUngrouped && onDissolveGroup && (
                <button type="button" className="guanlan-table-live-action" onClick={onDissolveGroup}>
                  解散
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={`workspace-group-section__collapse${collapsed ? " is-collapsed" : ""}`} aria-hidden={collapsed}>
        <div className="workspace-group-section__body">
          <div className="workspace-directory-table-scroll">
            <DeviceTable
              devices={group.devices}
              showGroupBadge={false}
              onEditGroup={onEditDeviceGroup}
              onDelete={onDeleteDevice}
              cpuTrends={cpuTrends}
            />
          </div>
        </div>
      </div>
    </Surface>
  );
}

