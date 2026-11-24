import { type RefObject, useEffect, useMemo, useRef } from 'react';
import { composingKey } from '../lib/composer-commands';
import {
  contextApplies,
  KEYBINDING_ACTIONS,
  type KeybindingId,
  type KeyEnvironment,
  matchBinding,
  resolveKeybindings,
} from '../lib/keybindings';
import { useSettingsStore } from '../stores/settingsStore';

/** Returns false when the action does not apply right now, letting the key through. */
export type KeybindingHandler = (event: KeyboardEvent) => unknown;

interface Entry {
  id: KeybindingId;
  handlers: RefObject<Partial<Record<KeybindingId, KeybindingHandler>>>;
  /** The element a scoped handler acts on, such as one composer among several. */
  scope?: RefObject<Element | null>;
}

const entries = new Set<Entry>();
/** The scope that last had focus, so an action reaches the composer the person used last. */
let lastScope: Element | null = null;
/** The first key of a chord, waiting for its second. */
let pending: { event: KeyboardEvent; timer: ReturnType<typeof setTimeout> } | null = null;
const CHORD_WAIT_MS = 1500;

let cache: { saved: unknown; bindings: Record<KeybindingId, string> } | null = null;
function currentBindings() {
  const saved = useSettingsStore.getState().shortcuts;
  if (cache?.saved !== saved) cache = { saved, bindings: resolveKeybindings(saved) };
  return cache.bindings;
}

/** The bindings in effect, updating as soon as the person changes one. */
export function useResolvedKeybindings() {
  const saved = useSettingsStore((state) => state.shortcuts);
  return useMemo(() => resolveKeybindings(saved), [saved]);
}

function editable(target: Element | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

function environment(event: KeyboardEvent): KeyEnvironment {
  const target = event.target instanceof Element ? event.target : null;
  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
  return {
    terminal: !!target?.closest('.xterm'),
    editable: editable(target),
    dialog: dialogs.length > 0,
    modal: dialogs.some((dialog) => !dialog.closest('[data-radix-popper-content-wrapper]')),
    composer: !!target?.closest('[data-composer]'),
    ownFind: !!target?.closest('[data-own-find]'),
  };
}

function visible(element: Element | null | undefined): element is Element {
  return !!element?.isConnected && element.getClientRects().length > 0;
}

/**
 * The handlers to try for an action, in order: the scoped one holding focus (or, unless
 * the action needs focus inside it, the one used last, else the newest on screen), then
 * unscoped handlers, newest first.
 */
function handlersFor(id: KeybindingId, target: Element | null, focusInside: boolean) {
  const matching = [...entries].filter((entry) => entry.id === id);
  const scoped = matching.filter((entry) => entry.scope && visible(entry.scope.current));
  const focused = scoped.find((entry) => target && entry.scope?.current?.contains(target));
  const chosen =
    focused ??
    (focusInside
      ? undefined
      : (scoped.find((entry) => entry.scope?.current === lastScope) ?? scoped.at(-1)));
  const unscoped = matching.filter((entry) => !entry.scope).reverse();
  return [...(chosen ? [chosen] : []), ...unscoped];
}

function run(id: KeybindingId, event: KeyboardEvent, focusInside: boolean) {
  const target = event.target instanceof Element ? event.target : null;
  for (const entry of handlersFor(id, target, focusInside)) {
    const handler = entry.handlers.current?.[id];
    if (handler && handler(event) !== false) return true;
  }
  return false;
}

function clearPending() {
  if (pending) clearTimeout(pending.timer);
  pending = null;
}

/** Runs the action `event` completes; true when one did. Notes a chord's first key. */
function dispatch(event: KeyboardEvent, previous: KeyboardEvent | null) {
  const bindings = currentBindings();
  const env = environment(event);
  let waiting = false;
  for (const action of KEYBINDING_ACTIONS) {
    const binding = bindings[action.id];
    const match = matchBinding(event, binding, previous);
    if (!match || !contextApplies(action.when, binding, env)) continue;
    if (match === 'prefix') {
      // Only an action something here can run holds the key for its chord.
      if ([...entries].some((entry) => entry.id === action.id)) waiting = true;
      continue;
    }
    if (event.repeat && !action.repeat) continue;
    if (run(action.id, event, action.when === 'composerFocus')) {
      event.preventDefault();
      return true;
    }
  }
  if (waiting && !event.repeat) {
    event.preventDefault();
    pending = { event, timer: setTimeout(clearPending, CHORD_WAIT_MS) };
    return true;
  }
  return false;
}

function onKeyDown(event: KeyboardEvent) {
  // A terminal, the shortcut recorder or a field's own handling already used these keys.
  if (event.defaultPrevented || composingKey(event)) return clearPending();
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(event.key)) return;
  const previous = pending?.event ?? null;
  clearPending();
  // A key that does not finish the chord counts on its own.
  if (previous && dispatch(event, previous)) return;
  dispatch(event, null);
}

function onFocusIn(event: FocusEvent) {
  const target = event.target instanceof Element ? event.target : null;
  for (const entry of entries) {
    const scope = entry.scope?.current;
    if (scope && target && scope.contains(target)) lastScope = scope;
  }
}

function register(entry: Entry) {
  if (!entries.size) {
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
  }
  entries.add(entry);
  return () => {
    entries.delete(entry);
    if (entries.size) return;
    window.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('focusin', onFocusIn);
    clearPending();
    lastScope = null;
  };
}

/**
 * Runs `handlers` when their actions' bindings are pressed where the actions apply. With
 * `scope`, the handlers act for that element, and the focused or last used one wins.
 * Handlers always see the latest render's values.
 */
export function useKeybindingHandlers(
  handlers: Partial<Record<KeybindingId, KeybindingHandler | undefined>>,
  scope?: RefObject<Element | null>,
) {
  const latest = useRef(handlers);
  latest.current = handlers;
  const ids = (Object.keys(handlers) as KeybindingId[])
    .filter((id) => handlers[id])
    .sort()
    .join(' ');
  useEffect(() => {
    if (!ids) return;
    const unregister = ids
      .split(' ')
      .map((id) => register({ id: id as KeybindingId, handlers: latest, scope }));
    return () => {
      for (const stop of unregister) stop();
    };
  }, [ids, scope]);
}
