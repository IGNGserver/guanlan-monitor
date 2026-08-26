import type {
  WidgetInstanceConfig,
  WidgetLayoutCatalogEntry,
  WidgetLayoutDocument,
  WidgetVisualization
} from "@dsc/shared";
import {
  findNextFreePlacement,
  normalizePlacement,
  normalizePlacements,
  SIZE_PRESETS,
  topLevelPlacements,
  type WidgetKind,
  type WidgetSize
} from "./widgetGrid";

export type WidgetDefinition = {
  id: string;
  templateId?: string;
  groupId?: string;
  title: string;
  kind: WidgetKind;
  defaultSize: WidgetSize;
  defaultH?: number;
  compactH?: number;
  defaultW?: number;
  widgetType?: string;
  category?: string;
  visualization?: WidgetVisualization;
  config?: WidgetInstanceConfig;
};

type WidgetCatalogEntry = WidgetLayoutCatalogEntry;

export function cloneWidgetLayout(layout: WidgetLayoutDocument): WidgetLayoutDocument {
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

export function mergeWidgetConfig(existing: WidgetInstanceConfig | undefined, incoming: WidgetInstanceConfig | undefined): WidgetInstanceConfig | undefined {
  if (!existing && !incoming) return undefined;
  return { ...(existing ?? {}), ...(incoming ?? {}) };
}

/**
 * System widgets are declared by the page and may be rehydrated after a
 * refresh. User-added widgets are already represented by the persisted
 * catalog, so registering their React render node must never recreate them.
 */
export function isDeclarativeWidgetDefinition(definition: Pick<WidgetDefinition, "widgetType" | "config">): boolean {
  return !definition.widgetType || definition.config?.systemRendered === true;
}

export function mergeDefinitions(layout: WidgetLayoutDocument, definitions: Record<string, WidgetDefinition>): WidgetLayoutDocument {
  const next = cloneWidgetLayout(layout);
  const deletedGroupIds = new Set(Object.entries(next.catalog).filter(([, entry]) => entry.config?.deleted === true).map(([id]) => id));
  for (const definition of Object.values(definitions)) {
    if (!isDeclarativeWidgetDefinition(definition)) continue;
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
      if (definition.groupId) {
        next.placements[definition.id] = normalizePlacement({ x: 1, y: 1, size: definition.defaultSize });
      } else {
        const customH = definition.id === "compute-cpu-facts" ? 2 : definition.defaultH;
        const initialPreset = SIZE_PRESETS[definition.defaultSize];
        const position = findNextFreePlacement(topLevelPlacements(next.placements, next.catalog), definition.defaultSize, 1, 1, { w: initialPreset.w, h: customH ?? initialPreset.h });
        next.placements[definition.id] = normalizePlacement({ ...position, size: definition.defaultSize, h: customH });
      }
    }
  }
  next.placements = normalizePlacements(next.placements, next.snapToGrid, next.catalog);
  return next;
}
