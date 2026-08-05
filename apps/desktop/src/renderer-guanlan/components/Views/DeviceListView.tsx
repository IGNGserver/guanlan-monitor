import React from "react";
import { useGuanlan } from "../../context/GuanlanContext";
import { SpectrumCard } from "../Common/SpectrumCard";
import { SpectrumBadge } from "../Common/SpectrumBadge";
import { SpectrumInput } from "../Common/SpectrumInput";
import { EmptyState } from "../Common/EmptyState";
import { SpectrumButton } from "../Common/SpectrumButton";

export const DeviceListView: React.FC = () => {
  const {
    snapshot,
    loading,
    error,
    selectedDeviceId,
    setSelectedDeviceId,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    refresh
  } = useGuanlan();

  if (loading && !snapshot) return <EmptyState variant="loading" title="加载设备节点列表..." />;

  if (error && !snapshot) {
    return (
      <EmptyState
        variant="error"
        title="获取设备列表失败"
        description={error}
        actionLabel="重试"
        onAction={refresh}
      />
    );
  }

  if (!snapshot) return <EmptyState variant="loading" />;

  const devices = snapshot.devices || [];

  const filteredDevices = devices.filter((dev) => {
    const matchesSearch =
      dev.hostname.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dev.deviceId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dev.os.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === "all" ? true : statusFilter === "online" ? dev.status === "online" : dev.status === "offline";

    return matchesSearch && matchesStatus;
  });

  const selectedDevice = devices.find((d) => d.deviceId === selectedDeviceId) || devices[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Read-Only Remote Device Notice Banner */}
      <div
        style={{
          padding: "10px 14px",
          backgroundColor: "var(--gl-surface-quiet)",
          border: "1px solid var(--gl-border-muted)",
          borderRadius: "var(--gl-radius-md)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 12
        }}
      >
        <span aria-hidden="true">🔒</span>
        <div>
          <strong style={{ color: "var(--gl-text-primary)" }}>远端设备视图 — 只读安全策略</strong>
          <span style={{ color: "var(--gl-text-secondary)", marginLeft: 6 }}>
            远端节点的采集参数与硬件信息保持只读模式。修改本机 Agent 参数请转至「此设备」页面。
          </span>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 260 }}>
          <label htmlFor="device-search-input" className="sr-only">
            搜索设备
          </label>
          <SpectrumInput
            id="device-search-input"
            aria-label="搜索 Hostname / 设备 ID / 操作系统"
            placeholder="搜索 Hostname / 设备 ID / 操作系统..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: "100%", maxWidth: 360 }}
          />
        </div>

        <div style={{ display: "flex", gap: 4 }} role="group" aria-label="设备状态筛选">
          {(["all", "online", "offline"] as const).map((filter) => (
            <SpectrumButton
              key={filter}
              variant={statusFilter === filter ? "primary" : "secondary"}
              size="sm"
              onClick={() => setStatusFilter(filter)}
              aria-pressed={statusFilter === filter}
            >
              {filter === "all" && "全部节点"}
              {filter === "online" && "🟢 在线"}
              {filter === "offline" && "⚪ 离线"}
            </SpectrumButton>
          ))}
        </div>
      </div>

      {/* Main Split / Grid View */}
      <div className="gl-grid-adaptive-2">
        {/* Device Fleet List */}
        <SpectrumCard title={`设备节点列表 (${filteredDevices.length})`}>
          {filteredDevices.length === 0 ? (
            <EmptyState variant="empty" title="没有匹配的设备节点" description="请尝试调整搜索关键字或筛选选项。" />
          ) : (
            <div className="gl-table-container">
              <table className="gl-table">
                <thead>
                  <tr>
                    <th style={{ width: 44, textAlign: "center" }}>选择</th>
                    <th>主机名 / ID</th>
                    <th>系统</th>
                    <th>状态</th>
                    <th>CPU 使用率</th>
                    <th>内存</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDevices.map((dev) => {
                    const isSelected = dev.deviceId === selectedDevice?.deviceId;
                    return (
                      <tr
                        key={dev.deviceId}
                        aria-selected={isSelected}
                        style={{
                          backgroundColor: isSelected ? "var(--gl-accent-quiet)" : undefined
                        }}
                      >
                        <td style={{ textAlign: "center" }}>
                          <input
                            type="radio"
                            id={`select-device-${dev.deviceId}`}
                            name="device-selection"
                            checked={isSelected}
                            onChange={() => setSelectedDeviceId(dev.deviceId)}
                            aria-label={`选择设备 ${dev.hostname} (${dev.deviceId})`}
                            style={{ cursor: "pointer", accentColor: "var(--gl-accent-base)", margin: 0 }}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => setSelectedDeviceId(dev.deviceId)}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              font: "inherit",
                              color: "inherit",
                              cursor: "pointer",
                              textAlign: "left",
                              width: "100%",
                              display: "block"
                            }}
                            aria-label={`查看设备 ${dev.hostname} 详情`}
                          >
                            <div style={{ fontWeight: isSelected ? 600 : 400, color: "var(--gl-text-primary)" }}>
                              {dev.hostname}
                            </div>
                            <div style={{ fontSize: 10, color: "var(--gl-text-muted)", fontFamily: "var(--gl-font-mono)" }}>
                              {dev.deviceId}
                            </div>
                          </button>
                        </td>
                        <td style={{ textTransform: "capitalize" }}>
                          {dev.os} {dev.agentVersion ? `v${dev.agentVersion}` : ""}
                        </td>
                        <td>
                          {dev.status === "online" ? (
                            <SpectrumBadge status="online" label="在线" />
                          ) : (
                            <SpectrumBadge status="offline" label="离线" />
                          )}
                        </td>
                        <td style={{ fontFamily: "var(--gl-font-mono)" }}>
                          {dev.cpuUsagePercent != null ? `${dev.cpuUsagePercent}%` : "—"}
                        </td>
                        <td style={{ fontFamily: "var(--gl-font-mono)" }}>
                          {dev.memoryUsagePercent != null ? `${dev.memoryUsagePercent}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SpectrumCard>

        {/* Selected Remote Device Detail View */}
        {selectedDevice ? (
          <SpectrumCard title={`设备只读详情: ${selectedDevice.hostname}`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--gl-border-subtle)", paddingBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{selectedDevice.hostname}</span>
                {selectedDevice.status === "online" ? (
                  <SpectrumBadge status="online" label="实时通道激活" />
                ) : (
                  <SpectrumBadge status="offline" label="断开连接" />
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12 }}>
                <div>
                  <div style={{ color: "var(--gl-text-muted)" }}>设备 ID (deviceId)</div>
                  <div style={{ fontFamily: "var(--gl-font-mono)", fontWeight: 500 }}>{selectedDevice.deviceId}</div>
                </div>
                <div>
                  <div style={{ color: "var(--gl-text-muted)" }}>操作系统 / Agent</div>
                  <div style={{ fontWeight: 500, textTransform: "capitalize" }}>
                    {selectedDevice.os} {selectedDevice.agentVersion ? `(v${selectedDevice.agentVersion})` : ""}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--gl-text-muted)" }}>最后心跳 (lastSeenAt)</div>
                  <div style={{ fontSize: 11 }}>
                    {selectedDevice.lastSeenAt ? new Date(selectedDevice.lastSeenAt).toLocaleString() : "未记录"}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--gl-text-muted)" }}>GPU / 显存使用率</div>
                  <div>
                    {selectedDevice.gpuUsagePercent != null ? `${selectedDevice.gpuUsagePercent}%` : "未检测到"}
                    {selectedDevice.gpuMemoryUsagePercent != null ? ` (显存 ${selectedDevice.gpuMemoryUsagePercent}%)` : ""}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--gl-text-muted)" }}>磁盘占用率</div>
                  <div>{selectedDevice.diskUsagePercent != null ? `${selectedDevice.diskUsagePercent}%` : "未检测到"}</div>
                </div>
              </div>

              {/* Read-Only Device Policy Presentation */}
              <div style={{ borderTop: "1px solid var(--gl-border-subtle)", paddingTop: 12, marginTop: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--gl-text-primary)", marginBottom: 4 }}>
                  🔒 远端节点只读策略
                </div>
                <div style={{ fontSize: 11, color: "var(--gl-text-muted)", lineHeight: 1.5 }}>
                  该节点为远端采集节点，仅支持只读遥测与运行状态监控。修改本机 Agent 参数与参数配置请转至「此设备」页面。
                </div>
              </div>
            </div>
          </SpectrumCard>
        ) : (
          <SpectrumCard>
            <EmptyState variant="empty" title="请选择要查看的设备" />
          </SpectrumCard>
        )}
      </div>
    </div>
  );
};
