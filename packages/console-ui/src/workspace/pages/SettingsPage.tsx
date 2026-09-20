import React, { useEffect, useRef, useState } from "react";
import type { AgentProbeProvider, AgentProbeTarget, DeviceBlockKey, DeviceMetricKey, DesktopDetectedTargetGroup } from "@dsc/shared";
import { useWorkspace, type SettingsSection } from "../WorkspaceContext";
import { M3Checkbox, M3SegmentedControl, M3Select, M3Switch, M3TextField } from "../m3";
import { Button, Icon, StatusLabel, Surface, SummaryRow } from "../ui";
import { formatBytes, formatDate, formatPreciseDateTime } from "../formatters";
import { selectSnapshotSource } from "../selectors";
import { formatWorkspaceError } from "../context/WorkspaceTypes";
import { settingsNavigation } from "../shell/PrimaryNavigation";
import {
  AgentTemperatureSourcesPanel,
  InstanceMetricOverride,
  PageIntro,
  appIconSrc,
  instanceMetricOptions,
  metricGroups,
  mergeFanMetricSeries,
  probeProviderLabels,
  probeTargetLabels
} from "./shared";

export function SettingsPage() {
  const { route, capabilities, closeSettings, navigate } = useWorkspace();
  const section: SettingsSection = route.kind === "settings"
    ? route.section
    : capabilities.canControlNativeWindow ? "general" : "workspace";
  const pages: Record<SettingsSection, React.ReactNode> = {
    general: <GeneralSettings />,
    workspace: capabilities.canControlNativeWindow ? <GeneralSettings /> : <WebWorkspaceSettings />,
    appearance: <AppearanceSettings />,
    connections: capabilities.canConfigureConnection ? <ConnectionSettings /> : <WebSessionSettings />,
    agent: capabilities.canManageLocalAgent ? <AgentSettings /> : <WebWorkspaceSettings />,
    data: <DataSettings />,
    shortcuts: <ShortcutSettings />,
    session: capabilities.canConfigureConnection ? <ConnectionSettings /> : <WebSessionSettings />,
    about: <AboutSettings />
  };
  const heading = settingsNavigation(capabilities).find((item) => item.id === section);
  const descriptions: Partial<Record<SettingsSection, string>> = {
    general: "调整观澜的日常行为。",
    workspace: "浏览器端的刷新、实例筛选和中枢状态。",
    appearance: "调整工作区的主题、密度和动画适配。",
    session: "管理当前浏览器会话和访问边界。",
    data: "查看实时数据来源与版本信息。",
    shortcuts: "用键盘快速切换页面和刷新状态。",
    about: "查看观澜中枢的版本与项目链接。"
  };
  const visibleSettings = settingsNavigation(capabilities).filter((item) => {
    if (item.id === "agent") return capabilities.canManageLocalAgent;
    if (item.id === "connections") return capabilities.canConfigureConnection;
    return true;
  });
  return <div className="workspace-page workspace-page--settings">
    <div className="workspace-settings-mobile-nav" aria-label="设置分类">
      <Button variant="quiet" onClick={closeSettings}><Icon name="back" size={16} />返回控制台</Button>
      <div className="workspace-settings-mobile-nav__list">
        {visibleSettings.map((item) => <button type="button" className={item.id === section ? "is-selected" : ""} key={item.id} onClick={() => navigate({ kind: "settings", section: item.id })}>{item.label}</button>)}
      </div>
    </div>
    <PageIntro eyebrow="设置" title={heading?.label ?? "设置"} description={descriptions[section]} />{pages[section]}
  </div>;
}

function WebWorkspaceSettings() {
  const { snapshot, hubs, allDevices, instanceType, setInstanceType, refreshInterval, setRefreshInterval, refresh, refreshing, mutationPending } = useWorkspace();
  const hub = hubs[0];
  const online = allDevices.filter((device) => device.status === "online").length;
  const source = snapshot ? selectSnapshotSource(snapshot, allDevices) : "unknown";
  const state = source === "live" ? "online" : source === "cache" ? "cached" : source === "unknown" ? "warning" : "unknown";
  const stateLabel = state === "online" ? "连接正常" : state === "cached" ? "显示缓存" : "等待同步";
  return (
    <div className="workspace-settings-stack workspace-web-settings">
      <div className="workspace-web-settings__status">
        <div className="workspace-web-settings__status-main">
          <StatusLabel state={state} />
          <strong>{stateLabel}</strong>
          <p>{hub?.name ?? "观澜中枢"} · 浏览器端通过当前站点读取实时设备状态。</p>
        </div>
        <div className="workspace-web-settings__stat"><span>实例</span><strong>{allDevices.length}</strong></div>
        <div className="workspace-web-settings__stat"><span>在线</span><strong>{online}</strong></div>
        <div className="workspace-web-settings__stat"><span>同步</span><strong>{snapshot ? formatDate(snapshot.generatedAt) : "等待"}</strong></div>
      </div>

      <div className="workspace-web-settings__grid">
        <Surface>
          <div className="workspace-surface__header"><div><span className="workspace-section-kicker">中枢状态偏好</span><h3>浏览器显示与刷新</h3></div></div>
          <div className="workspace-settings-list">
            <SettingRow label="状态刷新频率" description="只影响当前网页读取状态的频率，不改变 Agent 的采样间隔。"><M3SegmentedControl className="workspace-setting-segmented" options={[{ value: "5", label: "5 秒" }, { value: "10", label: "10 秒" }, { value: "30", label: "30 秒" }]} value={String(refreshInterval)} onChange={(value) => setRefreshInterval(Number(value) as typeof refreshInterval)} aria-label="状态刷新频率" disabled={mutationPending} /></SettingRow>
            <SettingRow label="总览观察范围" description="健康结论始终覆盖全部实例；默认自动显示所有类型，也可以只看普通设备或虚拟机。"><M3SegmentedControl className="workspace-setting-segmented" options={[{ value: "all", label: "全部" }, { value: "device", label: "普通设备" }, { value: "virtual_machine", label: "虚拟机" }]} value={instanceType} onChange={(value) => setInstanceType(value as typeof instanceType)} aria-label="总览观察范围" /></SettingRow>
          </div>
        </Surface>

        <Surface>
          <div className="workspace-surface__header"><div><span className="workspace-section-kicker">中枢状态</span><h3>当前数据链路</h3></div><StatusLabel state={state} /></div>
          <div className="workspace-detail-list"><SummaryRow label="数据来源" value={source === "live" ? "实时中枢" : source === "cache" ? "缓存" : source === "empty" ? "等待数据" : "连接异常"} /><SummaryRow label="最近同步" value={snapshot ? formatPreciseDateTime(snapshot.generatedAt) : "尚未同步"} /><SummaryRow label="接入实例" value={`${allDevices.length} 个`} /></div>
          <div className="workspace-form__actions"><Button variant="quiet" onClick={() => void refresh()} disabled={refreshing || mutationPending}><Icon name="refresh" size={15} />{refreshing ? "正在同步" : "立即同步"}</Button></div>
        </Surface>
      </div>
    </div>
  );
}

function WebSessionSettings() {
  const { snapshot, logout, mutationPending, refresh, refreshing } = useWorkspace();
  const authenticated = snapshot?.session.authenticated ?? false;
  const signOut = async () => {
    await logout();
    if (typeof window !== "undefined") window.location.reload();
  };
  const reloadForAuthentication = () => {
    if (typeof window !== "undefined") window.location.reload();
  };
  return (
    <div className="workspace-settings-stack workspace-web-settings">
      <Surface>
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">当前会话</span><h3>{authenticated ? "浏览器会话已认证" : "会话需要重新认证"}</h3></div><StatusLabel state={authenticated ? "online" : "warning"} /></div>
        <div className="workspace-detail-list"><SummaryRow label="认证方式" value="中枢访问密钥" /><SummaryRow label="会话范围" value="当前浏览器" /><SummaryRow label="访问权限" value="已授权设备与指标" /></div>
        {!authenticated && <div className="workspace-session-recovery m3-inline-banner" role="alert"><div className="workspace-session-recovery__copy"><strong>当前会话不可用</strong><p>站点认证可能已过期，重新认证会保留当前页面地址。</p></div><div className="workspace-form__actions"><Button variant="primary" onClick={reloadForAuthentication}>重新认证</Button><Button variant="quiet" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "正在检查" : "重新检查"}</Button></div></div>}
        <div className="workspace-form__actions"><Button variant="danger" onClick={() => void signOut()} disabled={!authenticated || mutationPending}>{mutationPending ? "正在退出" : "退出当前会话"}</Button></div>
      </Surface>
      <Surface className="workspace-connection-note">
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">网页端边界</span><h3>中枢地址由站点提供</h3></div></div>
        <p className="workspace-surface__description">浏览器端不保存桌面连接地址，也不管理本机 Agent。页面只使用当前站点的认证会话访问中枢，并通过实时通道接收设备更新。</p>
      </Surface>
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return <div className="workspace-setting-row"><div><strong>{label}</strong>{description && <p>{description}</p>}</div><div className="workspace-setting-row__control">{children}</div></div>;
}

function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return <M3Switch className="workspace-m3-toggle" compact checked={checked} onCheckedChange={onChange} label={label} disabled={disabled} />;
}

function GeneralSettings() {
  const { snapshot, updateStartupSettings, mutationPending, refreshInterval, setRefreshInterval, capabilities } = useWorkspace();
  if (!capabilities.canChangeStartupSettings) return <WebWorkspaceSettings />;
  const startup = snapshot?.startup ?? { openAtLogin: false, startMinimized: false };
  return (
    <Surface>
      <div className="workspace-settings-list">
        <M3Switch label="开机启动" description="登录系统后自动启动观澜。" checked={startup.openAtLogin} onCheckedChange={(checked) => void updateStartupSettings({ openAtLogin: checked })} disabled={mutationPending} />
        <M3Switch label="启动时最小化" description="启动后保持在系统托盘，不打断当前工作。" checked={startup.startMinimized} onCheckedChange={(checked) => void updateStartupSettings({ startMinimized: checked })} disabled={mutationPending} />
        <SettingRow label="数据刷新频率" description="实时连接下，桌面端自动刷新状态的间隔；不改变 Agent 的采样频率。"><M3SegmentedControl className="workspace-setting-segmented" options={[{ value: "5", label: "5 秒" }, { value: "10", label: "10 秒" }, { value: "30", label: "30 秒" }]} value={String(refreshInterval)} onChange={(value) => setRefreshInterval(Number(value) as typeof refreshInterval)} aria-label="数据刷新频率" disabled={mutationPending} /></SettingRow>
      </div>
    </Surface>
  );
}

function AppearanceSettings() {
  const { theme, setTheme, density, setDensity } = useWorkspace();
  return (
    <Surface>
      <div className="workspace-settings-list">
        <SettingRow label="主题" description="跟随系统，或固定使用浅色/深色主题。"><M3SegmentedControl className="workspace-setting-segmented" options={[{ value: "system", label: "跟随系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色" }]} value={theme} onChange={(value) => setTheme(value as typeof theme)} aria-label="主题" /></SettingRow>
        <SettingRow label="界面密度" description="自动会根据触摸输入和窗口尺寸放大操作目标；远控手机时可手动选择触摸。"><M3SegmentedControl className="workspace-setting-segmented" options={[{ value: "auto", label: "自动" }, { value: "comfortable", label: "舒适" }, { value: "compact", label: "紧凑" }, { value: "touch", label: "触摸" }]} value={density} onChange={(value) => setDensity(value as typeof density)} aria-label="界面密度" /></SettingRow>
        <SettingRow label="动画" description="尊重系统的减少动态效果设置。"><span className="workspace-setting-note"><Icon name="check" size={15} />已启用可访问性适配</span></SettingRow>
      </div>
    </Surface>
  );
}

function ConnectionSettings() {
  const { snapshot, saveHubConnection, logout, disconnectAgent, mutationPending } = useWorkspace();
  const [serverUrl, setServerUrl] = useState(snapshot?.localBackend?.config.connection.serverUrl ?? "");
  const [accessKey, setAccessKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ serverUrl?: string; accessKey?: string }>({});
  const [formError, setFormError] = useState("");
  const authenticated = snapshot?.session.authenticated ?? false;
  const agentConfigured = Boolean(snapshot?.localBackend?.config.connection.secretConfigured);
  const agentRunning = snapshot?.localBackend?.running ?? false;
  useEffect(() => {
    setServerUrl(snapshot?.localBackend?.config.connection.serverUrl ?? "");
  }, [snapshot?.localBackend?.config.connection.serverUrl]);
  const validateConnection = () => {
    const nextErrors: { serverUrl?: string; accessKey?: string } = {};
    const nextServerUrl = serverUrl.trim();
    if (!nextServerUrl) {
      nextErrors.serverUrl = "请输入中枢地址。";
    } else {
      try {
        const parsed = new URL(nextServerUrl);
        if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
          nextErrors.serverUrl = "地址必须使用 http:// 或 https://，并包含主机名。";
        }
      } catch {
        nextErrors.serverUrl = "请输入完整地址，例如 https://hub.example.com。";
      }
    }
    if (!accessKey.trim() && !snapshot?.session.accessKeyConfigured) {
      nextErrors.accessKey = "首次连接需要输入访问密钥。";
    }
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };
  const saveConnection = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (!validateConnection()) return;
    setSaving(true);
    try {
      const saved = await saveHubConnection(serverUrl, accessKey);
      if (saved) {
        setAccessKey("");
        setFieldErrors({});
      } else {
        setFormError("连接未保存，请检查中枢地址、访问密钥和服务状态后重试。");
      }
    } finally {
      setSaving(false);
    }
  };
  const disconnect = async () => {
    const stopped = await disconnectAgent();
    if (stopped) setDisconnectConfirmOpen(false);
  };
  return (
    <div className="workspace-settings-stack">
      <Surface>
        <div className="workspace-surface__header">
          <div><span className="workspace-section-kicker">中枢连接</span><h3>{authenticated ? "已连接" : "需要认证"}</h3></div>
          <StatusLabel state={authenticated ? "online" : "warning"} />
        </div>
        <form className="workspace-form workspace-connection-form" onSubmit={saveConnection} noValidate>
          <M3TextField
            label="中枢地址"
            type="url"
            value={serverUrl}
            onChange={(event) => { setServerUrl(event.target.value); setFieldErrors((current) => ({ ...current, serverUrl: undefined })); setFormError(""); }}
            placeholder="https://hub.example.com"
            autoComplete="url"
            errorText={fieldErrors.serverUrl}
            supportingText="必须包含 http:// 或 https:// 协议。"
            required
          />
          <M3TextField
            label="访问密钥"
            type="password"
            value={accessKey}
            onChange={(event) => { setAccessKey(event.target.value); setFieldErrors((current) => ({ ...current, accessKey: undefined })); setFormError(""); }}
            placeholder={snapshot?.session.accessKeyConfigured ? "已保存，留空保留当前认证" : "输入中枢访问密钥"}
            autoComplete="current-password"
            errorText={fieldErrors.accessKey}
            supportingText={snapshot?.session.accessKeyConfigured ? "已配置访问密钥；留空会保留当前认证。" : "访问密钥只会发送到桌面主进程，不会进入页面状态或日志。"}
            required={!snapshot?.session.accessKeyConfigured}
          />
          {formError && <div className="workspace-form__error" role="alert">{formError}</div>}
          <p className="workspace-form__hint">地址和访问密钥会在同一次保存中提交；保存按钮会先写入地址，再用同一地址完成认证。</p>
          <div className="workspace-form__actions">
            <Button variant="primary" type="submit" disabled={saving || mutationPending}>{saving ? "正在保存…" : authenticated ? "保存连接" : "保存并连接"}</Button>
            {authenticated && <Button variant="quiet" onClick={() => void logout()} disabled={saving || mutationPending}>退出桌面查看</Button>}
          </div>
        </form>
      </Surface>
      <Surface className="workspace-connection-note">
        <div className="workspace-surface__header">
          <div><span className="workspace-section-kicker">本机上报</span><h3>{agentRunning ? "Agent 正在采集" : agentConfigured ? "Agent 已配置但未运行" : "Agent 未配置"}</h3></div>
          <StatusLabel state={agentRunning ? "online" : agentConfigured ? "warning" : "unknown"} />
        </div>
        <p className="workspace-surface__description">退出桌面查看只会结束当前界面的中枢认证，本机 Agent 仍可能继续采集和上报。如果要停止本机上报，会停止采集、关闭云同步并清除本机保存的上报凭据。</p>
        {agentConfigured && <div className="workspace-form__actions"><Button variant="danger" onClick={() => setDisconnectConfirmOpen(true)} disabled={mutationPending}>停止本机上报</Button></div>}
        {disconnectConfirmOpen && <div className="workspace-danger-note" role="alert"><strong>确认停止本机上报？</strong><p>这会停止 Agent、关闭云同步并清除上报凭据；之后需要重新配置连接才能恢复。</p><div className="workspace-form__actions"><Button variant="danger" onClick={() => void disconnect()} disabled={mutationPending}>{mutationPending ? "正在停止…" : "停止并清除凭据"}</Button><Button variant="quiet" onClick={() => setDisconnectConfirmOpen(false)} disabled={mutationPending}>取消</Button></div></div>}
      </Surface>
      <Surface>
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">连接诊断</span><h3>如果连接失败</h3></div></div>
        <p className="workspace-surface__description">请确认地址包含协议（例如 https://），中枢服务已启动，并使用中枢访问密钥。保存按钮会先写入地址，再用同一地址完成认证；如果地址未保存，页面会直接提示需要补充中枢地址。</p>
      </Surface>
    </div>
  );
}

function AgentSettings() {
  const { snapshot, controlAgent, updateLocalConfig, cloudPush, refreshing, mutationPending } = useWorkspace();
  const backend = snapshot?.localBackend;
  const config = backend?.config;
  // "service-readonly" means the machine-scope service owns the configuration
  // and this user cannot write it. Explain that instead of offering controls
  // that will fail.
  const agentMode = backend?.agentMode ?? "child";
  const agentReadOnly = agentMode === "service-readonly";
  const agentModeLabel = agentMode === "service"
    ? "系统服务（可管理）"
    : agentReadOnly
      ? "系统服务（只读）"
      : "桌面端托管进程";
  const enabledMetrics = config?.enabledMetrics ?? [];
  const configuredProbes = config?.probeSelections ?? [];
  const supportedProbePlans = Array.isArray(backend?.supportedProbePlans) ? backend.supportedProbePlans : [];
  const detectedTargets = Array.isArray(backend?.detectedTargets) ? backend.detectedTargets : [];
  const [selectedMetrics, setSelectedMetrics] = useState<DeviceMetricKey[]>(enabledMetrics);
  const selectedMetricsRef = useRef<DeviceMetricKey[]>(enabledMetrics);
  const metricSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const [probeSelections, setProbeSelections] = useState(configuredProbes);
  const probeSelectionsRef = useRef(probeSelections);
  const [enabledDeviceIds, setEnabledDeviceIds] = useState<Partial<Record<DeviceBlockKey, string[]>>>(config?.enabledDeviceIds ?? {});
  const enabledDeviceIdsRef = useRef(enabledDeviceIds);
  const [instanceMetricConfig, setInstanceMetricConfig] = useState<Record<string, DeviceMetricKey[]>>(config?.instanceMetricConfig ?? {});
  const instanceMetricConfigRef = useRef(instanceMetricConfig);
  const [agentHostname, setAgentHostname] = useState(config?.connection.hostname ?? "");
  const [normalSamplingSeconds, setNormalSamplingSeconds] = useState(String(config?.sampling.normalIntervalSeconds ?? 30));
  const [slowSamplingSeconds, setSlowSamplingSeconds] = useState(String(config?.sampling.slowIntervalSeconds ?? 30));
  const fanSeries = mergeFanMetricSeries(
    snapshot?.metrics?.latest.fans ?? [],
    snapshot?.metrics?.series?.fans ?? [],
    snapshot?.generatedAt ?? snapshot?.metrics?.lastSeenAt ?? new Date().toISOString()
  );
  const temperatureSources = Array.isArray(backend?.temperatureSources) ? backend.temperatureSources : [];
  const temperatureSensorBackends = Array.isArray(backend?.temperatureSensorBackends) ? backend.temperatureSensorBackends : [];
  const metricDraftKey = enabledMetrics.join("|");
  const probeDraftKey = configuredProbes.map((selection) => `${selection.target}:${selection.provider}:${selection.enabled}`).join("|");
  const deviceDraftKey = JSON.stringify(config?.enabledDeviceIds ?? {});
  const instanceMetricDraftKey = JSON.stringify(config?.instanceMetricConfig ?? {});
  const runtimeDraftKey = `${config?.connection.hostname ?? ""}|${config?.sampling.normalIntervalSeconds ?? 30}|${config?.sampling.slowIntervalSeconds ?? 30}`;
  useEffect(() => {
    selectedMetricsRef.current = enabledMetrics;
    setSelectedMetrics(enabledMetrics);
  }, [metricDraftKey]);
  useEffect(() => {
    setProbeSelections(configuredProbes);
    probeSelectionsRef.current = configuredProbes;
  }, [probeDraftKey]);
  useEffect(() => {
    setEnabledDeviceIds(config?.enabledDeviceIds ?? {});
    enabledDeviceIdsRef.current = config?.enabledDeviceIds ?? {};
  }, [deviceDraftKey]);
  useEffect(() => {
    setInstanceMetricConfig(config?.instanceMetricConfig ?? {});
    instanceMetricConfigRef.current = config?.instanceMetricConfig ?? {};
  }, [instanceMetricDraftKey]);
  useEffect(() => {
    setAgentHostname(config?.connection.hostname ?? "");
    setNormalSamplingSeconds(String(config?.sampling.normalIntervalSeconds ?? 30));
    setSlowSamplingSeconds(String(config?.sampling.slowIntervalSeconds ?? 30));
  }, [runtimeDraftKey]);
  if (!backend || !config) return <EmptyState title="本机 Agent 尚未启动" detail="启动本机服务后才能查看和修改采集设置。" action={<Button variant="primary" onClick={() => void controlAgent("start")}>启动服务</Button>} />;

  const detectedGroups: DesktopDetectedTargetGroup[] = (() => {
    if (!fanSeries.length) return detectedTargets;
    const fanGroup = detectedTargets.find((group) => group.target === "fan");
    if (fanGroup?.instances.length) return detectedTargets;
    const configuredFanIds = enabledDeviceIds.fan;
    const fanInstances = fanSeries.map((fan) => ({
      id: fan.id,
      name: fan.name,
      subtitle: fan.interface,
      enabled: configuredFanIds ? configuredFanIds.includes(fan.id) : true,
      metrics: ["转速"]
    }));
    if (fanGroup) return detectedTargets.map((group) => group.target === "fan" ? { ...group, instances: fanInstances } : group);
    return [...detectedTargets, { target: "fan", label: "风扇实例", instances: fanInstances }];
  })();

  const isInstanceEnabled = (target: AgentProbeTarget, id: string, fallback: boolean) => {
    if (target === "connection") return fallback;
    const configuredIds = enabledDeviceIds[target];
    return configuredIds ? configuredIds.includes(id) : fallback;
  };

  const toggleDetectedInstance = (target: AgentProbeTarget, id: string, enabled: boolean) => {
    if (target === "connection") return;
    const group = detectedGroups.find((item) => item.target === target);
    const fallbackIds = group?.instances.filter((instance) => instance.enabled).map((instance) => instance.id) ?? [];
    const currentIds = enabledDeviceIdsRef.current[target] ?? fallbackIds;
    const nextIds = enabled ? Array.from(new Set([...currentIds, id])) : currentIds.filter((item) => item !== id);
    const nextEnabledDeviceIds = { ...enabledDeviceIdsRef.current, [target]: nextIds };
    enabledDeviceIdsRef.current = nextEnabledDeviceIds;
    setEnabledDeviceIds(nextEnabledDeviceIds);
    // Instance switches are actions in their own right. Persist immediately so
    // leaving and re-entering settings cannot restore the previous selection.
    void updateLocalConfig({ enabledDeviceIds: nextEnabledDeviceIds });
  };

  const updateInstanceMetricConfig = (instanceId: string, value: DeviceMetricKey[] | undefined) => {
    const next = { ...instanceMetricConfigRef.current };
    if (value === undefined) delete next[instanceId];
    else next[instanceId] = value;
    instanceMetricConfigRef.current = next;
    setInstanceMetricConfig(next);
    void updateLocalConfig({ instanceMetricConfig: next });
  };
  const saveRuntimeConfig = () => {
    const normalIntervalSeconds = Math.max(1, Number.parseInt(normalSamplingSeconds, 10) || 30);
    const slowIntervalSeconds = Math.max(1, Number.parseInt(slowSamplingSeconds, 10) || normalIntervalSeconds);
    setNormalSamplingSeconds(String(normalIntervalSeconds));
    setSlowSamplingSeconds(String(slowIntervalSeconds));
    void updateLocalConfig({
      connection: { hostname: agentHostname.trim() },
      sampling: { normalIntervalSeconds, slowIntervalSeconds }
    });
  };
  const toggleMetric = (key: DeviceMetricKey) => {
    const current = selectedMetricsRef.current;
    const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    selectedMetricsRef.current = next;
    setSelectedMetrics(next);
    metricSaveQueueRef.current = metricSaveQueueRef.current
      .catch(() => undefined)
      .then(() => updateLocalConfig({ enabledMetrics: next }))
      .catch(() => undefined);
  };
  const updateProbe = (target: AgentProbeTarget, patch: { provider?: AgentProbeProvider; enabled?: boolean }) => {
    const current = probeSelectionsRef.current;
    const existing = current.find((selection) => selection.target === target);
    const next = existing
      ? current.map((selection) => selection.target === target ? { ...selection, ...patch } : selection)
      : [...current, { target, provider: patch.provider ?? "builtin", enabled: patch.enabled ?? true }];
    probeSelectionsRef.current = next;
    setProbeSelections(next);
    void updateLocalConfig({ probeSelections: next });
  };
  return (
    <div className="workspace-settings-stack">
      <Surface>
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">服务状态</span><h3>本机 Agent</h3></div><StatusLabel state={backend.running ? "online" : "offline"} /></div>
        {agentReadOnly && <p className="workspace-surface__description">本机 Agent 由系统级服务运行（开机自启、无需登录），当前用户没有修改权限。请在管理员终端执行 <code>guanlan-agent config set --hub &lt;中枢地址&gt; --key-stdin</code>，或以管理员身份重新打开本应用后再修改设置。</p>}
        {agentMode === "service" && <p className="workspace-surface__description">本机 Agent 由系统级服务运行，关闭本应用或注销登录后仍会继续采集与上报。</p>}
        <div className="workspace-agent-actions"><Button variant="primary" onClick={() => void controlAgent(backend.running ? "stop" : "start")} disabled={refreshing || mutationPending || agentReadOnly}>{backend.running ? "停止服务" : "启动服务"}</Button><Button variant="quiet" onClick={() => void controlAgent("restart")} disabled={refreshing || mutationPending || agentReadOnly}>重启服务</Button><Button variant="quiet" onClick={() => void controlAgent("check-connection")} disabled={refreshing || mutationPending || agentReadOnly}>检查连接</Button><Button variant="quiet" onClick={() => void controlAgent("detect-probes")} disabled={refreshing || mutationPending || agentReadOnly}>重新检测硬件</Button></div>
        <div className="workspace-detail-list"><SummaryRow label="运行方式" value={agentModeLabel} /><SummaryRow label="连接状态" value={backend.connectionStatus} /><SummaryRow label="上传间隔" value={`${backend.effectiveUploadIntervalSeconds} 秒`} /><SummaryRow label="待上传样本" value={backend.pendingSampleCount ? `${backend.pendingSampleCount} 条 · ${formatBytes(backend.pendingBytes)}` : "0 条"} /><SummaryRow label="配置文件" value={backend.configFileExists ? "已找到" : "未找到"} />{backend.lastUploadError && <SummaryRow label="最近上传问题" value={formatWorkspaceError(new Error(backend.lastUploadError), "本机 Agent 上报失败，请检查连接和配置")}/>}</div>
      </Surface>
      <Surface>
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">Agent 身份与节奏</span><h3>设备显示名与采样间隔</h3></div></div>
        <div className="workspace-form workspace-agent-runtime-form">
          <M3TextField label="设备显示名" value={agentHostname} onChange={(event) => setAgentHostname(event.target.value)} placeholder="例如：办公室主机" maxLength={120} />
          <div className="workspace-form__grid"><M3TextField label="正常采样间隔（秒）" type="number" min="1" max="86400" value={normalSamplingSeconds} onChange={(event) => setNormalSamplingSeconds(event.target.value)} /><M3TextField label="降级采样间隔（秒）" type="number" min="1" max="86400" value={slowSamplingSeconds} onChange={(event) => setSlowSamplingSeconds(event.target.value)} /></div>
          <p className="workspace-form__hint">采样间隔决定 Agent 多久采集一次数据；桌面端“数据刷新频率”只决定界面多久读取一次状态，两者互不替代。</p>
          <div className="workspace-form__actions"><Button variant="primary" onClick={saveRuntimeConfig} disabled={refreshing || mutationPending || agentReadOnly}>保存 Agent 设置</Button></div>
        </div>
      </Surface>
      <Surface>
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">采集策略</span><h3>本机行为</h3></div></div>
        <div className="workspace-settings-list"><SettingRow label="自动启动采集" description="Agent 启动后自动开始采集硬件数据。"><Toggle checked={config.autoStartCollector} onChange={(checked) => void updateLocalConfig({ autoStartCollector: checked })} label="自动启动采集" disabled={mutationPending || agentReadOnly} /></SettingRow><SettingRow label="异常时自动重启" description="采集器异常退出后自动尝试恢复。"><Toggle checked={config.autoRestartCollector} onChange={(checked) => void updateLocalConfig({ autoRestartCollector: checked })} label="异常时自动重启" disabled={mutationPending || agentReadOnly} /></SettingRow><SettingRow label="采集与本地记录" description="关闭后停止采集器，不再生成新的本机样本。"><Toggle checked={config.dataRecordingEnabled} onChange={(checked) => void updateLocalConfig({ dataRecordingEnabled: checked })} label="采集与本地记录" disabled={mutationPending || agentReadOnly} /></SettingRow><SettingRow label="上传到中枢" description="允许本机 Agent 将采样数据上传到当前中枢；关闭后仍可保留本地配置。"><Toggle checked={config.cloudSyncEnabled} onChange={(checked) => void updateLocalConfig({ cloudSyncEnabled: checked })} label="上传到中枢" disabled={mutationPending || agentReadOnly} /></SettingRow></div>
      </Surface>
      <Surface className="workspace-collection-surface">
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">上报数据</span><h3>选择 Agent 采集内容</h3></div><span className="workspace-caption">已选 {selectedMetrics.length} 项</span></div>
        <p className="workspace-surface__description">指标、探针来源和实例覆盖都会立即保存，离开页面后仍会保留。启用某个硬件探针时，Agent 可能自动补齐该探针运行所需的依赖指标；“同步到中枢”仍需单独执行。</p>
        <div className="workspace-metric-option-grid">{metricGroups.map((group) => <div className="workspace-metric-option-group" key={group.label}><strong>{group.label}</strong>{group.items.map((item) => <M3Checkbox compact className="workspace-check-row" key={item.key} checked={selectedMetrics.includes(item.key)} onCheckedChange={() => toggleMetric(item.key)} label={item.label} />)}</div>)}</div>
        <div className="workspace-probe-config"><div className="workspace-probe-config__header"><div><strong>硬件探针</strong><span>更换探针来源或启停探针后会立即保存；下方再决定每个实例是否上报。</span></div></div>{supportedProbePlans.map((plan) => { const selection = probeSelections.find((item) => item.target === plan.target); const providers = plan.providers.filter((provider): provider is AgentProbeProvider => provider in probeProviderLabels); const selectedProvider = selection?.provider && providers.includes(selection.provider) ? selection.provider : providers.includes(plan.default as AgentProbeProvider) ? plan.default as AgentProbeProvider : providers[0]; return <div className="workspace-probe-row" key={plan.target}><div><strong>{probeTargetLabels[plan.target]}</strong><small>{selection?.enabled === false ? "已停用" : "已启用"}</small></div><M3Select label="探针来源" hideLabel selectClassName="workspace-select workspace-select--small" value={selectedProvider ?? "disabled"} onChange={(event) => updateProbe(plan.target, { provider: event.target.value as AgentProbeProvider })} disabled={!providers.length || mutationPending || agentReadOnly} options={providers.map((provider) => ({ value: provider, label: probeProviderLabels[provider] }))} /><Toggle checked={selection?.enabled ?? true} onChange={(enabled) => updateProbe(plan.target, { enabled })} label={`${probeTargetLabels[plan.target]} 探针`} disabled={mutationPending || agentReadOnly} /></div>; })}</div>
        <div className="workspace-form__actions"><Button variant="quiet" onClick={() => void cloudPush()} disabled={refreshing || mutationPending || agentReadOnly}>同步到中枢</Button></div>
      </Surface>
      <Surface>
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">检测结果</span><h3>已发现硬件</h3><p className="workspace-surface__description">关闭某个实例或修改它的指标覆盖后会立即写入本机配置。</p></div><span className="workspace-caption">{detectedGroups.reduce((count, group) => count + group.instances.length, 0)} 个实例</span></div>
        {detectedGroups.length ? <div className="workspace-detected-list">{detectedGroups.map((group) => <div className="workspace-detected-group" key={group.target}><strong>{group.label}</strong>{group.instances.map((instance) => { const enabled = isInstanceEnabled(group.target, instance.id, instance.enabled); return <div className="workspace-detected-row" key={instance.id}><div className="workspace-detected-row__identity"><strong>{instance.name}</strong>{instance.subtitle && <small>{instance.subtitle}</small>}<InstanceMetricOverride target={group.target} instanceId={instance.id} globalMetrics={selectedMetrics} override={instanceMetricConfig[instance.id]} onChange={(value) => updateInstanceMetricConfig(instance.id, value)} disabled={mutationPending || agentReadOnly} /></div><div className="workspace-detected-row__control"><small className={enabled ? "is-enabled" : "is-disabled"}>{enabled ? "上报中" : "不上传"}</small><Toggle checked={enabled} onChange={(checked) => toggleDetectedInstance(group.target, instance.id, checked)} label={`${instance.name} 上报`} disabled={mutationPending || agentReadOnly} /></div></div>; })}</div>)}</div> : <div className="workspace-muted-block">尚未检测到硬件探针，请点击“重新检测硬件”。</div>}
      </Surface>
      <AgentTemperatureSourcesPanel sensors={temperatureSources} backends={temperatureSensorBackends} probeError={backend.temperatureProbeError} />
    </div>
  );
}

function DataSettings() {
  const { snapshot, openExternal, capabilities } = useWorkspace();
  const update = snapshot?.update;
  const sourceLabel = snapshot?.source === "cache" ? "离线缓存" : snapshot?.source === "live" ? capabilities.canUseOfflineCache ? "实时连接" : "实时中枢" : "无数据";
  return <div className="workspace-settings-stack"><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">同步状态</span><h3>数据与更新</h3></div></div><div className="workspace-detail-list"><SummaryRow label="数据来源" value={sourceLabel} /><SummaryRow label={capabilities.canUseOfflineCache ? "缓存时间" : "最近同步"} value={capabilities.canUseOfflineCache ? formatDate(snapshot?.cache.savedAt) : formatPreciseDateTime(snapshot?.generatedAt)} />{capabilities.canUseOfflineCache && <SummaryRow label="缓存年龄" value={snapshot?.cache.ageSeconds == null ? "无" : `${snapshot.cache.ageSeconds} 秒`} />}<SummaryRow label="当前版本" value={update?.currentVersion ?? "未知"} /></div></Surface><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">版本</span><h3>{update?.available ? `可用更新：${update.latestVersion}` : "当前已是最新版本"}</h3></div>{update?.available && <StatusLabel state="warning" />}</div>{update?.message && <p className="workspace-surface__description">{update.message}</p>}{update?.releaseUrl && <Button variant="quiet" onClick={() => void openExternal(update.releaseUrl!)}>查看更新说明<Icon name="external" size={15} /></Button>}</Surface></div>;
}

function ShortcutSettings() {
  const shortcuts = [["/ 或 Ctrl/⌘ + K", "打开搜索和命令面板"], ["F5 或 Ctrl/⌘ + R", "刷新设备状态"], ["Esc", "关闭当前弹层"], ["Ctrl/⌘ + B", "折叠侧边栏"], ["Ctrl/⌘ + ,", "打开设置"]];
  return <Surface><div className="workspace-shortcut-list">{shortcuts.map(([key, description]) => <div className="workspace-shortcut-row" key={key}><kbd>{key}</kbd><span>{description}</span></div>)}</div></Surface>;
}

function AboutSettings() {
  const { snapshot, openExternal } = useWorkspace();
  return <Surface><div className="workspace-about"><div className="workspace-about__mark-wrap"><img className="workspace-about__mark-img" src={appIconSrc} alt="观澜" /></div><h3>观澜设备状态控制台</h3><p>面向本机 Agent 和接入中枢的状态工作区。</p><div className="workspace-detail-list"><SummaryRow label="版本" value={snapshot?.update?.currentVersion ?? "开发版本"} /><SummaryRow label="发布通道" value={snapshot?.update?.currentChannel ?? "测试"} /></div><div className="workspace-form__actions"><Button variant="quiet" onClick={() => void openExternal("https://github.com/IGNGserver/guanlan-monitor")}><Icon name="external" size={15} />项目主页</Button><Button variant="quiet" onClick={() => void openExternal("https://github.com/IGNGserver/guanlan-monitor/issues")}><Icon name="external" size={15} />报告问题</Button></div></div></Surface>;
}

function LoadingSurface() {
  return <div className="workspace-page workspace-loading-state" role="status" aria-busy="true" aria-label="正在加载设备状态"><span className="workspace-visually-hidden">正在加载设备状态</span><div className="workspace-skeleton workspace-skeleton--hero" /><div className="workspace-skeleton workspace-skeleton--large" /><div className="workspace-skeleton workspace-skeleton--medium" /></div>;
}

function EmptyState({ title, detail, action, tone = "neutral" }: { title: string; detail: string; action?: React.ReactNode; tone?: "neutral" | "error" }) {
  return <section className={`workspace-empty m3-state-surface m3-state-surface--${tone}`} role={tone === "error" ? "alert" : "status"}><div className="workspace-empty__mark"><Icon name={tone === "error" ? "warning" : "overview"} size={22} /></div><h3>{title}</h3><p>{detail}</p>{action}</section>;
}

function ErrorSurface({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return <EmptyState tone="error" title={title} detail={detail} action={<Button variant="primary" onClick={onRetry}><Icon name="refresh" size={16} />重试</Button>} />;
}
