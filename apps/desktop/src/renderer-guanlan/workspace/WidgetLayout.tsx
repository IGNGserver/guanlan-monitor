import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type WidgetSize = "large" | "medium" | "small";
export type WidgetKind = "group" | "content";

type WidgetDefinition = {
  id: string;
  title: string;
  kind: WidgetKind;
  defaultSize: WidgetSize;
};

type WidgetPreference = {
  size: WidgetSize;
  hidden: boolean;
};

type WidgetCatalogEntry = Omit<WidgetDefinition, "id">;

type WidgetScope = {
  order: string[];
  preferences: Record<string, WidgetPreference>;
  catalog: Record<string, WidgetCatalogEntry>;
};

type WidgetStore = {
  version: 1;
  scopes: Record<string, WidgetScope>;
};

type ResolvedWidget = WidgetPreference & {
  order: number;
};

type HiddenWidget = WidgetDefinition;

type WidgetLayoutContextValue = {
  editable: boolean;
  editMode: boolean;
  setEditMode: React.Dispatch<React.SetStateAction<boolean>>;
  resolveWidget: (definition: WidgetDefinition) => ResolvedWidget;
  registerWidget: (definition: WidgetDefinition) => void;
  updateSize: (id: string, size: WidgetSize) => void;
  hideWidget: (id: string) => void;
  restoreWidget: (id: string) => void;
  reorderWidgets: (draggedId: string, targetId: string) => void;
  hiddenWidgets: HiddenWidget[];
};

const STORAGE_KEY = "dsc-desktop-widget-layout-v1";
const DEFAULT_SIZE: WidgetSize = "medium";

const WidgetLayoutContext = createContext<WidgetLayoutContextValue | null>(null);

function createScope(): WidgetScope {
  return {
    order: [],
    preferences: {},
    catalog: {}
  };
}

function createStore(): WidgetStore {
  return { version: 1, scopes: {} };
}

function readStore(): WidgetStore {
  if (typeof window === "undefined") return createStore();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<WidgetStore> | null;
    if (!parsed || parsed.version !== 1 || !parsed.scopes || typeof parsed.scopes !== "object") return createStore();
    return parsed as WidgetStore;
  } catch {
    return createStore();
  }
}

function scopeFor(store: WidgetStore, scopeKey: string): WidgetScope {
  return store.scopes[scopeKey] ?? createScope();
}

export function WidgetLayoutProvider({
  scopeKey,
  editable,
  children
}: {
  scopeKey: string;
  editable: boolean;
  children: React.ReactNode;
}) {
  const [store, setStore] = useState<WidgetStore>(() => readStore());
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    if (!editable) setEditMode(false);
  }, [editable]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // A locked-down desktop profile may disable localStorage. The page remains usable for this session.
    }
  }, [store]);

  const registerWidget = useCallback((definition: WidgetDefinition) => {
    setStore((current) => {
      const scope = scopeFor(current, scopeKey);
      const preference = scope.preferences[definition.id];
      const nextPreference = preference ?? { size: definition.defaultSize ?? DEFAULT_SIZE, hidden: false };
      const nextOrder = scope.order.includes(definition.id) ? scope.order : [...scope.order, definition.id];
      const nextCatalogEntry: WidgetCatalogEntry = {
        title: definition.title,
        kind: definition.kind,
        defaultSize: definition.defaultSize
      };
      const catalogIsSame = JSON.stringify(scope.catalog[definition.id]) === JSON.stringify(nextCatalogEntry);
      if (
        preference &&
        catalogIsSame &&
        nextOrder.length === scope.order.length
      ) {
        return current;
      }
      return {
        ...current,
        scopes: {
          ...current.scopes,
          [scopeKey]: {
            order: nextOrder,
            preferences: { ...scope.preferences, [definition.id]: nextPreference },
            catalog: { ...scope.catalog, [definition.id]: nextCatalogEntry }
          }
        }
      };
    });
  }, [scopeKey]);

  const resolveWidget = useCallback((definition: WidgetDefinition): ResolvedWidget => {
    const scope = scopeFor(store, scopeKey);
    const preference = scope.preferences[definition.id] ?? { size: definition.defaultSize ?? DEFAULT_SIZE, hidden: false };
    return {
      size: preference.size,
      hidden: editable && preference.hidden,
      order: scope.order.indexOf(definition.id)
    };
  }, [editable, scopeKey, store]);

  const updatePreference = useCallback((id: string, update: (preference: WidgetPreference) => WidgetPreference) => {
    if (!editable) return;
    setStore((current) => {
      const scope = scopeFor(current, scopeKey);
      const existing = scope.preferences[id] ?? { size: DEFAULT_SIZE, hidden: false };
      return {
        ...current,
        scopes: {
          ...current.scopes,
          [scopeKey]: {
            ...scope,
            preferences: { ...scope.preferences, [id]: update(existing) }
          }
        }
      };
    });
  }, [editable, scopeKey]);

  const updateSize = useCallback((id: string, size: WidgetSize) => {
    updatePreference(id, (preference) => ({ ...preference, size }));
  }, [updatePreference]);

  const hideWidget = useCallback((id: string) => {
    updatePreference(id, (preference) => ({ ...preference, hidden: true }));
  }, [updatePreference]);

  const restoreWidget = useCallback((id: string) => {
    updatePreference(id, (preference) => ({ ...preference, hidden: false }));
  }, [updatePreference]);

  const reorderWidgets = useCallback((draggedId: string, targetId: string) => {
    if (!editable || draggedId === targetId) return;
    setStore((current) => {
      const scope = scopeFor(current, scopeKey);
      const from = scope.order.indexOf(draggedId);
      const to = scope.order.indexOf(targetId);
      if (from < 0 || to < 0) return current;
      const nextOrder = [...scope.order];
      nextOrder.splice(from, 1);
      nextOrder.splice(to, 0, draggedId);
      return {
        ...current,
        scopes: {
          ...current.scopes,
          [scopeKey]: { ...scope, order: nextOrder }
        }
      };
    });
  }, [editable, scopeKey]);

  const hiddenWidgets = useMemo(() => {
    if (!editable) return [];
    const scope = scopeFor(store, scopeKey);
    return scope.order
      .filter((id) => scope.preferences[id]?.hidden && scope.catalog[id])
      .map((id) => {
        const entry = scope.catalog[id]!;
        return { id, ...entry };
      });
  }, [editable, scopeKey, store]);

  const contextValue = useMemo<WidgetLayoutContextValue>(() => ({
    editable,
    editMode,
    setEditMode,
    resolveWidget,
    registerWidget,
    updateSize,
    hideWidget,
    restoreWidget,
    reorderWidgets,
    hiddenWidgets
  }), [editable, editMode, hiddenWidgets, hideWidget, registerWidget, reorderWidgets, resolveWidget, restoreWidget, updateSize]);

  return <WidgetLayoutContext.Provider value={contextValue}>{children}</WidgetLayoutContext.Provider>;
}

export function useWidgetLayout() {
  const context = useContext(WidgetLayoutContext);
  if (!context) throw new Error("useWidgetLayout must be used inside WidgetLayoutProvider");
  return context;
}

export function DesktopWidget({
  id,
  title,
  kind = "content",
  defaultSize = DEFAULT_SIZE,
  children
}: {
  id: string;
  title: string;
  kind?: WidgetKind;
  defaultSize?: WidgetSize;
  children: React.ReactNode;
}) {
  const layout = useWidgetLayout();
  const definition = useMemo(() => ({ id, title, kind, defaultSize }), [defaultSize, id, kind, title]);
  const resolved = layout.resolveWidget(definition);

  useEffect(() => {
    layout.registerWidget(definition);
  }, [definition, layout.registerWidget]);

  if (resolved.hidden) return null;

  const editing = layout.editable && layout.editMode;
  const orderStyle = resolved.order >= 0 ? { order: resolved.order } : undefined;
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
      style={orderStyle}
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

  useEffect(() => {
    if (!layout.editMode) setHiddenOpen(false);
  }, [layout.editMode]);

  if (!layout.editable) {
    return <span className="workspace-layout-lock">全景视图 · 布局锁定</span>;
  }

  return (
    <div className="workspace-layout-toolbar">
      <button
        className={`workspace-layout-toggle${layout.editMode ? " is-active" : ""}`}
        type="button"
        aria-pressed={layout.editMode}
        onClick={() => layout.setEditMode((value) => !value)}
      >
        <span className="workspace-layout-toggle__mark">⌘</span>
        {layout.editMode ? "完成排布" : "编辑排布"}
      </button>
      {layout.editMode && layout.hiddenWidgets.length > 0 && (
        <div className="workspace-layout-hidden">
          <button className="workspace-layout-hidden__toggle" type="button" onClick={() => setHiddenOpen((value) => !value)} aria-expanded={hiddenOpen}>
            已隐藏 {layout.hiddenWidgets.length} 项 <span aria-hidden="true">{hiddenOpen ? "⌃" : "⌄"}</span>
          </button>
          {hiddenOpen && (
            <div className="workspace-layout-hidden__tray">
              {layout.hiddenWidgets.map((widget) => (
                <div className="workspace-layout-hidden__item" key={widget.id}>
                  <span><strong>{widget.title}</strong><small>{widget.kind === "group" ? "设备区块" : "内容区块"}</small></span>
                  <button type="button" onClick={() => layout.restoreWidget(widget.id)}>恢复</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
