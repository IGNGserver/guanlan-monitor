import React from "react";
import { useGuanlan } from "../../context/GuanlanContext";

export const ToastRegion: React.FC = () => {
  const { toasts, removeToast } = useGuanlan();

  if (toasts.length === 0) return null;

  return (
    <div className="gl-toast-region" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="gl-toast">
          <div className="gl-toast-content">
            <div className="gl-toast-title">
              {toast.type === "success" && "✅ "}
              {toast.type === "error" && "❌ "}
              {toast.type === "warning" && "⚠️ "}
              {toast.type === "info" && "ℹ️ "}
              {toast.title}
            </div>
            <div className="gl-toast-text">{toast.text}</div>
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--gl-text-muted)",
              fontSize: 12,
              padding: 2
            }}
            aria-label="关闭通知"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
};
