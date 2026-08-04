import React from "react";
import { useConsole } from "../../context/ConsoleContext";

export const StatusBanner: React.FC = () => {
  const {
    snapshot,
    hasPendingChanges,
    applyPendingChanges,
    discardPendingChanges,
    toastMessage,
    dismissToast
  } = useConsole();

  const isCache = snapshot?.source === "cache";
  const isEmpty = snapshot?.source === "empty";
  const localBackend = snapshot?.localBackend;
  const isCollectorStopped = localBackend && !localBackend.running;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {/* Toast Notification Bar */}
      {toastMessage && (
        <div
          style={{
            padding: "8px 16px",
            background:
              toastMessage.type === "success"
                ? "rgba(52, 211, 153, 0.15)"
                : toastMessage.type === "error"
                ? "rgba(248, 113, 113, 0.15)"
                : toastMessage.type === "warning"
                ? "rgba(251, 191, 36, 0.15)"
                : "rgba(56, 189, 248, 0.15)",
            borderBottom: `1px solid ${
              toastMessage.type === "success"
                ? "rgba(52, 211, 153, 0.4)"
                : toastMessage.type === "error"
                ? "rgba(248, 113, 113, 0.4)"
                : toastMessage.type === "warning"
                ? "rgba(251, 191, 36, 0.4)"
                : "rgba(56, 189, 248, 0.4)"
            }`,
            color: "var(--text-main)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "12px"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span>
              {toastMessage.type === "success"
                ? "✅"
                : toastMessage.type === "error"
                ? "❌"
                : toastMessage.type === "warning"
                ? "⚠️"
                : "ℹ️"}
            </span>
            <strong>{toastMessage.title}:</strong>
            <span>{toastMessage.text}</span>
          </div>
          <button
            onClick={dismissToast}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "14px"
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Visibly Pending Local Config Edits Bar */}
      {hasPendingChanges && (
        <div
          style={{
            padding: "8px 20px",
            background: "rgba(251, 191, 36, 0.12)",
            borderBottom: "1px solid rgba(251, 191, 36, 0.3)",
            color: "var(--accent-amber)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "12px"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span>⚠️</span>
            <strong>Unsaved Local Configuration Changes Pending:</strong>
            <span>You have modified local Agent sampling, probe, or metric settings.</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button className="btn btn-secondary btn-sm" onClick={discardPendingChanges}>
              Discard
            </button>
            <button className="btn btn-primary btn-sm" onClick={applyPendingChanges}>
              Apply Local Changes
            </button>
          </div>
        </div>
      )}

      {/* Cached Data Warning Bar */}
      {isCache && (
        <div
          style={{
            padding: "6px 20px",
            background: "rgba(192, 132, 252, 0.1)",
            borderBottom: "1px solid rgba(192, 132, 252, 0.25)",
            color: "var(--accent-purple)",
            fontSize: "11px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span>📦</span>
            <span>
              <strong>Cached Telemetry Active:</strong> Showing last saved snapshot from local cache.
            </span>
          </div>
          <span>Age: {snapshot?.cache?.ageSeconds ?? "—"}s</span>
        </div>
      )}

      {isEmpty && (
        <div
          style={{
            padding: "6px 20px",
            background: "rgba(248, 113, 113, 0.1)",
            borderBottom: "1px solid rgba(248, 113, 113, 0.25)",
            color: "var(--accent-rose)",
            fontSize: "11px"
          }}
        >
          No live snapshot is available. Start the local Agent backend or configure a Hub access key, then refresh.
        </div>
      )}

      {/* Collector Stopped Warning */}
      {isCollectorStopped && (
        <div
          style={{
            padding: "6px 20px",
            background: "rgba(248, 113, 113, 0.1)",
            borderBottom: "1px solid rgba(248, 113, 113, 0.25)",
            color: "var(--accent-rose)",
            fontSize: "11px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span>🛑</span>
            <span>Local Agent collector service is currently stopped.</span>
          </div>
        </div>
      )}
    </div>
  );
};
