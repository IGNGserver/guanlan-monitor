import React from "react";
import { useWorkspace, type SettingsSection } from "../WorkspaceContext";
import { Button, Icon, StatusLabel, Surface } from "../ui";
import { selectSnapshotSource } from "../selectors";
import { EmptyState, PageIntro } from "./shared";

export function HubPage() {
  const { snapshot, hubs, route, navigate, openSettings, capabilities } = useWorkspace();
  const hub = hubs.find((item) => item.id === (route.kind === "hub" ? route.hubId : "")) ?? hubs[0];
  if (!hub) return <EmptyState title="没有配置中枢" detail="配置一个中枢连接后，这里会显示它提供的设备目录。" action={<Button variant="primary" onClick={() => openSettings(capabilities.canConfigureConnection ? "connections" : "workspace")}>{capabilities.canConfigureConnection ? "添加中枢" : "查看中枢设置"}</Button>} />;

  const source = snapshot ? selectSnapshotSource(snapshot, hub.devices) : "unknown";
  const sourceState: "online" | "offline" | "cached" | "warning" | "unknown" = source === "live" ? "online" : source === "cache" ? "cached" : source === "unknown" ? "warning" : "unknown";
  const sourceLabel = source === "live" ? "实时连接" : source === "cache" ? "离线缓存" : source === "empty" ? "等待数据" : "连接异常";
  const statusLabel = source === "live" ? "连接正常" : source === "cache" ? "正在显示缓存" : source === "empty" ? "暂无设备数据" : "需要检查连接";
  const online = hub.devices.filter((device) => device.status === "online").length;
  const settingsSection: SettingsSection = capabilities.canConfigureConnection ? "connections" : "workspace";
  const settingsLabel = capabilities.canConfigureConnection ? "管理连接" : "查看中枢设置";
  const statusReason = source === "cache"
    ? "当前显示离线缓存；设备目录中的顺序和删除操作会在恢复实时连接后可用。"
    : source === "live"
      ? "这里专注于中枢连接和同步状态；设备搜索、筛选、排序和管理统一在设备目录完成。"
      : "当前还没有可写的实时连接；先完成连接后再查看设备目录。";

  return <div className="workspace-page workspace-page--hub">
    <PageIntro
      eyebrow="中枢"
      title={hub.name}
      description={hub.endpoint}
      actions={<><Button variant="quiet" onClick={() => navigate({ kind: "overview" })}><Icon name="back" size={16} />返回总览</Button><Button variant="quiet" onClick={() => navigate({ kind: "devices" })}>查看设备目录<Icon name="arrow" size={16} /></Button><Button variant="primary" onClick={() => openSettings(settingsSection)}><Icon name="settings" size={16} />{settingsLabel}</Button></>}
    />
    <div className="workspace-hub-facts" aria-label="中枢状态事实">
      <div><span>连接状态</span><strong><StatusLabel state={sourceState} />{statusLabel}</strong></div>
      <div><span>数据来源</span><strong>{sourceLabel}</strong></div>
      <div><span>最近同步</span><strong>{snapshot ? new Date(snapshot.generatedAt).toLocaleString() : "尚未同步"}</strong></div>
      <div><span>目录范围</span><strong>{hub.devices.length} 个实例 · {online} 个 Agent 在线</strong></div>
    </div>
    <div className="workspace-inline-note" role="status"><Icon name="about" size={15} />{statusReason}</div>
    <Surface className="workspace-hub-next-step">
      <div className="workspace-surface__header"><div><span className="workspace-section-kicker">下一步</span><h3>{hub.devices.length ? "从设备目录开始处理实例" : "先让中枢拿到第一台设备"}</h3></div><Button variant="primary" onClick={() => hub.devices.length ? navigate({ kind: "devices" }) : openSettings(settingsSection)}>{hub.devices.length ? "打开设备目录" : settingsLabel}<Icon name="arrow" size={16} /></Button></div>
      <p className="workspace-surface__description">设备目录是唯一的设备管理入口：搜索、类型和状态筛选、排序、顺序调整以及删除都在同一处完成，避免在中枢状态页重复操作。</p>
    </Surface>
    {!hub.devices.length && <EmptyState title="还没有可显示的设备" detail="配置中枢访问地址和密钥后，等待 Agent 完成一次上报，再回到设备目录查看实例。" action={<Button variant="quiet" onClick={() => openSettings(settingsSection)}>{settingsLabel}</Button>} />}
  </div>;
}
