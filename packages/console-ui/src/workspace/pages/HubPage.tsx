import React, { useState } from "react";
import { useWorkspace, type SettingsSection } from "../WorkspaceContext";
import { Button, Icon, StatusLabel, Surface } from "../ui";
import { selectDeviceDirectory, selectSnapshotSource, type DeviceDirectorySort, type DeviceDirectoryStatus } from "../selectors";
import { DeviceDirectoryFilterBar, DeviceDirectoryHeader, DeviceRow, EmptyState, PageIntro } from "./shared";

export function HubPage() {
  const { snapshot, hubs, route, navigate, openSettings, capabilities } = useWorkspace();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "device" | "virtual_machine">("all");
  const [statusFilter, setStatusFilter] = useState<DeviceDirectoryStatus>("all");
  const [sort, setSort] = useState<DeviceDirectorySort>("order");
  const hub = hubs.find((item) => item.id === (route.kind === "hub" ? route.hubId : "")) ?? hubs[0];
  if (!hub) return <EmptyState title="没有配置中枢" detail="配置一个中枢连接后，这里会显示它提供的设备目录。" action={<Button variant="primary" onClick={() => openSettings(capabilities.canConfigureConnection ? "connections" : "workspace")}>{capabilities.canConfigureConnection ? "添加中枢" : "查看中枢设置"}</Button>} />;

  const source = snapshot ? selectSnapshotSource(snapshot, hub.devices) : "unknown";
  const sourceState: "online" | "offline" | "cached" | "warning" | "unknown" = source === "live" ? "online" : source === "cache" ? "cached" : source === "unknown" ? "warning" : "unknown";
  const sourceLabel = source === "live" ? "实时连接" : source === "cache" ? "离线缓存" : source === "empty" ? "等待数据" : "连接异常";
  const statusLabel = source === "live" ? "连接正常" : source === "cache" ? "正在显示缓存" : source === "empty" ? "暂无设备数据" : "需要检查连接";
  const online = hub.devices.filter((device) => device.status === "online").length;
  const visibleDevices = selectDeviceDirectory(hub.devices, { query, instanceType: typeFilter, status: statusFilter, sort });
  const settingsSection: SettingsSection = capabilities.canConfigureConnection ? "connections" : "workspace";
  const settingsLabel = capabilities.canConfigureConnection ? "管理连接" : "查看中枢设置";
  const readonlyReason = source === "cache"
    ? "当前目录来自缓存，只读；恢复实时认证后才能管理设备顺序。"
    : source === "live"
      ? "中枢目录为只读视图；设备顺序和删除操作请在“设备”页面完成。"
      : "当前没有可写的实时认证连接，目录只读。";

  return <div className="workspace-page workspace-page--hub">
    <PageIntro
      eyebrow="中枢"
      title={hub.name}
      description={hub.endpoint}
      actions={<><Button variant="quiet" onClick={() => navigate({ kind: "overview" })}><Icon name="back" size={16} />返回总览</Button><Button variant="primary" onClick={() => openSettings(settingsSection)}><Icon name="settings" size={16} />{settingsLabel}</Button></>}
    />
    <div className="workspace-hub-facts" aria-label="中枢状态事实">
      <div><span>连接状态</span><strong><StatusLabel state={sourceState} />{statusLabel}</strong></div>
      <div><span>数据来源</span><strong>{sourceLabel}</strong></div>
      <div><span>最近同步</span><strong>{snapshot ? new Date(snapshot.generatedAt).toLocaleString() : "尚未同步"}</strong></div>
      <div><span>目录范围</span><strong>{hub.devices.length} 个实例 · {online} 个 Agent 在线</strong></div>
    </div>
    <div className="workspace-inline-note" role="status"><Icon name="info" size={15} />{readonlyReason}</div>
    <DeviceDirectoryFilterBar
      devices={hub.devices}
      query={query}
      onQueryChange={setQuery}
      typeFilter={typeFilter}
      onTypeFilterChange={setTypeFilter}
      statusFilter={statusFilter}
      onStatusFilterChange={setStatusFilter}
      sort={sort}
      onSortChange={setSort}
    />
    <Surface className="workspace-directory-surface workspace-hub-directory">
      <div className="workspace-surface__header"><div><span className="workspace-section-kicker">只读目录</span><h3>{visibleDevices.length} / {hub.devices.length} 个实例</h3></div><Button variant="quiet" onClick={() => openSettings(settingsSection)}>{capabilities.canConfigureConnection ? "连接设置" : "中枢设置"}</Button></div>
      <DeviceDirectoryHeader />
      <div className="workspace-device-rows" role="rowgroup">
        {visibleDevices.length ? visibleDevices.map((device) => <DeviceRow key={device.deviceId} device={device} />) : <EmptyState title="没有匹配设备" detail="尝试清空搜索或调整类型、状态筛选。" action={<Button variant="quiet" onClick={() => { setQuery(""); setTypeFilter("all"); setStatusFilter("all"); }}>清除筛选</Button>} />}
      </div>
    </Surface>
  </div>;
}
