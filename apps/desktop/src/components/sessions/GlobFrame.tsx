import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import {
  GLOB_FRAME_EVENT,
  type GlobFrameMode,
  globLog,
  overlayReady,
} from '../../lib/window-attach';
import { useWindowTheme } from '../../window-bootstrap';
import './glob-frame.css';

/**
 * A click-through window sized just around another app's window, drawing a soft accent
 * outline: pulsing while the agent is dragged over that window, and glowing briefly
 * once it's attached. Native code sizes and places it; this page only draws.
 */
export function GlobFrame() {
  useWindowTheme(undefined);
  const [mode, setMode] = useState<GlobFrameMode>('off');
  /** Restarts the attached glow each time it's shown. */
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => void overlayReady().catch(() => undefined));
    });
    const stop = listen<{ mode: GlobFrameMode }>(GLOB_FRAME_EVENT, (event) => {
      setMode(event.payload.mode);
      setShown((value) => value + 1);
    });
    globLog('frame page mounted');
    return () => {
      cancelAnimationFrame(frame);
      void stop.then((unlisten) => unlisten());
    };
  }, []);

  if (mode === 'off') return null;
  return <div key={shown} className="glob-frame" data-mode={mode} aria-hidden="true" />;
}

/**
 * The thin accent edge that stays around an attached window for as long as it waits for
 * the agent: solid when the agent may control it, dashed when it may only see it.
 * Native code keeps it on the window; it closes when the agent takes the window, so the
 * grant's own frame and bar take over.
 */
export function AttachEdge({ control }: { control: boolean }) {
  useWindowTheme(undefined);
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => void overlayReady().catch(() => undefined));
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div className="attach-edge" data-control={control || undefined} aria-hidden="true" />;
}
