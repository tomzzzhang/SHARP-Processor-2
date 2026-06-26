/**
 * Renders the app's themed dialog (alert / confirm / prompt) and the toast
 * stack. Mounted once in App. Driven by src/lib/dialogs.ts.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogStore } from '@/lib/dialogs';
import { Button } from '@/components/ui/button';
import { FOCUS_RING } from '@/lib/ui-classes';

export function DialogHost() {
  const dialog = useDialogStore((s) => s.dialog);
  const close = useDialogStore((s) => s._close);
  const toasts = useDialogStore((s) => s.toasts);
  const removeToast = useDialogStore((s) => s._removeToast);

  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Seed + focus the prompt field whenever a prompt opens.
  useEffect(() => {
    if (dialog?.kind === 'prompt') {
      setText(dialog.defaultValue ?? '');
      const t = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => clearTimeout(t);
    }
  }, [dialog]);

  const finish = (value: boolean | string | null | void) => {
    dialog?.resolve(value);
    close();
  };
  const onCancel = () => {
    if (!dialog) return;
    finish(dialog.kind === 'prompt' ? null : dialog.kind === 'confirm' ? false : undefined);
  };
  const onConfirm = () => {
    if (!dialog) return;
    finish(dialog.kind === 'prompt' ? text : dialog.kind === 'confirm' ? true : undefined);
  };

  // Esc cancels; Enter confirms (for prompt, Enter is handled on the input).
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && dialog.kind !== 'prompt') {
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog, text]);

  const defaultTitle =
    dialog?.kind === 'confirm' ? 'Confirm' : dialog?.kind === 'prompt' ? 'Enter a value' : 'SHARP Processor 2';

  return createPortal(
    <>
      {dialog && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/30 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onCancel();
          }}
        >
          <div className="w-full max-w-sm overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="text-sm font-semibold">{dialog.title ?? defaultTitle}</span>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Close"
                className={`rounded-sm p-0.5 text-muted-foreground hover:text-foreground ${FOCUS_RING}`}
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="space-y-2.5 px-4 py-3">
              {dialog.message && (
                <p className="whitespace-pre-line text-sm text-foreground/90">{dialog.message}</p>
              )}
              {dialog.kind === 'prompt' && (
                <input
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onConfirm();
                    }
                  }}
                  className={`h-8 w-full rounded-md border bg-background px-2 text-sm ${FOCUS_RING}`}
                />
              )}
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-2.5">
              {dialog.kind !== 'alert' && (
                <Button variant="ghost" size="sm" onClick={onCancel}>
                  {dialog.cancelLabel ?? 'Cancel'}
                </Button>
              )}
              <Button size="sm" onClick={onConfirm}>
                {dialog.confirmLabel ?? 'OK'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[2100] flex flex-col items-end gap-2">
          {toasts.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => removeToast(t.id)}
              className={`pointer-events-auto max-w-sm rounded-md border px-3 py-2 text-left text-xs shadow-lg ${
                t.kind === 'error'
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : t.kind === 'success'
                    ? 'border-border bg-primary/10 text-foreground'
                    : 'border-border bg-popover text-foreground'
              }`}
            >
              {t.message}
            </button>
          ))}
        </div>
      )}
    </>,
    document.body,
  );
}
