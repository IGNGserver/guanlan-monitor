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
    updateLocalConfig,
    controlAgent,
    setAgentSecret,
    updateStartupSettings,
    cloudPush,
    refresh
  } = useGuanlan();

  const [serverUrlInput, setServerUrlInput] = useState("");
  const [normalInterval, setNormalInterval] = useState(5);
  const [slowInterval, setSlowInterval] = useState(15);
  const [autoStartCollector, setAutoStartCollector] = useState(true);
  const [autoRestartCollector, setAutoRestartCollector] = useState(true);

  const [secretInput, setSecretInput] = useState("");
  const [secretModalOpen, setSecretModalOpen] = useState(false);

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
  }, [snapshot]);

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
