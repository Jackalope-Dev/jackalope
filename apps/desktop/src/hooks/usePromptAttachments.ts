import { type ClipboardEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { attachmentReference } from '../lib/prompt-attachments';
import { nativeTask } from '../lib/task-runtime';
import { isTauriEnvironment } from '../lib/tauri-bridge';

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

/**
 * Lets a composer accept files: pasted images are saved for the project, and
 * files dropped on `target` or chosen with `pick` are referenced by path.
 * `onAttach` receives the prompt lines to add.
 */
export function usePromptAttachments({
  projectPath,
  target,
  onAttach,
  disabled,
}: {
  projectPath?: string;
  target: RefObject<HTMLElement | null>;
  onAttach: (references: string[]) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
  const onPaste = (event: ClipboardEvent) => {
    if (!available) return;
    const images = [...event.clipboardData.files].filter((file) => PASTE_TYPES[file.type]);
    if (!images.length) return;
    event.preventDefault();
    setBusy(true);
    setError('');
    void Promise.all(
      images.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const path = await nativeTask<string>('prompt_attachment_save', {
          projectPath,
          extension: PASTE_TYPES[file.type],
          bytes: Array.from(bytes),
        });
        return attachmentReference(path, projectPath);
      }),
    )
      .then((references) => attach.current(references))
      .catch((cause) => setError(String(cause)))
      .finally(() => setBusy(false));
  };
  const pick = async () => {
    if (!available) return;
    setError('');
    try {
      const paths = await nativeTask<string[]>('prompt_attachment_pick', { projectPath });
      if (paths.length) attach.current(paths.map((path) => attachmentReference(path, projectPath)));
    } catch (cause) {
      setError(String(cause));
    }
  };
  return { available, dragging, busy, error, clearError: () => setError(''), onPaste, pick };
}
