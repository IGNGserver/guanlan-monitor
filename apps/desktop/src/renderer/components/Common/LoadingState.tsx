import React from "react";

export const LoadingState: React.FC = () => {
  return (
    <div style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div className="card animate-pulse" style={{ height: "120px", background: "rgba(255, 255, 255, 0.03)" }} />
      <div className="grid-3">
        <div className="card animate-pulse" style={{ height: "180px", background: "rgba(255, 255, 255, 0.03)" }} />
        <div className="card animate-pulse" style={{ height: "180px", background: "rgba(255, 255, 255, 0.03)" }} />
        <div className="card animate-pulse" style={{ height: "180px", background: "rgba(255, 255, 255, 0.03)" }} />
      </div>
      <div className="card animate-pulse" style={{ height: "240px", background: "rgba(255, 255, 255, 0.03)" }} />
    </div>
  );
};
