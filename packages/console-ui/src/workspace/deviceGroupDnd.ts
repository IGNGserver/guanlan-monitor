import type React from "react";

export const DEVICE_GROUP_DND_MIME = "application/x-dsc-device-ids";

let activeDraggedDeviceIds: string[] | null = null;

export function startDeviceGroupDrag(
  event: React.DragEvent,
  deviceIds: readonly string[],
  summaryLabel: string
): void {
  const unique = [...new Set(deviceIds.filter(Boolean))];
  if (!unique.length) return;
  activeDraggedDeviceIds = unique;
  event.dataTransfer.effectAllowed = "move";
  try {
    event.dataTransfer.setData(DEVICE_GROUP_DND_MIME, JSON.stringify(unique));
    event.dataTransfer.setData("text/plain", summaryLabel);
  } catch {
    /* Some restricted WebViews limit custom MIME types; in-memory fallback handles same-tab drag. */
  }
}

export function endDeviceGroupDrag(): void {
  activeDraggedDeviceIds = null;
}

export function getActiveDraggedDeviceCount(): number {
  return activeDraggedDeviceIds?.length ?? 0;
}

export function isDeviceGroupDragEvent(event: React.DragEvent): boolean {
  if (activeDraggedDeviceIds && activeDraggedDeviceIds.length > 0) return true;
  const types = Array.from(event.dataTransfer?.types ?? []);
  return types.includes(DEVICE_GROUP_DND_MIME);
}

export function readDroppedDeviceIds(event: React.DragEvent): string[] {
  let parsed: string[] = [];
  try {
    const raw = event.dataTransfer?.getData(DEVICE_GROUP_DND_MIME);
    if (raw) {
      const json = JSON.parse(raw) as unknown;
      if (Array.isArray(json)) {
        parsed = json.filter((id): id is string => typeof id === "string" && id.length > 0);
      }
    }
  } catch {
    parsed = [];
  }
  const fallback = activeDraggedDeviceIds ?? [];
  activeDraggedDeviceIds = null;
  return [...new Set(parsed.length > 0 ? parsed : fallback)];
}
