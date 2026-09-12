import React from "react";
import { useWorkspace, type SettingsSection } from "../WorkspaceContext";
import { Button, Icon, StatusLabel, Surface } from "../ui";
import { EmptyState, DeviceRow, PageIntro } from "./shared";

export function HubPage() {
  const { hubs, route, navigate, openSettings, capabilities } = useWorkspace();
  const hub = hubs.find((item) => item.id === (route.kind === "hub" ? route.hubId : "")) ?? hubs[0];
  if (!hub) return <EmptyState title="没有配置中枢" detail="添加一个中枢后，设备会显示在侧边栏。" action={<Button variant="primary" onClick={() => openSettings(capabilities.canConfigureConnection ? "connections" : "workspace")}>{capabilities.canConfigureConnection ? "添加中枢" : "查看中枢设置"}</Button>} />;
  const online = hub.devices.filter((device) => device.status === "online").length;
  const allVirtualMachines = hub.devices.length > 0 && hub.devices.every((device) => device.instanceType === "virtual_machine");
  const onlineLabel = allVirtualMachines ? "Agent 在线" : "在线";
  const settingsSection: SettingsSection = capabilities.canConfigureConnection ? "connections" : "workspace";
  const settingsLabel = capabilities.canConfigureConnection ? "管理连接" : "查看中枢设置";
  return <div className="workspace-page"><PageIntro eyebrow="中枢" title={hub.name} description={hub.endpoint} actions={<><Button variant="quiet" onClick={() => navigate({ kind: "overview" })}><Icon name="back" size={16} />返回总览</Button><Button variant="primary" onClick={() => openSettings(settingsSection)}><Icon name="settings" size={16} />{settingsLabel}</Button></>} /><div className="workspace-hub-hero"><div><StatusLabel state={hub.state === "online" ? "online" : hub.state === "cached" ? "cached" : hub.state === "offline" ? "warning" : "unknown"} /><strong>{hub.state === "online" ? "连接正常" : hub.state === "cached" ? "正在显示缓存" : "需要检查连接"}</strong><p>{online} 个实例 Agent 在线，共 {hub.devices.length} 个实例。</p></div><div className="workspace-hub-hero__stat"><span>实例</span><strong>{hub.devices.length}</strong></div><div className="workspace-hub-hero__stat"><span>{onlineLabel}</span><strong>{online}</strong></div></div><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">实例列表</span><h3>{hub.devices.length} 个实例</h3></div><Button variant="quiet" onClick={() => openSettings(settingsSection)}>{capabilities.canConfigureConnection ? "连接设置" : "中枢设置"}</Button></div><div className="workspace-device-rows">{hub.devices.map((device) => <DeviceRow key={device.deviceId} device={device} />)}</div></Surface></div>;
}
