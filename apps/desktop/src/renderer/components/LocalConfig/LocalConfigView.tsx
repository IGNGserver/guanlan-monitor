import React from "react";
import { useConsole } from "../../context/ConsoleContext";
import { Badge } from "../Common/Badge";
import type {
  AgentProbeTarget,
  AgentProbeProvider,
  DeviceMetricKey,
  DeviceBlockKey
} from "@dsc/shared";
import { getBlockLabel } from "../../utils/formatters";

export const LocalConfigView: React.FC = () => {
  const {
    snapshot,
    pendingConfigPatch,
    updatePendingPatch,
    applyPendingChanges,
    discardPendingChanges,
    hasPendingChanges,
    controlCollector,
    setSecretModalOpen,
    saveStartupSettings,
    triggerCloudPush,
    cloudPushStatus
  } = useConsole();

  const config = snapshot?.localBackend?.config;
  const localBackend = snapshot?.localBackend;
  const startup = snapshot?.startup;

  if (!config) {
    return (
      <div className="card" style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>
        Local backend configuration service unavailable.
      </div>
    );
  }

  // Effective connection values (merged with pending patch)
  const currentConnection = {
    serverUrl: pendingConfigPatch.connection?.serverUrl ?? config.connection.serverUrl,
    deviceId: pendingConfigPatch.connection?.deviceId ?? config.connection.deviceId,
    hostname: pendingConfigPatch.connection?.hostname ?? config.connection.hostname
  };

  // Effective sampling values
  const currentSampling = {
    normalIntervalSeconds: pendingConfigPatch.sampling?.normalIntervalSeconds ?? config.sampling.normalIntervalSeconds,
    slowIntervalSeconds: pendingConfigPatch.sampling?.slowIntervalSeconds ?? config.sampling.slowIntervalSeconds
  };

  // Effective probe selections
  const currentProbes = pendingConfigPatch.probeSelections ?? config.probeSelections ?? [];

  // Effective enabled metrics
  const currentEnabledMetrics: DeviceMetricKey[] = pendingConfigPatch.enabledMetrics ?? config.enabledMetrics ?? [];

  // Effective enabled device IDs per block
  const currentEnabledDeviceIds: Partial<Record<DeviceBlockKey, string[]>> =
    pendingConfigPatch.enabledDeviceIds ?? config.enabledDeviceIds ?? {};

  // All known metric keys categorized by block
  const metricBlocks: { block: DeviceBlockKey; label: string; metrics: { key: DeviceMetricKey; name: string }[] }[] = [
    {
      block: "cpu",
      label: "CPU / Processor Metrics",
      metrics: [
        { key: "cpuUsage", name: "CPU Usage %" },
        { key: "cpuFrequency", name: "Core Frequency (MHz)" },
        { key: "cpuTemperature", name: "Package Temperature (°C)" },
        { key: "cpuTopology", name: "Topology & Core Counts" },
        { key: "systemOverview", name: "Process & Thread Counts" }
      ]
    },
    {
      block: "gpu",
      label: "GPU / Graphics Adapter Metrics",
      metrics: [
        { key: "gpuUsage", name: "GPU Core Usage %" },
        { key: "gpuFrequency", name: "GPU Core Frequency" },
        { key: "gpuMemory", name: "VRAM Memory Usage" },
        { key: "gpuTemperature", name: "GPU Temperature" },
        { key: "gpuEncode", name: "Video Encode Engine" },
        { key: "gpuDecode", name: "Video Decode Engine" },
        { key: "gpuDriverInfo", name: "Driver Information" }
      ]
    },
    {
      block: "memory",
      label: "Memory & Swap Metrics",
      metrics: [
        { key: "memoryUsage", name: "RAM Used / Total" },
        { key: "swapUsage", name: "Swap / Pagefile Usage" },
        { key: "memoryAvailable", name: "Available Memory" },
        { key: "memoryCached", name: "Cached Standby Memory" },
        { key: "memoryCommitted", name: "Committed Memory Bytes" },
        { key: "memoryHardware", name: "Hardware Speed & Slots" }
      ]
    },
    {
      block: "disk",
      label: "Storage Disk Metrics",
      metrics: [
        { key: "diskUsage", name: "Disk Usage %" },
        { key: "diskRead", name: "Read Throughput (B/s)" },
        { key: "diskWrite", name: "Write Throughput (B/s)" },
        { key: "diskMetadata", name: "Filesystem & Mount Metadata" },
        { key: "diskHealth", name: "SMART Health Status" },
        { key: "diskActivity", name: "Disk Active Time %" }
      ]
    },
    {
      block: "network",
      label: "Network Interface Metrics",
      metrics: [
        { key: "networkRxRate", name: "Download Rx Rate (B/s)" },
        { key: "networkTxRate", name: "Upload Tx Rate (B/s)" },
        { key: "networkTraffic", name: "Accumulated Traffic (Bytes)" },
        { key: "networkIdentity", name: "MAC & IP Identities" }
      ]
    },
    {
      block: "fan",
      label: "Fan & Thermal Sensor Metrics",
      metrics: [
        { key: "fanRpm", name: "Fan Speed (RPM)" },
        { key: "fanControl", name: "Control Mode & Curves" },
        { key: "fanTargetTemperature", name: "Target Temperature" },
        { key: "fanPwm", name: "PWM Percent Range" },
        { key: "fanChannelState", name: "Channel Sensor State" },
        { key: "fanNote", name: "Custom Fan Notes" }
      ]
    }
  ];

  const handleMetricToggle = (key: DeviceMetricKey) => {
    const isEnabled = currentEnabledMetrics.includes(key);
    const updated = isEnabled
      ? currentEnabledMetrics.filter((k) => k !== key)
      : [...currentEnabledMetrics, key];
    updatePendingPatch({ enabledMetrics: updated });
  };

  const handleProbeChange = (target: AgentProbeTarget, field: "provider" | "enabled", val: any) => {
    const existingIndex = currentProbes.findIndex((p) => p.target === target);
    let updatedProbes = [...currentProbes];
    if (existingIndex >= 0) {
      updatedProbes[existingIndex] = { ...updatedProbes[existingIndex], [field]: val };
    } else {
      updatedProbes.push({
        target,
        provider: field === "provider" ? val : "builtin",
        enabled: field === "enabled" ? val : true
      });
    }
    updatePendingPatch({ probeSelections: updatedProbes });
  };

  const handleInstanceToggle = (block: DeviceBlockKey, instanceId: string) => {
    const currentList = currentEnabledDeviceIds[block] || [];
    const isEnabled = currentList.includes(instanceId);
    const updatedList = isEnabled
      ? currentList.filter((id) => id !== instanceId)
      : [...currentList, instanceId];
    updatePendingPatch({
      enabledDeviceIds: {
        ...currentEnabledDeviceIds,
        [block]: updatedList
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Local Collector Controls Bar */}
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>⚡ Local Collector Management</span>
            {localBackend?.running ? <Badge variant="online">Running</Badge> : <Badge variant="offline">Stopped</Badge>}
          </h3>
          <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
            Control the background hardware telemetry daemon on this machine.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => controlCollector("detect-probes")}
            title="Scan hardware probes and refresh instances"
          >
            🔍 Detect Probes
          </button>

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => controlCollector("check-connection")}
            title="Ping Hub server and verify access key"
          >
            📡 Check Hub Connection
          </button>

          {localBackend?.running ? (
            <button className="btn btn-danger btn-sm" onClick={() => controlCollector("stop")}>
              🛑 Stop Collector
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => controlCollector("start")}>
              ▶️ Start Collector
            </button>
          )}

          <button
            className="btn btn-secondary btn-sm"
            onClick={triggerCloudPush}
            disabled={cloudPushStatus === "pushing"}
          >
            ☁️ {cloudPushStatus === "pushing" ? "Pushing..." : "Push Config to Hub"}
          </button>
        </div>
      </div>

      {/* Connection & Sampling Settings */}
      <div className="grid-2">
        {/* Agent Identity & Connection */}
        <div className="card">
          <div className="card-header">
            <h4 className="card-title">🌐 Connection & Identity</h4>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "12px" }}>
            <div>
              <label style={{ display: "block", color: "var(--text-secondary)", marginBottom: "4px" }}>Hub Server URL:</label>
              <input
                type="text"
                className="input-text"
                value={currentConnection.serverUrl}
                onChange={(e) =>
                  updatePendingPatch({
                    connection: { ...pendingConfigPatch.connection, serverUrl: e.target.value }
                  })
                }
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label style={{ display: "block", color: "var(--text-secondary)", marginBottom: "4px" }}>Device ID:</label>
                <input
                  type="text"
                  className="input-text"
                  value={currentConnection.deviceId}
                  onChange={(e) =>
                    updatePendingPatch({
                      connection: { ...pendingConfigPatch.connection, deviceId: e.target.value }
                    })
                  }
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", color: "var(--text-secondary)", marginBottom: "4px" }}>Hostname:</label>
                <input
                  type="text"
                  className="input-text"
                  value={currentConnection.hostname}
                  onChange={(e) =>
                    updatePendingPatch({
                      connection: { ...pendingConfigPatch.connection, hostname: e.target.value }
                    })
                  }
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            {/* Secret Configured status & Set secret button */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: "6px", borderTop: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ color: "var(--text-secondary)" }}>Agent Secret:</span>
                {config.connection.secretConfigured ? (
                  <Badge variant="online">Configured</Badge>
                ) : (
                  <Badge variant="warning">Not Set</Badge>
                )}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setSecretModalOpen(true)}>
                🔐 Change Secret
              </button>
            </div>
          </div>
        </div>

        {/* Sampling & App Startup Settings */}
        <div className="card">
          <div className="card-header">
            <h4 className="card-title">⏱️ Sampling Intervals & Application Settings</h4>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "12px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label style={{ display: "block", color: "var(--text-secondary)", marginBottom: "4px" }}>Normal Sampling (sec):</label>
                <input
                  type="number"
                  className="input-text"
                  value={currentSampling.normalIntervalSeconds}
                  onChange={(e) =>
                    updatePendingPatch({
                      sampling: { ...pendingConfigPatch.sampling, normalIntervalSeconds: Number(e.target.value) }
                    })
                  }
                  style={{ width: "100%" }}
                  min={1}
                  max={60}
                />
              </div>
              <div>
                <label style={{ display: "block", color: "var(--text-secondary)", marginBottom: "4px" }}>Slow Sampling (sec):</label>
                <input
                  type="number"
                  className="input-text"
                  value={currentSampling.slowIntervalSeconds}
                  onChange={(e) =>
                    updatePendingPatch({
                      sampling: { ...pendingConfigPatch.sampling, slowIntervalSeconds: Number(e.target.value) }
                    })
                  }
                  style={{ width: "100%" }}
                  min={5}
                  max={300}
                />
              </div>
            </div>

            {/* Application Startup Toggles */}
            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>Launch App on OS Login:</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={startup?.openAtLogin ?? true}
                    onChange={(e) => saveStartupSettings({ openAtLogin: e.target.checked })}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>Start Application Minimized:</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={startup?.startMinimized ?? false}
                    onChange={(e) => saveStartupSettings({ startMinimized: e.target.checked })}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>Enable Local Data Recording:</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={pendingConfigPatch.dataRecordingEnabled ?? config.dataRecordingEnabled ?? true}
                    onChange={(e) => updatePendingPatch({ dataRecordingEnabled: e.target.checked })}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>Auto-Sync Display Config to Hub:</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={pendingConfigPatch.cloudSyncEnabled ?? config.cloudSyncEnabled ?? true}
                    onChange={(e) => updatePendingPatch({ cloudSyncEnabled: e.target.checked })}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Probe Selection Matrix */}
      <div className="card">
        <div className="card-header">
          <h4 className="card-title">🔍 Hardware Probe Targets & Provider Matrix</h4>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Probe Target</th>
                <th>Provider Selection</th>
                <th>Status</th>
                <th>Enabled Toggle</th>
              </tr>
            </thead>
            <tbody>
              {localBackend?.supportedProbePlans?.map((plan) => {
                const currentProbe = currentProbes.find((p) => p.target === plan.target);
                const selectedProvider = currentProbe?.provider || plan.default;
                const isEnabled = currentProbe ? currentProbe.enabled : true;

                return (
                  <tr key={plan.target}>
                    <td>
                      <strong style={{ color: "var(--text-main)", textTransform: "uppercase" }}>{plan.target}</strong>
                    </td>
                    <td>
                      <select
                        className="select-input"
                        value={selectedProvider}
                        onChange={(e) => handleProbeChange(plan.target, "provider", e.target.value as AgentProbeProvider)}
                      >
                        {plan.providers.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <Badge variant={isEnabled ? "online" : "offline"}>
                        {isEnabled ? "Active" : "Disabled"}
                      </Badge>
                    </td>
                    <td>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={(e) => handleProbeChange(plan.target, "enabled", e.target.checked)}
                        />
                        <span className="toggle-slider" />
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detected Instances Matrix */}
      {localBackend?.detectedTargets && localBackend.detectedTargets.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h4 className="card-title">🖥️ Detected Hardware Instances Filtering</h4>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {localBackend.detectedTargets.map((group) => {
              const enabledList = currentEnabledDeviceIds[group.target as DeviceBlockKey] || [];
              return (
                <div key={group.target} style={{ borderBottom: "1px solid var(--border-subtle)", paddingBottom: "10px" }}>
                  <div style={{ fontWeight: 600, color: "var(--accent-cyan)", marginBottom: "6px" }}>
                    {group.label} ({group.instances.length} Detected)
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {group.instances.map((inst) => {
                      const isEnabled = enabledList.length === 0 || enabledList.includes(inst.id);
                      return (
                        <button
                          key={inst.id}
                          onClick={() => handleInstanceToggle(group.target as DeviceBlockKey, inst.id)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "var(--radius-sm)",
                            border: `1px solid ${isEnabled ? "var(--accent-cyan)" : "var(--border-muted)"}`,
                            background: isEnabled ? "rgba(56, 189, 248, 0.12)" : "rgba(0,0,0,0.2)",
                            color: isEnabled ? "var(--text-main)" : "var(--text-muted)",
                            fontSize: "11px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px"
                          }}
                        >
                          <span>{isEnabled ? "✅" : "⚪"}</span>
                          <span>{inst.name}</span>
                          <span className="mono" style={{ opacity: 0.6, fontSize: "10px" }}>({inst.id})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Global & Block Metric Enable Matrix */}
      <div className="card">
        <div className="card-header">
          <h4 className="card-title">📊 Granular Metric Field Selection</h4>
        </div>
        <div className="grid-2">
          {metricBlocks.map((blk) => (
            <div key={blk.block} style={{ background: "rgba(0,0,0,0.2)", padding: "12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontWeight: 600, color: "var(--accent-cyan)", marginBottom: "8px", fontSize: "12px" }}>
                {blk.label}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {blk.metrics.map((m) => {
                  const isChecked = currentEnabledMetrics.length === 0 || currentEnabledMetrics.includes(m.key);
                  return (
                    <label key={m.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px", cursor: "pointer" }}>
                      <span style={{ color: isChecked ? "var(--text-main)" : "var(--text-muted)" }}>{m.name}</span>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleMetricToggle(m.key)}
                        style={{ accentColor: "var(--accent-cyan)" }}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky Bottom Actions Bar when pending changes exist */}
      {hasPendingChanges && (
        <div
          className="card"
          style={{
            position: "sticky",
            bottom: "16px",
            background: "var(--bg-card-active)",
            border: "1px solid var(--accent-amber)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 20px"
          }}
        >
          <div style={{ color: "var(--accent-amber)", fontWeight: 600 }}>
            ⚠️ Local changes pending application
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button className="btn btn-secondary" onClick={discardPendingChanges}>
              Discard Edits
            </button>
            <button className="btn btn-primary" onClick={applyPendingChanges}>
              Save & Apply Local Config
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
