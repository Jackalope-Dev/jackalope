import { invokeNative } from './native/transport.ts';

/** How a workspace runs in the iOS Simulator; mirrors the native `Target`. */
export interface SimulatorTarget {
  /** Why it cannot run here, such as no Xcode; null when it can. */
  issue: string | null;
  scheme: string | null;
  /** The build Jackalope runs without a saved command. */
  buildCommand: string;
}

type SimulatorPhase =
  | 'booting'
  | 'building'
  | 'installing'
  | 'launching'
  | 'running'
  | 'failed'
  | 'stopped';

/** The Simulator side of a managed preview; mirrors the native `SimulatorPreview`. */
export interface SimulatorPreviewState {
  udid: string;
  device: string;
  bundleId: string | null;
  phase: SimulatorPhase;
  /** The input driver behind taps and typing: off, starting, ready or failed. */
  input: 'off' | 'starting' | 'ready' | 'failed';
  inputError: string | null;
  error: string | null;
  appearance: string | null;
  contentSize: string | null;
  landscape: boolean;
}

export interface SimulatorFrame {
  /** Base64 PNG. */
  png: string;
  width: number;
  height: number;
  capturedAt: string;
}

/** One element on the Simulator screen, its frame in points. */
export interface SimulatorElement {
  type: string;
  label?: string;
  identifier?: string;
  value?: string;
  frame: [number, number, number, number];
}

export interface SimulatorElements {
  screen: [number, number] | null;
  elements: SimulatorElement[];
}

export type SimulatorAction =
  | { action: 'tap'; x: number; y: number }
  | { action: 'type'; text: string }
  | { action: 'home' }
  | { action: 'rotate' }
  | { action: 'appearance'; value: 'light' | 'dark' }
  | { action: 'contentSize'; value: string }
  | { action: 'openUrl'; url: string };

/** Dynamic Type sizes, smallest first, with the label the toolbar shows. */
export const CONTENT_SIZES: { id: string; label: string }[] = [
  { id: 'extra-small', label: 'Extra small' },
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Default' },
  { id: 'extra-large', label: 'Extra large' },
  { id: 'extra-extra-large', label: 'Extra extra large' },
  { id: 'extra-extra-extra-large', label: 'Largest' },
  { id: 'accessibility-medium', label: 'Accessibility medium' },
  { id: 'accessibility-large', label: 'Accessibility large' },
  { id: 'accessibility-extra-large', label: 'Accessibility extra large' },
  { id: 'accessibility-extra-extra-large', label: 'Accessibility extra extra large' },
  { id: 'accessibility-extra-extra-extra-large', label: 'Accessibility largest' },
];

const targets = new Map<string, Promise<SimulatorTarget | null>>();

/** How `path` runs in the Simulator, or null when it is not an iOS app. Cached per path. */
export function simulatorTarget(path: string, refresh = false): Promise<SimulatorTarget | null> {
  let pending = refresh ? undefined : targets.get(path);
  if (!pending) {
    pending = invokeNative<SimulatorTarget | null>('simulator_preview_target', { path });
    targets.set(path, pending);
    pending.catch(() => targets.delete(path));
  }
  return pending;
}

/** Where a pointer lands on the frame, each axis from 0 to 1, or null outside it. */
export function framePosition(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
  return { x, y };
}

const STRUCTURAL = new Set([
  'application',
  'window',
  'other',
  'group',
  'layoutArea',
  'layoutItem',
  'scrollView',
  'table',
  'collectionView',
]);

/**
 * The element a person means at a frame position: the smallest one containing it,
 * passing over unlabeled containers when anything else matches. Mirrors the native
 * selection so the highlight shows what Select saves.
 */
export function elementAt(
  elements: SimulatorElements,
  position: { x: number; y: number },
): SimulatorElement | null {
  if (!elements.screen) return null;
  const [width, height] = elements.screen;
  const px = position.x * width;
  const py = position.y * height;
  const inside = elements.elements.filter(({ type, frame: [x, y, w, h] }) => {
    return type !== 'application' && px >= x && px <= x + w && py >= y && py <= y + h;
  });
  const area = (element: SimulatorElement) => element.frame[2] * element.frame[3];
  const smallest = (list: SimulatorElement[]) =>
    list.reduce<SimulatorElement | null>(
      (best, element) => (!best || area(element) < area(best) ? element : best),
      null,
    );
  const meaningful = inside.filter(
    (element) => !STRUCTURAL.has(element.type) || element.label || element.identifier,
  );
  return smallest(meaningful) ?? smallest(inside);
}

/** An element's box over the frame, in percent of the frame. */
export function highlightBox(
  element: SimulatorElement,
  screen: [number, number],
): { left: string; top: string; width: string; height: string } {
  const [x, y, w, h] = element.frame;
  const percent = (value: number, size: number) =>
    `${Math.max(0, Math.min(100, (value / size) * 100)).toFixed(2)}%`;
  return {
    left: percent(x, screen[0]),
    top: percent(y, screen[1]),
    width: percent(w, screen[0]),
    height: percent(h, screen[1]),
  };
}

/** A short name for an element: its type and label or identifier. */
export function describeElement(element: SimulatorElement): string {
  if (element.label) return `${element.type} “${element.label.slice(0, 80)}”`;
  if (element.identifier) return `${element.type} #${element.identifier}`;
  return element.type;
}

/** What the preview is doing, for its status line. */
export function simulatorStatus(state: SimulatorPreviewState | null | undefined): string {
  if (!state) return 'Starting…';
  const device = state.device || 'the task’s Simulator';
  switch (state.phase) {
    case 'booting':
      return `Starting ${device}…`;
    case 'building':
      return `Building for ${device}…`;
    case 'installing':
      return `Installing on ${device}…`;
    case 'launching':
      return 'Launching the app…';
    case 'running':
      return state.input === 'starting'
        ? `Running on ${device} · preparing taps and typing (about a minute the first time)`
        : `Running on ${device}`;
    case 'failed':
      return 'The Simulator preview stopped. See the build log.';
    case 'stopped':
      return 'Simulator preview stopped';
  }
}
