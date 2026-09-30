import React, { useRef } from "react";
import appIcon from "../../assets/app-icon.png";
import { useWorkspace } from "../WorkspaceContext";
import { M3IconButton } from "../m3";
import { CAPTION_GLYPHS, type CaptionGlyphName } from "./captionGlyphs";

const appIconSrc = typeof appIcon === "string" ? appIcon : (appIcon as { src: string }).src;

/**
 * One Windows caption button.
 *
 * The glyph is drawn inline on a 10x10 grid with 1px stroke (caption band owned
 * by the OS chrome, see `captionGlyphs.ts`). `stroke-linecap` stays `butt` so the
 * minimize rule does not grow past the 10px box.
 */
function CaptionButton({ glyph, label, className = "", onClick }: { glyph: CaptionGlyphName; label: string; className?: string; onClick: () => void }) {
  return <M3IconButton className={`workspace-caption-button ${className}`} label={label} onClick={onClick}>
    <svg className="workspace-caption-glyph" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <path d={CAPTION_GLYPHS[glyph]} fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="butt" strokeLinejoin="miter" />
    </svg>
  </M3IconButton>;
}

export function NativeTitleBar() {
  const { minimizeWindow, toggleMaximizeWindow, closeWindow, capabilities, adapterDragStart, adapterDragMove, adapterDragEnd, windowState } = useWorkspace();
  const dragPointerId = useRef<number | null>(null);
  /* The maximized flag is the host's, not a local guess. `toggleMaximizeWindow`
   * returns the intended state for the click that changed it, but the window can
   * also be maximized/restored from the taskbar, so the provider subscribes to
   * the native events and this reads the result. */
  const toggleMaximize = () => { void toggleMaximizeWindow(); };
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
  const restoreAvailable = windowState.maximized || windowState.fullscreen;
  return <header className="workspace-windowbar">
    <div className="workspace-windowbar__drag" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onLostPointerCapture={handlePointerUp} onDoubleClick={toggleMaximize}>
      <img className="workspace-windowbar__mark-img" src={appIconSrc} alt="观澜" /><strong>观澜</strong><span className="workspace-windowbar__separator" aria-hidden="true" /><span className="workspace-windowbar__subtitle">设备状态控制台</span>
    </div>
    <div className="workspace-windowbar__controls" role="group" aria-label="窗口控制">
      <CaptionButton glyph="minimize" label="最小化" onClick={() => void minimizeWindow()} />
      <CaptionButton glyph={restoreAvailable ? "restore" : "maximize"} label={restoreAvailable ? "还原窗口" : "最大化"} onClick={toggleMaximize} />
      <CaptionButton glyph="close" label="隐藏到托盘" className="workspace-caption-button--close" onClick={() => void closeWindow()} />
    </div>
  </header>;
}
