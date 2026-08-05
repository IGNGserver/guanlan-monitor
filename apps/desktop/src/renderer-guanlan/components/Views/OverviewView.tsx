import React from "react";
import { useGuanlan } from "../../context/GuanlanContext";
import { SpectrumCard } from "../Common/SpectrumCard";
import { SpectrumBadge } from "../Common/SpectrumBadge";
import { GuanlanChart } from "../Charts/GuanlanChart";
import { EmptyState } from "../Common/EmptyState";
import { SpectrumToggle } from "../Common/SpectrumInput";
import { SpectrumButton } from "../Common/SpectrumButton";

export const OverviewView: React.FC = () => {
  const { snapshot, loading, error, isMockAdapter, mockFlags, setMockFlags, refresh } = useGuanlan();

  if (loading && !snapshot) {
    return <EmptyState variant="loading" title="正在获取系统快照..." />;
  }

  if (error && !snapshot) {
    return (
      <EmptyState
        variant="error"
        title="快照获取失败"
        description={error}
        actionLabel="重试刷新"
        onAction={refresh}
      />
    );
  }

  if (!snapshot || snapshot.devices.length === 0) {
    return (
      <EmptyState
        variant="empty"
        title="全网尚无已注册节点"
        description="未检测到活动的远端或本机 Agent 节点。请检查 Hub 连接与 Agent 授权密钥。"
        actionLabel="手动刷新"
        onAction={refresh}
      />
    );
  }

  const onlineCount = snapshot.devices.filter((d) => d.status === "online").length;
  const offlineCount = snapshot.devices.length - onlineCount;
  const isCache = snapshot.source === "cache";
  const backend = snapshot.localBackend;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Simulation Toggle Toolbar for Mock Preview Review */}
      {isMockAdapter && (
        <SpectrumCard title="🧪 Guanlan Spectrum 模拟状态测试栏 (Mock Preview 视效审计)">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            <SpectrumToggle
              label="模拟空数据 (Empty)"
              checked={mockFlags.simulateEmpty}
              onChange={(checked) => setMockFlags({ simulateEmpty: checked })}
            />
            <SpectrumToggle
              label="模拟离线缓存 (Cached)"
              checked={mockFlags.simulateCached}
              onChange={(checked) => setMockFlags({ simulateCached: checked })}
            />
            <SpectrumToggle
              label="模拟 Agent 停止 (Stopped)"
              checked={mockFlags.simulateAgentStopped}
              onChange={(checked) => setMockFlags({ simulateAgentStopped: checked })}
            />
            <SpectrumToggle
              label="模拟通信错误 (Error)"
              checked={mockFlags.simulateError}
              onChange={(checked) => setMockFlags({ simulateError: checked })}
            />
          </div>
        </SpectrumCard>
      )}

      {/* Top Banner when error occurs while showing cached/stale data */}
      {error && (
        <div
          style={{
            padding: "10px 14px",
            backgroundColor: "var(--gl-status-error-bg)",
            border: "1px solid var(--gl-status-error)",
            borderRadius: "var(--gl-radius-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 12,
            color: "var(--gl-status-error)"
          }}
        >
          <div>
            <strong>通信告警: </strong>
            <span>{error}</span>
          </div>
          <SpectrumButton variant="danger" size="sm" onClick={refresh}>
            重试连接
          </SpectrumButton>
        </div>
      )}

      {/* KPI Metric Summary Grid */}
      <div className="gl-grid-adaptive-4">
        <SpectrumCard>
          <div style={{ fontSize: 12, color: "var(--gl-text-secondary)" }}>总注册节点</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--gl-text-primary)" }}>
            {snapshot.devices.length} <span style={{ fontSize: 13, fontWeight: 400 }}>台</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--gl-text-muted)" }}>包含 Linux 与 Windows 实例</div>
        </SpectrumCard>

        <SpectrumCard>
          <div style={{ fontSize: 12, color: "var(--gl-text-secondary)" }}>在线活动节点</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--gl-status-online)" }}>
            {onlineCount} <span style={{ fontSize: 13, fontWeight: 400 }}>台</span>
          </div>
          <SpectrumBadge status="online" label="实时通道激活" />
        </SpectrumCard>

        <SpectrumCard>
          <div style={{ fontSize: 12, color: "var(--gl-text-secondary)" }}>离线/未响应节点</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--gl-status-offline)" }}>
            {offlineCount} <span style={{ fontSize: 13, fontWeight: 400 }}>台</span>
          </div>
          <SpectrumBadge status="offline" label="心跳未回应" />
        </SpectrumCard>

        <SpectrumCard>
          <div style={{ fontSize: 12, color: "var(--gl-text-secondary)" }}>快照数据源</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>
            {isCache ? "离线只读缓存" : "Live 实时同步"}
          </div>
          {isCache ? (
            <SpectrumBadge status="cached" label={`年龄: ${snapshot.cache.ageSeconds ?? 0}s`} />
          ) : (
            <SpectrumBadge status="online" label="WebSocket 通道" />
          )}
        </SpectrumCard>
      </div>

      {/* Telemetry Chart & Narrative Card */}
      <div className="gl-grid-adaptive-2">
        <SpectrumCard title="全网核心节点 CPU/内存 遥测趋势">
          <GuanlanChart metrics={snapshot.metrics} title="实时指标分布 (最近 1 小时)" height={220} />
        </SpectrumCard>

        <SpectrumCard title="系统摘要与活动状态">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, borderBottom: "1px solid var(--gl-border-subtle)", paddingBottom: 8 }}>
              <span style={{ color: "var(--gl-text-secondary)" }}>本机 Agent 运行状态</span>
              <span>
                {backend?.running ? (
                  <SpectrumBadge status="online" label={`运行中 (PID: ${backend.frontendParentPid})`} />
                ) : (
                  <SpectrumBadge status="error" label="已停止" />
                )}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, borderBottom: "1px solid var(--gl-border-subtle)", paddingBottom: 8 }}>
              <span style={{ color: "var(--gl-text-secondary)" }}>已连接 Hub 地址</span>
              <span className="gl-value-deemphasized" style={{ fontFamily: "var(--gl-font-mono)", color: "var(--gl-text-value-muted)", fontWeight: 500 }}>
                {backend?.config?.connection?.serverUrl || "未配置"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, borderBottom: "1px solid var(--gl-border-subtle)", paddingBottom: 8 }}>
              <span style={{ color: "var(--gl-text-secondary)" }}>采样间隔 (Normal / Slow)</span>
              <span className="gl-value-deemphasized" style={{ fontFamily: "var(--gl-font-mono)", color: "var(--gl-text-value-muted)", fontWeight: 500 }}>
                {backend?.config?.sampling?.normalIntervalSeconds ?? 5}s / {backend?.config?.sampling?.slowIntervalSeconds ?? 15}s
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: "var(--gl-text-secondary)" }}>开机自运行状态</span>
              <span className="gl-value-deemphasized" style={{ color: "var(--gl-text-value-muted)", fontWeight: 500 }}>
                {snapshot.startup.openAtLogin ? "已启用" : "未启用"}
              </span>
            </div>
          </div>
        </SpectrumCard>
      </div>
    </div>
  );
};
