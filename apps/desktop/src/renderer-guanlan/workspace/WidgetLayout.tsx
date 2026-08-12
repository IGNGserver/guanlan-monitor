import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type WidgetSize = "large" | "medium" | "small";
export type WidgetKind = "group" | "content";

export type WidgetPlacement = {
  x: number;
  y: number;
  w: number;
  h: number;
  size: WidgetSize;
  hidden: boolean;
};

type WidgetDefinition = {
  id: string;
  title: string;
  kind: WidgetKind;
  defaultSize: WidgetSize;
  templateId?: string;
};

type WidgetCatalogEntry = Omit<WidgetDefinition, "id">;

type WidgetScope = {
  templateKey?: string;
  placements: Record<string, WidgetPlacement>;
  catalog: Record<string, WidgetCatalogEntry>;
};

type WidgetStore = {
  version: 2;
  scopes: Record<string, WidgetScope>;
  templates: Record<string, WidgetScope>;
};

type ResolvedWidget = {
  size: WidgetSize;
  hidden: boolean;
  placement?: WidgetPlacement;
};

export type HiddenWidget = WidgetDefinition & {
  scopeKey: string;
  scopeLabel?: string;
};

type WidgetLayoutExport = {
  kind: "dsc-widget-layout";
  version: 2;
  exportedAt: string;
  templateKey: string;
  scope: WidgetScope;
  template: WidgetScope;
  regions: Array<{
    suffix: string;
    templateKey: string;
    scope: WidgetScope;
    template: WidgetScope;
  }>;
};

type WidgetLayoutContextValue = {
  scopeKey: string;
  templateKey: string;
  editable: boolean;
  locked: boolean;
  editMode: boolean;
  setEditMode: (value: React.SetStateAction<boolean>) => void;
  resolveWidget: (definition: WidgetDefinition) => ResolvedWidget;
  registerWidget: (definition: WidgetDefinition) => void;
  updateSize: (id: string, size: WidgetSize) => void;
  hideWidget: (id: string) => void;
  restoreWidget: (id: string, targetScopeKey?: string) => void;
  reorderWidgets: (draggedId: string, targetId: string) => void;
  resetDeviceLayout: () => void;
  saveAsTemplate: () => void;
  exportLayout: () => void;
  importLayout: (json: string) => boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  hasLocalOverride: boolean;
  hasTemplate: boolean;
  hiddenWidgets: HiddenWidget[];
};

const STORAGE_KEY = "dsc-desktop-widget-layout-v2";
const LEGACY_STORAGE_KEY = "dsc-desktop-widget-layout-v1";
const STORAGE_EVENT = "dsc-widget-layout-changed";
const GRID_COLUMNS = 12;
const HISTORY_LIMIT = 30;
const DEFAULT_SIZE: WidgetSize = "medium";

const SIZE_PRESETS: Record<WidgetSize, Pick<WidgetPlacement, "w" | "h">> = {
  large: { w: 12, h: 6 },
  medium: { w: 6, h: 6 },
  small: { w: 3, h: 3 }
};

const WidgetLayoutContext = createContext<WidgetLayoutContextValue | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWidgetSize(value: unknown): value is WidgetSize {
  return value === "large" || value === "medium" || value === "small";
}

function isWidgetKind(value: unknown): value is WidgetKind {
  return value === "group" || value === "content";
}

function createScope(templateKey?: string): WidgetScope {
  return { templateKey, placements: {}, catalog: {} };
}

function createStore(): WidgetStore {
  return { version: 2, scopes: {}, templates: {} };
}

function createPlacement(size: WidgetSize, x = 1, y = 1, hidden = false): WidgetPlacement {
  const preset = SIZE_PRESETS[size];
  return {
    x: Math.max(1, Math.min(Math.round(x), GRID_COLUMNS - preset.w + 1)),
    y: Math.max(1, Math.round(y)),
    w: preset.w,
    h: preset.h,
    size,
    hidden
  };
}

function normalizePlacement(value: unknown): WidgetPlacement | null {
  if (!isRecord(value)) return null;
  const size = isWidgetSize(value.size) ? value.size : DEFAULT_SIZE;
  const preset = SIZE_PRESETS[size];
  const x = Number.isFinite(value.x) ? Number(value.x) : 1;
  const y = Number.isFinite(value.y) ? Number(value.y) : 1;
  return {
    x: Math.max(1, Math.min(Math.round(x), GRID_COLUMNS - preset.w + 1)),
    y: Math.max(1, Math.round(y)),
    w: preset.w,
    h: preset.h,
    size,
    hidden: value.hidden === true
  };
}

function normalizeCatalog(value: unknown): Record<string, WidgetCatalogEntry> {
  if (!isRecord(value)) return {};
  const catalog: Record<string, WidgetCatalogEntry> = {};
  for (const [id, rawEntry] of Object.entries(value)) {
    if (!isRecord(rawEntry) || typeof rawEntry.title !== "string") continue;
    const entry: WidgetCatalogEntry = {
      title: rawEntry.title,
      kind: isWidgetKind(rawEntry.kind) ? rawEntry.kind : "content",
      defaultSize: isWidgetSize(rawEntry.defaultSize) ? rawEntry.defaultSize : DEFAULT_SIZE
    };
    if (typeof rawEntry.templateId === "string" && rawEntry.templateId) entry.templateId = rawEntry.templateId;
    catalog[id] = entry;
  }
  return catalog;
}

function cloneScope(scope: WidgetScope): WidgetScope {
  return {
    templateKey: scope.templateKey,
    placements: Object.fromEntries(Object.entries(scope.placements).map(([id, placement]) => [id, { ...placement }])),
    catalog: { ...scope.catalog }
  };
}

function intersects(left: WidgetPlacement, right: WidgetPlacement): boolean {
  return left.x < right.x + right.w && left.x + left.w > right.x && left.y < right.y + right.h && left.y + left.h > right.y;
}

function findNextFreePlacement(
  placements: Record<string, WidgetPlacement>,
  size: WidgetSize,
  preferredX = 1,
  preferredY = 1
): Pick<WidgetPlacement, "x" | "y"> {
  const preset = SIZE_PRESETS[size];
  const startY = Math.max(1, Math.round(preferredY));
  const startX = Math.max(1, Math.min(Math.round(preferredX), GRID_COLUMNS - preset.w + 1));
  const existing = Object.values(placements);

  for (let y = startY; y < startY + 1000; y += 1) {
    const firstX = y === startY ? startX : 1;
    for (let x = firstX; x <= GRID_COLUMNS - preset.w + 1; x += 1) {
      const candidate = createPlacement(size, x, y);
      if (existing.every((placement) => !intersects(candidate, placement))) return { x, y };
    }
  }

  const lastRow = existing.reduce((max, placement) => Math.max(max, placement.y + placement.h), 1);
  return { x: 1, y: lastRow };
}

function normalizePlacements(placements: Record<string, WidgetPlacement>): Record<string, WidgetPlacement> {
  const result: Record<string, WidgetPlacement> = {};
  const entries = Object.entries(placements).sort(([, left], [, right]) => left.y - right.y || left.x - right.x);
  for (const [id, placement] of entries) {
    const nextPosition = findNextFreePlacement(result, placement.size, placement.x, placement.y);
    result[id] = { ...placement, ...nextPosition };
  }
  return result;
}

function migrateLegacyScope(value: unknown): WidgetScope {
  const raw = isRecord(value) ? value : {};
  const catalog = normalizeCatalog(raw.catalog);
  const placements: Record<string, WidgetPlacement> = {};
  const legacyOrder = Array.isArray(raw.order) ? raw.order.filter((id): id is string => typeof id === "string") : Object.keys(catalog);
  const legacyPreferences = isRecord(raw.preferences) ? raw.preferences : {};
  const ids = [...new Set([...legacyOrder, ...Object.keys(catalog)])];

  for (const id of ids) {
    const entry = catalog[id];
    const preference = isRecord(legacyPreferences[id]) ? legacyPreferences[id] : {};
    const size = isWidgetSize(preference.size) ? preference.size : entry?.defaultSize ?? DEFAULT_SIZE;
    const position = findNextFreePlacement(placements, size);
    placements[id] = createPlacement(size, position.x, position.y, preference.hidden === true);
  }

  return { placements, catalog };
}

function normalizeScope(value: unknown): WidgetScope {
  const raw = isRecord(value) ? value : {};
  const catalog = normalizeCatalog(raw.catalog);
  const placements: Record<string, WidgetPlacement> = {};
  if (isRecord(raw.placements)) {
    for (const [id, rawPlacement] of Object.entries(raw.placements)) {
      const placement = normalizePlacement(rawPlacement);
      if (placement) placements[id] = placement;
    }
  }

  if (Array.isArray(raw.order) || isRecord(raw.preferences)) return migrateLegacyScope(value);
  return {
    templateKey: typeof raw.templateKey === "string" ? raw.templateKey : undefined,
    placements: normalizePlacements(placements),
    catalog
  };
}

function parseStore(value: unknown): WidgetStore | null {
  if (!isRecord(value)) return null;
  if (value.version === 2) {
    const scopes: Record<string, WidgetScope> = {};
    const templates: Record<string, WidgetScope> = {};
    if (isRecord(value.scopes)) {
      for (const [key, scope] of Object.entries(value.scopes)) scopes[key] = normalizeScope(scope);
    }
    if (isRecord(value.templates)) {
      for (const [key, scope] of Object.entries(value.templates)) templates[key] = normalizeScope(scope);
    }
    return { version: 2, scopes, templates };
  }
  if (value.version === 1 && isRecord(value.scopes)) {
    const scopes: Record<string, WidgetScope> = {};
    for (const [key, scope] of Object.entries(value.scopes)) scopes[key] = migrateLegacyScope(scope);
    return { version: 2, scopes, templates: {} };
  }
  return null;
}

function readStore(): WidgetStore {
  if (typeof window === "undefined") return createStore();
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const parsed = parseStore(JSON.parse(window.localStorage.getItem(key) ?? "null"));
      if (parsed) return parsed;
    } catch {
      // Ignore malformed local layout data and continue with a clean store.
    }
  }
  return createStore();
}

function writeStore(store: WidgetStore) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // A locked-down desktop profile may disable localStorage. The page remains usable for this session.
  }
}

function scopeFor(store: WidgetStore, scopeKey: string): WidgetScope {
  return store.scopes[scopeKey] ?? createScope();
}

function templateFor(store: WidgetStore, templateKey: string): WidgetScope {
  return store.templates[templateKey] ?? createScope(templateKey);
}

function mapRegionTemplateId(scopeKey: string, templateKey: string, id: string): string {
  const scopeRegion = scopeKey.split(":region:")[1];
  const templateRegion = templateKey.split(":region:")[1];
  if (!scopeRegion || !templateRegion || scopeRegion === templateRegion || !id.startsWith(scopeRegion)) return id;
  return `${templateRegion}${id.slice(scopeRegion.length)}`;
}

function effectivePlacements(
  scope: WidgetScope,
  template: WidgetScope,
  templateIdFor: (id: string, entry: WidgetCatalogEntry) => string
): Record<string, WidgetPlacement> {
  const placements: Record<string, WidgetPlacement> = { ...scope.placements };
  for (const [id, catalogEntry] of Object.entries(scope.catalog)) {
    if (placements[id]) continue;
    const templateId = templateIdFor(id, catalogEntry);
    const templatePlacement = template.placements[templateId] ?? template.placements[id];
    if (templatePlacement) placements[id] = { ...templatePlacement };
  }
  return placements;
}

function materializePlacements(
  scope: WidgetScope,
  template: WidgetScope,
  templateIdFor: (id: string, entry: WidgetCatalogEntry) => string
): Record<string, WidgetPlacement> {
  const placements = effectivePlacements(scope, template, templateIdFor);
  for (const [id, catalogEntry] of Object.entries(scope.catalog)) {
    if (placements[id]) continue;
    const position = findNextFreePlacement(placements, catalogEntry.defaultSize);
    placements[id] = createPlacement(catalogEntry.defaultSize, position.x, position.y);
  }
  return placements;
}

function relevantScopeKeys(store: WidgetStore, rootScopeKey: string, includeNested: boolean): string[] {
  if (!includeNested) return [rootScopeKey];
  const prefix = `${rootScopeKey}:region:`;
  return Object.keys(store.scopes).filter((key) => key === rootScopeKey || key.startsWith(prefix));
}

function scopeLabel(scopeKey: string, rootScopeKey: string): string | undefined {
  if (scopeKey === rootScopeKey) return undefined;
  return "设备区块内";
}

export function WidgetLayoutProvider({
  scopeKey,
  templateKey = scopeKey,
  editable,
  locked = false,
  includeNestedHidden = false,
  editModeOverride,
  children
}: {
  scopeKey: string;
  templateKey?: string;
  editable: boolean;
  locked?: boolean;
  includeNestedHidden?: boolean;
  editModeOverride?: boolean;
  children: React.ReactNode;
}) {
  const [store, setStore] = useState<WidgetStore>(() => readStore());
  const storeRef = useRef(store);
  const instanceRef = useRef({});
  const pastRef = useRef<WidgetStore[]>([]);
  const futureRef = useRef<WidgetStore[]>([]);
  const [internalEditMode, setInternalEditMode] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const editMode = editModeOverride ?? internalEditMode;
  const templateIdFor = useCallback((id: string, entry?: WidgetCatalogEntry) => (
    entry?.templateId ?? mapRegionTemplateId(scopeKey, templateKey, id)
  ), [scopeKey, templateKey]);

  const applyStore = useCallback((next: WidgetStore, trackHistory = true) => {
    const current = storeRef.current;
    if (next === current) return;
    if (trackHistory) {
      pastRef.current = [...pastRef.current, current].slice(-HISTORY_LIMIT);
      futureRef.current = [];
    }
    storeRef.current = next;
    setStore(next);
    writeStore(next);
    setHistoryVersion((value) => value + 1);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(STORAGE_EVENT, {
        detail: { source: instanceRef.current, trackHistory, previous: current }
      }));
    }
  }, []);

  const mutateStore = useCallback((mutator: (current: WidgetStore) => WidgetStore, trackHistory = true) => {
    applyStore(mutator(storeRef.current), trackHistory);
  }, [applyStore]);

  useEffect(() => {
    writeStore(store);
  }, [store]);

  useEffect(() => {
    const handleExternalStoreChange = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as { source?: object; trackHistory?: boolean; previous?: WidgetStore } : undefined;
      if (detail?.source === instanceRef.current) return;
      if (detail?.trackHistory && detail.previous) {
        pastRef.current = [...pastRef.current, detail.previous].slice(-HISTORY_LIMIT);
        futureRef.current = [];
      }
      const next = readStore();
      storeRef.current = next;
      setStore(next);
      setHistoryVersion((value) => value + 1);
    };
    window.addEventListener(STORAGE_EVENT, handleExternalStoreChange);
    window.addEventListener("storage", handleExternalStoreChange);
    return () => {
      window.removeEventListener(STORAGE_EVENT, handleExternalStoreChange);
      window.removeEventListener("storage", handleExternalStoreChange);
    };
  }, []);

  useEffect(() => {
    pastRef.current = [];
    futureRef.current = [];
    setInternalEditMode(false);
    setHistoryVersion((value) => value + 1);
  }, [scopeKey, templateKey]);

  useEffect(() => {
    if (!editable || locked) setInternalEditMode(false);
  }, [editable, locked]);

  const setEditMode = useCallback((value: React.SetStateAction<boolean>) => {
    if (editModeOverride !== undefined || !editable || locked) return;
    setInternalEditMode(value);
  }, [editable, editModeOverride, locked]);

  const registerWidget = useCallback((definition: WidgetDefinition) => {
    if (locked) return;
    mutateStore((current) => {
      const scope = scopeFor(current, scopeKey);
      const template = templateFor(current, templateKey);
      const nextScope = cloneScope(scope);
      nextScope.templateKey = templateKey;
      let changed = scope.templateKey !== templateKey;
      const nextCatalogEntry: WidgetCatalogEntry = {
        title: definition.title,
        kind: definition.kind,
        defaultSize: definition.defaultSize
      };
      if (definition.templateId) nextCatalogEntry.templateId = definition.templateId;
      const previousCatalogEntry = scope.catalog[definition.id];
      if (!previousCatalogEntry || JSON.stringify(previousCatalogEntry) !== JSON.stringify(nextCatalogEntry)) {
        nextScope.catalog[definition.id] = nextCatalogEntry;
        changed = true;
      }
      const hasSavedLayout = Object.keys(scope.placements).length > 0 || Object.keys(template.placements).length > 0;
      const templatePlacement = template.placements[definition.templateId ?? mapRegionTemplateId(scopeKey, templateKey, definition.id)] ?? template.placements[definition.id];
      if (hasSavedLayout && !nextScope.placements[definition.id] && !templatePlacement) {
        const effectivePlacements = { ...template.placements, ...nextScope.placements };
        const position = findNextFreePlacement(effectivePlacements, definition.defaultSize ?? DEFAULT_SIZE);
        nextScope.placements[definition.id] = createPlacement(definition.defaultSize ?? DEFAULT_SIZE, position.x, position.y);
        changed = true;
      }
      if (!changed) return current;
      return { ...current, scopes: { ...current.scopes, [scopeKey]: nextScope } };
    }, false);
  }, [locked, mutateStore, scopeKey, templateKey]);

  const resolveWidget = useCallback((definition: WidgetDefinition): ResolvedWidget => {
    if (locked) return { size: definition.defaultSize ?? DEFAULT_SIZE, hidden: false };
    const scope = scopeFor(store, scopeKey);
    const template = templateFor(store, templateKey);
    const templateId = definition.templateId ?? mapRegionTemplateId(scopeKey, templateKey, definition.id);
    const placement = scope.placements[definition.id] ?? template.placements[templateId] ?? template.placements[definition.id];
    return {
      size: placement?.size ?? definition.defaultSize ?? DEFAULT_SIZE,
      hidden: editable && placement?.hidden === true,
      placement
    };
  }, [editable, locked, scopeKey, store, templateKey]);

  const updatePlacement = useCallback((id: string, update: (placement: WidgetPlacement) => WidgetPlacement) => {
    if (!editable || locked) return;
    mutateStore((current) => {
      const scope = scopeFor(current, scopeKey);
      const template = templateFor(current, templateKey);
      const placements = materializePlacements(scope, template, templateIdFor);
      const currentPlacement = placements[id] ?? createPlacement(DEFAULT_SIZE);
      const nextPlacement = update({ ...currentPlacement });
      const nextScope = cloneScope(scope);
      nextScope.templateKey = templateKey;
      nextScope.placements = normalizePlacements({ ...placements, [id]: nextPlacement });
      return { ...current, scopes: { ...current.scopes, [scopeKey]: nextScope } };
    });
  }, [editable, locked, mutateStore, scopeKey, templateIdFor, templateKey]);

  const updateSize = useCallback((id: string, size: WidgetSize) => {
    updatePlacement(id, (placement) => ({ ...placement, ...SIZE_PRESETS[size], size }));
  }, [updatePlacement]);

  const hideWidget = useCallback((id: string) => {
    updatePlacement(id, (placement) => ({ ...placement, hidden: true }));
  }, [updatePlacement]);

  const restoreWidget = useCallback((id: string, targetScopeKey = scopeKey) => {
    if (!editable || locked) return;
    mutateStore((current) => {
      const scope = scopeFor(current, targetScopeKey);
      const targetTemplateKey = scope.templateKey ?? (targetScopeKey === scopeKey ? templateKey : "");
      const template = targetTemplateKey ? templateFor(current, targetTemplateKey) : createScope();
      const catalogEntry = scope.catalog[id];
      const targetTemplateId = catalogEntry?.templateId ?? mapRegionTemplateId(targetScopeKey, targetTemplateKey, id);
      const currentPlacement = scope.placements[id] ?? template.placements[targetTemplateId] ?? template.placements[id] ?? createPlacement(DEFAULT_SIZE);
      const nextScope = cloneScope(scope);
      nextScope.placements[id] = { ...currentPlacement, hidden: false };
      return { ...current, scopes: { ...current.scopes, [targetScopeKey]: nextScope } };
    });
  }, [editable, locked, mutateStore, scopeKey, templateKey]);

  const reorderWidgets = useCallback((draggedId: string, targetId: string) => {
    if (!editable || locked || draggedId === targetId) return;
    mutateStore((current) => {
      const scope = scopeFor(current, scopeKey);
      const template = templateFor(current, templateKey);
      const placements = materializePlacements(scope, template, templateIdFor);
      const dragged = placements[draggedId];
      const target = placements[targetId];
      if (!dragged || !target) return current;
      const nextScope = cloneScope(scope);
      nextScope.templateKey = templateKey;
      nextScope.placements = normalizePlacements({
        ...placements,
        [draggedId]: { ...dragged, x: target.x, y: target.y },
        [targetId]: { ...target, x: dragged.x, y: dragged.y }
      });
      return { ...current, scopes: { ...current.scopes, [scopeKey]: nextScope } };
    });
  }, [editable, locked, mutateStore, scopeKey, templateIdFor, templateKey]);

  const resetDeviceLayout = useCallback(() => {
    if (!editable || locked) return;
    mutateStore((current) => {
      const keys = relevantScopeKeys(current, scopeKey, true);
      const scopes = { ...current.scopes };
      let changed = false;
      for (const key of keys) {
        const scope = scopeFor(current, key);
        if (!Object.keys(scope.placements).length) continue;
        scopes[key] = { ...cloneScope(scope), placements: {} };
        changed = true;
      }
      return changed ? { ...current, scopes } : current;
    });
  }, [editable, locked, mutateStore, scopeKey]);

  const saveAsTemplate = useCallback(() => {
    if (!editable || locked) return;
    mutateStore((current) => {
      const templates = { ...current.templates };
      for (const key of relevantScopeKeys(current, scopeKey, true)) {
        const scope = scopeFor(current, key);
        const targetTemplateKey = scope.templateKey ?? (key === scopeKey ? templateKey : undefined);
        if (!targetTemplateKey) continue;
        const existingTemplate = templateFor(current, targetTemplateKey);
        const placements: Record<string, WidgetPlacement> = {};
        const catalog: Record<string, WidgetCatalogEntry> = {};
        for (const [id, catalogEntry] of Object.entries(scope.catalog)) {
          const templateId = catalogEntry.templateId ?? mapRegionTemplateId(key, targetTemplateKey, id);
          const sourcePlacement = scope.placements[id] ?? existingTemplate.placements[templateId] ?? existingTemplate.placements[id];
          const position = sourcePlacement
            ? { x: sourcePlacement.x, y: sourcePlacement.y }
            : findNextFreePlacement(placements, catalogEntry.defaultSize);
          placements[templateId] = sourcePlacement
            ? { ...sourcePlacement }
            : createPlacement(catalogEntry.defaultSize, position.x, position.y);
          catalog[templateId] = { ...catalogEntry, templateId: undefined };
        }
        templates[targetTemplateKey] = { templateKey: targetTemplateKey, placements, catalog };
      }
      return { ...current, templates };
    });
  }, [editable, locked, mutateStore, scopeKey, templateKey]);

  const exportLayout = useCallback(() => {
    if (typeof window === "undefined") return;
    const current = storeRef.current;
    const rootScope = scopeFor(current, scopeKey);
    const rootTemplate = templateFor(current, templateKey);
    const regions = relevantScopeKeys(current, scopeKey, true)
      .filter((key) => key !== scopeKey)
      .map((key) => {
        const scope = scopeFor(current, key);
        const regionTemplateKey = scope.templateKey ?? "";
        return {
          suffix: key.slice(scopeKey.length),
          templateKey: regionTemplateKey,
          scope: cloneScope(scope),
          template: regionTemplateKey ? cloneScope(templateFor(current, regionTemplateKey)) : createScope()
        };
      });
    const payload: WidgetLayoutExport = {
      kind: "dsc-widget-layout",
      version: 2,
      exportedAt: new Date().toISOString(),
      templateKey,
      scope: cloneScope(rootScope),
      template: cloneScope(rootTemplate),
      regions
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `guanlan-layout-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [scopeKey, templateKey]);

  const importLayout = useCallback((json: string): boolean => {
    if (!editable || locked) return false;
    try {
      const parsed = JSON.parse(json) as Partial<WidgetLayoutExport>;
      if (parsed.kind !== "dsc-widget-layout" || parsed.version !== 2 || !parsed.scope || !parsed.template) return false;
      const current = storeRef.current;
      const importedScope = normalizeScope(parsed.scope);
      importedScope.templateKey = templateKey;
      const importedTemplate = normalizeScope(parsed.template);
      importedTemplate.templateKey = templateKey;
      const scopes = { ...current.scopes, [scopeKey]: importedScope };
      const templates = { ...current.templates, [templateKey]: importedTemplate };
      const sourceTemplateKey = typeof parsed.templateKey === "string" ? parsed.templateKey : templateKey;
      const oldRegionKeys = Object.keys(scopes).filter((key) => key.startsWith(`${scopeKey}:region:`));
      for (const key of oldRegionKeys) delete scopes[key];
      for (const region of Array.isArray(parsed.regions) ? parsed.regions : []) {
        if (!region || typeof region.suffix !== "string" || !region.scope || !region.template) continue;
        const nextScopeKey = `${scopeKey}${region.suffix}`;
        const nextTemplateKey = region.templateKey?.startsWith(sourceTemplateKey)
          ? `${templateKey}${region.templateKey.slice(sourceTemplateKey.length)}`
          : region.templateKey || `${templateKey}${region.suffix}`;
        const regionScope = normalizeScope(region.scope);
        regionScope.templateKey = nextTemplateKey;
        const regionTemplate = normalizeScope(region.template);
        regionTemplate.templateKey = nextTemplateKey;
        scopes[nextScopeKey] = regionScope;
        templates[nextTemplateKey] = regionTemplate;
      }
      applyStore({ ...current, scopes, templates });
      return true;
    } catch {
      return false;
    }
  }, [applyStore, editable, locked, scopeKey, templateKey]);

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(storeRef.current);
    storeRef.current = previous;
    setStore(previous);
    writeStore(previous);
    setHistoryVersion((value) => value + 1);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(STORAGE_EVENT, {
        detail: { source: instanceRef.current, trackHistory: false }
      }));
    }
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(storeRef.current);
    storeRef.current = next;
    setStore(next);
    writeStore(next);
    setHistoryVersion((value) => value + 1);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(STORAGE_EVENT, {
        detail: { source: instanceRef.current, trackHistory: false }
      }));
    }
  }, []);

  const hiddenWidgets = useMemo(() => {
    if (!editable) return [];
    const hidden: HiddenWidget[] = [];
    for (const sourceScopeKey of relevantScopeKeys(store, scopeKey, includeNestedHidden)) {
      const sourceScope = scopeFor(store, sourceScopeKey);
      const sourceTemplateKey = sourceScope.templateKey ?? (sourceScopeKey === scopeKey ? templateKey : "");
      const sourceTemplate = sourceTemplateKey ? templateFor(store, sourceTemplateKey) : createScope();
      for (const [id, catalogEntry] of Object.entries(sourceScope.catalog)) {
        const templateId = catalogEntry.templateId ?? mapRegionTemplateId(sourceScopeKey, sourceTemplateKey, id);
        const placement = sourceScope.placements[id] ?? sourceTemplate.placements[templateId] ?? sourceTemplate.placements[id];
        if (!placement?.hidden) continue;
        hidden.push({ id, ...catalogEntry, scopeKey: sourceScopeKey, scopeLabel: scopeLabel(sourceScopeKey, scopeKey) });
      }
    }
    return hidden;
  }, [editable, includeNestedHidden, scopeKey, store, templateKey]);

  const template = templateFor(store, templateKey);
  const contextValue = useMemo<WidgetLayoutContextValue>(() => ({
    scopeKey,
    templateKey,
    editable,
    locked,
    editMode,
    setEditMode,
    resolveWidget,
    registerWidget,
    updateSize,
    hideWidget,
    restoreWidget,
    reorderWidgets,
    resetDeviceLayout,
    saveAsTemplate,
    exportLayout,
    importLayout,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    undo,
    redo,
    hasLocalOverride: relevantScopeKeys(store, scopeKey, includeNestedHidden).some((key) => Object.keys(scopeFor(store, key).placements).length > 0),
    hasTemplate: Object.keys(template.placements).length > 0,
    hiddenWidgets
  }), [editMode, editable, exportLayout, hideWidget, hiddenWidgets, importLayout, includeNestedHidden, locked, registerWidget, redo, reorderWidgets, resetDeviceLayout, resolveWidget, restoreWidget, saveAsTemplate, scopeKey, template.placements, templateKey, undo, updateSize, historyVersion, store]);

  return <WidgetLayoutContext.Provider value={contextValue}>{children}</WidgetLayoutContext.Provider>;
}

export function useWidgetLayout() {
  const context = useContext(WidgetLayoutContext);
  if (!context) throw new Error("useWidgetLayout must be used inside WidgetLayoutProvider");
  return context;
}

export function WidgetLayoutRegion({
  regionKey,
  templateRegionKey = regionKey,
  children
}: {
  regionKey: string;
  templateRegionKey?: string;
  children: React.ReactNode;
}) {
  const parent = useWidgetLayout();
  return (
    <WidgetLayoutProvider
      scopeKey={`${parent.scopeKey}:region:${regionKey}`}
      templateKey={`${parent.templateKey}:region:${templateRegionKey}`}
      editable={parent.editable}
      locked={parent.locked}
      editModeOverride={parent.editMode}
    >
      {children}
    </WidgetLayoutProvider>
  );
}

function placementStyle(placement: WidgetPlacement | undefined): React.CSSProperties | undefined {
  if (!placement) return undefined;
  return {
    "--widget-x": placement.x,
    "--widget-y": placement.y,
    "--widget-w": placement.w,
    "--widget-h": placement.h,
    "--widget-w-md": placement.size === "large" ? 6 : placement.size === "medium" ? 3 : 2,
    "--widget-h-md": placement.size === "large" ? 3 : placement.size === "medium" ? 3 : 2
  } as React.CSSProperties;
}

export function DesktopWidget({
  id,
  templateId,
  title,
  kind = "content",
  defaultSize = DEFAULT_SIZE,
  children
}: {
  id: string;
  templateId?: string;
  title: string;
  kind?: WidgetKind;
  defaultSize?: WidgetSize;
  children: React.ReactNode;
}) {
  const layout = useWidgetLayout();
  const definition = useMemo(() => ({ id, templateId, title, kind, defaultSize }), [defaultSize, id, kind, templateId, title]);
  const resolved = layout.resolveWidget(definition);

  useEffect(() => {
    layout.registerWidget(definition);
  }, [definition, layout.registerWidget]);

  if (resolved.hidden) return null;

  const editing = layout.editable && layout.editMode;
  const handleDragStart = (event: React.DragEvent<HTMLElement>) => {
    if (!editing) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!editing) return;
    event.preventDefault();
    const draggedId = event.dataTransfer.getData("text/plain");
    if (draggedId) layout.reorderWidgets(draggedId, id);
  };

  return (
    <div
      className={`workspace-widget workspace-widget--${resolved.size} workspace-widget--${kind}${editing ? " is-editing" : ""}`}
      style={placementStyle(resolved.placement)}
      data-widget-id={id}
      onDragOver={(event) => { if (editing) event.preventDefault(); }}
      onDrop={handleDrop}
    >
      {editing && (
        <div className="workspace-widget__tools" onPointerDown={(event) => event.stopPropagation()}>
          <span className="workspace-widget__drag-hint" title="拖动以调整位置" draggable={editing} onDragStart={handleDragStart}>⠿ <span>拖动</span></span>
          <span className="workspace-widget__tool-title" title={title}>{title}</span>
          <div className="workspace-widget__size-control" role="group" aria-label={`${title}尺寸`}>
            {(["large", "medium", "small"] as WidgetSize[]).map((size) => (
              <button
                key={size}
                className={resolved.size === size ? "is-active" : ""}
                type="button"
                aria-pressed={resolved.size === size}
                onClick={() => layout.updateSize(id, size)}
              >
                {size === "large" ? "大" : size === "medium" ? "中" : "小"}
              </button>
            ))}
          </div>
          <button className="workspace-widget__hide" type="button" onClick={() => layout.hideWidget(id)}>隐藏</button>
        </div>
      )}
      <div className="workspace-widget__content">{children}</div>
    </div>
  );
}

export function WidgetLayoutToolbar() {
  const layout = useWidgetLayout();
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!layout.editMode) setHiddenOpen(false);
  }, [layout.editMode]);

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const ok = layout.importLayout(await file.text());
    setNotice(ok ? "布局已导入" : "布局文件格式无效");
    window.setTimeout(() => setNotice(""), 2200);
  };

  if (!layout.editable) {
    return <span className="workspace-layout-lock">全景视图 · 布局锁定</span>;
  }

  return (
    <div className="workspace-layout-toolbar">
      <span className="workspace-layout-source" title="没有本设备覆盖时，会使用同类设备通用布局">
        {layout.hasLocalOverride ? "本设备覆盖" : layout.hasTemplate ? "通用布局" : "内置默认"}
      </span>
      <button
        className={`workspace-layout-toggle${layout.editMode ? " is-active" : ""}`}
        type="button"
        aria-pressed={layout.editMode}
        onClick={() => layout.setEditMode((value) => !value)}
      >
        <span className="workspace-layout-toggle__mark">⌘</span>
        {layout.editMode ? "完成排布" : "编辑排布"}
      </button>
      {layout.editMode && (
        <>
          <div className="workspace-layout-history" role="group" aria-label="布局历史">
            <button type="button" disabled={!layout.canUndo} onClick={layout.undo} title="撤销">↶</button>
            <button type="button" disabled={!layout.canRedo} onClick={layout.redo} title="重做">↷</button>
          </div>
          <div className="workspace-layout-actions" role="group" aria-label="布局操作">
            <button type="button" onClick={layout.resetDeviceLayout}>恢复通用</button>
            <button type="button" onClick={layout.saveAsTemplate}>设为通用</button>
            <button type="button" onClick={layout.exportLayout}>导出</button>
            <button type="button" onClick={() => fileInputRef.current?.click()}>导入</button>
            <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={(event) => void handleImport(event)} />
          </div>
        </>
      )}
      {layout.editMode && layout.hiddenWidgets.length > 0 && (
        <div className="workspace-layout-hidden">
          <button className="workspace-layout-hidden__toggle" type="button" onClick={() => setHiddenOpen((value) => !value)} aria-expanded={hiddenOpen}>
            已隐藏 {layout.hiddenWidgets.length} 项 <span aria-hidden="true">{hiddenOpen ? "⌃" : "⌄"}</span>
          </button>
          {hiddenOpen && (
            <div className="workspace-layout-hidden__tray">
              {layout.hiddenWidgets.map((widget) => (
                <div className="workspace-layout-hidden__item" key={`${widget.scopeKey}:${widget.id}`}>
                  <span><strong>{widget.title}</strong><small>{widget.kind === "group" ? "设备区块" : "内容区块"}{widget.scopeLabel ? ` · ${widget.scopeLabel}` : ""}</small></span>
                  <button type="button" onClick={() => layout.restoreWidget(widget.id, widget.scopeKey)}>恢复</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {notice && <span className="workspace-layout-notice" role="status">{notice}</span>}
    </div>
  );
}
