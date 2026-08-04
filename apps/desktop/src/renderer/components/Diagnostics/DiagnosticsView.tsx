import React, { useState } from "react";
import { useConsole } from "../../context/ConsoleContext";
import { Badge } from "../Common/Badge";
import { formatBytes, formatTimestamp } from "../../utils/formatters";

export const DiagnosticsView: React.FC = () => {
  const { snapshot, showToast } = useConsole();
  const [exportedDiagnostics, setExportedDiagnostics] = useState<string | null>(null);

  const localBackend = snapshot?.localBackend;

  if (!localBackend) {
    return (
      <div className="card" style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>
        Local backend status unavailable.
      </div>
    );
  }

  const handleExportDiagnostics = () => {
    // Generate redacted support export (never include secret text!)
    const report = {
      generatedAt: new Date().toISOString(),
      appVersion: snapshot?.update?.currentVersion || "0.2.68",
      platform: snapshot?.update?.platform || "windows-gui",
      backend: {
        running: localBackend.running,
        backendStartedAt: localBackend.backendStartedAt,
        frontendParentPid: localBackend.frontendParentPid,
        restartCount: localBackend.restartCount,
        effectiveUploadIntervalSeconds: localBackend.effectiveUploadIntervalSeconds,
        pendingSampleCount: localBackend.pendingSampleCount,
        pendingBytes: localBackend.pendingBytes
      },
      config: {
        serverUrl: localBackend.config.connection.serverUrl,
        deviceId: localBackend.config.connection.deviceId,
        hostname: localBackend.config.connection.hostname,
        secretConfigured: localBackend.config.connection.secretConfigured,
        normalIntervalSeconds: localBackend.config.sampling.normalIntervalSeconds,
        slowIntervalSeconds: localBackend.config.sampling.slowIntervalSeconds,
        enabledMetricsCount: localBackend.config.enabledMetrics.length,
        probes: localBackend.config.probeSelections
      },
      fileStatus: {
        configPath: localBackend.configPath,
        configFileExists: localBackend.configFileExists,
        syncStatePath: localBackend.syncStatePath,
        syncStateFileExists: localBackend.syncStateFileExists,
        diagnosticsPath: localBackend.diagnosticsPath,
        diagnosticsFileExists: localBackend.diagnosticsFileExists,
        pendingStatePath: localBackend.pendingStatePath,
        pendingStateFileExists: localBackend.pendingStateFileExists
      }
    };

    const formattedJson = JSON.stringify(report, null, 2);
    setExportedDiagnostics(formattedJson);
    navigator.clipboard.writeText(formattedJson);
    showToast("success", "Diagnostics Exported", "Redacted support diagnostics report copied to clipboard!");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Header Bar */}
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>🛠️ Local Backend Diagnostics & Durable Spool</span>
            {localBackend.running ? <Badge variant="online">Daemon Active</Badge> : <Badge variant="offline">Stopped</Badge>}
          </h3>
          <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
            Inspect collector spool status, process metrics, durable storage files, and generate support reports.
          </p>
        </div>

        <button className="btn btn-primary btn-sm" onClick={handleExportDiagnostics}>
          📋 Export Support Report
        </button>
      </div>

      {/* Grid overview */}
      <div className="grid-3">
        {/* Process Status */}
        <div className="card">
          <div className="card-header">
            <h4 className="card-title">🖥️ Backend Process</h4>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Parent Frontend PID:</span>
              <strong className="mono">{localBackend.frontendParentPid}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Backend Started:</span>
              <strong className="mono">{formatTimestamp(localBackend.backendStartedAt)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Child Collector Started:</span>
              <strong className="mono">{formatTimestamp(localBackend.childStartedAt)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Restart Count:</span>
              <strong className="mono" style={{ color: localBackend.restartCount > 0 ? "var(--accent-amber)" : "var(--text-main)" }}>
                {localBackend.restartCount}
              </strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Upload Interval:</span>
              <strong className="mono">{localBackend.effectiveUploadIntervalSeconds}s</strong>
            </div>
          </div>
        </div>

        {/* Upload Spool Queue */}
        <div className="card">
          <div className="card-header">
            <h4 className="card-title">📦 Durable Upload Spool</h4>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Queued Samples:</span>
              <strong className="mono" style={{ color: localBackend.pendingSampleCount > 0 ? "var(--accent-amber)" : "var(--accent-emerald)" }}>
                {localBackend.pendingSampleCount} Samples
              </strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Queued Spool Size:</span>
              <strong className="mono">{formatBytes(localBackend.pendingBytes)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Oldest Sample:</span>
              <strong className="mono">{formatTimestamp(localBackend.oldestPendingAt)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Last Upload:</span>
              <strong className="mono">{formatTimestamp(localBackend.lastUploadAt)}</strong>
            </div>
          </div>
        </div>

        {/* Hub Connection & Sync Status */}
        <div className="card">
          <div className="card-header">
            <h4 className="card-title">📡 Hub Connection & Sync</h4>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Hub Status:</span>
              <strong style={{ color: "var(--accent-cyan)" }}>{localBackend.connectionStatus}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Last Cloud Sync:</span>
              <strong className="mono">{formatTimestamp(localBackend.lastCloudSyncAt)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Pending Config Push:</span>
              <strong style={{ color: localBackend.cloudConfigPending ? "var(--accent-amber)" : "var(--status-online)" }}>
                {localBackend.cloudConfigPending ? "Pending" : "Synchronized"}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Durable Storage Files List */}
      <div className="card">
        <div className="card-header">
          <h4 className="card-title">📁 Data File Paths & Storage Status</h4>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>File Description</th>
                <th>File Path</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Agent Local Configuration</td>
                <td className="mono">{localBackend.configPath}</td>
                <td>
                  <Badge variant={localBackend.configFileExists ? "online" : "offline"}>
                    {localBackend.configFileExists ? "Exists" : "Missing"}
                  </Badge>
                </td>
              </tr>
              <tr>
                <td>Display Config Sync State</td>
                <td className="mono">{localBackend.syncStatePath}</td>
                <td>
                  <Badge variant={localBackend.syncStateFileExists ? "online" : "offline"}>
                    {localBackend.syncStateFileExists ? "Exists" : "Missing"}
                  </Badge>
                </td>
              </tr>
              <tr>
                <td>Durable Upload Spool Database</td>
                <td className="mono">{localBackend.pendingStatePath}</td>
                <td>
                  <Badge variant={localBackend.pendingStateFileExists ? "online" : "offline"}>
                    {localBackend.pendingStateFileExists ? "Exists" : "Missing"}
                  </Badge>
                </td>
              </tr>
              <tr>
                <td>Diagnostic Log File</td>
                <td className="mono">{localBackend.diagnosticsPath}</td>
                <td>
                  <Badge variant={localBackend.diagnosticsFileExists ? "online" : "offline"}>
                    {localBackend.diagnosticsFileExists ? "Exists" : "Missing"}
                  </Badge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Latest Collector Log & Issues */}
      <div className="card">
        <div className="card-header">
          <h4 className="card-title">📜 Latest Collector Log Output</h4>
        </div>
        <div
          className="mono"
          style={{
            padding: "12px",
            background: "#04070a",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            fontSize: "11px",
            color: "var(--text-secondary)",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            maxHeight: "160px",
            overflowY: "auto"
          }}
        >
          {localBackend.lastChildLog || "[INFO] Collector operating normally."}
        </div>
      </div>

      {/* Exported Report Display */}
      {exportedDiagnostics && (
        <div className="card">
          <div className="card-header">
            <h4 className="card-title">📋 Exported Redacted Support Diagnostics (Copied to Clipboard)</h4>
            <button className="btn btn-secondary btn-sm" onClick={() => setExportedDiagnostics(null)}>
              Close
            </button>
          </div>
          <textarea
            readOnly
            className="input-text mono"
            rows={8}
            value={exportedDiagnostics}
            style={{ width: "100%", fontSize: "11px", background: "#04070a" }}
          />
        </div>
      )}
    </div>
  );
};
