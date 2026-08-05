import React, { createContext, useContext, useState, useEffect } from "react";
import type { ThemeMode, ContrastMode, MotionMode } from "../helpers/theme";
import { resolveEffectiveTheme } from "../helpers/theme";
import type { InteractionScale, InteractionScaleSetting } from "../helpers/density";
import { resolveInteractionScale } from "../helpers/density";

interface ThemeContextType {
  themeMode: ThemeMode;
  effectiveTheme: "light" | "dark";
  contrastMode: ContrastMode;
  motionMode: MotionMode;
  densitySetting: InteractionScaleSetting;
  effectiveDensity: InteractionScale;
  setThemeMode: (mode: ThemeMode) => void;
  setContrastMode: (mode: ContrastMode) => void;
  setMotionMode: (mode: MotionMode) => void;
  setDensitySetting: (setting: InteractionScaleSetting) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    return (localStorage.getItem("guanlan-theme") as ThemeMode) || "system";
  });

  const [contrastMode, setContrastModeState] = useState<ContrastMode>(() => {
    return (localStorage.getItem("guanlan-contrast") as ContrastMode) || "normal";
  });

  const [motionMode, setMotionModeState] = useState<MotionMode>(() => {
    return (localStorage.getItem("guanlan-motion") as MotionMode) || "full";
  });

  const [densitySetting, setDensitySettingState] = useState<InteractionScaleSetting>(() => {
    return (localStorage.getItem("guanlan-interaction-scale") as InteractionScaleSetting) || "auto";
  });

  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  const [hasTouchSupport, setHasTouchSupport] = useState<boolean>(() => {
    return typeof window !== "undefined" && (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window);
  });

  useEffect(() => {
    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleDarkChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    darkQuery.addEventListener("change", handleDarkChange);

    const touchQuery = window.matchMedia("(pointer: coarse)");
    const handleTouchChange = (e: MediaQueryListEvent) => setHasTouchSupport(e.matches);
    touchQuery.addEventListener("change", handleTouchChange);

    return () => {
      darkQuery.removeEventListener("change", handleDarkChange);
      touchQuery.removeEventListener("change", handleTouchChange);
    };
  }, []);

  const effectiveTheme = resolveEffectiveTheme(themeMode, systemPrefersDark);
  const effectiveDensity = resolveInteractionScale(densitySetting, hasTouchSupport);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", effectiveTheme);
    document.documentElement.setAttribute("data-contrast", contrastMode);
    document.documentElement.setAttribute("data-motion", motionMode);
    document.documentElement.setAttribute("data-density", effectiveDensity);
  }, [effectiveTheme, contrastMode, motionMode, effectiveDensity]);

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    localStorage.setItem("guanlan-theme", mode);
  };

  const setContrastMode = (mode: ContrastMode) => {
    setContrastModeState(mode);
    localStorage.setItem("guanlan-contrast", mode);
  };

  const setMotionMode = (mode: MotionMode) => {
    setMotionModeState(mode);
    localStorage.setItem("guanlan-motion", mode);
  };

  const setDensitySetting = (setting: InteractionScaleSetting) => {
    setDensitySettingState(setting);
    localStorage.setItem("guanlan-interaction-scale", setting);
  };

  return (
    <ThemeContext.Provider
      value={{
        themeMode,
        effectiveTheme,
        contrastMode,
        motionMode,
        densitySetting,
        effectiveDensity,
        setThemeMode,
        setContrastMode,
        setMotionMode,
        setDensitySetting
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
