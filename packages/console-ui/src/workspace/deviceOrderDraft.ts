type DeviceOrderDraftGuard = () => boolean;

const draftGuards = new Set<DeviceOrderDraftGuard>();

export function registerDeviceOrderDraftGuard(guard: DeviceOrderDraftGuard): () => void {
  draftGuards.add(guard);
  return () => {
    draftGuards.delete(guard);
  };
}

export function confirmDiscardDeviceOrderDraft(): boolean {
  if (![...draftGuards].every((guard) => !guard())) return window.confirm("设备顺序修改尚未保存，离开后顺序草稿将丢失。是否继续？");
  return true;
}

/** Keep a local order draft valid when live updates add or remove instances. */
export function mergeDeviceOrder(draft: string[], serverOrder: string[]): string[] {
  const serverIds = new Set(serverOrder);
  const retained = draft.filter((deviceId) => serverIds.has(deviceId));
  const retainedIds = new Set(retained);
  return [...retained, ...serverOrder.filter((deviceId) => !retainedIds.has(deviceId))];
}
