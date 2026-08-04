import React, { useState } from "react";
import { useConsole } from "../../context/ConsoleContext";

export const AuthModal: React.FC = () => {
  const {
    snapshot,
    accessKeyModalOpen,
    setAccessKeyModalOpen,
    loginHub,
    logoutHub,
    secretModalOpen,
    setSecretModalOpen,
    saveSecret,
    fanNoteModalOpen,
    setFanNoteModalOpen,
    submitFanNote
  } = useConsole();

  const [inputKey, setInputKey] = useState("");
  const [inputSecret, setInputSecret] = useState("");
  const [fanNoteText, setFanNoteText] = useState(fanNoteModalOpen?.currentNote || "");

  if (!accessKeyModalOpen && !secretModalOpen && !fanNoteModalOpen) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px"
      }}
    >
      {/* 1. Global Hub Access Key Modal */}
      {accessKeyModalOpen && (
        <div className="card" style={{ width: "420px", background: "var(--bg-card)", border: "1px solid var(--border-muted)" }}>
          <div className="card-header">
            <h3 className="card-title">🔑 Global Hub Access Key</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => setAccessKeyModalOpen(false)}>
              ✕
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Authenticate with the global Hub access key to view remote fleet devices and fetch synchronized telemetry.
            </p>

            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              Current Status:{" "}
              {snapshot?.session?.accessKeyConfigured ? (
                <strong style={{ color: "var(--status-online)" }}>Key Configured & Active</strong>
              ) : (
                <strong style={{ color: "var(--status-warning)" }}>No Key Configured</strong>
              )}
            </div>

            <div>
              <label style={{ display: "block", fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                Enter Global Access Key:
              </label>
              <input
                type="password"
                className="input-text"
                placeholder="Paste Hub access key..."
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
              {snapshot?.session?.accessKeyConfigured ? (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={async () => {
                    await logoutHub();
                    setAccessKeyModalOpen(false);
                  }}
                >
                  Logout & Clear Key
                </button>
              ) : (
                <div />
              )}

              <div style={{ display: "flex", gap: "8px" }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setAccessKeyModalOpen(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!inputKey.trim()}
                  onClick={async () => {
                    await loginHub(inputKey.trim());
                    setInputKey("");
                  }}
                >
                  Save & Login
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Agent Secret Modal */}
      {secretModalOpen && (
        <div className="card" style={{ width: "420px", background: "var(--bg-card)", border: "1px solid var(--border-muted)" }}>
          <div className="card-header">
            <h3 className="card-title">🔐 Set Agent Connection Secret</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => setSecretModalOpen(false)}>
              ✕
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              The Agent secret authenticates your local collector with the Hub. The secret is saved securely in the main process and is never exposed in logs or renderer state.
            </p>

            <div>
              <label style={{ display: "block", fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                New Agent Secret:
              </label>
              <input
                type="password"
                className="input-text"
                placeholder="Enter new secret key..."
                value={inputSecret}
                onChange={(e) => setInputSecret(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setSecretModalOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={!inputSecret.trim()}
                onClick={async () => {
                  await saveSecret(inputSecret.trim());
                  setInputSecret("");
                }}
              >
                Save Secret
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Fan Note Modal */}
      {fanNoteModalOpen && (
        <div className="card" style={{ width: "420px", background: "var(--bg-card)", border: "1px solid var(--border-muted)" }}>
          <div className="card-header">
            <h3 className="card-title">✏️ Edit Fan Sensor Note</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => setFanNoteModalOpen(null)}>
              ✕
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Attach a custom descriptive note to fan sensor ID <strong className="mono">{fanNoteModalOpen.fanId}</strong>.
            </p>

            <input
              type="text"
              className="input-text"
              placeholder="e.g. AIO Pump, Front Intake Array..."
              value={fanNoteText}
              onChange={(e) => setFanNoteText(e.target.value)}
              style={{ width: "100%" }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setFanNoteModalOpen(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  await submitFanNote(fanNoteModalOpen.fanId, fanNoteText);
                }}
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
