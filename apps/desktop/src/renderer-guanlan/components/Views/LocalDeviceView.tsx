import React, { useState, useEffect } from "react";
import { useGuanlan } from "../../context/GuanlanContext";
import { SpectrumCard } from "../Common/SpectrumCard";
import { SpectrumBadge } from "../Common/SpectrumBadge";
import { SpectrumInput, SpectrumToggle } from "../Common/SpectrumInput";
import { SpectrumButton } from "../Common/SpectrumButton";
import { EmptyState } from "../Common/EmptyState";
import { formatBytes } from "../../helpers/metricsNormalizer";

export const LocalDeviceView: React.FC = () => {
  const {
    snapshot,
    loading,
    error,
    setSelectedDeviceId,
    updateLocalConfig,
    controlAgent,
    setAgentSecret,
    saveFanNote,
    updateStartupSettings,
    cloudPush,
    refresh
  } = useGuanlan();

  const localDeviceId = snapshot?.localBackend?.config?.connection?.deviceId;
  const metricsDeviceId = snapshot?.metrics?.device?.deviceId;
  const isLocalMetrics = Boolean(localDeviceId && metricsDeviceId && metricsDeviceId === localDeviceId);

  const [serverUrlInput, setServerUrlInput] = useState("");
  const [normalInterval, setNormalInterval] = useState(5);
  const [slowInterval, setSlowInterval] = useState(15);
  const [autoStartCollector, setAutoStartCollector] = useState(true);
  const [autoRestartCollector, setAutoRestartCollector] = useState(true);

  const [secretInput, setSecretInput] = useState("");
  const [secretModalOpen, setSecretModalOpen] = useState(false);

  const [fanNoteDrafts, setFanNoteDrafts] = useState<Record<string, string>>({});
  const [savingFanId, setSavingFanId] = useState<string | null>(null);

  // Sync form inputs whenever snapshot arrives, preventing frozen initial defaults
  useEffect(() => {
    if (snapshot?.localBackend?.config) {
      const cfg = snapshot.localBackend.config;
      setServerUrlInput(cfg.connection.serverUrl || "http://127.0.0.1:3100");
      setNormalInterval(cfg.sampling.normalIntervalSeconds ?? 5);
      setSlowInterval(cfg.sampling.slowIntervalSeconds ?? 15);
      setAutoStartCollector(cfg.autoStartCollector ?? true);
      setAutoRestartCollector(cfg.autoRestartCollector ?? true);
    }

    if (isLocalMetrics && snapshot?.metrics?.latest?.fans) {
      setFanNoteDrafts((prev) => {
        const updated = { ...prev };
        snapshot.metrics!.latest!.fans.forEach((fan) => {
          if (updated[fan.id] === undefined) {
            updated[fan.id] = fan.note || "";
          }
        });
        return updated;
      });
    }
  }, [snapshot, isLocalMetrics]);

  useEffect(() => {
    if (!secretModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSecretModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [secretModalOpen]);

  if (loading && !snapshot) return <EmptyState variant="loading" title="正在获取本机 Agent 状态..." />;

  if (error && !snapshot) {
    return (
      <EmptyState
        variant="error"
        title="获取本机 Agent 失败"
        description={error}
        actionLabel="重试"
        onAction={refresh}
      />
    );
  }

  if (!snapshot) return <EmptyState variant="loading" />;

  const backend = snapshot.localBackend;
  const isAgentRunning = backend?.running === true;
  const fans = isLocalMetrics ? (snapshot.metrics?.latest?.fans || []) : [];

  const handleSaveConfig = async () => {
    await updateLocalConfig({
      connection: {
        serverUrl: serverUrlInput
      },
      sampling: {
        normalIntervalSeconds: Number(normalInterval),
        slowIntervalSeconds: Number(slowInterval)
      },
      autoStartCollector,
      autoRestartCollector
    });
  };

  const handleSaveSecret = async () => {
    if (!secretInput.trim()) return;
    await setAgentSecret(secretInput);
    setSecretInput("");
    setSecretModalOpen(false);
  };

  const handleSaveFanNote = async (fanId: string) => {
    if (!localDeviceId) return;
    const note = fanNoteDrafts[fanId] ?? "";
    try {
      setSavingFanId(fanId);
      await saveFanNote(localDeviceId, fanId, note);
    } catch (err) {
      console.error("保存风扇备注异常:", err);
    } finally {
      setSavingFanId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Prominent Header Banner distinguishing Local Device Controls */}
      <div
        style={{
          padding: "12px 16px",
          backgroundColor: "var(--gl-accent-quiet)",
          border: "1px solid var(--gl-accent-base)",
          borderRadius: "var(--gl-radius-md)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--gl-accent-text)" }}>
            💻 本机 Agent 服务与嵌套配置 (此设备)
          </div>
          <div style={{ fontSize: 12, color: "var(--gl-text-secondary)" }}>
            管理本机后台服务生命周期、Hub 连接凭据与指标采样参数。
          </div>
        </div>
        <SpectrumButton variant="primary" size="sm" onClick={cloudPush}>
          ☁️ 推送配置至云端 (Cloud Push)
        </SpectrumButton>
      </div>

      <div className="gl-grid-adaptive-2">
        {/* Agent Service Lifecycle Card */}
        <SpectrumCard title="Agent 后台服务生命周期 (DesktopAgentControlAction)">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "var(--gl-text-secondary)" }}>服务运行状态</span>
              {isAgentRunning ? (
                <SpectrumBadge status="online" label={`运行中 (PID: ${backend.frontendParentPid})`} />
              ) : (
                <SpectrumBadge status="error" label="已停止" />
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "var(--gl-text-secondary)" }}>连接状态 (connectionStatus)</span>
              <span style={{ fontFamily: "var(--gl-font-mono)", fontWeight: 600 }}>
                {backend?.connectionStatus || "未连接"}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "var(--gl-text-secondary)" }}>累计重启次数 (restartCount)</span>
              <span style={{ fontFamily: "var(--gl-font-mono)" }}>{backend?.restartCount ?? 0} 次</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "var(--gl-text-secondary)" }}>待发缓冲队列 (spool)</span>
              <span style={{ fontFamily: "var(--gl-font-mono)" }}>
                {backend?.pendingSampleCount ?? 0} 项 ({formatBytes(backend?.pendingBytes ?? 0)})
              </span>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              <SpectrumButton
                variant="primary"
                size="sm"
                disabled={isAgentRunning}
                onClick={() => controlAgent("start")}
              >
                ▶ 启动服务 (start)
              </SpectrumButton>
              <SpectrumButton
                variant="danger"
                size="sm"
                disabled={!isAgentRunning}
                onClick={() => controlAgent("stop")}
              >
                ⏹ 停止服务 (stop)
              </SpectrumButton>
              <SpectrumButton
                variant="secondary"
                size="sm"
                onClick={() => controlAgent("restart")}
              >
                🔄 复合重启 (stop ➔ start)
              </SpectrumButton>
              <SpectrumButton
                variant="secondary"
                size="sm"
                onClick={() => controlAgent("check-connection")}
              >
                📡 检查 Hub 通信
              </SpectrumButton>
              <SpectrumButton
                variant="secondary"
                size="sm"
                onClick={() => controlAgent("detect-probes")}
              >
                🔍 重新检测探针
              </SpectrumButton>
            </div>
          </div>
        </SpectrumCard>

        {/* Local Configuration Parameters */}
        <SpectrumCard title="Hub 连接与采样嵌套配置 (DesktopConfigPatch)">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SpectrumInput
              id="hub-server-url"
              label="Hub 服务地址 (serverUrl)"
              value={serverUrlInput}
              onChange={(e) => setServerUrlInput(e.target.value)}
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <SpectrumInput
                id="normal-interval"
                label="常规采样间隔 (秒)"
                type="number"
                min={1}
                max={60}
                value={normalInterval}
                onChange={(e) => setNormalInterval(Number(e.target.value))}
              />

              <SpectrumInput
                id="slow-interval"
                label="慢速采样间隔 (秒)"
                type="number"
                min={5}
                max={300}
                value={slowInterval}
                onChange={(e) => setSlowInterval(Number(e.target.value))}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              <SpectrumToggle
                label="自动启动采集器 (autoStartCollector)"
                checked={autoStartCollector}
                onChange={setAutoStartCollector}
              />
              <SpectrumToggle
                label="异常自动重启采集器 (autoRestartCollector)"
                checked={autoRestartCollector}
                onChange={setAutoRestartCollector}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--gl-border-subtle)", paddingTop: 10, marginTop: 4 }}>
              <span style={{ fontSize: 12, color: "var(--gl-text-secondary)" }}>通信 Secret 配置状态</span>
              <span>
                {backend?.config?.connection?.secretConfigured ? (
                  <SpectrumBadge status="online" label="密钥已安全配置" />
                ) : (
                  <SpectrumBadge status="warning" label="未设置 Secret" />
                )}
              </span>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <SpectrumButton variant="primary" size="sm" onClick={handleSaveConfig}>
                💾 保存本机配置
              </SpectrumButton>
              <SpectrumButton
                variant="secondary"
                size="sm"
                onClick={() => setSecretModalOpen(true)}
              >
                🔑 修改通信 Secret
              </SpectrumButton>
            </div>
          </div>
        </SpectrumCard>
      </div>

      {/* Fan Sensor Telemetry & Custom Notes Section (Local Scope) */}
      <SpectrumCard title="🌀 风扇传感器与自定义备注 (Fan Sensor Notes)">
        {!localDeviceId ? (
          <div style={{ fontSize: 12, color: "var(--gl-text-muted)", padding: "4px 0" }}>
            未检测到有效的本机设备 ID 配置 (localBackend.config.connection.deviceId 未获取)。
          </div>
        ) : !isLocalMetrics ? (
          <div
            style={{
              padding: "12px 14px",
              backgroundColor: "var(--gl-surface-quiet)",
              border: "1px solid var(--gl-border-muted)",
              borderRadius: "var(--gl-radius-md)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              fontSize: 12
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div style={{ color: "var(--gl-text-primary)", fontWeight: 500 }}>
                🔒 传感器数据为只读/未匹配状态：当前遥测指标来源于节点 <code style={{ fontFamily: "var(--gl-font-mono)" }}>{metricsDeviceId || "未选择"}</code>，非本机 (<code style={{ fontFamily: "var(--gl-font-mono)" }}>{localDeviceId}</code>)
              </div>
              <SpectrumButton
                variant="secondary"
                size="sm"
                onClick={() => setSelectedDeviceId(localDeviceId)}
              >
                📡 切换至本机指标
              </SpectrumButton>
            </div>
            <div style={{ color: "var(--gl-text-secondary)", fontSize: 11, lineHeight: 1.5 }}>
              风扇传感器与自定义备注仅在本机指标匹配时允许查看与编辑保存。点击上方按钮可请求并显示本机实时遥测数据。
            </div>
          </div>
        ) : fans.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--gl-text-muted)", padding: "4px 0" }}>
            未检测到本机风扇传感器指标 (或风扇采集探针未启用)。
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {fans.map((fan) => {
              const fanInputId = `fan-note-input-${fan.id}`;
              const draftValue = fanNoteDrafts[fan.id] ?? fan.note ?? "";
              const isSaving = savingFanId === fan.id;

              return (
                <div
                  key={fan.id}
                  style={{
                    padding: 12,
                    border: "1px solid var(--gl-border-subtle)",
                    borderRadius: "var(--gl-radius-md)",
                    backgroundColor: "var(--gl-surface-quiet)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8
                  }}
                >
                  {/* Read-Only Telemetry Header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 8
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: "var(--gl-text-primary)" }}>
                        🌀 {fan.label || fan.id}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontFamily: "var(--gl-font-mono)",
                          color: "var(--gl-text-muted)",
                          backgroundColor: "var(--gl-surface-elevated)",
                          padding: "2px 6px",
                          borderRadius: 4
                        }}
                      >
                        ID: {fan.id}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--gl-text-secondary)" }}>
                        接口: {fan.interface || "通用通道"}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontFamily: "var(--gl-font-mono)",
                          fontWeight: 600,
                          fontSize: 13,
                          color: "var(--gl-accent-text)"
                        }}
                      >
                        ⚡ {fan.rpm != null ? `${fan.rpm} RPM` : "未定转速"}
                      </span>

                      {fan.controlMode && (
                        <SpectrumBadge status="online" label={`模式: ${fan.controlMode}`} />
                      )}

                      {fan.targetTemperatureC != null && (
                        <span style={{ fontSize: 11, color: "var(--gl-text-secondary)" }}>
                          目标: {fan.targetTemperatureC}°C
                        </span>
                      )}

                      {(fan.minPwmPercent != null || fan.maxPwmPercent != null) && (
                        <span style={{ fontSize: 11, color: "var(--gl-text-secondary)" }}>
                          PWM: {fan.minPwmPercent ?? 0}% - {fan.maxPwmPercent ?? 100}%
                        </span>
                      )}

                      {fan.channelState && (
                        <SpectrumBadge status="cached" label={`状态: ${fan.channelState}`} />
                      )}
                    </div>
                  </div>

                  {/* Labeled Edit Custom Note Form */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-end",
                      gap: 8,
                      flexWrap: "wrap",
                      marginTop: 4
                    }}
                  >
                    <div style={{ flex: "1 1 240px" }}>
                      <SpectrumInput
                        id={fanInputId}
                        label={`风扇 ${fan.label || fan.id} 备注说明`}
                        placeholder="输入风扇位置或用途备注..."
                        value={draftValue}
                        onChange={(e) =>
                          setFanNoteDrafts((prev) => ({ ...prev, [fan.id]: e.target.value }))
                        }
                      />
                    </div>
                    <SpectrumButton
                      variant="primary"
                      size="sm"
                      disabled={isSaving}
                      onClick={() => handleSaveFanNote(fan.id)}
                      aria-label={`保存 ${fan.label || fan.id} 风扇备注`}
                    >
                      {isSaving ? "保存中..." : "💾 保存备注"}
                    </SpectrumButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SpectrumCard>

      {/* Startup & Operating System Integration Card */}
      <SpectrumCard title="系统集成与启动项设置 (Startup Settings)">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
          <SpectrumToggle
            label="开机自动启动 (openAtLogin)"
            checked={snapshot.startup.openAtLogin}
            onChange={(checked) => updateStartupSettings({ openAtLogin: checked })}
          />
          <SpectrumToggle
            label="启动后最小化至系统托盘 (startMinimized)"
            checked={snapshot.startup.startMinimized}
            onChange={(checked) => updateStartupSettings({ startMinimized: checked })}
          />
        </div>
      </SpectrumCard>

      {/* Secret Modal Overlay */}
      {secretModalOpen && (
        <div
          className="gl-overlay-backdrop"
          onClick={() => setSecretModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="修改 Agent 通信 Secret"
        >
          <div className="gl-command-modal" onClick={(e) => e.stopPropagation()} style={{ padding: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: "var(--gl-text-primary)" }}>
              修改 Agent 通信 Secret
            </div>
            <div style={{ fontSize: 12, color: "var(--gl-text-secondary)", marginBottom: 12 }}>
              密钥在存储与通信过程中使用加密受控处理，不会在日志或界面中明文泄露与回显。
            </div>
            <SpectrumInput
              id="agent-secret-input"
              type="password"
              aria-label="新的 Secret 密钥"
              placeholder="输入新的 Secret 密钥..."
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <SpectrumButton variant="secondary" onClick={() => setSecretModalOpen(false)}>
                取消
              </SpectrumButton>
              <SpectrumButton variant="primary" onClick={handleSaveSecret}>
                保存加密 Secret
              </SpectrumButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
