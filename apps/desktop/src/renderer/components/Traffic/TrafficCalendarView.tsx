import React from "react";
import { useConsole } from "../../context/ConsoleContext";
import { formatBytes, formatTimestamp } from "../../utils/formatters";
import type { TrafficCalendarMode } from "@dsc/shared";

export const TrafficCalendarView: React.FC = () => {
  const { snapshot, trafficMode, setTrafficMode } = useConsole();

  const traffic = snapshot?.trafficCalendar;

  if (!traffic) {
    return (
      <div className="card" style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>
        No traffic calendar data available.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Header Summary Banner */}
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h3 style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-main)" }}>{traffic.title}</h3>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
            Scope: {formatTimestamp(traffic.rangeStart)} — {formatTimestamp(traffic.rangeEnd)}
          </div>
        </div>

        {/* Totals */}
        <div style={{ display: "flex", gap: "16px" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)" }}>Total Download (Rx)</div>
            <div className="mono" style={{ fontSize: "15px", fontWeight: 700, color: "var(--accent-cyan)" }}>
              {formatBytes(traffic.totalRxBytes)}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)" }}>Total Upload (Tx)</div>
            <div className="mono" style={{ fontSize: "15px", fontWeight: 700, color: "var(--accent-purple)" }}>
              {formatBytes(traffic.totalTxBytes)}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)" }}>Combined Traffic</div>
            <div className="mono" style={{ fontSize: "15px", fontWeight: 700, color: "var(--accent-emerald)" }}>
              {formatBytes(traffic.totalRxBytes + traffic.totalTxBytes)}
            </div>
          </div>
        </div>

        {/* Calendar Mode Tabs */}
        <div style={{ display: "flex", gap: "4px", background: "rgba(0,0,0,0.3)", padding: "2px", borderRadius: "var(--radius-sm)" }}>
          {(["day", "week", "month"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setTrafficMode(m)}
              style={{
                padding: "4px 12px",
                fontSize: "11px",
                borderRadius: "3px",
                border: "none",
                background: trafficMode === m ? "var(--border-muted)" : "transparent",
                color: trafficMode === m ? "var(--accent-cyan)" : "var(--text-secondary)",
                fontWeight: trafficMode === m ? 600 : 400,
                cursor: "pointer",
                textTransform: "capitalize"
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Traffic Calendar Grid Cells */}
      <div className="grid-3">
        {traffic.cells.map((cell) => (
          <div
            key={cell.key}
            className="card"
            style={{
              borderColor: cell.isSelected ? "var(--accent-cyan)" : undefined,
              background: cell.isSelected ? "var(--bg-card-active)" : undefined,
              display: "flex",
              flexDirection: "column",
              gap: "8px"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: "13px", color: "var(--text-main)" }}>{cell.label}</strong>
              {cell.isCurrentPeriod && <span className="badge badge-live">Current</span>}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "11px" }}>
              <div>
                <span style={{ color: "var(--text-secondary)" }}>Download: </span>
                <strong className="mono" style={{ color: "var(--accent-cyan)" }}>{formatBytes(cell.totalRxBytes)}</strong>
              </div>
              <div>
                <span style={{ color: "var(--text-secondary)" }}>Upload: </span>
                <strong className="mono" style={{ color: "var(--accent-purple)" }}>{formatBytes(cell.totalTxBytes)}</strong>
              </div>
            </div>

            <div className="progress-bar-bg" style={{ marginTop: "4px" }}>
              <div
                className="progress-bar-fill"
                style={{
                  width: `${Math.min(100, Math.max(5, ((cell.totalRxBytes + cell.totalTxBytes) / 25000000000) * 100))}%`,
                  background: "linear-gradient(90deg, #38bdf8 0%, #c084fc 100%)"
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Granular Range Records Table */}
      <div className="card">
        <div className="card-header">
          <h4 className="card-title">Detailed Granular Traffic Records</h4>
        </div>
        {traffic.records.length === 0 ? (
          <div style={{ padding: "16px", color: "var(--text-muted)", textAlign: "center" }}>No records for this timeframe.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Rx Download</th>
                  <th>Tx Upload</th>
                  <th>Total Bandwidth</th>
                </tr>
              </thead>
              <tbody>
                {traffic.records.map((r, idx) => (
                  <tr key={idx}>
                    <td className="mono" style={{ color: "var(--text-main)" }}>{formatTimestamp(r.timestamp)}</td>
                    <td className="mono" style={{ color: "var(--accent-cyan)" }}>{formatBytes(r.rxBytes)}</td>
                    <td className="mono" style={{ color: "var(--accent-purple)" }}>{formatBytes(r.txBytes)}</td>
                    <td className="mono" style={{ color: "var(--accent-emerald)", fontWeight: 700 }}>{formatBytes(r.totalBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
