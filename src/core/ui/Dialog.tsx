// src/core/ui/Dialog.tsx
//
// P001 — 5H13 branded dialogs.
//
// This is the ONE dialog/validation framework for the app. Do not add a
// second one. Any user-facing alert(), confirm(), or prompt() call must be
// replaced with the useDialog() hook exported here.
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type AlertOptions = { title?: string; tone?: 'info' | 'danger' };
type ConfirmOptions = {
  title?: string;
  tone?: 'info' | 'danger';
  confirmLabel?: string;
  cancelLabel?: string;
};
type PromptOptions = {
  title?: string;
  tone?: 'info' | 'danger';
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
};

type PendingDialog =
  | { kind: 'alert'; message: string; options?: AlertOptions; resolve: () => void }
  | { kind: 'confirm'; message: string; options?: ConfirmOptions; resolve: (v: boolean) => void }
  | {
      kind: 'prompt';
      message: string;
      options?: PromptOptions;
      resolve: (v: string | null) => void;
    };

type DialogApi = {
  alert: (message: string, options?: AlertOptions) => Promise<void>;
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  prompt: (message: string, options?: PromptOptions) => Promise<string | null>;
};

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('useDialog() must be used within <DialogProvider>.');
  }
  return ctx;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const queue = useRef<PendingDialog[]>([]);

  const advance = useCallback(() => {
    const next = queue.current.shift() ?? null;
    setPending(next);
    setPromptValue(next && next.kind === 'prompt' ? next.options?.defaultValue ?? '' : '');
  }, []);

  const enqueue = useCallback(
    (dialog: PendingDialog) => {
      queue.current.push(dialog);
      setPending((current) => {
        if (current) return current;
        const next = queue.current.shift() ?? null;
        setPromptValue(next && next.kind === 'prompt' ? next.options?.defaultValue ?? '' : '');
        return next;
      });
    },
    [],
  );

  const api = useMemo<DialogApi>(
    () => ({
      alert: (message, options) =>
        new Promise<void>((resolve) => {
          enqueue({ kind: 'alert', message, options, resolve });
        }),
      confirm: (message, options) =>
        new Promise<boolean>((resolve) => {
          enqueue({ kind: 'confirm', message, options, resolve });
        }),
      prompt: (message, options) =>
        new Promise<string | null>((resolve) => {
          enqueue({ kind: 'prompt', message, options, resolve });
        }),
    }),
    [enqueue],
  );

  const close = () => {
    advance();
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-900/40 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && pending.kind === 'alert') {
              pending.resolve();
              close();
            }
          }}
        >
          <div
            role={pending.kind === 'alert' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="border-b border-slate-100 px-5 py-3">
              <h2
                className={`text-sm font-semibold ${
                  pending.options?.tone === 'danger' ? 'text-red-700' : 'text-slate-800'
                }`}
              >
                {pending.options?.title ?? '5H13'}
              </h2>
            </div>
            <div className="px-5 py-4 text-sm text-slate-700 whitespace-pre-wrap">
              {pending.message}
              {pending.kind === 'prompt' && (
                <input
                  autoFocus
                  className="input mt-3 w-full"
                  placeholder={pending.options?.placeholder}
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = promptValue.trim();
                      if (pending.options?.required && !val) return;
                      pending.resolve(val);
                      close();
                    } else if (e.key === 'Escape') {
                      pending.resolve(null);
                      close();
                    }
                  }}
                />
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              {pending.kind === 'alert' && (
                <button
                  autoFocus
                  type="button"
                  className="button"
                  onClick={() => {
                    pending.resolve();
                    close();
                  }}
                >
                  OK
                </button>
              )}
              {pending.kind === 'confirm' && (
                <>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => {
                      pending.resolve(false);
                      close();
                    }}
                  >
                    {pending.options?.cancelLabel ?? 'Cancel'}
                  </button>
                  <button
                    autoFocus
                    type="button"
                    className={pending.options?.tone === 'danger' ? 'button-danger' : 'button'}
                    onClick={() => {
                      pending.resolve(true);
                      close();
                    }}
                  >
                    {pending.options?.confirmLabel ?? 'Confirm'}
                  </button>
                </>
              )}
              {pending.kind === 'prompt' && (
                <>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => {
                      pending.resolve(null);
                      close();
                    }}
                  >
                    {pending.options?.cancelLabel ?? 'Cancel'}
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={!!pending.options?.required && !promptValue.trim()}
                    onClick={() => {
                      pending.resolve(promptValue.trim());
                      close();
                    }}
                  >
                    {pending.options?.confirmLabel ?? 'OK'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
