import {
  Button,
  FieldCheck,
  InlineNotice,
  SettingActions,
  SettingGroup,
  SettingRow,
} from '@jackalope/ui';
import { type KeyboardEvent, useState } from 'react';
import {
  defaultShortcuts,
  displayShortcut,
  normalizeShortcut,
  resolveShortcuts,
  type ShortcutAction,
  shortcutNames,
} from '../../lib/shortcuts';
import { useSettingsStore } from '../../stores/settingsStore';

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

/** Shortcuts the app reserves; listed so they're discoverable and so rebinding can warn. */
const BUILT_IN: { keys: string[]; label: string; clashes?: (binding: string) => boolean }[] = [
  {
    keys: ['Mod', '1–9'],
    label: 'Jump to an open work tab',
    clashes: (binding) => /^Mod\+[1-9]$/.test(binding),
  },
  { keys: ['Ctrl', 'Tab'], label: 'Next open work tab' },
  { keys: ['Ctrl', 'Shift', 'Tab'], label: 'Previous open work tab' },
];

/** The keys a binding shows as keycaps, with Mod as this platform's primary modifier. */
function keycaps(binding: string): string[] {
  return displayShortcut(binding)
    .split('+')
    .map((key) => (isMac ? ({ Shift: '⇧', Alt: '⌥' }[key] ?? key) : key));
}

function Keycaps({ binding }: { binding: string }) {
  return (
    <span className="shortcut-keys" aria-hidden="true">
      {keycaps(binding).map((key) => (
        <kbd key={key} className="shortcut-key">
          {key}
        </kbd>
      ))}
    </span>
  );
}

/** A pressed key combination in the shortcut format, or null for a modifier alone. */
function recorded(event: KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(event.key)) return null;
  const parts: string[] = [];
  if (isMac ? event.metaKey : event.ctrlKey) parts.push('Mod');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  const code = event.code.startsWith('Key')
    ? event.code.slice(3)
    : event.code.startsWith('Digit')
      ? event.code.slice(5)
      : event.key;
  parts.push(code);
  return parts.join('+');
}

export function KeyboardShortcuts() {
  const settings = useSettingsStore();
  const [drafts, setDrafts] = useState(resolveShortcuts(settings.shortcuts));
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [invalid, setInvalid] = useState<Partial<Record<ShortcutAction, boolean>>>({});
  const [error, setError] = useState('');
  const actions = Object.keys(defaultShortcuts) as ShortcutAction[];
  /** Why a binding can't be used as is: another action has it, or the app reserves it. */
  const conflict = (action: ShortcutAction) => {
    const binding = drafts[action];
    const other = actions.find((item) => item !== action && drafts[item] === binding);
    if (other) return `Also set for ${shortcutNames[other]}.`;
    const reserved = BUILT_IN.find((item) => item.clashes?.(binding));
    return reserved ? `${reserved.label} uses this.` : '';
  };
  const changed = actions.some(
    (action) => drafts[action] !== resolveShortcuts(settings.shortcuts)[action],
  );
  const blocked = actions.some((action) => conflict(action));
  const save = () => {
    if (blocked) {
      setError('Choose a different shortcut for each action.');
      return;
    }
    settings.updateSettings({ shortcuts: drafts as Record<string, string> });
    setError('');
  };
  return (
    <>
      <SettingGroup
        title="Keyboard shortcuts"
        description="Choose Record, then press the keys. Use your primary modifier, optionally with Shift or Alt. Common editing and system shortcuts are reserved."
      >
        {actions.map((action) => {
          const problem = conflict(action);
          return (
            <SettingRow
              key={action}
              title={shortcutNames[action]}
              description={
                problem || invalid[action] ? (
                  <FieldCheck tone="error">
                    {invalid[action]
                      ? 'That combination is reserved or needs your primary modifier.'
                      : problem}
                  </FieldCheck>
                ) : undefined
              }
            >
              <span className="shortcut-edit">
                {recording === action ? (
                  <button
                    type="button"
                    className="shortcut-recorder"
                    // biome-ignore lint/a11y/noAutofocus: recording starts from the Record button the person just pressed.
                    autoFocus
                    aria-label={`Press the new shortcut for ${shortcutNames[action]}, or Escape to cancel`}
                    onBlur={() => setRecording(null)}
                    onKeyDown={(event) => {
                      event.preventDefault();
                      if (event.key === 'Escape') return setRecording(null);
                      const next = recorded(event);
                      if (!next) return;
                      const binding = normalizeShortcut(next);
                      setInvalid({ ...invalid, [action]: !binding });
                      if (binding) setDrafts({ ...drafts, [action]: binding });
                      setRecording(null);
                    }}
                  >
                    Press keys…
                  </button>
                ) : (
                  <Keycaps binding={drafts[action]} />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Record a shortcut for ${shortcutNames[action]} (now ${displayShortcut(drafts[action])})`}
                  onClick={() => setRecording(action)}
                >
                  Record
                </Button>
              </span>
            </SettingRow>
          );
        })}
        <SettingActions>
          <Button variant="outline" onClick={save} disabled={!changed}>
            Save shortcuts
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              settings.updateSettings({ shortcuts: {} });
              setDrafts(defaultShortcuts);
              setInvalid({});
              setError('');
            }}
          >
            Restore defaults
          </Button>
        </SettingActions>
      </SettingGroup>
      <SettingGroup title="Built in" description="These stay the same.">
        {BUILT_IN.map((item) => (
          <SettingRow key={item.label} title={item.label}>
            <span className="shortcut-keys" role="img" aria-label={item.keys.join(' ')}>
              {item.keys.map((key) => (
                <kbd key={key} className="shortcut-key">
                  {key === 'Mod' ? displayShortcut('Mod') : key}
                </kbd>
              ))}
            </span>
          </SettingRow>
        ))}
      </SettingGroup>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </>
  );
}
