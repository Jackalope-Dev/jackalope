import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { primaryModifier } from '../../lib/platform-shortcuts';
import {
  displayShortcut,
  resolveShortcuts,
  type ShortcutAction,
  shortcutNames,
} from '../../lib/shortcuts';
import { useSettingsStore } from '../../stores/settingsStore';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';

/** Window event that opens the keyboard shortcut sheet. */
export const OPEN_SHORTCUTS = 'jackalope:open-shortcuts';

function typing(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** Lists keyboard shortcuts. Opens with ? outside text fields or from command search. */
export function ShortcutSheet() {
  const [open, setOpen] = useState(false);
  const saved = useSettingsStore((state) => state.shortcuts);
  useEffect(() => {
    const show = () => setOpen(true);
    const key = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (typing(event.target) || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener(OPEN_SHORTCUTS, show);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener(OPEN_SHORTCUTS, show);
      window.removeEventListener('keydown', key);
    };
  }, []);
  const bindings = resolveShortcuts(saved);
  const mod = primaryModifier();
  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: 'Workspace',
      rows: (Object.keys(bindings) as ShortcutAction[]).map((action) => [
        shortcutNames[action],
        displayShortcut(bindings[action]),
      ]),
    },
    {
      title: 'Open work',
      rows: [
        ['Go to tab 1–9', `${mod}+1…9`],
        ['Next tab', 'Ctrl+Tab'],
        ['Previous tab', 'Ctrl+Shift+Tab'],
      ],
    },
    {
      title: 'Writing',
      rows: [
        ['Send a message', 'Enter'],
        ['New line', 'Shift+Enter'],
        ['Continue a task from its follow-up', `${mod}+Enter`],
        ['Attach an image or file', 'Paste · Drop'],
      ],
    },
    {
      title: 'Anywhere',
      rows: [
        ['Close a dialog or menu', 'Esc'],
        ['Show these shortcuts', '?'],
      ],
    },
  ];
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogContent className="shortcut-sheet" aria-describedby={undefined}>
        <DialogHeader title="Keyboard shortcuts" />
        <DialogCloseButton />
        <div className="shortcut-sheet-groups">
          {groups.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.rows.map(([label, keys]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      <kbd>{keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="task-muted text-xs">Change workspace shortcuts in Settings → Desktop.</p>
      </DialogContent>
    </Dialog.Root>
  );
}
