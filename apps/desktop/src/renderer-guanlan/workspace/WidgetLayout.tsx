import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
  WidgetLayoutCatalogEntry as SharedWidgetLayoutCatalogEntry,
  WidgetLayoutDocument,
  WidgetLayoutKind,
  WidgetLayoutPlacement as SharedWidgetLayoutPlacement,
  WidgetLayoutRequest,
  WidgetLayoutSaveRequest,
  WidgetLayoutSize,
  WidgetLayoutSync,
  WidgetLayoutTemplate
} from "@dsc/shared";

export type WidgetSize = WidgetLayoutSize;
export type WidgetKind = WidgetLayoutKind;
export type WidgetPlacement = SharedWidgetLayoutPlacement;

type WidgetDefinition = {
  id: string;
  templateId?: string;
  title: string;
  kind: WidgetKind;
  defaultSize: WidgetSize;
};

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
  toggleSnapToGrid: () => void;
  resetDeviceLayout: () => void;
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
};

const WidgetLayoutContext = createContext<WidgetLayoutContextValue | null>(null);
const GRID_COLUMNS = 12;
const HISTORY_LIMIT = 30;
const DEFAULT_SIZE: WidgetSize = "medium";

const SIZE_PRESETS: Record<WidgetSize, Pick<WidgetPlacement, "w" | "h">> = {
  large: { w: 12, h: 6 },
  medium: { w: 6, h: 6 },
  small: { w: 3, h: 3 }
};

function emptyLayout(snapToGrid = true): WidgetLayoutDocument {
  return { placements: {}, catalog: {}, snapToGrid };
}

function cloneLayout(layout: WidgetLayoutDocument): WidgetLayoutDocument {
  return {
    placements: Object.fromEntries(Object.entries(layout.placements).map(([id, placement]) => [id, { ...placement }])),
    catalog: Object.fromEntries(Object.entries(layout.catalog).map(([id, entry]) => [id, { ...entry }])),
    snapToGrid: layout.snapToGrid
  };
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

function normalizePlacements(placements: Record<string, WidgetPlacement>, snapToGrid: boolean): Record<string, WidgetPlacement> {
  const normalized = Object.fromEntries(
    Object.entries(placements).map(([id, placement]) => [id, normalizePlacement(placement)])
  ) as Record<string, WidgetPlacement>;
  if (!snapToGrid) return normalized;

  const visible = Object.entries(normalized)
    .filter(([, placement]) => !placement.hidden)
    .sort(([, left], [, right]) => left.y - right.y || left.x - right.x);
  const hidden = Object.entries(normalized).filter(([, placement]) => placement.hidden);
  const compacted: Record<string, WidgetPlacement> = {};
  for (const [id, placement] of visible) {
    const position = findNextFreePlacement(compacted, placement.size);
    compacted[id] = { ...placement, ...position };
  }
  for (const [id, placement] of hidden) compacted[id] = placement;
  return compacted;
}

function normalizeLayout(layout: WidgetLayoutDocument | null | undefined): WidgetLayoutDocument {
  if (!layout) return emptyLayout();
  const catalog: Record<string, WidgetCatalogEntry> = {};
  for (const [id, entry] of Object.entries(layout.catalog ?? {})) {
    if (!entry || typeof entry.title !== "string") continue;
    catalog[id] = {
      title: entry.title,
      kind: entry.kind === "group" ? "group" : "content",
      defaultSize: entry.defaultSize === "large" || entry.defaultSize === "small" ? entry.defaultSize : "medium",
      ...(entry.templateId ? { templateId: entry.templateId } : {})
    };
  }
  const placements: Record<string, WidgetPlacement> = {};
  for (const [id, placement] of Object.entries(layout.placements ?? {})) {
    placements[id] = normalizePlacement(placement, catalog[id]?.defaultSize ?? DEFAULT_SIZE);
  }
  return {
    catalog,
    placements: normalizePlacements(placements, layout.snapToGrid !== false),
    snapToGrid: layout.snapToGrid !== false
  };
}

function mergeDefinitions(layout: WidgetLayoutDocument, definitions: Record<string, WidgetDefinition>): WidgetLayoutDocument {
  const next = cloneLayout(layout);
  for (const definition of Object.values(definitions)) {
    next.catalog[definition.id] = {
      title: definition.title,
      kind: definition.kind,
      defaultSize: definition.defaultSize,
      ...(definition.templateId ? { templateId: definition.templateId } : {})
    };
    if (!next.placements[definition.id]) {
      const position = findNextFreePlacement(next.placements, definition.defaultSize);
      next.placements[definition.id] = normalizePlacement({ ...position, size: definition.defaultSize });
    }
  }
  next.placements = normalizePlacements(next.placements, next.snapToGrid);
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
      defaultSize: entry.defaultSize
    };
  }
  next.placements = normalizePlacements(positions, next.snapToGrid);
  return next;
}

function applyTemplateToLayout(template: WidgetLayoutDocument, definitions: Record<string, WidgetDefinition>): WidgetLayoutDocument {
  const source = normalizeLayout(template);
  const next = emptyLayout(source.snapToGrid);
  for (const definition of Object.values(definitions)) {
    next.catalog[definition.id] = {
      title: definition.title,
      kind: definition.kind,
      defaultSize: definition.defaultSize,
      ...(definition.templateId ? { templateId: definition.templateId } : {})
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
  const [definitionVersion, setDefinitionVersion] = useState(0);
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

  const registerWidget = useCallback((definition: WidgetDefinition) => {
    const previous = definitionsRef.current[definition.id];
    definitionsRef.current[definition.id] = definition;
    if (!previous || JSON.stringify(previous) !== JSON.stringify(definition)) setDefinitionVersion((value) => value + 1);
    setDraft((current) => {
      const next = mergeDefinitions(current, { [definition.id]: definition });
      draftRef.current = next;
      return next;
    });
  }, []);

  const resolveWidget = useCallback((definition: WidgetDefinition): ResolvedWidget => {
    if (locked) return { size: definition.defaultSize, hidden: false };
    const placement = draft.placements[definition.id];
    return {
      size: placement?.size ?? definition.defaultSize,
      hidden: editable && placement?.hidden === true,
      placement
    };
  }, [draft.placements, editable, locked]);

  const getWidgetSize = useCallback((id: string, defaultSize: WidgetSize): WidgetSize => {
    if (locked) return defaultSize;
    return draft.placements[id]?.size ?? defaultSize;
  }, [draft.placements, locked]);

  const mutateDraft = useCallback((mutator: (current: WidgetLayoutDocument) => WidgetLayoutDocument) => {
    if (!editable || locked) return;
    const current = draftRef.current;
    const next = normalizeLayout(mutator(cloneLayout(current)));
    pastRef.current = [...pastRef.current, current].slice(-HISTORY_LIMIT);
    futureRef.current = [];
    draftRef.current = next;
    setDraft(next);
    dirtyRef.current = true;
    setDirty(true);
    setHistoryVersion((value) => value + 1);
  }, [editable, locked]);

  const updateSize = useCallback((id: string, size: WidgetSize) => {
    mutateDraft((current) => {
      const existing = current.placements[id] ?? normalizePlacement({ size });
      current.placements[id] = normalizePlacement({ ...existing, size });
      current.placements = normalizePlacements(current.placements, current.snapToGrid);
      return current;
    });
  }, [mutateDraft]);

  const hideWidget = useCallback((id: string) => {
    mutateDraft((current) => {
      const placement = current.placements[id];
      if (placement) placement.hidden = true;
      current.placements = normalizePlacements(current.placements, current.snapToGrid);
      return current;
    });
  }, [mutateDraft]);

  const restoreWidget = useCallback((id: string) => {
    mutateDraft((current) => {
      const entry = current.catalog[id];
      const placement = current.placements[id] ?? normalizePlacement(undefined, entry?.defaultSize ?? DEFAULT_SIZE);
      placement.hidden = false;
      if (current.snapToGrid) {
        const visible = { ...current.placements };
        delete visible[id];
        const position = findNextFreePlacement(visible, placement.size);
        placement.x = position.x;
        placement.y = position.y;
      }
      current.placements[id] = placement;
      return current;
    });
  }, [mutateDraft]);

  const reorderWidgets = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    mutateDraft((current) => {
      const dragged = current.placements[draggedId];
      const target = current.placements[targetId];
      if (!dragged || !target) return current;
      const draggedPosition = { x: dragged.x, y: dragged.y };
      dragged.x = target.x;
      dragged.y = target.y;
      target.x = draggedPosition.x;
      target.y = draggedPosition.y;
      current.placements = normalizePlacements(current.placements, current.snapToGrid);
      return current;
    });
  }, [mutateDraft]);

  const toggleSnapToGrid = useCallback(() => {
    mutateDraft((current) => {
      current.snapToGrid = !current.snapToGrid;
      current.placements = normalizePlacements(current.placements, current.snapToGrid);
      return current;
    });
  }, [mutateDraft]);

  const resetDeviceLayout = useCallback(() => {
    replaceDraft(createInitialLayout(definitionsRef.current), true);
    resetHistory();
  }, [replaceDraft, resetHistory, definitionVersion]);

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
    const blob = new Blob([JSON.stringify({ kind: "dsc-widget-layout", version: 3, templateKey, layout: draftRef.current }, null, 2)], { type: "application/json" });
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
      const parsed = JSON.parse(json) as { layout?: WidgetLayoutDocument; placements?: WidgetLayoutDocument["placements"]; catalog?: WidgetLayoutDocument["catalog"]; snapToGrid?: boolean };
      const candidate = parsed.layout ?? parsed;
      if (!candidate.placements || !candidate.catalog) return false;
      replaceDraft(mergeDefinitions(normalizeLayout({
        placements: candidate.placements,
        catalog: candidate.catalog,
        snapToGrid: candidate.snapToGrid !== false
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
    hiddenWidgets
  }), [applyTemplate, deleteTemplate, dirty, draft.snapToGrid, editable, editMode, exportLayout, getWidgetSize, hideWidget, hiddenWidgets, historyVersion, importLayout, loading, locked, redo, registerWidget, remote.instanceLayout, remote.templates, reorderWidgets, resetDeviceLayout, resolveWidget, restoreWidget, saveAsTemplate, saveLayout, saving, scopeKey, syncMessage, templateKey, toggleSnapToGrid, undo, updateSize]);

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
  const editing = layout.editable && layout.editMode;

  useEffect(() => {
    layout.registerWidget(definition);
  }, [definition, layout.registerWidget]);

  if (resolved.hidden) return null;

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
              <button key={size} className={resolved.size === size ? "is-active" : ""} type="button" aria-pressed={resolved.size === size} onClick={() => layout.updateSize(id, size)}>
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

  if (!layout.editable) return <span className="workspace-layout-lock">全景视图 · 布局锁定</span>;

  return (
    <div className="workspace-layout-toolbar">
      <span className={`workspace-layout-source${layout.dirty ? " is-dirty" : ""}`} title="布局由中枢保存和分发">
        {layout.loading ? "读取中枢布局" : layout.dirty ? "未保存到中枢" : layout.hasInstanceLayout ? "本设备布局" : "初始模板"}
      </span>
      <button className={`workspace-layout-toggle${layout.editMode ? " is-active" : ""}`} type="button" aria-pressed={layout.editMode} onClick={() => layout.setEditMode((value) => !value)}>
        <span className="workspace-layout-toggle__mark">⌘</span>{layout.editMode ? "完成排布" : "编辑排布"}
      </button>
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
          <button className="workspace-layout-actions__button" type="button" onClick={layout.resetDeviceLayout}>恢复初始</button>
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
