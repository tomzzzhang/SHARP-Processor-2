/**
 * Themed, promise-based replacements for the browser's native alert / confirm /
 * prompt, plus transient toast notifications. These render through <DialogHost>
 * (mounted once in App) so every dialog matches the app's look and theming
 * instead of the un-styled OS popups.
 *
 *   await showAlert('Up to date!')
 *   if (await showConfirm('Download the update?')) { ... }
 *   const name = await showPrompt({ title: 'Group name', defaultValue: 'Group 1' })
 *   toast('Saved', 'success')
 */
import { create } from 'zustand';

export type DialogKind = 'alert' | 'confirm' | 'prompt';

export interface DialogRequest {
  kind: DialogKind;
  title?: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (value: boolean | string | null | void) => void;
}

export type ToastKind = 'info' | 'success' | 'error';
export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface DialogStore {
  dialog: DialogRequest | null;
  toasts: ToastItem[];
  _open: (d: DialogRequest) => void;
  _close: () => void;
  _addToast: (t: ToastItem) => void;
  _removeToast: (id: number) => void;
}

export const useDialogStore = create<DialogStore>((set, get) => ({
  dialog: null,
  toasts: [],
  _open: (dialog) => {
    // If a dialog is already pending (e.g. a keyboard shortcut fired while one
    // was open), cancel it — resolve its promise with the dismissal value —
    // before opening the new one, so no awaiting promise leaks.
    const prev = get().dialog;
    if (prev) prev.resolve(prev.kind === 'prompt' ? null : prev.kind === 'confirm' ? false : undefined);
    set({ dialog });
  },
  _close: () => set({ dialog: null }),
  _addToast: (t) => set((s) => ({ toasts: [...s.toasts, t] })),
  _removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export function showAlert(message: string, opts?: { title?: string }): Promise<void> {
  return new Promise((resolve) => {
    useDialogStore.getState()._open({
      kind: 'alert',
      message,
      title: opts?.title,
      resolve: () => resolve(),
    });
  });
}

export function showConfirm(
  message: string,
  opts?: { title?: string; confirmLabel?: string; cancelLabel?: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState()._open({
      kind: 'confirm',
      message,
      title: opts?.title,
      confirmLabel: opts?.confirmLabel,
      cancelLabel: opts?.cancelLabel,
      resolve: (v) => resolve(v === true),
    });
  });
}

export function showPrompt(opts?: {
  title?: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.getState()._open({
      kind: 'prompt',
      title: opts?.title,
      message: opts?.message,
      defaultValue: opts?.defaultValue,
      confirmLabel: opts?.confirmLabel,
      resolve: (v) => resolve(typeof v === 'string' ? v : null),
    });
  });
}

let nextToastId = 0;

export function toast(message: string, kind: ToastKind = 'info') {
  const id = ++nextToastId;
  useDialogStore.getState()._addToast({ id, message, kind });
  setTimeout(() => useDialogStore.getState()._removeToast(id), kind === 'error' ? 6000 : 3500);
}
