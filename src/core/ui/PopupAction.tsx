'use client';

// Build 65 — universal page layout (user request, 2026-09-27): a page or tab
// opens on its main information (registers, lists, dashboards); actions that
// ADD or CHANGE things (add, create, record, upload, request …) live behind
// buttons in an <ActionBar> at the top and open in a pop-up window.
//
//   <ActionBar>
//     <PopupAction label="+ Add supplier" title="Add supplier" notice={message}>
//       <Form …>…</Form>
//     </PopupAction>
//     <PopupAction label="Pricing rules" variant="secondary" wide>…</PopupAction>
//   </ActionBar>
//
// Closing: the Close button, Esc, or a click outside. It also closes itself
// after a successful save: when a form inside was submitted and is then reset
// (the existing forms reset themselves on success), or when the page calls the
// close function from usePopupClose(). `notice` shows the page's success /
// error message inside the pop-up so errors are not hidden behind it.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const CloseCtx = createContext<() => void>(() => {});
/** Inside a PopupAction: close it (e.g. after a successful save). */
export function usePopupClose() { return useContext(CloseCtx); }

export function ActionBar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-2 ${className}`}>{children}</div>;
}

export function PopupAction({
  label, title, children, variant = 'primary', wide = false, notice, disabled = false, onOpen, openParam,
}: {
  label: ReactNode;
  title?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  variant?: 'primary' | 'secondary';
  wide?: boolean;
  notice?: string | null;
  disabled?: boolean;
  onOpen?: () => void;
  /** Build 82: open on arrival when the URL has ?new=<openParam> (5H13 Shortcuts). */
  openParam?: string;
}) {
  const [open, setOpen] = useState(false);
  const submitted = useRef(false);
  const noticeAtOpen = useRef<string | null | undefined>(null);
  const close = useCallback(() => { setOpen(false); submitted.current = false; }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => {
    if (!openParam || disabled || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('new') !== openParam) return;
    url.searchParams.delete('new');
    window.history.replaceState(window.history.state, '', url.pathname + (url.search ? url.search : '') + url.hash);
    noticeAtOpen.current = notice; submitted.current = false; setOpen(true); onOpen?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParam, disabled]);

  const show = () => { noticeAtOpen.current = notice; submitted.current = false; setOpen(true); onOpen?.(); };
  // only show messages produced while this pop-up is open
  const visibleNotice = open && notice && notice !== noticeAtOpen.current ? notice : null;

  return (
    <>
      <button type="button" disabled={disabled} onClick={show} className={variant === 'primary' ? 'button' : 'button-secondary'}>{label}</button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          role="dialog" aria-modal="true" aria-label={title ?? (typeof label === 'string' ? label : undefined)}
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div className={`my-8 w-full ${wide ? 'max-w-5xl' : 'max-w-3xl'} rounded-xl bg-white text-left shadow-xl`}>
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="text-lg font-semibold">{title ?? label}</h3>
              <button type="button" className="button-secondary" onClick={close}>Close</button>
            </div>
            <div
              className="p-5"
              onSubmitCapture={() => { submitted.current = true; }}
              onReset={() => { if (submitted.current) close(); }}
            >
              {visibleNotice && <div className="mb-4 rounded border bg-slate-50 p-3 text-sm">{visibleNotice}</div>}
              <CloseCtx.Provider value={close}>{typeof children === 'function' ? children(close) : children}</CloseCtx.Provider>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
