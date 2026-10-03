import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { M3IconButton } from "../m3";
import { Icon } from "../ui";

/** Native modal focus/inert behavior, with a history entry for system Back. */
export function TouchSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const id = useId();
  const lifecycle = useRef(0);
  useEffect(() => {
    const version = ++lifecycle.current;
    const previous = window.history.state;
    if (previous?.dscTouchSheet !== id) window.history.pushState({ ...previous, dscTouchSheet: id }, "");
    dialog.current?.showModal();
    const onPop = () => { if (window.history.state?.dscTouchSheet !== id) closeRef.current(); };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // React Strict Mode replays effects. Only a real unmount removes the
      // history entry, after a replay has had the chance to reattach.
      queueMicrotask(() => {
        if (lifecycle.current === version && window.history.state?.dscTouchSheet === id) window.history.back();
      });
    };
  }, [id]);
  const dismiss = () => {
    if (window.history.state?.dscTouchSheet === id) window.history.back();
    else closeRef.current();
  };
  return createPortal(<dialog ref={dialog} className="touch-sheet m3e-theme" aria-labelledby={id}
    onCancel={(event) => { event.preventDefault(); dismiss(); }}
    onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
    <div className="touch-sheet__body">
      <div className="touch-sheet__handle" aria-hidden="true" />
      <header><h2 id={id}>{title}</h2><M3IconButton label="关闭面板" onClick={dismiss}><Icon name="close" /></M3IconButton></header>
      {children}
    </div>
  </dialog>, document.body);
}
