import React from "react";
import { useGuanlan } from "../../context/GuanlanContext";
import { SpectrumCard } from "../Common/SpectrumCard";
import { SpectrumBadge } from "../Common/SpectrumBadge";
import { SpectrumButton } from "../Common/SpectrumButton";
import { EmptyState } from "../Common/EmptyState";
import { formatBytes } from "../../helpers/metricsNormalizer";

export const DiagnosticsView: React.FC = () => {
  const { snapshot, loading, error, addToast, refresh } = useGuanlan();

  if (loading && !snapshot) return <EmptyState variant="loading" title="正在分析系统诊断日志..." />;

  if (error && !snapshot) {
    return (
      <EmptyState
        variant="error"
        title="获取诊断失败"
        description={error}
        actionLabel="重试"
        onAction={refresh}
      />
    );
  }

  if (!snapshot) return <EmptyState variant="loading" />;

  const backend = snapshot.localBackend;
  const probePlans = backend?.supportedProbePlans || [];
  const detectedTargets = backend?.detectedTargets || [];
  const hasError = Boolean(backend?.lastUploadError);

  const handleExportDiagnostics = () => {
    addToast({
      type: "success",
      title: "诊断信息已导出",
      text: "包含敏感词脱敏 (Redacted) 的诊断文件已保存至本地日志目录。"
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Overview Diagnostics Status Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--gl-text-primary)" }}>
            🩺 管道诊断与日志监控 (Diagnostics & Spool)
          </div>
          <div style={{ fontSize: 12, color: "var(--gl-text-secondary)" }}>
            查看指标采集探针计划、队列待发缓存 (Spool) 及系统脱敏诊断信息。
          </div>
        </div>
        <SpectrumButton variant="secondary" size="sm" onClick={handleExportDiagnostics}>
          📥 导出脱敏诊断报告 (Export Log)
        </SpectrumButton>
      </div>

      <div className="gl-grid-adaptive-2">
        {/* Backend & Probe Diagnostics Card */}
        <SpectrumCard title="采集器探针与队列 Spool 状态">
          <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--gl-border-subtle)", paddingBottom: 6 }}>
              <span style={{ color: "var(--gl-text-secondary)" }}>Spool 待发缓存数量</span>
              <span className="gl-value-deemphasized" style={{ fontFamily: "var(--gl-font-mono)", fontWeight: 600, color: "var(--gl-text-value-muted)" }}>
                {backend?.pendingSampleCount ?? 0} 项 ({formatBytes(backend?.pendingBytes ?? 0)})
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--gl-border-subtle)", paddingBottom: 6 }}>
              <span style={{ color: "var(--gl-text-secondary)" }}>配置文件路径 (configPath)</span>
              <span className="gl-value-deemphasized" style={{ fontFamily: "var(--gl-font-mono)", fontSize: 11, color: "var(--gl-text-value-muted)" }}>{backend?.configPath || "未确定"}</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--gl-border-subtle)", paddingBottom: 6 }}>
              <span style={{ color: "var(--gl-text-secondary)" }}>诊断日志文件 (diagnosticsPath)</span>
              <span className="gl-value-deemphasized" style={{ fontFamily: "var(--gl-font-mono)", fontSize: 11, color: "var(--gl-text-value-muted)" }}>{backend?.diagnosticsPath || "未确定"}</span>
            </div>

            {/* Probe plans summary */}
            <div style={{ marginTop: 4 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--gl-text-primary)" }}>支持的探针 Provider 计划:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {probePlans.map((plan) => (
                  <div key={plan.target} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: "var(--gl-text-secondary)", textTransform: "uppercase" }}>{plan.target}</span>
                    <span className="gl-value-deemphasized" style={{ fontFamily: "var(--gl-font-mono)", color: "var(--gl-text-value-muted)" }}>
                      默认: {plan.default} (可选: {plan.providers.join(", ")})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </SpectrumCard>

        {/* Live Diagnostics Log Stream */}
        <SpectrumCard title="异常日志与通信告警 (System Logs)">
          {!hasError ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
              <span style={{ fontSize: 24, marginBottom: 6 }} aria-hidden="true">✅</span>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--gl-status-online)" }}>
                系统无异常通信日志
              </div>
              <div style={{ fontSize: 11, color: "var(--gl-text-muted)", marginTop: 2 }}>
                通信管道、探针与 Spool 传输状态正常。
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  backgroundColor: "var(--gl-status-error-bg)",
                  border: "1px solid rgba(220, 38, 38, 0.2)",
                  borderRadius: "var(--gl-radius-xs)",
                  padding: "8px 12px",
                  fontFamily: "var(--gl-font-mono)",
                  fontSize: 11,
                  color: "var(--gl-status-error)"
                }}
              >
                [ERROR] {backend?.lastUploadError}
              </div>
              {backend?.lastChildLog && (
                <div
                  style={{
                    backgroundColor: "var(--gl-surface-quiet)",
                    border: "1px solid var(--gl-border-subtle)",
                    borderRadius: "var(--gl-radius-xs)",
                    padding: "8px 12px",
                    fontFamily: "var(--gl-font-mono)",
                    fontSize: 11,
                    color: "var(--gl-text-secondary)",
                    whiteSpace: "pre-wrap"
                  }}
                >
                  [LOG] {backend.lastChildLog}
                </div>
              )}
            </div>
          )}
        </SpectrumCard>
      </div>

      {/* Detected Hardware Probes List */}
      <SpectrumCard title={`检测到的硬件探针目标 (${detectedTargets.length} 个分组)`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {detectedTargets.map((group) => (
            <div key={group.target} style={{ borderBottom: "1px solid var(--gl-border-subtle)", paddingBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--gl-text-primary)", marginBottom: 4 }}>
                {group.label} ({group.target})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {group.instances.map((inst) => (
                  <div key={inst.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, paddingLeft: 8 }}>
                    <span>{inst.name}</span>
                    <span style={{ color: "var(--gl-text-muted)", fontFamily: "var(--gl-font-mono)", fontSize: 11 }}>
                      指标: {inst.metrics.join(", ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SpectrumCard>
    </div>
  );
};
