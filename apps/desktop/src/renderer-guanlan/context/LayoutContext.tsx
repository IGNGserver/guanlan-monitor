import React, { createContext, useContext, useState, useEffect } from "react";
import type { LayoutClass } from "../helpers/layout";
import { getLayoutClass } from "../helpers/layout";

interface LayoutContextType {
  width: number;
  height: number;
  layoutClass: LayoutClass;
  isCompact: boolean;
  isMedium: boolean;
  isExpanded: boolean;
  isLarge: boolean;
}

const LayoutContext = createContext<LayoutContextType | null>(null);

export const LayoutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1024,
    height: typeof window !== "undefined" ? window.innerHeight : 768
  }));

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const layoutClass = getLayoutClass(dimensions.width);

  return (
    <LayoutContext.Provider
      value={{
        width: dimensions.width,
        height: dimensions.height,
        layoutClass,
        isCompact: layoutClass === "compact",
        isMedium: layoutClass === "medium",
        isExpanded: layoutClass === "expanded",
        isLarge: layoutClass === "large"
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
};

export const useLayout = (): LayoutContextType => {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error("useLayout must be used within a LayoutProvider");
  }
  return context;
};
