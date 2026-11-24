import { describeError } from '@jackalope/contracts/errors';
import { type ClipboardEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { attachesPaste, pastedTextLabel, restorePaste } from '../lib/large-paste';
import { isTauriEnvironment } from '../lib/native/env';
import { invokeNative } from '../lib/native/transport';
import { attachmentReference } from '../lib/prompt-attachments';

const PASTE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function inside(element: HTMLElement | null, x: number, y: number) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** Pasted text saved as a file, which Undo puts back into the draft. */
interface PastedText {
  reference: string;
  text: string;
  label: string;
}

/**
 * Lets a composer accept files: pasted images are saved for the project, and
 * files dropped on `target` or chosen with `pick` are referenced by path.
 * `onAttach` receives the prompt lines to add. With `edit`, text pasted at 32 KiB
 * or more, or larger than the draft's remaining `room`, is saved as a text file
 * instead and listed in `pasted` until undone or dismissed.
 */
export function usePromptAttachments({
  projectPath,
  target,
  onAttach,
  disabled,
  edit,
  room,
}: {
  projectPath?: string;
  target: RefObject<HTMLElement | null>;
  onAttach: (references: string[]) => void;
  disabled?: boolean;
  edit?: (change: (current: string) => string) => void;
  /** Characters the draft can still take. */
  room?: () => number;
}) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pasted, setPasted] = useState<PastedText[]>([]);
  const attach = useRef(onAttach);
  attach.current = onAttach;
  const available = isTauriEnvironment() && !!projectPath && !disabled;
  useEffect(() => {
    if (!available) return;
    let stop: (() => void) | undefined;
    let canceled = false;
    void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
      const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const { payload } = event;
        if (payload.type === 'leave') {
          setDragging(false);
          return;
        }
        // Drag positions are physical pixels; element bounds are CSS pixels.
        const scale = window.devicePixelRatio || 1;
        const over = inside(target.current, payload.position.x / scale, payload.position.y / scale);
        if (payload.type === 'drop') {
          setDragging(false);
          if (over && payload.paths.length) {
            setError('');
            attach.current(payload.paths.map((path) => attachmentReference(path, projectPath)));
          }
        } else setDragging(over);
      });
      if (canceled) unlisten();
      else stop = unlisten;
    });
    return () => {
      canceled = true;
      stop?.();
    };
  }, [available, projectPath, target]);
  const pasteText = (event: ClipboardEvent) => {
    const text = event.clipboardData.getData('text/plain');
    if (!edit || !attachesPaste(text, room?.())) return;
    event.preventDefault();
    setBusy(true);
    setError('');
    void invokeNative<string>('prompt_attachment_save', {
      projectPath,
      extension: 'txt',
      bytes: Array.from(new TextEncoder().encode(text)),
    })
      .then((path) => {
        const reference = attachmentReference(path, projectPath);
        attach.current([reference]);
        setPasted((current) => [...current, { reference, text, label: pastedTextLabel(text) }]);
      })
      .catch((cause) => setError(describeError(cause)))
      .finally(() => setBusy(false));
  };
  const onPaste = (event: ClipboardEvent) => {
    if (!available) return;
    const images = [...event.clipboardData.files].filter((file) => PASTE_TYPES[file.type]);
    if (!images.length) {
      pasteText(event);
      return;
    }
    event.preventDefault();
    setBusy(true);
    setError('');
    void Promise.all(
      images.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const path = await invokeNative<string>('prompt_attachment_save', {
          projectPath,
          extension: PASTE_TYPES[file.type],
          bytes: Array.from(bytes),
        });
        return attachmentReference(path, projectPath);
      }),
    )
      .then((references) => attach.current(references))
      .catch((cause) => setError(describeError(cause)))
      .finally(() => setBusy(false));
  };
  const pick = async () => {
    if (!available) return;
    setError('');
    try {
      const paths = await invokeNative<string[]>('prompt_attachment_pick', { projectPath });
      if (paths.length) attach.current(paths.map((path) => attachmentReference(path, projectPath)));
    } catch (cause) {
      setError(describeError(cause));
    }
  };
  const dismissPaste = (reference: string) =>
    setPasted((current) => current.filter((item) => item.reference !== reference));
  const undoPaste = (reference: string) => {
    const item = pasted.find((entry) => entry.reference === reference);
    if (!item) return;
    edit?.((current) => restorePaste(current, item.reference, item.text));
    dismissPaste(reference);
  };
  return {
    available,
    dragging,
    busy,
    error,
    clearError: () => setError(''),
    onPaste,
    pick,
    pasted,
    undoPaste,
    dismissPaste,
  };
}
