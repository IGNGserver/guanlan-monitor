import React, { useState } from "react";
import { useGuanlan, GuanlanNavTab } from "../../context/GuanlanContext";
import { useLayout } from "../../context/LayoutContext";

interface NavItemDef {
  key: GuanlanNavTab;
  label: string;
  icon: string;
}

const navItems: NavItemDef[] = [
  { key: "overview", label: "总览", icon: "📊" },
  { key: "devices", label: "设备", icon: "💻" },
  { key: "history", label: "历史", icon: "📈" },
  { key: "this-device", label: "此设备", icon: "⚙️" },
  { key: "diagnostics", label: "诊断", icon: "🩺" },
  { key: "settings", label: "设置", icon: "🛠️" }
];

export const GuanlanNav: React.FC = () => {
  const { activeTab, setActiveTab } = useGuanlan();
  const { isCompact, isMedium } = useLayout();
  const [moreOpen, setMoreOpen] = useState(false);

  if (isCompact) {
    // Primary 4 tabs + More popover for 390px narrow viewports to prevent cramped text
    const primaryNav = navItems.slice(0, 4);
    const secondaryNav = navItems.slice(4);

    const isSecondaryActive = secondaryNav.some((item) => item.key === activeTab);

    return (
      <nav className="gl-bottom-nav" aria-label="移动与窄视口底栏导航">
        {primaryNav.map((item) => {
          const active = activeTab === item.key;
          return (
            <button
              type="button"
              key={item.key}
              className={`gl-bottom-nav-item ${active ? "active" : ""}`}
              onClick={() => {
                setActiveTab(item.key);
                setMoreOpen(false);
              }}
              aria-current={active ? "page" : undefined}
            >
              <span style={{ fontSize: 16 }} aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}

        {/* More Tab with Accessible Popover */}
        <div style={{ position: "relative", display: "flex", height: "100%", minWidth: 0, width: "100%" }}>
          <button
            type="button"
            className={`gl-bottom-nav-item ${isSecondaryActive ? "active" : ""}`}
            onClick={() => setMoreOpen(!moreOpen)}
            aria-expanded={moreOpen}
            aria-label="更多导航选项"
            style={{ width: "100%", height: "100%" }}
          >
            <span style={{ fontSize: 16 }} aria-hidden="true">⋯</span>
            <span>更多</span>
          </button>

          {moreOpen && (
            <>
              <div
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 99
                }}
                onClick={() => setMoreOpen(false)}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 60,
                  right: 4,
                  backgroundColor: "var(--gl-surface-layer-1)",
                  border: "1px solid var(--gl-border-strong)",
                  borderRadius: "var(--gl-radius-md)",
                  boxShadow: "var(--gl-shadow-md)",
                  display: "flex",
                  flexDirection: "column",
                  padding: 6,
                  minWidth: 130,
                  zIndex: 100
                }}
              >
                {secondaryNav.map((item) => {
                  const active = activeTab === item.key;
                  return (
                    <button
                      type="button"
                      key={item.key}
                      className={`gl-nav-item ${active ? "active" : ""}`}
                      onClick={() => {
                        setActiveTab(item.key);
                        setMoreOpen(false);
                      }}
                      style={{ justifyContent: "flex-start", margin: 0, padding: "8px 12px", height: "auto" }}
                    >
                      <span style={{ fontSize: 16 }} aria-hidden="true">{item.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </nav>
    );
  }

  return (
    <nav className="gl-nav-rail" aria-label="主侧栏导航">
      {navItems.map((item) => {
        const active = activeTab === item.key;
        return (
          <button
            type="button"
            key={item.key}
            className={`gl-nav-item ${active ? "active" : ""}`}
            onClick={() => setActiveTab(item.key)}
            title={isMedium ? item.label : undefined}
            aria-current={active ? "page" : undefined}
          >
            <span style={{ fontSize: 16, flexShrink: 0 }} aria-hidden="true">{item.icon}</span>
            {!isMedium && <span>{item.label}</span>}
          </button>
        );
      })}
    </nav>
  );
};
