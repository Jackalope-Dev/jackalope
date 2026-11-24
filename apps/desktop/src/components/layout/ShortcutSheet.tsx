import { DialogCloseButton, DialogContent, DialogHeader } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { useResolvedKeybindings } from '../../hooks/useKeybindings';
import { useAppEvent } from '../../lib/app-events';
import {
  displayBinding,
  KEYBINDING_ACTIONS,
  KEYBINDING_GROUPS,
  type KeybindingId,
} from '../../lib/keybindings';
import { primaryModifier } from '../../lib/platform-shortcuts';

const TABS = Array.from({ length: 9 }, (_, index) => `tab${index + 1}` as KeybindingId);

/** Keys that are not rebindable, listed after the groups they belong with. */
const FIXED: Record<string, [string, string][]> = {
  Composer: [
    ['Send a message', 'Enter'],
    ['New line', 'Shift+Enter'],
    ['Earlier messages', '↑ · ↓'],
    ['Move through an open picker', 'Arrow keys'],
    ['Attach an image or file', 'Paste · Drop'],
  ],
  Anywhere: [['Close a dialog or menu', 'Esc']],
};

/**
 * Lists keyboard shortcuts with the person's own bindings. Opens with its shortcut (`?`
 * by default) or from command search.
 */
export function ShortcutSheet() {
  const [open, setOpen] = useState(false);
  const bindings = useResolvedKeybindings();
  useAppEvent('open-shortcuts', () => setOpen(true));
  // Nine Mod+digit tabs read as one row while they keep their defaults.
  const mod = primaryModifier();
  const tabsAsRange = TABS.every((id, index) => bindings[id] === `Mod+${index + 1}`);
  const groups = [
    ...KEYBINDING_GROUPS.map((group) => ({
      title: group,
      rows: [
        ...KEYBINDING_ACTIONS.filter(
          (action) =>
            action.group === group &&
            bindings[action.id] &&
            !(tabsAsRange && TABS.includes(action.id)),
        ).map((action): [string, string] => [action.label, displayBinding(bindings[action.id])]),
        ...(group === 'Open work' && tabsAsRange
          ? [['Go to tab 1–9', `${mod}+1…9`] as [string, string]]
          : []),
        ...(FIXED[group] ?? []),
      ],
    })),
    { title: 'Anywhere', rows: FIXED.Anywhere },
  ].filter((group) => group.rows.length);
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
        <p className="task-muted text-xs">Change shortcuts in Settings → Keyboard shortcuts.</p>
      </DialogContent>
    </Dialog.Root>
  );
}
