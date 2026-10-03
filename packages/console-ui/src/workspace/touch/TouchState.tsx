import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { DeviceDirectorySort, DeviceDirectoryStatus } from "../selectors";
import type { SettingsSection } from "../routes";
import type { DeviceTabId } from "../dashboard";

export type TouchPanel = "status" | "trends" | "hardware";
export interface TouchDetailState { panel: TouchPanel; tab: DeviceTabId; }
function useTouchStateValue() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<DeviceDirectoryStatus>("all");
  const [sort, setSort] = useState<DeviceDirectorySort>("order");
  const [pins, setPins] = useState<string[]>([]);
  const [settingsCategory, setSettingsCategory] = useState<SettingsSection | null>(null);
  const [details, setDetails] = useState<Record<string, TouchDetailState>>({});
  const scroll = useRef(new Map<string, number>());
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("dsc-pinned-devices") ?? "[]");
      if (Array.isArray(saved)) setPins(saved.filter((id): id is string => typeof id === "string").slice(0, 32));
    } catch { /* Storage is optional, including in private browsing. */ }
  }, []);
  const togglePin = (id: string) => setPins((current) => {
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current.slice(-31), id];
    try { localStorage.setItem("dsc-pinned-devices", JSON.stringify(next)); } catch { /* In-memory pins still work. */ }
    return next;
  });
  return { query, setQuery, status, setStatus, sort, setSort, pins, togglePin, settingsCategory, setSettingsCategory, details, setDetails, scroll };
}
const TouchState = createContext<ReturnType<typeof useTouchStateValue> | null>(null);
/** Lives outside the adaptive branches: rotation never discards a user's place. */
export function TouchStateProvider({ children }: { children: React.ReactNode }) {
  const value = useTouchStateValue();
  return <TouchState.Provider value={value}>{children}</TouchState.Provider>;
}
export function useTouchState() {
  const value = useContext(TouchState);
  if (!value) throw new Error("TouchStateProvider is required");
  return value;
}
export function useTouchDetail(deviceId: string) {
  const { details, setDetails } = useTouchState();
  const view = details[deviceId] ?? { panel: "status" as const, tab: "overview" as const };
  return [view, (patch: Partial<TouchDetailState>) => setDetails((current) => ({ ...current, [deviceId]: { ...view, ...patch } }))] as const;
}
