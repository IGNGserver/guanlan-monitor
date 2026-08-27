import type {
  WidgetLayoutCatalogEntry,
  WidgetLayoutDocument,
  WidgetLayoutKind,
  WidgetLayoutPlacement,
  WidgetLayoutSize,
  WidgetInstanceConfig
} from "@dsc/shared";

export type WidgetSize = WidgetLayoutSize;
export type WidgetKind = WidgetLayoutKind;
export type WidgetPlacement = WidgetLayoutPlacement;
export type WidgetDisplayMode = "normal" | "minimal" | "board";

export const GRID_COLUMNS = 4;
export const DEFAULT_SIZE: WidgetSize = "medium";

export const SIZE_PRESETS: Record<WidgetSize, Pick<WidgetPlacement, "w" | "h">> = {
  large: { w: 4, h: 2 },
  medium: { w: 2, h: 2 },
  small: { w: 1, h: 2 }
};

export const COMPACT_SIZE_PRESETS: Record<Exclude<WidgetDisplayMode, "normal">, Record<WidgetSize, Pick<WidgetPlacement, "w" | "h">>> = {
  minimal: {
    large: { w: 4, h: 1 },
    medium: { w: 2, h: 1 },
    small: { w: 1, h: 1 }
  },
  board: {
    large: { w: 4, h: 1 },
    medium: { w: 2, h: 1 },
    small: { w: 1, h: 1 }
  }
};

export function isWidgetSize(value: unknown): value is WidgetSize {
  return value === "large" || value === "medium" || value === "small";
}

export function intersects(left: WidgetPlacement, right: WidgetPlacement): boolean {
  return left.x < right.x + right.w && left.x + left.w > right.x && left.y < right.y + right.h && left.y + left.h > right.y;
}

export function normalizePlacement(
  value: Partial<WidgetPlacement> | undefined,
  sizeFallback: WidgetSize = DEFAULT_SIZE,
  options?: { customH?: number; customW?: number }
): WidgetPlacement {
  const size = value?.size === "large" || value?.size === "medium" || value?.size === "small" ? value.size : sizeFallback;
  const preset = SIZE_PRESETS[size];
  const w = Number.isFinite(value?.w) && (value!.w as number) >= 1 && (value!.w as number) <= GRID_COLUMNS
    ? Math.round(value!.w as number)
    : (options?.customW ?? preset.w);
  const h = Number.isFinite(value?.h) && (value!.h as number) >= 1
    ? Math.round(value!.h as number)
    : (options?.customH ?? preset.h);
  const x = Number.isFinite(value?.x) ? Math.round(value?.x as number) : 1;
  const y = Number.isFinite(value?.y) ? Math.round(value?.y as number) : 1;
  return {
    x: Math.max(1, Math.min(x, GRID_COLUMNS - w + 1)),
    y: Math.max(1, y),
    w,
    h,
    size,
    hidden: value?.hidden === true
  };
}

export function resizePlacement(
  value: Partial<WidgetPlacement> | undefined,
  size: WidgetSize,
  options?: { customH?: number; customW?: number }
): WidgetPlacement {
  const existing = normalizePlacement(value, size, options);
  const preset = SIZE_PRESETS[size];
  return normalizePlacement({
    ...existing,
    size,
    w: options?.customW ?? preset.w,
    h: options?.customH ?? preset.h
  }, size, options);
}

export function findNextFreePlacement(
  placements: Record<string, WidgetPlacement>,
  size: WidgetSize,
  preferredX = 1,
  preferredY = 1,
  customDimensions?: { w?: number; h?: number }
): Pick<WidgetPlacement, "x" | "y"> {
  const preset = SIZE_PRESETS[size];
  const w = customDimensions?.w && customDimensions.w >= 1 ? Math.min(GRID_COLUMNS, Math.round(customDimensions.w)) : preset.w;
  const h = customDimensions?.h && customDimensions.h >= 1 ? Math.round(customDimensions.h) : preset.h;
  const existing = Object.values(placements).filter((placement) => !placement.hidden);
  const startY = Math.max(1, Math.round(preferredY));
  const startX = Math.max(1, Math.min(Math.round(preferredX), GRID_COLUMNS - w + 1));

  const preferredCandidate: WidgetPlacement = { x: startX, y: startY, w, h, size, hidden: false };
  if (existing.every((placement) => !intersects(preferredCandidate, placement))) {
    return { x: startX, y: startY };
  }

  for (let y = 1; y < 1000; y += 1) {
    for (let x = 1; x <= GRID_COLUMNS - w + 1; x += 1) {
      const candidate: WidgetPlacement = { x, y, w, h, size, hidden: false };
      if (existing.every((placement) => !intersects(candidate, placement))) return { x, y };
    }
  }

  const lastRow = existing.reduce((max, placement) => Math.max(max, placement.y + placement.h), 1);
  return { x: 1, y: lastRow };
}

export function findNextFreePlacementInContainer(
  placements: Record<string, WidgetPlacement>,
  size: WidgetSize,
  maxColumns: number,
  preferredX = 1,
  preferredY = 1,
  customDimensions?: { w?: number; h?: number }
): Pick<WidgetPlacement, "x" | "y"> {
  const preset = SIZE_PRESETS[size];
  const w = Math.min(customDimensions?.w && customDimensions.w >= 1 ? Math.round(customDimensions.w) : preset.w, maxColumns);
  const h = customDimensions?.h && customDimensions.h >= 1 ? Math.round(customDimensions.h) : preset.h;
  const existing = Object.values(placements).filter((placement) => !placement.hidden);
  const startY = Math.max(1, Math.round(preferredY));
  const startX = Math.max(1, Math.min(Math.round(preferredX), maxColumns - w + 1));

  const preferredCandidate: WidgetPlacement = { x: startX, y: startY, w, h, size, hidden: false };
  if (existing.every((placement) => !intersects(preferredCandidate, placement))) {
    return { x: startX, y: startY };
  }

  for (let y = 1; y < 1000; y += 1) {
    for (let x = 1; x <= maxColumns - w + 1; x += 1) {
      const candidate: WidgetPlacement = { x, y, w, h, size, hidden: false };
      if (existing.every((placement) => !intersects(candidate, placement))) return { x, y };
    }
  }

  const lastRow = existing.reduce((max, placement) => Math.max(max, placement.y + placement.h), 1);
  return { x: 1, y: lastRow };
}

export function isGroupedEntry(id: string, catalog: Record<string, WidgetLayoutCatalogEntry>): boolean {
  return Boolean(catalog[id]?.groupId);
}

export function topLevelPlacements(
  placements: Record<string, WidgetPlacement>,
  catalog: Record<string, WidgetLayoutCatalogEntry>
): Record<string, WidgetPlacement> {
  return Object.fromEntries(Object.entries(placements).filter(([id]) => !isGroupedEntry(id, catalog)));
}

export function projectDisplayPlacements(
  layout: Pick<WidgetLayoutDocument, "placements" | "catalog">,
  mode: WidgetDisplayMode
): Record<string, WidgetPlacement> {
  const source = Object.fromEntries(
    Object.entries(layout.placements).map(([id, placement]) => [id, { ...placement }])
  ) as Record<string, WidgetPlacement>;
  if (mode === "normal") return source;

  const projected: Record<string, WidgetPlacement> = {};
  const topLevel = Object.entries(topLevelPlacements(source, layout.catalog))
    .filter(([, placement]) => !placement.hidden)
    .sort(([leftId, left], [rightId, right]) => (
      left.y - right.y || left.x - right.x || leftId.localeCompare(rightId)
    ));

  for (const [id, placement] of topLevel) {
    const compactPreset = COMPACT_SIZE_PRESETS[mode][placement.size];
    const isGroup = layout.catalog[id]?.kind === "group";
    const width = compactPreset.w;
    // Groups keep their child-driven shape, but each saved row becomes one
    // compact row. Standalone widgets always use a single compact row.
    const height = isGroup ? Math.max(1, Math.ceil(placement.h / 2)) : compactPreset.h;
    const position = findNextFreePlacement(projected, placement.size, 1, 1, { w: width, h: height });
    projected[id] = { ...placement, ...position, w: width, h: height };
  }

  for (const [id, placement] of Object.entries(source)) {
    if (placement.hidden || isGroupedEntry(id, layout.catalog)) projected[id] = placement;
  }
  return projected;
}

export function layoutContainerForWidget(id: string, catalog: Record<string, WidgetLayoutCatalogEntry>): string | null {
  return catalog[id]?.groupId ?? null;
}

export function normalizePlacements(
  placements: Record<string, WidgetPlacement>,
  snapToGrid: boolean,
  catalog: Record<string, WidgetLayoutCatalogEntry> = {}
): Record<string, WidgetPlacement> {
  const normalized = Object.fromEntries(
    Object.entries(placements).map(([id, placement]) => [
      id,
      normalizePlacement(placement, catalog[id]?.defaultSize ?? DEFAULT_SIZE, {
        customH: id === "compute-cpu-facts" ? 2 : undefined
      })
    ])
  ) as Record<string, WidgetPlacement>;

  if (catalog["compute-cpu-facts"] && normalized["compute-cpu-facts"]) {
    normalized["compute-cpu-facts"].w = 4;
    normalized["compute-cpu-facts"].h = 2;
  }

  const groupIds = new Set<string>();
  for (const [id, entry] of Object.entries(catalog)) {
    if (entry.kind === "group" || (entry.groupId && catalog[entry.groupId])) {
      if (entry.kind === "group") groupIds.add(id);
      if (entry.groupId && catalog[entry.groupId]?.kind === "group") groupIds.add(entry.groupId);
    }
  }

  for (const groupId of groupIds) {
    const groupEntry = catalog[groupId];
    const group = normalized[groupId];
    if (!group) continue;

    const children = Object.entries(catalog)
      .filter(([, entry]) => entry.groupId === groupId)
      .map(([id]) => id)
      .filter((id) => Boolean(normalized[id]))
      .sort((left, right) => {
        const leftPlacement = normalized[left];
        const rightPlacement = normalized[right];
        return leftPlacement.y - rightPlacement.y || leftPlacement.x - rightPlacement.x || left.localeCompare(right);
      });

    const visibleChildren = children.filter((childId) => !normalized[childId].hidden);

    const configuredSize = groupEntry?.config?.sizeOverride;
    let groupSize: WidgetSize;
    if (isWidgetSize(configuredSize)) {
      groupSize = configuredSize;
    } else if (visibleChildren.length >= 2) {
      groupSize = "large";
    } else if (visibleChildren.length === 1) {
      groupSize = groupEntry?.defaultSize === "small" ? "small" : (groupEntry?.defaultSize === "large" ? "large" : "medium");
    } else {
      groupSize = groupEntry?.defaultSize ?? "small";
    }

    const groupColumns = SIZE_PRESETS[groupSize].w;
    const chartsPerRow = groupColumns >= 4 ? 2 : 1;
    const rowCount = visibleChildren.length ? Math.max(1, Math.ceil(visibleChildren.length / chartsPerRow)) : 1;
    const groupH = visibleChildren.length ? rowCount * 2 : 2;
    const groupW = groupColumns;

    visibleChildren.forEach((childId, index) => {
      const child = normalized[childId];
      const row = Math.floor(index / chartsPerRow);
      const col = index % chartsPerRow;
      const childW = groupColumns >= 4 ? 2 : groupColumns;
      const childH = 2;
      const childX = groupColumns >= 4 ? col * 2 + 1 : 1;
      const childY = row * 2 + 1;
      normalized[childId] = {
        ...child,
        x: childX,
        y: childY,
        w: childW,
        h: childH
      };
    });

    normalized[groupId] = normalizePlacement({
      ...group,
      size: groupSize,
      w: groupW,
      h: groupH
    }, groupSize);
  }

  const visibleTopLevel = Object.entries(normalized)
    .filter(([id, placement]) => !placement.hidden && !isGroupedEntry(id, catalog))
    .sort(([leftId, left], [rightId, right]) => {
      if (left.y !== right.y) return left.y - right.y;
      if (left.x !== right.x) return left.x - right.x;
      return leftId.localeCompare(rightId);
    });

  const finalPlacements: Record<string, WidgetPlacement> = {};
  if (snapToGrid) {
    for (const [id, placement] of visibleTopLevel) {
      const position = findNextFreePlacement(finalPlacements, placement.size, 1, 1, { w: placement.w, h: placement.h });
      finalPlacements[id] = { ...placement, ...position };
    }
  } else {
    for (const [id, placement] of visibleTopLevel) {
      const collides = Object.values(finalPlacements).some((occupied) => intersects(placement, occupied));
      if (collides) {
        const position = findNextFreePlacement(finalPlacements, placement.size, placement.x, placement.y, { w: placement.w, h: placement.h });
        finalPlacements[id] = { ...placement, ...position };
      } else {
        finalPlacements[id] = placement;
      }
    }
  }

  for (const [id, placement] of Object.entries(normalized)) {
    if (placement.hidden || isGroupedEntry(id, catalog)) {
      finalPlacements[id] = placement;
    }
  }

  return finalPlacements;
}

export function moveWidgetWithAvoidance(layout: WidgetLayoutDocument, draggedId: string, targetId: string): WidgetLayoutDocument {
  if (draggedId === targetId) return layout;
  const dragged = layout.placements[draggedId];
  const target = layout.placements[targetId];
  if (!dragged || !target || dragged.hidden || target.hidden) return layout;
  const containerId = layoutContainerForWidget(draggedId, layout.catalog);
  if (containerId !== layoutContainerForWidget(targetId, layout.catalog)) return layout;

  const siblings = Object.entries(layout.placements)
    .filter(([id, p]) => !p.hidden && layoutContainerForWidget(id, layout.catalog) === containerId)
    .sort(([leftId, left], [rightId, right]) => left.y - right.y || left.x - right.x || leftId.localeCompare(rightId))
    .map(([id]) => id);

  const fromIndex = siblings.indexOf(draggedId);
  const toIndex = siblings.indexOf(targetId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return layout;

  const nextOrder = [...siblings];
  nextOrder.splice(fromIndex, 1);
  nextOrder.splice(toIndex, 0, draggedId);

  const nextPlacements = { ...layout.placements };

  if (containerId) {
    const groupEntry = layout.catalog[containerId];
    const configuredSize = groupEntry?.config?.sizeOverride;
    const groupSize = isWidgetSize(configuredSize)
      ? configuredSize
      : (nextOrder.length >= 2 ? "large" : (groupEntry?.defaultSize ?? "medium"));
    const groupColumns = SIZE_PRESETS[groupSize].w;
    const chartsPerRow = groupColumns >= 4 ? 2 : 1;

    nextOrder.forEach((childId, index) => {
      const child = nextPlacements[childId];
      if (!child) return;
      const row = Math.floor(index / chartsPerRow);
      const col = index % chartsPerRow;
      const childW = groupColumns >= 4 ? 2 : groupColumns;
      const childH = 2;
      const childX = groupColumns >= 4 ? col * 2 + 1 : 1;
      const childY = row * 2 + 1;
      nextPlacements[childId] = {
        ...child,
        x: childX,
        y: childY,
        w: childW,
        h: childH
      };
    });
  } else {
    const placed: Record<string, WidgetPlacement> = {};
    for (const id of nextOrder) {
      const existing = nextPlacements[id];
      if (!existing) continue;
      const pos = findNextFreePlacement(placed, existing.size, 1, 1, { w: existing.w, h: existing.h });
      placed[id] = { ...existing, ...pos };
      nextPlacements[id] = placed[id];
    }
  }

  return { ...layout, placements: nextPlacements };
}

export function placementStyle(
  placement: Partial<WidgetPlacement> | undefined,
  fallbackSize: WidgetSize = DEFAULT_SIZE,
  customH?: number,
  customW?: number,
  customCompactH?: number
): {
  "--widget-w": number;
  "--widget-h": number;
  "--widget-w-md": number;
  "--widget-h-md": number;
  "--widget-h-compact": number;
  order: number;
} {
  const size = placement?.size ?? fallbackSize;
  const preset = SIZE_PRESETS[size] ?? SIZE_PRESETS.medium;
  const w = placement?.w && placement.w >= 1 ? placement.w : (customW ?? preset.w);
  const h = placement?.h && placement.h >= 1 ? placement.h : (customH ?? preset.h);
  const compactH = customCompactH && customCompactH >= 1 ? customCompactH : h;
  const x = placement?.x ?? 1;
  const y = placement?.y ?? 1;
  const order = (y - 1) * 100 + x;
  return {
    "--widget-w": w,
    "--widget-h": h,
    "--widget-w-md": w >= 3 ? 2 : 1,
    "--widget-h-md": h,
    "--widget-h-compact": compactH,
    order
  };
}
