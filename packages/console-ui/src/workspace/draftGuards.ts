import { hasDeviceOrderDraft } from "./deviceOrderDraft";
import { hasWidgetLayoutDraft } from "./WidgetLayout";

/**
 * Route, history and native-window exits share one prompt so a user never has
 * to confirm the same navigation twice when two independent drafts are open.
 */
export function confirmDiscardWorkspaceDrafts(): boolean {
  const hasLayoutDraft = hasWidgetLayoutDraft();
  const hasOrderDraft = hasDeviceOrderDraft();
  if (!hasLayoutDraft && !hasOrderDraft) return true;
  if (hasLayoutDraft && hasOrderDraft) {
    return window.confirm("布局和设备顺序修改尚未保存，离开后这些草稿都会丢失。是否继续？");
  }
  if (hasLayoutDraft) return window.confirm("当前布局修改尚未保存，离开后布局草稿将丢失。是否继续？");
  return window.confirm("设备顺序修改尚未保存，离开后顺序草稿将丢失。是否继续？");
}
