import React, { useRef, useState } from "react";
import appIcon from "../../assets/app-icon.png";
import { useWorkspace } from "../WorkspaceContext";
import { M3IconButton } from "../m3";
import { Icon } from "../ui";

const appIconSrc = typeof appIcon === "string" ? appIcon : (appIcon as { src: string }).src;

export function NativeTitleBar() {
  const { minimizeWindow, toggleMaximizeWindow, closeWindow, capabilities, adapterDragStart, adapterDragMove, adapterDragEnd } = useWorkspace();
  const [isMaximized, setIsMaximized] = useState(false);
  const dragPointerId = useRef<number | null>(null);
  const toggleMaximize = async () => setIsMaximized(await toggleMaximizeWindow());
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragPointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    adapterDragStart(event.screenX, event.screenY);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragPointerId.current === event.pointerId) adapterDragMove(event.screenX, event.screenY);
  };
  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragPointerId.current !== event.pointerId) return;
    dragPointerId.current = null;
    adapterDragEnd();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  if (!capabilities.canControlNativeWindow) return null;
  return <header className="workspace-windowbar">
    <div className="workspace-windowbar__drag" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onLostPointerCapture={handlePointerUp} onDoubleClick={() => void toggleMaximize()}>
      <img className="workspace-windowbar__mark-img" src={appIconSrc} alt="观澜" /><strong>观澜</strong><span className="workspace-windowbar__separator" aria-hidden="true" /><span className="workspace-windowbar__subtitle">设备状态控制台</span>
    </div>
    <div className="workspace-windowbar__controls" role="group" aria-label="窗口控制">
      <M3IconButton className="workspace-window-control" label="最小化" onClick={() => void minimizeWindow()}><Icon name="windowMinimize" size={15} /></M3IconButton>
      <M3IconButton className="workspace-window-control" label={isMaximized ? "还原窗口" : "最大化"} onClick={() => void toggleMaximize()}><Icon name={isMaximized ? "windowRestore" : "windowMaximize"} size={14} /></M3IconButton>
      <M3IconButton className="workspace-window-control workspace-window-control--close" label="隐藏到托盘" onClick={() => void closeWindow()}><Icon name="windowClose" size={15} /></M3IconButton>
    </div>
  </header>;
}
