import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DeviceSummary } from "@dsc/shared";
import { useWorkspace } from "../WorkspaceContext";
import { useTouchState } from "./TouchState";
import { TouchDeviceRow } from "./TouchDeviceRow";
import { TouchSheet } from "./TouchSheet";
import { M3Chip, M3IconButton, M3SearchBar, M3Select, M3SegmentedControl } from "../m3";
import { Button, Icon } from "../ui";
import {
  normalizeDeviceGroup,
  selectDeviceDirectory,
  selectDeviceGroups,
  selectExistingGroupNames,
  sortDevicesByCriterion,
  type DeviceDirectorySort,
  type DeviceDirectoryStatus,
  type DeviceGroupSummary
} from "../selectors";
import { mergeDeviceOrder, registerDeviceOrderDraftGuard } from "../deviceOrderDraft";
import {
  BatchGroupManageDialog,
  ConfirmDialog,
  DeviceGroupDialog,
  EmptyState,
  ErrorSurface,
  LoadingSurface,
  PromptDialog
} from "../pages/shared";
import { formatGroupPoolCaption } from "../pages/GroupVisuals";
import { formatPercent } from "../formatters";

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

export function TouchDevices() {
  const {
    allDevices,
    snapshot,
    loading,
    error,
    refresh,
    route,
    navigate,
    deleteInstance,
    reorderInstances,
    updateDeviceGroup,
    syncDeviceGroupMembers,
    mutationPending,
    openSettings,
    healthThresholds
  } = useWorkspace();
  const { query, setQuery, status, setStatus, group, setGroup, sort, setSort, pins, togglePin } = useTouchState();
  const [sheet, setSheet] = useState<"filter" | "menu" | null>(null);
  const [target, setTarget] = useState<DeviceSummary | null>(null);
  const [groupMenuTarget, setGroupMenuTarget] = useState<DeviceGroupSummary | null>(null);
  const [groupTarget, setGroupTarget] = useState<DeviceSummary | null>(null);
  const [batchGroupTarget, setBatchGroupTarget] = useState<string | null | undefined>(undefined);
  const [renamingGroup, setRenamingGroup] = useState<DeviceGroupSummary | null>(null);
  const [dissolvingGroup, setDissolvingGroup] = useState<DeviceGroupSummary | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(readCollapsedGroups);
  const [deleting, setDeleting] = useState(false);
  const [manage, setManage] = useState(false);
  const [draft, setDraft] = useState<string[] | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const pendingGroupTransitionRef = useRef<string | null>(null);

  useEffect(() => {
    if (route.kind === "devices") {
      setGroup(route.group ?? "all");
    }
  }, [route, setGroup]);

  // Execute deferred dialog opens only AFTER TouchSheet unmounts so native top-layer <dialog> never masks M3Dialog!
  useEffect(() => {
    if (sheet || target || groupMenuTarget || !pendingActionRef.current) return;
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    const timer = window.setTimeout(action, 0);
    return () => window.clearTimeout(timer);
  }, [groupMenuTarget, sheet, target]);

  const selectGroup = (nextGroup: string) => {
    setGroup(nextGroup);
    if (route.kind === "devices") {
      const normalized = nextGroup === "all" ? undefined : nextGroup;
      if (route.group !== normalized) {
        navigate(normalized ? { kind: "devices", group: normalized } : { kind: "devices" });
      }
    }
  };

  const serverOrder = allDevices.map((device) => device.deviceId);
  const effectiveOrder = mergeDeviceOrder(draft ?? serverOrder, serverOrder);
  const dirty = Boolean(manage && draft && effectiveOrder.some((id, index) => id !== serverOrder[index]));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    const unregister = registerDeviceOrderDraftGuard(() => dirtyRef.current);
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", unload);
    };
  }, []);

  const routeKey = route.kind === "device" ? `device:${route.deviceId}` : route.kind;
  useEffect(() => {
    setManage(false);
    setDraft(null);
  }, [routeKey]);

  const canManage = snapshot?.source === "live" && snapshot.session.authenticated;
  useEffect(() => {
    if (!canManage) {
      setManage(false);
      setDraft(null);
      setDeleting(false);
    }
  }, [canManage]);

  const ordered = useMemo(() => {
    const positions = new Map(effectiveOrder.map((id, index) => [id, index]));
    return allDevices
      .slice()
      .sort((a, b) => (positions.get(a.deviceId) ?? 0) - (positions.get(b.deviceId) ?? 0))
      .map((device, index) => ({ ...device, sortOrder: index }));
  }, [allDevices, effectiveOrder.join("\0")]);

  const groups = useMemo(() => selectDeviceGroups(ordered, healthThresholds), [ordered, healthThresholds]);
  const existingGroupNames = useMemo(() => selectExistingGroupNames(ordered), [ordered]);
  const hasNamedGroups = existingGroupNames.length > 0;

  useEffect(() => {
    if (groups.some((item) => item.key === pendingGroupTransitionRef.current)) {
      pendingGroupTransitionRef.current = null;
    }
    if (
      group !== "all"
      && group !== pendingGroupTransitionRef.current
      && allDevices.length > 0
      && !groups.some((item) => item.key === group)
    ) {
      setGroup("all");
      if (route.kind === "devices" && route.group) {
        navigate({ kind: "devices" });
      }
    }
  }, [allDevices.length, group, groups, navigate, route, setGroup]);

  const activeGroup = group !== "all" && !groups.some((item) => item.key === group) ? "all" : group;
  const activeGroupSummary = useMemo(
    () => (activeGroup === "all" ? null : groups.find((item) => item.key === activeGroup) ?? null),
    [activeGroup, groups]
  );

  const visible = selectDeviceDirectory(ordered, {
    query: manage ? "" : query,
    status: manage ? "all" : status,
    group: manage ? "all" : activeGroup,
    sort: manage ? "order" : sort
  });

  const visibleGroups = useMemo(() => {
    const raw = selectDeviceGroups(visible, healthThresholds);
    if (sort === "order" || manage) return raw;
    return raw.map((item) => ({ ...item, devices: sortDevicesByCriterion(item.devices, sort) }));
  }, [healthThresholds, manage, sort, visible]);

  const showGroupedSections = !manage && hasNamedGroups && activeGroup === "all" && visibleGroups.length > 0;
  const isSearching = query.trim().length > 0;

  const toggleCollapseGroup = (groupKey: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      storeCollapsedGroups(next);
      return next;
    });
  };

  const move = (id: string, direction: number) => {
    const visibleIndex = visible.findIndex((d) => d.deviceId === id);
    const neighbor = visible[visibleIndex + direction];
    if (!canManage || mutationPending || visibleIndex < 0 || !neighbor) return;
    const fromIdx = effectiveOrder.indexOf(id);
    const toIdx = effectiveOrder.indexOf(neighbor.deviceId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...effectiveOrder];
    [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
    setDraft(next);
  };

  const closeSheet = (afterClose?: () => void) => {
    if (afterClose) pendingActionRef.current = afterClose;
    if (window.history.state?.dscTouchSheet) {
      window.history.back();
      return;
    }
    setSheet(null);
  };
  const closeTarget = (afterClose?: () => void) => {
    if (afterClose) pendingActionRef.current = afterClose;
    if (window.history.state?.dscTouchSheet) {
      window.history.back();
      return;
    }
    setTarget(null);
    setDeleting(false);
  };
  const closeGroupMenu = (afterClose?: () => void) => {
    if (afterClose) pendingActionRef.current = afterClose;
    if (window.history.state?.dscTouchSheet) {
      window.history.back();
      return;
    }
    setGroupMenuTarget(null);
  };

  const save = async () => {
    if (!canManage || mutationPending) return;
    if (await reorderInstances(effectiveOrder)) {
      setManage(false);
      setDraft(null);
    }
  };

  if (loading && !snapshot) return <LoadingSurface />;
  if (!snapshot) return <ErrorSurface title="暂时无法读取设备" detail={error ?? "请检查网络后重试"} onRetry={() => void refresh()} />;

  return (
    <div className="touch-page touch-directory">
      <header className="touch-directory__heading">
        <div>
          <h1>{activeGroupSummary ? activeGroupSummary.name : "设备"}</h1>
          <p>
            {activeGroupSummary
              ? `本组 ${activeGroupSummary.online}/${activeGroupSummary.total} 台在线 · 共 ${allDevices.length} 台`
              : `${allDevices.length} 台${snapshot?.source === "cache" ? "已缓存" : "已接入"}`}
          </p>
        </div>
        {!manage && (
          <div className="touch-directory__heading-actions">
            {canManage && allDevices.length > 0 && (
              <M3IconButton
                label="新建或管理分组"
                onClick={() => setBatchGroupTarget(activeGroupSummary && !activeGroupSummary.isUngrouped ? activeGroupSummary.name : "")}
              >
                <Icon name="add" />
              </M3IconButton>
            )}
            <M3IconButton label="设备目录操作" onClick={() => setSheet("menu")}>
              <Icon name="more" />
            </M3IconButton>
          </div>
        )}
      </header>

      {manage ? (
        <div className="touch-manage-bar" role="status">
          <p>
            调整列表顺序
            <br />
            <small>用上移、下移调整，保存后同步到中枢。</small>
          </p>
          <div>
            <Button variant="text" disabled={mutationPending} onClick={() => { setManage(false); setDraft(null); }}>
              取消
            </Button>
            <Button variant="primary" disabled={!dirty || mutationPending} onClick={() => void save()}>
              {mutationPending ? "保存中" : "保存顺序"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="touch-directory__sticky">
          <div className="touch-search-row">
            <M3SearchBar
              label="搜索设备"
              placeholder="搜索名称、分组、系统或标识"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery("")}
              autoComplete="off"
              enterKeyHint="search"
            />
            <M3IconButton
              label="筛选与排序"
              selected={status !== "all" || activeGroup !== "all" || sort !== "order"}
              onClick={() => setSheet("filter")}
            >
              <Icon name="filter" />
            </M3IconButton>
          </div>
          {hasNamedGroups && (
            <div className="touch-group-chips" role="group" aria-label="按分组筛选">
              <M3Chip selected={activeGroup === "all"} onClick={() => selectGroup("all")}>
                全部 ({ordered.length})
              </M3Chip>
              {groups.map((item) => (
                <M3Chip key={item.key} selected={activeGroup === item.key} onClick={() => selectGroup(item.key)}>
                  <span className="workspace-group-chip-content">
                    <span className={`workspace-group-chip-dot is-${item.state}`} aria-hidden="true" />
                    <span>
                      {item.name} ({item.online}/{item.total})
                    </span>
                  </span>
                </M3Chip>
              ))}
            </div>
          )}
        </div>
      )}

      {!manage && activeGroupSummary && (
        <div className="touch-group-summary-bar">
          <span>
            {[
              activeGroupSummary.avgCpuPercent != null ? `CPU ${formatPercent(activeGroupSummary.avgCpuPercent)}` : "",
              activeGroupSummary.memoryTotalBytes
                ? `内存池 ${formatGroupPoolCaption(activeGroupSummary.memoryUsedBytes, activeGroupSummary.memoryTotalBytes)}`
                : activeGroupSummary.avgMemoryPercent != null
                  ? `内存 ${formatPercent(activeGroupSummary.avgMemoryPercent)}`
                  : "",
              activeGroupSummary.offline > 0 ? `${activeGroupSummary.offline} 台离线` : ""
            ]
              .filter(Boolean)
              .join(" · ") || "组内状态正常"}
          </span>
          {canManage && (
            <Button
              variant="text"
              onClick={() =>
                activeGroupSummary.isUngrouped
                  ? setBatchGroupTarget("")
                  : setGroupMenuTarget(activeGroupSummary)
              }
            >
              {activeGroupSummary.isUngrouped ? "批量设组" : "管组"}
            </Button>
          )}
        </div>
      )}

      {!manage && (
        <div className="touch-directory__count" aria-live="polite">
          {query || status !== "all" || activeGroup !== "all"
            ? `找到 ${visible.length} 台 · ${status === "online" ? "在线" : status === "offline" ? "离线" : "全部状态"}`
            : "点击设备查看状态与趋势"}
        </div>
      )}

      {showGroupedSections ? (
        <div className="touch-group-sections">
          {visibleGroups.map((groupItem) => {
            const isCollapsed = !isSearching && collapsedGroups.has(groupItem.key);
            return (
              <section key={groupItem.key} className={`touch-group-section${isCollapsed ? " is-collapsed" : ""}`} aria-label={`分组 ${groupItem.name}`}>
                <div className="touch-group-section__bar">
                  <button
                    type="button"
                    className="touch-group-section__header m3e-state-host"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleCollapseGroup(groupItem.key)}
                  >
                    <span className="touch-group-section__title">
                      <span className="touch-group-section__chevron" aria-hidden="true">
                        <Icon name="chevron" size={18} />
                      </span>
                      <span className={`workspace-group-chip-dot is-${groupItem.state}`} aria-hidden="true" />
                      <strong>{groupItem.name}</strong>
                      <small>{groupItem.online}/{groupItem.total}</small>
                    </span>
                    <span className="touch-group-section__meta">
                      {groupItem.overThreshold > 0
                        ? `${groupItem.overThreshold} 超限`
                        : groupItem.offline > 0
                          ? `${groupItem.offline} 离线`
                          : groupItem.avgCpuPercent != null
                            ? `CPU ${formatPercent(groupItem.avgCpuPercent)}`
                            : isCollapsed
                              ? "展开"
                              : "收起"}
                    </span>
                  </button>
                  {canManage && (
                    <M3IconButton
                      label={`管理分组 ${groupItem.name}`}
                      onClick={() =>
                        groupItem.isUngrouped
                          ? setBatchGroupTarget("")
                          : setGroupMenuTarget(groupItem)
                      }
                    >
                      <Icon name="more" size={18} />
                    </M3IconButton>
                  )}
                </div>
                <div className={`touch-group-section__collapse${isCollapsed ? " is-collapsed" : ""}`} aria-hidden={isCollapsed}>
                  <div className="touch-group-section__body">
                    <div className="touch-device-list">
                      {groupItem.devices.map((device) => (
                        <div key={device.deviceId} className="touch-directory__item">
                          <TouchDeviceRow
                            device={device}
                            selected={route.kind === "device" && route.deviceId === device.deviceId}
                            onMore={() => {
                              setTarget(device);
                              setDeleting(false);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="touch-device-list">
          {visible.map((device, index) => (
            <div key={device.deviceId} className="touch-directory__item">
              <TouchDeviceRow
                device={device}
                selected={route.kind === "device" && route.deviceId === device.deviceId}
                disabled={manage}
                onMore={!manage ? () => { setTarget(device); setDeleting(false); } : undefined}
              />
              {manage && (
                <div className="touch-order-controls">
                  <span>第 {index + 1} 位</span>
                  <M3IconButton
                    label={`上移${device.hostname}`}
                    disabled={!canManage || mutationPending || index === 0}
                    onClick={() => move(device.deviceId, -1)}
                  >
                    <Icon name="chevronUp" />
                  </M3IconButton>
                  <M3IconButton
                    label={`下移${device.hostname}`}
                    disabled={!canManage || mutationPending || index === visible.length - 1}
                    onClick={() => move(device.deviceId, 1)}
                  >
                    <Icon name="chevron" />
                  </M3IconButton>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!visible.length && (
        <EmptyState
          title={allDevices.length ? "没有匹配的设备" : "还没有设备接入"}
          detail={allDevices.length ? "清除搜索或筛选后查看全部设备。" : "设备上的 Agent 首次上报后会自动出现在这里。"}
          action={
            allDevices.length ? (
              <Button onClick={() => { setQuery(""); setStatus("all"); selectGroup("all"); }}>清除筛选</Button>
            ) : (
              <Button onClick={() => openSettings("connections")}>查看连接</Button>
            )
          }
        />
      )}

      {sheet && (
        <TouchSheet title={sheet === "filter" ? "筛选与排序" : "设备目录操作"} onClose={() => setSheet(null)}>
          {sheet === "filter" ? (
            <div className="touch-sheet__stack">
              <M3SegmentedControl
                aria-label="设备状态筛选"
                options={[
                  { value: "all", label: "全部" },
                  { value: "online", label: "在线" },
                  { value: "offline", label: "离线" }
                ]}
                value={status}
                onChange={(value) => setStatus(value as DeviceDirectoryStatus)}
              />
              <M3Select
                label="排列方式"
                value={sort}
                onChange={(event) => setSort(event.target.value as DeviceDirectorySort)}
                options={[
                  { value: "order", label: "中枢顺序" },
                  { value: "name", label: "设备名称" },
                  { value: "cpu", label: "CPU 使用率" },
                  { value: "memory", label: "内存使用率" },
                  { value: "disk", label: "磁盘使用率" },
                  { value: "lastSeen", label: "最近在线" }
                ]}
              />
              <Button variant="text" onClick={() => { setStatus("all"); selectGroup("all"); setSort("order"); }}>
                重置筛选与排序
              </Button>
              <Button variant="primary" onClick={() => closeSheet()}>
                查看 {visible.length} 台设备
              </Button>
            </div>
          ) : (
            <div className="touch-sheet__stack">
              <Button
                disabled={!canManage || mutationPending}
                onClick={() =>
                  closeSheet(() =>
                    setBatchGroupTarget(activeGroupSummary && !activeGroupSummary.isUngrouped ? activeGroupSummary.name : "")
                  )
                }
              >
                新建或批量设置设备分组
              </Button>
              {activeGroupSummary && !activeGroupSummary.isUngrouped && (
                <>
                  <Button
                    disabled={!canManage || mutationPending}
                    onClick={() => closeSheet(() => setRenamingGroup(activeGroupSummary))}
                  >
                    重命名“{activeGroupSummary.name}”
                  </Button>
                  <Button
                    variant="danger"
                    disabled={!canManage || mutationPending}
                    onClick={() => closeSheet(() => setDissolvingGroup(activeGroupSummary))}
                  >
                    解散“{activeGroupSummary.name}”分组
                  </Button>
                </>
              )}
              <Button
                disabled={!canManage || mutationPending || allDevices.length < 2}
                onClick={() => closeSheet(() => { setDraft(serverOrder); setManage(true); })}
              >
                管理设备顺序
              </Button>
              <p>
                {canManage
                  ? "可新建分组、批量增删组成员，或在单台设备的更多操作中修改分组。"
                  : "离线缓存只能查看，恢复连接后可管理设备。"}
              </p>
            </div>
          )}
        </TouchSheet>
      )}

      {groupMenuTarget && (
        <TouchSheet title={`分组“${groupMenuTarget.name}”`} onClose={() => setGroupMenuTarget(null)}>
          <div className="touch-sheet__stack">
            <Button
              disabled={!canManage || mutationPending}
              onClick={() => {
                const name = groupMenuTarget.name;
                closeGroupMenu(() => setBatchGroupTarget(name));
              }}
            >
              管理组成员 ({groupMenuTarget.total} 台)
            </Button>
            <Button
              disabled={!canManage || mutationPending}
              onClick={() => {
                const grp = groupMenuTarget;
                closeGroupMenu(() => setRenamingGroup(grp));
              }}
            >
              重命名分组
            </Button>
            <Button
              variant="danger"
              disabled={!canManage || mutationPending}
              onClick={() => {
                const grp = groupMenuTarget;
                closeGroupMenu(() => setDissolvingGroup(grp));
              }}
            >
              解散分组（保留设备）
            </Button>
          </div>
        </TouchSheet>
      )}

      {target && (
        <TouchSheet title={deleting ? `删除“${target.hostname}”？` : target.hostname} onClose={() => { setTarget(null); setDeleting(false); }}>
          <div className="touch-sheet__stack">
            {deleting ? (
              <>
                <p>将从中枢移除该采集设备（与设备组无关）。如果该设备上的 Agent 仍在运行，下次上报时会自动重新注册并加回列表。</p>
                <Button
                  variant="danger"
                  disabled={!canManage || mutationPending}
                  onClick={() => {
                    const id = target.deviceId;
                    closeTarget();
                    void deleteInstance(id);
                  }}
                >
                  删除设备
                </Button>
                <Button variant="text" onClick={() => setDeleting(false)}>
                  取消删除
                </Button>
              </>
            ) : (
              <>
                <Button
                  disabled={!canManage || mutationPending}
                  onClick={() => {
                    const device = target;
                    closeTarget(() => setGroupTarget(device));
                  }}
                >
                  {normalizeDeviceGroup(target.group) ? `修改分组（当前：${normalizeDeviceGroup(target.group)}）` : "设置分组"}
                </Button>
                <Button onClick={() => { togglePin(target.deviceId); closeTarget(); }}>
                  {pins.includes(target.deviceId) ? "取消常用" : "设为常用设备"}
                </Button>
                <p>常用设备只保存在当前浏览器，显示在总览中。</p>
                <Button variant="danger" disabled={!canManage || mutationPending} onClick={() => setDeleting(true)}>
                  删除设备
                </Button>
              </>
            )}
          </div>
        </TouchSheet>
      )}

      {groupTarget && (
        <DeviceGroupDialog
          title={`设置“${groupTarget.hostname}”的分组`}
          detail="选择已有分组或输入新分组名，留空即可移出分组。"
          currentGroup={normalizeDeviceGroup(groupTarget.group)}
          existingGroups={existingGroupNames}
          disabled={mutationPending}
          onConfirm={(nextGroup) => {
            const deviceId = groupTarget.deviceId;
            void updateDeviceGroup([deviceId], nextGroup).then((ok) => {
              if (ok) setGroupTarget(null);
            });
          }}
          onCancel={() => setGroupTarget(null)}
        />
      )}

      {batchGroupTarget !== undefined && (
        <BatchGroupManageDialog
          devices={ordered}
          existingGroups={existingGroupNames}
          initialGroup={batchGroupTarget}
          disabled={mutationPending}
          onConfirm={(targetIds, nextGroup) => {
            void updateDeviceGroup(targetIds, nextGroup).then((ok) => {
              if (ok) setBatchGroupTarget(undefined);
            });
          }}
          onSyncMembers={(assignIds, nextGroup, removeIds) => {
            const prevName = batchGroupTarget;
            if (prevName && nextGroup && nextGroup !== prevName && activeGroup === prevName) {
              pendingGroupTransitionRef.current = nextGroup;
            }
            void syncDeviceGroupMembers(assignIds, nextGroup, removeIds).then((ok) => {
              if (!ok) {
                pendingGroupTransitionRef.current = null;
                return;
              }
              setBatchGroupTarget(undefined);
              if (prevName && nextGroup && nextGroup !== prevName && activeGroup === prevName) {
                selectGroup(nextGroup);
              } else if (prevName && assignIds.length === 0 && activeGroup === prevName) {
                selectGroup("all");
              }
            });
          }}
          onCancel={() => setBatchGroupTarget(undefined)}
        />
      )}

      {renamingGroup && (
        <PromptDialog
          title={`重命名分组“${renamingGroup.name}”`}
          detail={`组内 ${renamingGroup.total} 台设备将一并归入新分组名。`}
          initialValue={renamingGroup.name}
          existingGroups={existingGroupNames}
          confirmLabel="保存名称"
          disabled={mutationPending}
          onConfirm={(canonicalName) => {
            const oldKey = renamingGroup.key;
            if (canonicalName === oldKey) {
              setRenamingGroup(null);
              return;
            }
            const ids = renamingGroup.devices.map((d) => d.deviceId);
            const wasSelected = activeGroup === oldKey;
            if (wasSelected) pendingGroupTransitionRef.current = canonicalName;
            void updateDeviceGroup(ids, canonicalName).then((ok) => {
              if (!ok) {
                pendingGroupTransitionRef.current = null;
                return;
              }
              setCollapsedGroups((current) => {
                if (!current.has(oldKey)) return current;
                const next = new Set(current);
                next.delete(oldKey);
                next.add(canonicalName);
                storeCollapsedGroups(next);
                return next;
              });
              setRenamingGroup(null);
              if (wasSelected) selectGroup(canonicalName);
            });
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
            const oldKey = dissolvingGroup.key;
            const ids = dissolvingGroup.devices.map((d) => d.deviceId);
            const wasSelected = activeGroup === oldKey;
            void updateDeviceGroup(ids, null).then((ok) => {
              if (!ok) return;
              setCollapsedGroups((current) => {
                if (!current.has(oldKey)) return current;
                const next = new Set(current);
                next.delete(oldKey);
                storeCollapsedGroups(next);
                return next;
              });
              setDissolvingGroup(null);
              if (wasSelected) selectGroup("all");
            });
          }}
          onCancel={() => setDissolvingGroup(null)}
        />
      )}
    </div>
  );
}
