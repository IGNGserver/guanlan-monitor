import React, { useState } from "react";
import { useConsole } from "../../context/ConsoleContext";
import {
  formatBytes,
  formatThroughput,
  formatPercent,
  formatTemp,
  formatFrequency
} from "../../utils/formatters";
import { Badge } from "../Common/Badge";

type DetailTab = "disks" | "network" | "gpus" | "fans" | "cpu" | "backends" | "system";

export const InstanceDetailView: React.FC = () => {
  const { snapshot, setFanNoteModalOpen } = useConsole();
  const [activeTab, setActiveTab] = useState<DetailTab>("disks");

  const latest = snapshot?.metrics?.latest;
  const localBackend = snapshot?.localBackend;

  if (!latest) {
    return null;
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Tab Navigation */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "10px" }}>
        <h3 className="card-title">
          <span>🔍 Hardware & Telemetry Drill-Down</span>
        </h3>

        <div style={{ display: "flex", gap: "4px", background: "rgba(0,0,0,0.3)", padding: "2px", borderRadius: "var(--radius-sm)" }}>
          {(
            [
              { id: "disks", label: "Disks & SMART", count: latest.disks?.length },
              { id: "network", label: "Network Interfaces", count: latest.networkInterfaces?.length },
              { id: "gpus", label: "GPU Devices", count: latest.gpus?.length },
              { id: "fans", label: "Fans & Thermal", count: latest.fans?.length },
              { id: "cpu", label: "CPU Packages", count: latest.cpuPackages?.length },
              { id: "backends", label: "Sensor Backends", count: latest.sensorBackends?.length },
              { id: "system", label: "System Handles" }
            ] satisfies Array<{ id: DetailTab; label: string; count?: number }>
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: "4px 10px",
                fontSize: "11px",
                borderRadius: "3px",
                border: "none",
                background: activeTab === t.id ? "var(--border-muted)" : "transparent",
                color: activeTab === t.id ? "var(--accent-cyan)" : "var(--text-secondary)",
                fontWeight: activeTab === t.id ? 600 : 400,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px"
              }}
            >
              <span>{t.label}</span>
              {t.count !== undefined && (
                <span style={{ opacity: 0.6, fontSize: "10px", fontFamily: "var(--font-mono)" }}>
                  ({t.count})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content: Disks */}
      {activeTab === "disks" && (
        <div>
          {!latest.disks || latest.disks.length === 0 ? (
            <div style={{ padding: "16px", color: "var(--text-muted)", textAlign: "center" }}>
              No storage disks reported.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mount</th>
                    <th>Model / Name</th>
                    <th>FS</th>
                    <th>Capacity</th>
                    <th>Used</th>
                    <th>Active</th>
                    <th>Temp</th>
                    <th>SMART Health</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.disks.map((d) => {
                    const pct = d.totalBytes > 0 ? (d.usedBytes / d.totalBytes) * 100 : 0;
                    return (
                      <tr key={d.id}>
                        <td>
                          <strong className="mono" style={{ color: "var(--accent-cyan)" }}>{d.mountPoint}</strong>
                        </td>
                        <td>{d.name}</td>
                        <td className="mono">{d.filesystem || "NTFS"}</td>
                        <td className="mono">{formatBytes(d.totalBytes)}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span className="mono">{formatBytes(d.usedBytes)} ({formatPercent(pct)})</span>
                            <div className="progress-bar-bg" style={{ width: "60px" }}>
                              <div className="progress-bar-fill" style={{ width: `${pct}%`, background: "var(--accent-amber)" }} />
                            </div>
                          </div>
                        </td>
                        <td className="mono">{d.activePercent !== null && d.activePercent !== undefined ? `${d.activePercent}%` : "—"}</td>
                        <td className="mono">{formatTemp(d.temperatureC)}</td>
                        <td>
                          <Badge variant={d.healthStatus === "PASSED" || d.healthStatus === "OK" ? "online" : "warning"}>
                            {d.healthStatus || "PASSED"} {d.healthPercent ? `(${d.healthPercent}%)` : ""}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Network Interfaces */}
      {activeTab === "network" && (
        <div>
          {!latest.networkInterfaces || latest.networkInterfaces.length === 0 ? (
            <div style={{ padding: "16px", color: "var(--text-muted)", textAlign: "center" }}>
              No network interfaces reported.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Interface Name</th>
                    <th>Type</th>
                    <th>IPv4 Address</th>
                    <th>MAC Address</th>
                    <th>Speed</th>
                    <th>Rx Rate</th>
                    <th>Tx Rate</th>
                    <th>Total Rx / Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.networkInterfaces.map((net) => (
                    <tr key={net.id}>
                      <td>
                        <strong style={{ color: "var(--text-main)" }}>{net.name}</strong>
                      </td>
                      <td>
                        <span className="badge badge-live">{net.connectionType || "Ethernet"}</span>
                      </td>
                      <td className="mono" style={{ color: "var(--accent-cyan)" }}>
                        {net.ipv4?.join(", ") || "—"}
                      </td>
                      <td className="mono" style={{ color: "var(--text-muted)" }}>
                        {net.macAddress || "—"}
                      </td>
                      <td className="mono">{net.linkSpeedMbps ? `${net.linkSpeedMbps} Mbps` : "—"}</td>
                      <td className="mono" style={{ color: "var(--accent-cyan)" }}>
                        {formatThroughput(net.rxBytesPerSec)}
                      </td>
                      <td className="mono" style={{ color: "var(--accent-purple)" }}>
                        {formatThroughput(net.txBytesPerSec)}
                      </td>
                      <td className="mono">
                        {formatBytes(net.totalRxBytes)} / {formatBytes(net.totalTxBytes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: GPU Devices */}
      {activeTab === "gpus" && (
        <div className="grid-2">
          {!latest.gpus || latest.gpus.length === 0 ? (
            <div style={{ padding: "16px", color: "var(--text-muted)", textAlign: "center", gridColumn: "span 2" }}>
              No GPU devices reported.
            </div>
          ) : (
            latest.gpus.map((gpu) => {
              const vramPct = (gpu.memoryUsedBytes / (gpu.memoryTotalBytes || 1)) * 100;
              return (
                <div key={gpu.id} className="card" style={{ background: "rgba(0,0,0,0.2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                    <strong style={{ color: "var(--accent-indigo)", fontSize: "13px" }}>{gpu.name}</strong>
                    <Badge variant="live">{formatPercent(gpu.utilizationPercent)} Core</Badge>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "11px" }}>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                        <span>VRAM Usage:</span>
                        <span className="mono">{formatBytes(gpu.memoryUsedBytes)} / {formatBytes(gpu.memoryTotalBytes)} ({formatPercent(vramPct)})</span>
                      </div>
                      <div className="progress-bar-bg">
                        <div className="progress-bar-fill" style={{ width: `${vramPct}%`, background: "var(--accent-indigo)" }} />
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", paddingTop: "4px" }}>
                      <div>Frequency: <strong className="mono">{formatFrequency(gpu.frequencyMHz)}</strong></div>
                      <div>Temp: <strong className="mono">{formatTemp(gpu.temperatureC)}</strong></div>
                      <div>Decode Engine: <strong className="mono">{formatPercent(gpu.decodeUtilizationPercent)}</strong></div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab Content: Fans & Thermal */}
      {activeTab === "fans" && (
        <div style={{ overflowX: "auto" }}>
          {!latest.fans || latest.fans.length === 0 ? (
            <div style={{ padding: "16px", color: "var(--text-muted)", textAlign: "center" }}>
              No fans or cooling sensors reported.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fan Sensor Label</th>
                  <th>Interface</th>
                  <th>Speed (RPM)</th>
                  <th>Control Mode</th>
                  <th>Target Temp</th>
                  <th>Custom Note</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {latest.fans.map((fan) => (
                  <tr key={fan.id}>
                    <td>
                      <strong style={{ color: "var(--text-main)" }}>{fan.label}</strong>
                    </td>
                    <td className="mono">{fan.interface}</td>
                    <td className="mono" style={{ color: "var(--accent-cyan)", fontWeight: 700 }}>
                      {fan.rpm} RPM
                    </td>
                    <td>
                      <Badge variant="info">{fan.controlMode || "Auto"}</Badge>
                    </td>
                    <td className="mono">{formatTemp(fan.targetTemperatureC)}</td>
                    <td style={{ color: "var(--text-secondary)", fontStyle: fan.note ? "normal" : "italic" }}>
                      {fan.note || "No note added"}
                    </td>
                    <td>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() =>
                          setFanNoteModalOpen({
                            deviceId: snapshot?.selectedDeviceId || "local",
                            fanId: fan.id,
                            currentNote: fan.note || ""
                          })
                        }
                      >
                        ✏️ Edit Note
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab Content: CPU Packages */}
      {activeTab === "cpu" && (
        <div>
          {!latest.cpuPackages || latest.cpuPackages.length === 0 ? (
            <div style={{ padding: "16px", color: "var(--text-muted)", textAlign: "center" }}>
              No individual CPU packages reported.
            </div>
          ) : (
            <div className="grid-2">
              {latest.cpuPackages.map((pkg) => (
                <div key={pkg.id} className="card" style={{ background: "rgba(0,0,0,0.2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                    <strong style={{ color: "var(--accent-cyan)", fontSize: "13px" }}>{pkg.name}</strong>
                    <Badge variant="live">{formatPercent(pkg.usagePercent)}</Badge>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "11px" }}>
                    <div>Model: <span className="mono">{pkg.model || pkg.name}</span></div>
                    <div>Cores / Threads: <span className="mono">{pkg.coreCount || "—"} / {pkg.logicalCount || "—"}</span></div>
                    <div>Clock Speed: <span className="mono">{formatFrequency(pkg.frequencyMHz)}</span></div>
                    <div>Temperature: <span className="mono">{formatTemp(pkg.temperatureC)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Sensor Backends */}
      {activeTab === "backends" && (
        <div className="grid-3">
          {latest.sensorBackends && latest.sensorBackends.length > 0 ? (
            latest.sensorBackends.map((sb) => (
              <div key={sb.id} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <strong style={{ color: "var(--text-main)", fontSize: "12px" }}>{sb.label}</strong>
                  {sb.detail && <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>{sb.detail}</div>}
                </div>
                <Badge variant={sb.ok ? "online" : "error"}>{sb.ok ? "Active" : "Error"}</Badge>
              </div>
            ))
          ) : (
            <div style={{ padding: "16px", color: "var(--text-muted)", textAlign: "center", gridColumn: "span 3" }}>
              No sensor backend statuses available.
            </div>
          )}
        </div>
      )}

      {/* Tab Content: System Handles & Threads */}
      {activeTab === "system" && (
        <div className="grid-3">
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>Total System Processes</div>
            <div className="mono" style={{ fontSize: "20px", fontWeight: 700, color: "var(--accent-cyan)" }}>
              {latest.system?.processCount || "—"}
            </div>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>Active Threads</div>
            <div className="mono" style={{ fontSize: "20px", fontWeight: 700, color: "var(--accent-emerald)" }}>
              {latest.system?.threadCount || "—"}
            </div>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>Allocated Handles</div>
            <div className="mono" style={{ fontSize: "20px", fontWeight: 700, color: "var(--accent-amber)" }}>
              {latest.system?.handleCount || "—"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
