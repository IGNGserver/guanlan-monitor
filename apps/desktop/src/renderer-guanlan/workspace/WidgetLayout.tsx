import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  WidgetLayoutCatalogEntry as SharedWidgetLayoutCatalogEntry,
  WidgetLayoutDocument,
  WidgetLayoutKind,
  WidgetLayoutPlacement as SharedWidgetLayoutPlacement,
  WidgetLayoutRequest,
  WidgetLayoutSaveRequest,
  WidgetLayoutSize,
  WidgetLayoutSync,
  WidgetLayoutTemplate,
  WidgetInstanceConfig,
  WidgetVisualization
} from "@dsc/shared";

export type WidgetSize = WidgetLayoutSize;
export type WidgetKind = WidgetLayoutKind;
export type WidgetPlacement = SharedWidgetLayoutPlacement;

export type WidgetDefinition = {
  id: string;
  templateId?: string;
  groupId?: string;
  title: string;
  kind: WidgetKind;
  defaultSize: WidgetSize;
  widgetType?: string;
  category?: string;
  visualization?: WidgetVisualization;
  config?: WidgetInstanceConfig;
};

export type WidgetGroupChildDefinition = Omit<WidgetDefinition, "id" | "groupId">;

type WidgetCatalogEntry = SharedWidgetLayoutCatalogEntry;

type ResolvedWidget = {
  size: WidgetSize;
  hidden: boolean;
  placement?: WidgetPlacement;
};

export type HiddenWidget = WidgetDefinition;

export type WidgetLayoutSyncClient = {
  getWidgetLayout: (request: WidgetLayoutRequest) => Promise<WidgetLayoutSync>;
  saveWidgetLayout: (request: WidgetLayoutSaveRequest) => Promise<WidgetLayoutSync>;
};

type WidgetLayoutContextValue = {
  scopeKey: string;
  templateKey: string;
  editable: boolean;
  locked: boolean;
  editMode: boolean;
  setEditMode: (value: React.SetStateAction<boolean>) => void;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  syncMessage: string;
  snapToGrid: boolean;
  templates: WidgetLayoutTemplate[];
  resolveWidget: (definition: WidgetDefinition) => ResolvedWidget;
  getWidgetSize: (id: string, defaultSize: WidgetSize, templateId?: string) => WidgetSize;
  registerWidget: (definition: WidgetDefinition) => void;
  updateSize: (id: string, size: WidgetSize) => void;
  hideWidget: (id: string) => void;
  restoreWidget: (id: string) => void;
  reorderWidgets: (draggedId: string, targetId: string) => void;
  draggingWidgetId: string | null;
  beginWidgetDrag: (id: string) => void;
  previewWidgetDrop: (draggedId: string, targetId: string) => void;
  finishWidgetDrag: () => void;
  cancelWidgetDrag: () => void;
  toggleSnapToGrid: () => void;
  resetDeviceLayout: () => Promise<boolean>;
  applyTemplate: (templateId: string) => void;
  saveLayout: () => Promise<boolean>;
  saveAsTemplate: (name: string, templateId?: string) => Promise<boolean>;
  deleteTemplate: (templateId: string) => Promise<boolean>;
  exportLayout: () => void;
  importLayout: (json: string) => boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  hasInstanceLayout: boolean;
  hiddenWidgets: HiddenWidget[];
  widgetEntries: Array<{ id: string } & WidgetCatalogEntry>;
  addWidget: (definition: Omit<WidgetDefinition, "id"> & { id?: string }) => string | null;
  addWidgetGroup: (group: Omit<WidgetDefinition, "id" | "groupId">, children: WidgetGroupChildDefinition[]) => string | null;
  removeWidget: (id: string) => void;
  updateWidgetConfig: (id: string, patch: WidgetInstanceConfig) => void;
  compactLayout: () => void;
  getLayoutSnapshot: () => WidgetLayoutDocument;
};

const WidgetLayoutContext = createContext<WidgetLayoutContextValue | null>(null);
const GRID_COLUMNS = 4;
const HISTORY_LIMIT = 30;
const DEFAULT_SIZE: WidgetSize = "medium";

const SIZE_PRESETS: Record<WidgetSize, Pick<WidgetPlacement, "w" | "h">> = {
  large: { w: 4, h: 2 },
  medium: { w: 2, h: 2 },
  small: { w: 1, h: 2 }
};

function emptyLayout(snapToGrid = true): WidgetLayoutDocument {
  return { version: 4, placements: {}, catalog: {}, snapToGrid };
}

type WidgetLayoutDraftGuard = () => boolean;

type WidgetDragSession = {
  id: string;
  base: WidgetLayoutDocument;
  moved: boolean;
};

const draftGuards = new Set<WidgetLayoutDraftGuard>();

export function registerWidgetLayoutDraftGuard(guard: WidgetLayoutDraftGuard): () => void {
  draftGuards.add(guard);
  return () => {
    draftGuards.delete(guard);
  };
}

export function confirmDiscardWidgetLayoutDraft(): boolean {
  const hasDraft = [...draftGuards].some((guard) => guard());
  if (!hasDraft) return true;
  return window.confirm("当前布局修改尚未保存，退出后修改将丢失。是否继续？");
}

function cloneLayout(layout: WidgetLayoutDocument): WidgetLayoutDocument {
  return {
    ...(layout.version ? { version: layout.version } : {}),
    placements: Object.fromEntries(Object.entries(layout.placements).map(([id, placement]) => [id, { ...placement }])),
    catalog: Object.fromEntries(Object.entries(layout.catalog).map(([id, entry]) => [id, {
      ...entry,
      ...(entry.groupId ? { groupId: entry.groupId } : {}),
      ...(entry.config ? { config: { ...entry.config } } : {})
    }])),
    snapToGrid: layout.snapToGrid,
    ...(layout.panels ? { panels: layout.panels.map((panel) => ({ ...panel })) } : {})
  };
}

function mergeWidgetConfig(existing: WidgetInstanceConfig | undefined, incoming: WidgetInstanceConfig | undefined): WidgetInstanceConfig | undefined {
  if (!existing && !incoming) return undefined;
  return { ...(existing ?? {}), ...(incoming ?? {}) };
}

function normalizePlacement(value: Partial<WidgetPlacement> | undefined, sizeFallback: WidgetSize = DEFAULT_SIZE): WidgetPlacement {
  const size = value?.size === "large" || value?.size === "medium" || value?.size === "small" ? value.size : sizeFallback;
  const preset = SIZE_PRESETS[size];
  const x = Number.isFinite(value?.x) ? Math.round(value?.x as number) : 1;
  const y = Number.isFinite(value?.y) ? Math.round(value?.y as number) : 1;
  return {
    x: Math.max(1, Math.min(x, GRID_COLUMNS - preset.w + 1)),
    y: Math.max(1, y),
    w: preset.w,
    h: preset.h,
    size,
    hidden: value?.hidden === true
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
  const existing = Object.values(placements).filter((placement) => !placement.hidden);
  const startY = Math.max(1, Math.round(preferredY));
  const startX = Math.max(1, Math.min(Math.round(preferredX), GRID_COLUMNS - preset.w + 1));

  for (let y = startY; y < startY + 1000; y += 1) {
    const firstX = y === startY ? startX : 1;
    for (let x = firstX; x <= GRID_COLUMNS - preset.w + 1; x += 1) {
      const candidate = normalizePlacement({ x, y, size });
      if (existing.every((placement) => !intersects(candidate, placement))) return { x, y };
    }
  }

  const lastRow = existing.reduce((max, placement) => Math.max(max, placement.y + placement.h), 1);
  return { x: 1, y: lastRow };
}

function sizeForGroupWidth(width: number, fallback: WidgetSize): WidgetSize {
  if (width >= SIZE_PRESETS.large.w) return "large";
  if (width >= SIZE_PRESETS.medium.w) return "medium";
  if (width >= SIZE_PRESETS.small.w) return "small";
  return fallback;
}

function isWidgetSize(value: unknown): value is WidgetSize {
  return value === "large" || value === "medium" || value === "small";
}

function isGroupedEntry(id: string, catalog: Record<string, WidgetCatalogEntry>): boolean {
  const groupId = catalog[id]?.groupId;
  const parent = groupId ? catalog[groupId] : undefined;
  return Boolean(groupId && parent?.kind === "group" && parent.widgetType);
}

function topLevelPlacements(
  placements: Record<string, WidgetPlacement>,
  catalog: Record<string, WidgetCatalogEntry>
): Record<string, WidgetPlacement> {
  return Object.fromEntries(Object.entries(placements).filter(([id]) => !isGroupedEntry(id, catalog)));
}

function normalizePlacements(
  placements: Record<string, WidgetPlacement>,
  snapToGrid: boolean,
  catalog: Record<string, WidgetCatalogEntry> = {}
): Record<string, WidgetPlacement> {
  const normalized = Object.fromEntries(
    Object.entries(placements).map(([id, placement]) => [id, normalizePlacement(placement, catalog[id]?.defaultSize ?? DEFAULT_SIZE)])
  ) as Record<string, WidgetPlacement>;

  // Group children have their own four-column coordinate system. Pack them
  // inside the group first, then derive the group's outer width from the
  // occupied child columns so a one-card group can shrink to 2x2 or 1x2.
  const groupIds = new Set(
    Object.values(catalog)
      .map((entry) => entry.groupId)
      .filter((groupId): groupId is string => Boolean(groupId && catalog[groupId]?.kind === "group" && catalog[groupId]?.widgetType))
  );
  for (const groupId of groupIds) {
    const children = Object.entries(catalog)
      .filter(([, entry]) => entry.groupId === groupId)
      .map(([id]) => id)
      .filter((id) => Boolean(normalized[id]))
      .sort((left, right) => {
        const leftPlacement = normalized[left];
        const rightPlacement = normalized[right];
        return leftPlacement.y - rightPlacement.y || leftPlacement.x - rightPlacement.x || left.localeCompare(right);
      });
    const packed: Record<string, WidgetPlacement> = {};
    for (const childId of children) {
      const child = normalized[childId];
      if (!child.hidden) {
        // A device group is a scrollable, self-contained layout. Its charts
        // must always pack inside that frame, even when the outer canvas is in
        // free-positioning mode. Otherwise a newly-created group keeps the
        // registration y-coordinates and its width is calculated incorrectly.
        const preferredX = snapToGrid ? child.x : 1;
        const preferredY = snapToGrid ? child.y : 1;
        const position = findNextFreePlacement(packed, child.size, preferredX, preferredY);
        normalized[childId] = { ...child, ...position };
      }
      if (!normalized[childId].hidden) packed[childId] = normalized[childId];
    }
    const group = normalized[groupId];
    if (!group) continue;
    const visibleChildren = Object.values(packed);
    const occupiedWidth = visibleChildren.reduce((max, child) => Math.max(max, child.x + child.w - 1), 0);
    const configuredSize = catalog[groupId]?.config?.sizeOverride;
    const groupSize = isWidgetSize(configuredSize)
      ? configuredSize
      : visibleChildren.length ? sizeForGroupWidth(occupiedWidth, group.size) : "small";
    normalized[groupId] = normalizePlacement({ ...group, size: groupSize }, group.size);
  }

  if (!snapToGrid) return normalized;

  const visible = Object.entries(normalized)
    .filter(([id, placement]) => !placement.hidden && !isGroupedEntry(id, catalog))
    .sort(([, left], [, right]) => left.y - right.y || left.x - right.x);
  const compacted: Record<string, WidgetPlacement> = {};
  for (const [id, placement] of visible) {
    const position = findNextFreePlacement(compacted, placement.size);
    compacted[id] = { ...placement, ...position };
  }
  for (const [id, placement] of Object.entries(normalized)) {
    if (placement.hidden || isGroupedEntry(id, catalog)) compacted[id] = placement;
  }
  return compacted;
}

function layoutContainerForWidget(id: string, catalog: Record<string, WidgetCatalogEntry>): string | null {
  return catalog[id]?.groupId ?? null;
}

function moveWidgetWithAvoidance(layout: WidgetLayoutDocument, draggedId: string, targetId: string): WidgetLayoutDocument {
  if (draggedId === targetId) return layout;
  const dragged = layout.placements[draggedId];
  const target = layout.placements[targetId];
  if (!dragged || !target || dragged.hidden || target.hidden) return layout;
  if (layoutContainerForWidget(draggedId, layout.catalog) !== layoutContainerForWidget(targetId, layout.catalog)) return layout;

  const moving = normalizePlacement({ ...dragged, x: target.x, y: target.y }, dragged.size);
  const placements = { ...layout.placements, [draggedId]: moving };
  const placed: Record<string, WidgetPlacement> = { [draggedId]: moving };
  const siblings = Object.entries(placements)
    .filter(([id, placement]) => id !== draggedId && !placement.hidden && layoutContainerForWidget(id, layout.catalog) === layoutContainerForWidget(draggedId, layout.catalog))
    .sort(([leftId, left], [rightId, right]) => left.y - right.y || left.x - right.x || leftId.localeCompare(rightId));

  for (const [id, placement] of siblings) {
    const collides = Object.values(placed).some((occupied) => intersects(placement, occupied));
    if (collides) {
      const position = findNextFreePlacement(placed, placement.size, placement.x, placement.y);
      placements[id] = { ...placement, ...position };
    }
    placed[id] = placements[id];
  }

  return { ...layout, placements };
}

type WidgetMutationOptions = {
  compact?: boolean;
};

function normalizeLayout(layout: WidgetLayoutDocument | null | undefined, options: WidgetMutationOptions = {}): WidgetLayoutDocument {
  if (!layout) return emptyLayout();
  const catalog: Record<string, WidgetCatalogEntry> = {};
  const visualizations: WidgetVisualization[] = ["line", "area", "bar", "donut", "number", "table"];
  for (const [id, entry] of Object.entries(layout.catalog ?? {})) {
    if (!entry || typeof entry.title !== "string") continue;
    catalog[id] = {
      title: entry.title,
      kind: entry.kind === "group" ? "group" : "content",
      defaultSize: entry.defaultSize === "large" || entry.defaultSize === "small" ? entry.defaultSize : "medium",
      ...(entry.templateId ? { templateId: entry.templateId } : {}),
      ...(entry.groupId && typeof entry.groupId === "string" ? { groupId: entry.groupId } : {}),
      ...(entry.widgetType ? { widgetType: entry.widgetType } : {}),
      ...(entry.category ? { category: entry.category } : {}),
      ...(entry.visualization && visualizations.includes(entry.visualization) ? { visualization: entry.visualization } : {}),
      ...(entry.config ? { config: { ...entry.config } } : {})
    };
  }
  const placements: Record<string, WidgetPlacement> = {};
  for (const [id, placement] of Object.entries(layout.placements ?? {})) {
    placements[id] = normalizePlacement(placement, catalog[id]?.defaultSize ?? DEFAULT_SIZE);
  }
  for (const [id, entry] of Object.entries(catalog)) {
    if (entry.groupId && entry.groupId === id) {
      delete entry.groupId;
      continue;
    }
    // React can register a group child before the group definition. Keep the
    // relationship until the parent arrives instead of persisting the child
    // as a broken top-level item.
    const parent = entry.groupId ? catalog[entry.groupId] : undefined;
    if (entry.groupId && parent && parent.kind !== "group") delete entry.groupId;
  }
  const panels = (layout.panels ?? [])
    .filter((panel) => panel && typeof panel.id === "string" && typeof panel.name === "string")
    .map((panel, index) => ({
      id: panel.id,
      name: panel.name.trim().slice(0, 80) || `面板 ${index + 1}`,
      kind: panel.kind === "custom" ? ("custom" as const) : ("system" as const),
      order: Number.isFinite(panel.order) ? Math.max(0, Math.round(panel.order)) : index
    }))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const compact = options.compact === true || layout.snapToGrid !== false;
  return {
    version: 4,
    catalog,
    placements: normalizePlacements(placements, compact, catalog),
    snapToGrid: layout.snapToGrid !== false,
    ...(panels.length ? { panels } : {})
  };
}

function mergeDefinitions(layout: WidgetLayoutDocument, definitions: Record<string, WidgetDefinition>): WidgetLayoutDocument {
  const next = cloneLayout(layout);
  const deletedGroupIds = new Set(Object.entries(next.catalog).filter(([, entry]) => entry.config?.deleted === true).map(([id]) => id));
  for (const definition of Object.values(definitions)) {
    if (definition.groupId && deletedGroupIds.has(definition.groupId)) {
      delete next.catalog[definition.id];
      delete next.placements[definition.id];
      continue;
    }
    const existing = next.catalog[definition.id];
    const config = mergeWidgetConfig(existing?.config, definition.config);
    next.catalog[definition.id] = {
      ...existing,
      title: definition.title,
      kind: definition.kind,
      defaultSize: definition.defaultSize,
      ...(definition.templateId ? { templateId: definition.templateId } : {}),
      ...(definition.groupId ? { groupId: definition.groupId } : {}),
      ...(definition.widgetType ? { widgetType: definition.widgetType } : {}),
      ...(definition.category ? { category: definition.category } : {}),
      ...(definition.visualization ? { visualization: definition.visualization } : {}),
      ...(config ? { config } : {})
    };
    if (!next.placements[definition.id]) {
      const position = findNextFreePlacement(topLevelPlacements(next.placements, next.catalog), definition.defaultSize);
      next.placements[definition.id] = normalizePlacement({ ...position, size: definition.defaultSize });
    }
  }
  next.placements = normalizePlacements(next.placements, next.snapToGrid, next.catalog);
  return next;
}

function createInitialLayout(definitions: Record<string, WidgetDefinition>): WidgetLayoutDocument {
  return mergeDefinitions(emptyLayout(true), definitions);
}

function templateIdForDefinition(definition: WidgetDefinition): string {
  return definition.templateId ?? definition.id;
}

function buildTemplateLayout(layout: WidgetLayoutDocument): WidgetLayoutDocument {
  const next = emptyLayout(layout.snapToGrid);
  const positions: Record<string, WidgetPlacement> = {};
  for (const [id, entry] of Object.entries(layout.catalog)) {
    const templateId = entry.templateId ?? id;
    const placement = layout.placements[id] ?? normalizePlacement(undefined, entry.defaultSize);
    const position = placement.hidden ? { x: placement.x, y: placement.y } : findNextFreePlacement(positions, placement.size, placement.x, placement.y);
    positions[templateId] = { ...placement, ...position };
    next.catalog[templateId] = {
      title: entry.title,
      kind: entry.kind,
      defaultSize: entry.defaultSize,
      ...(entry.groupId ? { groupId: entry.groupId } : {}),
      ...(entry.widgetType ? { widgetType: entry.widgetType } : {}),
      ...(entry.category ? { category: entry.category } : {}),
      ...(entry.visualization ? { visualization: entry.visualization } : {}),
      ...(entry.config ? { config: { ...entry.config } } : {})
    };
  }
  next.placements = normalizePlacements(positions, next.snapToGrid, next.catalog);
  return next;
}

function applyTemplateToLayout(template: WidgetLayoutDocument, definitions: Record<string, WidgetDefinition>): WidgetLayoutDocument {
  const source = normalizeLayout(template);
  const next = emptyLayout(source.snapToGrid);
  for (const definition of Object.values(definitions)) {
    next.catalog[definition.id] = {
      ...source.catalog[templateIdForDefinition(definition)],
      title: definition.title,
      kind: definition.kind,
      defaultSize: definition.defaultSize,
      ...(definition.templateId ? { templateId: definition.templateId } : {}),
      ...(definition.groupId ? { groupId: definition.groupId } : {}),
      ...(definition.widgetType ? { widgetType: definition.widgetType } : {}),
      ...(definition.category ? { category: definition.category } : {}),
      ...(definition.visualization ? { visualization: definition.visualization } : {}),
      ...(definition.config ? { config: { ...definition.config } } : {})
    };
    const sourceId = templateIdForDefinition(definition);
    const sourcePlacement = source.placements[sourceId] ?? source.placements[definition.id];
    if (sourcePlacement) next.placements[definition.id] = { ...sourcePlacement };
  }
  return mergeDefinitions(next, definitions);
}

export function WidgetLayoutProvider({
  scopeKey,
  templateKey,
  editable,
  locked = false,
  getWidgetLayout,
  saveWidgetLayout,
  children
}: {
  scopeKey: string;
  templateKey: string;
  editable: boolean;
  locked?: boolean;
  getWidgetLayout: WidgetLayoutSyncClient["getWidgetLayout"];
  saveWidgetLayout: WidgetLayoutSyncClient["saveWidgetLayout"];
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<WidgetLayoutDocument>(() => emptyLayout());
  const draftRef = useRef(draft);
  const definitionsRef = useRef<Record<string, WidgetDefinition>>({});
  const [, setDefinitionVersion] = useState(0);
  const [remote, setRemote] = useState<WidgetLayoutSync>({ scopeKey, templateKey, instanceLayout: null, templates: [] });
  const remoteRef = useRef(remote);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const pastRef = useRef<WidgetLayoutDocument[]>([]);
  const futureRef = useRef<WidgetLayoutDocument[]>([]);
  const dragSessionRef = useRef<WidgetDragSession | null>(null);
  const [draggingWidgetId, setDraggingWidgetId] = useState<string | null>(null);

  const replaceDraft = useCallback((next: WidgetLayoutDocument, markDirty: boolean) => {
    const normalized = normalizeLayout(next);
    draftRef.current = normalized;
    setDraft(normalized);
    dirtyRef.current = markDirty;
    setDirty(markDirty);
    setHistoryVersion((value) => value + 1);
  }, []);

  const resetHistory = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    setHistoryVersion((value) => value + 1);
  }, []);

  const loadRemote = useCallback(async () => {
    setLoading(true);
    try {
      const nextRemote = await getWidgetLayout({ scopeKey, templateKey });
      remoteRef.current = nextRemote;
      setRemote(nextRemote);
      if (!dirtyRef.current) {
        const base = nextRemote.instanceLayout
          ? normalizeLayout(nextRemote.instanceLayout)
          : createInitialLayout(definitionsRef.current);
        replaceDraft(mergeDefinitions(base, definitionsRef.current), false);
        resetHistory();
      }
      setSyncMessage("");
    } catch (error) {
      setSyncMessage(error instanceof Error ? `中枢布局读取失败：${error.message}` : "中枢布局读取失败");
    } finally {
      setLoading(false);
    }
  }, [getWidgetLayout, replaceDraft, resetHistory, scopeKey, templateKey]);

  useEffect(() => {
    dirtyRef.current = false;
    setDirty(false);
    setEditMode(false);
    dragSessionRef.current = null;
    setDraggingWidgetId(null);
    definitionsRef.current = {};
    replaceDraft(emptyLayout(), false);
    resetHistory();
    void loadRemote();
  }, [loadRemote, resetHistory, replaceDraft, scopeKey, templateKey]);

  useEffect(() => {
    const refreshOnFocus = () => { void loadRemote(); };
    window.addEventListener("focus", refreshOnFocus);
    const timer = window.setInterval(refreshOnFocus, 30_000);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      window.clearInterval(timer);
    };
  }, [loadRemote]);

  useEffect(() => {
    if (!editable || locked) setEditMode(false);
  }, [editable, locked]);

  useEffect(() => {
    const unregisterGuard = registerWidgetLayoutDraftGuard(() => dirtyRef.current);
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      const proceed = window.confirm("当前布局修改尚未保存，退出后修改将丢失。是否继续退出？");
      if (!proceed) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      unregisterGuard();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const registerWidget = useCallback((definition: WidgetDefinition) => {
    const previous = definitionsRef.current[definition.id];
    definitionsRef.current[definition.id] = definition;
    if (!previous || JSON.stringify(previous) !== JSON.stringify(definition)) setDefinitionVersion((value) => value + 1);
    setDraft((current) => {
      const currentEntry = current.catalog[definition.id];
      const config = mergeWidgetConfig(currentEntry?.config, definition.config);
      const nextEntry: WidgetCatalogEntry = {
        ...currentEntry,
        title: definition.title,
        kind: definition.kind,
        defaultSize: definition.defaultSize,
        ...(definition.templateId ? { templateId: definition.templateId } : {}),
        ...(definition.groupId ? { groupId: definition.groupId } : {}),
        ...(definition.widgetType ? { widgetType: definition.widgetType } : {}),
        ...(definition.category ? { category: definition.category } : {}),
        ...(definition.visualization ? { visualization: definition.visualization } : {}),
        ...(config ? { config } : {})
      };
      if (currentEntry && current.placements[definition.id] && JSON.stringify(currentEntry) === JSON.stringify(nextEntry)) return current;
      const next = mergeDefinitions(current, { [definition.id]: definition });
      draftRef.current = next;
      return next;
    });
  }, []);

  const resolveWidget = useCallback((definition: WidgetDefinition): ResolvedWidget => {
    if (locked) return { size: definition.defaultSize, hidden: false };
    const entry = draft.catalog[definition.id];
    // A system-rendered widget stays declared by the page after removal. The
    // tombstone prevents a later data refresh from silently recreating it, and
    // the missing-entry branch avoids a one-frame flash before registration.
    if (definition.widgetType && (!entry || entry.config?.deleted === true)) {
      return { size: draft.placements[definition.id]?.size ?? definition.defaultSize, hidden: true, placement: draft.placements[definition.id] };
    }
    const placement = draft.placements[definition.id];
    return {
      size: placement?.size ?? definition.defaultSize,
      hidden: placement?.hidden === true,
      placement
    };
  }, [draft.catalog, draft.placements, locked]);

  const getWidgetSize = useCallback((id: string, defaultSize: WidgetSize): WidgetSize => {
    if (locked) return defaultSize;
    return draft.placements[id]?.size ?? defaultSize;
  }, [draft.placements, locked]);

  const mutateDraft = useCallback((mutator: (current: WidgetLayoutDocument) => WidgetLayoutDocument, options: WidgetMutationOptions = {}) => {
    if (!editable || locked) return;
    const current = draftRef.current;
    const next = normalizeLayout(mutator(cloneLayout(current)), options);
    pastRef.current = [...pastRef.current, current].slice(-HISTORY_LIMIT);
    futureRef.current = [];
    draftRef.current = next;
    setDraft(next);
    dirtyRef.current = true;
    setDirty(true);
    setHistoryVersion((value) => value + 1);
  }, [editable, locked]);

  const compactLayout = useCallback(() => {
    if (!editable || locked) return;
    const current = draftRef.current;
    const next = normalizeLayout(current, { compact: true });
    if (JSON.stringify(next.placements) === JSON.stringify(current.placements)) return;
    pastRef.current = [...pastRef.current, current].slice(-HISTORY_LIMIT);
    futureRef.current = [];
    draftRef.current = next;
    setDraft(next);
    dirtyRef.current = true;
    setDirty(true);
    setHistoryVersion((value) => value + 1);
  }, [editable, locked]);

  const beginWidgetDrag = useCallback((id: string) => {
    if (!editable || locked || dragSessionRef.current || !draftRef.current.placements[id]) return;
    dragSessionRef.current = { id, base: cloneLayout(draftRef.current), moved: false };
    setDraggingWidgetId(id);
  }, [editable, locked]);

  const previewWidgetDrop = useCallback((draggedId: string, targetId: string) => {
    const session = dragSessionRef.current;
    if (!session || session.id !== draggedId || draggedId === targetId) return;
    const current = draftRef.current;
    const next = moveWidgetWithAvoidance(current, draggedId, targetId);
    if (JSON.stringify(next.placements) === JSON.stringify(current.placements)) return;
    draftRef.current = next;
    setDraft(next);
    session.moved = true;
  }, []);

  const finishWidgetDrag = useCallback(() => {
    const session = dragSessionRef.current;
    if (session?.moved) {
      const normalized = normalizeLayout(draftRef.current);
      draftRef.current = normalized;
      setDraft(normalized);
      pastRef.current = [...pastRef.current, session.base].slice(-HISTORY_LIMIT);
      futureRef.current = [];
      dirtyRef.current = true;
      setDirty(true);
      setHistoryVersion((value) => value + 1);
    }
    dragSessionRef.current = null;
    setDraggingWidgetId(null);
  }, []);

  const cancelWidgetDrag = useCallback(() => {
    const session = dragSessionRef.current;
    if (session?.moved) {
      draftRef.current = session.base;
      setDraft(session.base);
    }
    dragSessionRef.current = null;
    setDraggingWidgetId(null);
  }, []);

  const addWidget = useCallback((definition: Omit<WidgetDefinition, "id"> & { id?: string }): string | null => {
    if (!editable || locked) return null;
    const requestedId = definition.id?.trim();
    let id = requestedId || `${definition.widgetType ?? "widget"}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    while (draftRef.current.catalog[id]) {
      id = `${definition.widgetType ?? "widget"}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }
    mutateDraft((current) => {
      current.catalog[id] = {
        title: definition.title,
        kind: definition.kind,
        defaultSize: definition.defaultSize,
        ...(definition.templateId ? { templateId: definition.templateId } : {}),
        ...(definition.groupId ? { groupId: definition.groupId } : {}),
        ...(definition.widgetType ? { widgetType: definition.widgetType } : {}),
        ...(definition.category ? { category: definition.category } : {}),
        ...(definition.visualization ? { visualization: definition.visualization } : {}),
        ...(definition.config ? { config: { ...definition.config } } : {})
      };
      const position = findNextFreePlacement(topLevelPlacements(current.placements, current.catalog), definition.defaultSize);
      current.placements[id] = normalizePlacement({ ...position, size: definition.defaultSize });
      return current;
    }, { compact: true });
    return id;
  }, [editable, locked, mutateDraft]);

  const addWidgetGroup = useCallback((group: Omit<WidgetDefinition, "id" | "groupId">, children: WidgetGroupChildDefinition[]): string | null => {
    if (!editable || locked) return null;
    const groupId = `${group.widgetType ?? "device-group"}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    mutateDraft((current) => {
      current.catalog[groupId] = {
        title: group.title,
        kind: group.kind,
        defaultSize: group.defaultSize,
        ...(group.templateId ? { templateId: group.templateId } : {}),
        ...(group.widgetType ? { widgetType: group.widgetType } : {}),
        ...(group.category ? { category: group.category } : {}),
        ...(group.visualization ? { visualization: group.visualization } : {}),
        ...(group.config ? { config: { ...group.config } } : {})
      };
      const groupPosition = findNextFreePlacement(topLevelPlacements(current.placements, current.catalog), group.defaultSize);
      current.placements[groupId] = normalizePlacement({ ...groupPosition, size: group.defaultSize });
      children.forEach((child, index) => {
        const childId = `${groupId}-${child.widgetType ?? "chart"}-${index}`;
        current.catalog[childId] = {
          title: child.title,
          kind: child.kind,
          defaultSize: child.defaultSize,
          groupId,
          ...(child.templateId ? { templateId: child.templateId } : {}),
          ...(child.widgetType ? { widgetType: child.widgetType } : {}),
          ...(child.category ? { category: child.category } : {}),
          ...(child.visualization ? { visualization: child.visualization } : {}),
          ...(child.config ? { config: { ...child.config } } : {})
        };
        current.placements[childId] = normalizePlacement({ x: 1, y: index + 1, size: child.defaultSize });
      });
      return current;
    }, { compact: true });
    return groupId;
  }, [editable, locked, mutateDraft]);

  const removeWidget = useCallback((id: string) => {
    mutateDraft((current) => {
      const entry = current.catalog[id];
      if (entry?.config?.systemRendered === true) {
        const placement = current.placements[id] ?? normalizePlacement(undefined, entry.defaultSize);
        placement.hidden = true;
        current.placements[id] = placement;
        entry.config = { ...(entry.config ?? {}), deleted: true };
        Object.entries(current.catalog)
          .filter(([, child]) => child.groupId === id)
          .forEach(([childId]) => {
            delete current.catalog[childId];
            delete current.placements[childId];
          });
        return current;
      }
      // Dynamic catalog widgets are user-created records. Removing a group
      // removes its children; removing a child removes that record. Static
      // legacy widgets without widgetType keep hide/restore behavior.
      if (!entry?.widgetType) {
        const placement = current.placements[id];
        if (placement) placement.hidden = true;
        return current;
      }
      const childIds = Object.entries(current.catalog)
        .filter(([, entry]) => entry.groupId === id)
        .map(([childId]) => childId);
      childIds.forEach((childId) => {
        delete current.catalog[childId];
        delete current.placements[childId];
      });
      delete current.catalog[id];
      delete current.placements[id];
      return current;
    }, { compact: true });
  }, [mutateDraft]);

  const updateWidgetConfig = useCallback((id: string, patch: WidgetInstanceConfig) => {
    mutateDraft((current) => {
      const entry = current.catalog[id];
      if (!entry) return current;
      entry.config = { ...(entry.config ?? {}), ...patch };
      if (patch.visualization) entry.visualization = patch.visualization;
      return current;
    });
  }, [mutateDraft]);

  const getLayoutSnapshot = useCallback(() => cloneLayout(draftRef.current), []);

  const updateSize = useCallback((id: string, size: WidgetSize) => {
    mutateDraft((current) => {
      const existing = current.placements[id] ?? normalizePlacement({ size });
      current.placements[id] = normalizePlacement({ ...existing, size });
      const entry = current.catalog[id];
      if (entry?.kind === "group") {
        entry.config = { ...(entry.config ?? {}), sizeOverride: size };
      }
      return current;
    }, { compact: true });
  }, [mutateDraft]);

  const hideWidget = useCallback((id: string) => {
    mutateDraft((current) => {
      const placement = current.placements[id] ?? normalizePlacement(undefined, current.catalog[id]?.defaultSize ?? DEFAULT_SIZE);
      placement.hidden = true;
      current.placements[id] = placement;
      current.placements = normalizePlacements(current.placements, current.snapToGrid, current.catalog);
      return current;
    }, { compact: true });
  }, [mutateDraft]);

  const restoreWidget = useCallback((id: string) => {
    mutateDraft((current) => {
      const entry = current.catalog[id];
      const placement = current.placements[id] ?? normalizePlacement(undefined, entry?.defaultSize ?? DEFAULT_SIZE);
      placement.hidden = false;
      if (entry?.config?.deleted === true) {
        const config = { ...entry.config };
        delete config.deleted;
        entry.config = Object.keys(config).length ? config : undefined;
      }
      if (current.snapToGrid) {
        const visible = { ...current.placements };
        delete visible[id];
        const position = findNextFreePlacement(visible, placement.size);
        placement.x = position.x;
        placement.y = position.y;
      }
      current.placements[id] = placement;
      return current;
    }, { compact: true });
  }, [mutateDraft]);

  const reorderWidgets = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    mutateDraft((current) => moveWidgetWithAvoidance(current, draggedId, targetId));
  }, [mutateDraft]);

  const toggleSnapToGrid = useCallback(() => {
    mutateDraft((current) => {
      current.snapToGrid = !current.snapToGrid;
      current.placements = normalizePlacements(current.placements, current.snapToGrid, current.catalog);
      return current;
    });
  }, [mutateDraft]);

  const resetDeviceLayout = useCallback(async (): Promise<boolean> => {
    if (!editable || locked || saving) return false;
    setSaving(true);
    try {
      const nextRemote = await saveWidgetLayout({ scopeKey, templateKey, instanceLayout: null });
      remoteRef.current = nextRemote;
      setRemote(nextRemote);
      replaceDraft(createInitialLayout(definitionsRef.current), false);
      resetHistory();
      setSyncMessage("已恢复初始布局");
      return true;
    } catch (error) {
      setSyncMessage(error instanceof Error ? `恢复初始布局失败：${error.message}` : "恢复初始布局失败");
      return false;
    } finally {
      setSaving(false);
    }
  }, [editable, locked, resetHistory, replaceDraft, saveWidgetLayout, saving, scopeKey, templateKey]);

  const applyTemplate = useCallback((templateId: string) => {
    const template = remoteRef.current.templates.find((item) => item.id === templateId);
    if (!template) return;
    replaceDraft(applyTemplateToLayout(template.layout, definitionsRef.current), true);
    resetHistory();
    setEditMode(true);
    setSyncMessage(`已应用“${template.name}”，点击“保存布局”后才会替换当前布局`);
  }, [replaceDraft, resetHistory]);

  const saveLayout = useCallback(async (): Promise<boolean> => {
    if (!editable || locked || saving) return false;
    setSaving(true);
    try {
      const nextRemote = await saveWidgetLayout({ scopeKey, templateKey, instanceLayout: cloneLayout(draftRef.current) });
      remoteRef.current = nextRemote;
      setRemote(nextRemote);
      replaceDraft(mergeDefinitions(normalizeLayout(nextRemote.instanceLayout), definitionsRef.current), false);
      resetHistory();
      setSyncMessage("当前布局已保存到中枢");
      return true;
    } catch (error) {
      setSyncMessage(error instanceof Error ? `布局保存失败：${error.message}` : "布局保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  }, [editable, locked, resetHistory, replaceDraft, saveWidgetLayout, saving, scopeKey, templateKey]);

  const saveAsTemplate = useCallback(async (name: string, templateId?: string): Promise<boolean> => {
    const normalizedName = name.trim();
    if (!normalizedName || !editable || locked || saving) return false;
    setSaving(true);
    try {
      const nextRemote = await saveWidgetLayout({
        scopeKey,
        templateKey,
        template: { id: templateId, name: normalizedName, layout: buildTemplateLayout(draftRef.current) }
      });
      remoteRef.current = nextRemote;
      setRemote(nextRemote);
      setSyncMessage(`通用模板“${normalizedName}”已保存到中枢`);
      return true;
    } catch (error) {
      setSyncMessage(error instanceof Error ? `通用模板保存失败：${error.message}` : "通用模板保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  }, [editable, locked, saveWidgetLayout, saving, scopeKey, templateKey]);

  const deleteTemplate = useCallback(async (templateId: string): Promise<boolean> => {
    if (!editable || locked || saving) return false;
    setSaving(true);
    try {
      const nextRemote = await saveWidgetLayout({ scopeKey, templateKey, deleteTemplateId: templateId });
      remoteRef.current = nextRemote;
      setRemote(nextRemote);
      setSyncMessage("通用模板已删除");
      return true;
    } catch (error) {
      setSyncMessage(error instanceof Error ? `通用模板删除失败：${error.message}` : "通用模板删除失败");
      return false;
    } finally {
      setSaving(false);
    }
  }, [editable, locked, saveWidgetLayout, saving, scopeKey, templateKey]);

  const exportLayout = useCallback(() => {
    if (typeof window === "undefined") return;
    const blob = new Blob([JSON.stringify({ kind: "dsc-widget-layout", version: 4, templateKey, layout: draftRef.current }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `guanlan-layout-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [templateKey]);

  const importLayout = useCallback((json: string): boolean => {
    if (!editable || locked) return false;
    try {
      const parsed = JSON.parse(json) as { layout?: WidgetLayoutDocument; version?: number; placements?: WidgetLayoutDocument["placements"]; catalog?: WidgetLayoutDocument["catalog"]; snapToGrid?: boolean; panels?: WidgetLayoutDocument["panels"] };
      const candidate = parsed.layout ?? parsed;
      if (!candidate.placements || !candidate.catalog) return false;
      replaceDraft(mergeDefinitions(normalizeLayout({
        version: candidate.version,
        placements: candidate.placements,
        catalog: candidate.catalog,
        snapToGrid: candidate.snapToGrid !== false,
        panels: candidate.panels
      }), definitionsRef.current), true);
      resetHistory();
      setSyncMessage("布局已导入，点击“保存布局”后才会同步到中枢");
      return true;
    } catch {
      return false;
    }
  }, [editable, locked, replaceDraft, resetHistory]);

  const undo = useCallback(() => {
    if (!editable || locked) return;
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(cloneLayout(draftRef.current));
    replaceDraft(previous, true);
  }, [editable, locked, replaceDraft]);

  const redo = useCallback(() => {
    if (!editable || locked) return;
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(cloneLayout(draftRef.current));
    replaceDraft(next, true);
  }, [editable, locked, replaceDraft]);

  const hiddenWidgets = useMemo(() => Object.entries(draft.catalog)
    .filter(([id]) => draft.placements[id]?.hidden)
    .map(([id, entry]) => ({ id, ...entry })), [draft.catalog, draft.placements]);

  const widgetEntries = useMemo(() => Object.entries(draft.catalog).map(([id, entry]) => ({ id, ...entry })), [draft.catalog]);

  const contextValue = useMemo<WidgetLayoutContextValue>(() => ({
    scopeKey,
    templateKey,
    editable,
    locked,
    editMode,
    setEditMode,
    loading,
    saving,
    dirty,
    syncMessage,
    snapToGrid: draft.snapToGrid,
    templates: remote.templates,
    resolveWidget,
    getWidgetSize,
    registerWidget,
    updateSize,
    hideWidget,
    restoreWidget,
    reorderWidgets,
    draggingWidgetId,
    beginWidgetDrag,
    previewWidgetDrop,
    finishWidgetDrag,
    cancelWidgetDrag,
    toggleSnapToGrid,
    resetDeviceLayout,
    applyTemplate,
    saveLayout,
    saveAsTemplate,
    deleteTemplate,
    exportLayout,
    importLayout,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    undo,
    redo,
    hasInstanceLayout: Boolean(remote.instanceLayout),
    hiddenWidgets,
    widgetEntries,
    addWidget,
    addWidgetGroup,
    removeWidget,
    updateWidgetConfig,
    compactLayout,
    getLayoutSnapshot
  }), [addWidget, addWidgetGroup, applyTemplate, beginWidgetDrag, cancelWidgetDrag, compactLayout, deleteTemplate, dirty, draft.snapToGrid, draggingWidgetId, editable, editMode, exportLayout, finishWidgetDrag, getLayoutSnapshot, getWidgetSize, hideWidget, hiddenWidgets, historyVersion, importLayout, loading, locked, previewWidgetDrop, redo, registerWidget, remote.instanceLayout, remote.templates, removeWidget, reorderWidgets, resetDeviceLayout, resolveWidget, restoreWidget, saveAsTemplate, saveLayout, saving, scopeKey, syncMessage, templateKey, toggleSnapToGrid, undo, updateSize, updateWidgetConfig, widgetEntries]);

  return <WidgetLayoutContext.Provider value={contextValue}>{children}</WidgetLayoutContext.Provider>;
}

export function useWidgetLayout() {
  const context = useContext(WidgetLayoutContext);
  if (!context) throw new Error("useWidgetLayout must be used inside WidgetLayoutProvider");
  return context;
}

export function useOptionalWidgetLayout() {
  return useContext(WidgetLayoutContext);
}

function placementStyle(placement: WidgetPlacement | undefined): React.CSSProperties | undefined {
  if (!placement) return undefined;
  return {
    "--widget-x": placement.x,
    "--widget-y": placement.y,
    "--widget-w": placement.w,
    "--widget-h": placement.h,
    "--widget-w-md": placement.size === "large" ? 2 : 1,
    "--widget-h-md": 2,
    order: placement.y * 100 + placement.x
  } as React.CSSProperties;
}

export function DesktopWidget({
  id,
  templateId,
  groupId,
  title,
  kind = "content",
  defaultSize = DEFAULT_SIZE,
  widgetType,
  category,
  visualization,
  config,
  className,
  children
}: {
  id: string;
  templateId?: string;
  groupId?: string;
  title: string;
  kind?: WidgetKind;
  defaultSize?: WidgetSize;
  widgetType?: string;
  category?: string;
  visualization?: WidgetVisualization;
  config?: WidgetInstanceConfig;
  className?: string;
  children: React.ReactNode;
}) {
  const layout = useWidgetLayout();
  const definition = useMemo(() => ({ id, templateId, groupId, title, kind, defaultSize, widgetType, category, visualization, config }), [category, config, defaultSize, groupId, id, kind, templateId, title, visualization, widgetType]);
  const resolved = layout.resolveWidget(definition);
  const editing = layout.editable && layout.editMode;
  const widgetRef = useRef<HTMLDivElement>(null);
  const pointerDragRef = useRef<{ pointerId: number; startX: number; startY: number; lastTargetId: string | null; handle: HTMLElement } | null>(null);
  const previousRectRef = useRef<DOMRect | null>(null);
  const flipAnimationRef = useRef<Animation | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    layout.registerWidget(definition);
  }, [definition, layout.registerWidget]);

  useLayoutEffect(() => {
    const node = widgetRef.current;
    if (!node) return;
    const nextRect = node.getBoundingClientRect();
    const previousRect = previousRectRef.current;
    previousRectRef.current = nextRect;
    if (dragging || !previousRect) return;
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
    flipAnimationRef.current?.cancel();
    flipAnimationRef.current = node.animate(
      [
        { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
        { transform: "translate3d(0, 0, 0)" }
      ],
      { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
    );
  }, [dragging, layout.draggingWidgetId, resolved.placement?.h, resolved.placement?.size, resolved.placement?.w, resolved.placement?.x, resolved.placement?.y]);

  if (resolved.hidden) return null;

  const findDropTarget = (clientX: number, clientY: number): string | null => {
    const node = widgetRef.current;
    const parent = node?.parentElement;
    if (!node || !parent) return null;
    const widgetForContainer = (element: Element): HTMLElement | null => {
      let candidate = element.closest<HTMLElement>("[data-widget-id]");
      while (candidate && candidate.parentElement !== parent) {
        candidate = candidate.parentElement?.closest<HTMLElement>("[data-widget-id]") ?? null;
      }
      return candidate;
    };
    const candidate = document.elementsFromPoint(clientX, clientY)
      .map(widgetForContainer)
      .find((element) => Boolean(element && element !== node && element.parentElement === parent));
    return candidate?.dataset.widgetId ?? null;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (!editing || event.button !== 0 || !resolved.placement) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastTargetId: null,
      handle: event.currentTarget
    };
    setDragOffset({ x: 0, y: 0 });
    setDragging(true);
    layout.beginWidgetDrag(id);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    const session = pointerDragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    const offsetX = event.clientX - session.startX;
    const offsetY = event.clientY - session.startY;
    if (Math.abs(offsetX) < 3 && Math.abs(offsetY) < 3) return;
    setDragOffset({ x: offsetX, y: offsetY });
    const targetId = findDropTarget(event.clientX, event.clientY);
    if (targetId && targetId !== session.lastTargetId) {
      session.lastTargetId = targetId;
      layout.previewWidgetDrop(id, targetId);
    }
  };

  const finishPointerDrag = (event: React.PointerEvent<HTMLSpanElement>, cancelled = false) => {
    const session = pointerDragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (session.handle.hasPointerCapture(session.pointerId)) session.handle.releasePointerCapture(session.pointerId);
    pointerDragRef.current = null;
    setDragOffset({ x: 0, y: 0 });
    setDragging(false);
    if (cancelled) layout.cancelWidgetDrag();
    else layout.finishWidgetDrag();
  };

  const widgetStyle = {
    ...(placementStyle(resolved.placement) ?? {}),
    ...(dragging ? { transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`, zIndex: 30 } : {})
  } as React.CSSProperties;

  return (
    <div
      ref={widgetRef}
      className={`workspace-widget workspace-widget--${resolved.size} workspace-widget--${kind}${editing ? " is-editing" : ""}${dragging ? " is-dragging" : ""}${className ? ` ${className}` : ""}`}
      style={widgetStyle}
      data-widget-id={id}
    >
      {editing && (
        <div className="workspace-widget__tools" onPointerDown={(event) => event.stopPropagation()}>
          <span
            className="workspace-widget__drag-hint"
            title="拖动以调整位置"
            role="button"
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(event) => finishPointerDrag(event)}
            onPointerCancel={(event) => finishPointerDrag(event, true)}
          >⠿ <span>拖动</span></span>
          <span className="workspace-widget__tool-title" title={title}>{title}</span>
          <div className="workspace-widget__size-control" role="group" aria-label={`${title}尺寸`}>
            {(["large", "medium", "small"] as WidgetSize[]).map((size) => (
              <button key={size} className={resolved.size === size ? "is-active" : ""} type="button" aria-pressed={resolved.size === size} onClick={() => layout.updateSize(id, size)}>
                {size === "large" ? "大" : size === "medium" ? "中" : "小"}
              </button>
            ))}
          </div>
          <button className="workspace-widget__hide" type="button" onClick={(event) => { event.stopPropagation(); layout.hideWidget(id); }}>隐藏</button>
          {widgetType && <button className="workspace-widget__remove" type="button" onClick={(event) => { event.stopPropagation(); layout.removeWidget(id); }}>移除</button>}
        </div>
      )}
      <div className="workspace-widget__content">{children}</div>
    </div>
  );
}

export function WidgetLayoutToolbar({ onOpenWidgetDrawer }: { onOpenWidgetDrawer?: () => void } = {}) {
  const layout = useWidgetLayout();
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!layout.editMode) {
      setHiddenOpen(false);
      setTemplatesOpen(false);
    }
  }, [layout.editMode]);

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    layout.importLayout(await file.text());
  };

  const handleToggleEditMode = async () => {
    if (!layout.editMode) {
      layout.compactLayout();
      layout.setEditMode(true);
      return;
    }
    if (layout.dirty) {
      if (layout.saving) return;
      const saved = await layout.saveLayout();
      if (!saved) return;
    }
    layout.setEditMode(false);
  };

  if (!layout.editable) return <span className="workspace-layout-lock">全景视图 · 布局锁定</span>;

  return (
    <div className="workspace-layout-toolbar">
      <span className={`workspace-layout-source${layout.dirty ? " is-dirty" : ""}`} title="布局由中枢保存和分发">
        {layout.loading ? "读取中枢布局" : layout.dirty ? "草稿布局" : layout.hasInstanceLayout ? "中枢布局" : "初始模板"}
      </span>
      <button className={`workspace-layout-toggle${layout.editMode ? " is-active" : ""}`} type="button" aria-pressed={layout.editMode} disabled={layout.saving && layout.dirty} onClick={() => void handleToggleEditMode()}>
        <span className="workspace-layout-toggle__mark">⌘</span>{layout.editMode ? "完成排布" : "编辑排布"}
      </button>
      {onOpenWidgetDrawer && <button className="workspace-layout-actions__button workspace-layout-actions__button--accent" type="button" onClick={onOpenWidgetDrawer}>添加小组件</button>}
      {layout.editMode && (
        <>
          <button className={`workspace-layout-snap${layout.snapToGrid ? " is-active" : ""}`} type="button" aria-pressed={layout.snapToGrid} onClick={layout.toggleSnapToGrid} title="打开后会按从左到右、从上到下自动填补空位">
            自动吸附 {layout.snapToGrid ? "开" : "关"}
          </button>
          <div className="workspace-layout-history" role="group" aria-label="布局历史">
            <button type="button" disabled={!layout.canUndo} onClick={layout.undo} title="撤销">↶</button>
            <button type="button" disabled={!layout.canRedo} onClick={layout.redo} title="重做">↷</button>
          </div>
          <button className="workspace-layout-save" type="button" onClick={() => void layout.saveLayout()} disabled={!layout.dirty || layout.saving}>
            {layout.saving ? "保存中" : "保存布局"}
          </button>
          <button className="workspace-layout-actions__button" type="button" onClick={() => void layout.resetDeviceLayout()} disabled={layout.saving}>
            {layout.saving ? "处理中" : "恢复初始"}
          </button>
          <div className="workspace-layout-template-menu">
            <button className="workspace-layout-actions__button" type="button" onClick={() => setTemplatesOpen((value) => !value)} aria-expanded={templatesOpen}>通用模板{layout.templates.length ? ` ${layout.templates.length}` : ""}</button>
            {templatesOpen && (
              <div className="workspace-layout-template-tray">
                {layout.templates.length ? layout.templates.map((template) => (
                  <div className="workspace-layout-template-item" key={template.id}>
                    <span><strong>{template.name}</strong><small>更新于 {new Date(template.updatedAt).toLocaleString()}</small></span>
                    <div><button type="button" onClick={() => { layout.applyTemplate(template.id); setTemplatesOpen(false); }}>应用</button><button type="button" onClick={() => void layout.deleteTemplate(template.id)}>删除</button></div>
                  </div>
                )) : <p className="workspace-layout-template-empty">当前类型和面板还没有通用模板。</p>}
              </div>
            )}
          </div>
          <div className="workspace-layout-template-save">
            <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="模板名称" aria-label="通用模板名称" />
            <button className="workspace-layout-actions__button" type="button" disabled={!templateName.trim() || layout.saving} onClick={() => { void layout.saveAsTemplate(templateName).then((saved) => { if (saved) setTemplateName(""); }); }}>保存为通用</button>
          </div>
          <div className="workspace-layout-actions" role="group" aria-label="布局文件操作">
            <button className="workspace-layout-actions__button" type="button" onClick={layout.exportLayout}>导出</button>
            <button className="workspace-layout-actions__button" type="button" onClick={() => fileInputRef.current?.click()}>导入</button>
            <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={(event) => void handleImport(event)} />
          </div>
        </>
      )}
      {layout.editMode && layout.hiddenWidgets.length > 0 && (
        <div className="workspace-layout-hidden">
          <button className="workspace-layout-hidden__toggle" type="button" onClick={() => setHiddenOpen((value) => !value)} aria-expanded={hiddenOpen}>已隐藏 {layout.hiddenWidgets.length} 项 <span aria-hidden="true">{hiddenOpen ? "⌃" : "⌄"}</span></button>
          {hiddenOpen && <div className="workspace-layout-hidden__tray">{layout.hiddenWidgets.map((widget) => <div className="workspace-layout-hidden__item" key={widget.id}><span><strong>{widget.title}</strong><small>{widget.kind === "group" ? "设备区块" : "内容区块"}</small></span><button type="button" onClick={() => layout.restoreWidget(widget.id)}>恢复</button></div>)}</div>}
        </div>
      )}
      {layout.syncMessage && <span className="workspace-layout-notice" role="status">{layout.syncMessage}</span>}
    </div>
  );
}
