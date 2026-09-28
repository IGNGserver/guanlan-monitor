import React, { useEffect, useState } from "react";
import { useWorkspace } from "../WorkspaceContext";
import { Button, CopyButton, Icon, Surface } from "../ui";
import { detectPlatform, platformShortcutRows, type NavigatorPlatform } from "../shortcuts";

/**
 * The keyboard reference page.
 *
 * `CapabilitiesShortcuts` used to print one cross-platform list to both clients.
 * The page now names the keys the reader actually has, and only the native
 * client is told about hiding the window to the tray.
 *
 * The platform probe is opt-in: the first render uses the non-mac default rather
 * than touching `navigator`, and the effect corrects it before paint.
 */
export function PlatformShortcuts() {
  const { capabilities } = useWorkspace();
  const [platform, setPlatform] = useState<NavigatorPlatform>("other");
  useEffect(() => setPlatform(detectPlatform()), []);
  const nativeWindow = capabilities.canControlNativeWindow;
  const rows = platformShortcutRows(platform, nativeWindow ? "Ctrl+R" : "F5", nativeWindow);
  const rowText = rows.map(({ keys, description }) => `${keys}\t${description}`).join("\n");
  return (
    <div className="workspace-settings-stack">
      <Surface>
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">键盘操作</span><h3>快捷键参考</h3></div><CopyButton text={rowText} label="复制全部快捷键" /></div>
        <div className="workspace-shortcut-list">{rows.map(({ keys, description }) => <div className="workspace-shortcut-row" key={keys}><kbd>{keys}</kbd><span>{description}</span></div>)}</div>
        {!nativeWindow && <p className="workspace-surface__description"><Icon name="about" size={15} />浏览器也有自己的刷新快捷键；观澜在聚焦控制台时会接管 <kbd>F5</kbd> 与 <kbd>Ctrl + R</kbd>，避免页面被整页重载。</p>}
        {nativeWindow && <p className="workspace-surface__description"><Icon name="about" size={15} />此处只列出观澜自有的快捷键；窗口隐藏到托盘后可从托盘图标重新打开。</p>}
      </Surface>
    </div>
  );
}
