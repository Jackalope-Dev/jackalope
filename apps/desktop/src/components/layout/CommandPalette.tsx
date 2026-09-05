import * as Dialog from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { PRESET_THEMES } from '../../lib/theme-engine';
import { useThemeStore } from '../../stores/themeStore';
import { type ActiveTab, WORKSPACE_VIEWS } from './navigation';

export function CommandPalette({
  isOpen,
  onClose,
  onNavigate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: ActiveTab) => void;
}) {
  const [query, setQuery] = useState('');
  const previousFocus = useRef<HTMLElement | null>(null);
  const setTheme = useThemeStore((state) => state.setTheme);
  const search = query.trim().toLowerCase();
  const views = WORKSPACE_VIEWS.filter((item) =>
    `${item.label} ${item.description}`.toLowerCase().includes(search),
  );
  const themes = PRESET_THEMES.filter((item) => item.name.toLowerCase().includes(search));

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-[var(--color-surface-sunken)]/70 backdrop-blur-sm z-[80]" />
        <Dialog.Content
          onOpenAutoFocus={() => {
            previousFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setQuery('');
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (previousFocus.current?.isConnected) previousFocus.current.focus();
          }}
          className="fixed top-[18vh] left-1/2 -translate-x-1/2 w-[480px] max-w-[calc(100vw-2rem)] appearance-panel z-[81] p-3"
          onKeyDown={(event) => {
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-command]'),
            );
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const target =
                index < 0
                  ? event.key === 'ArrowDown'
                    ? 0
                    : buttons.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                    buttons.length;
              buttons[target]?.focus();
            }
            if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
              event.preventDefault();
              buttons[0]?.click();
            }
          }}
        >
          <Dialog.Title className="sr-only">Jump to a view or theme</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search, then use arrow keys and Enter to choose. Escape closes this dialog.
          </Dialog.Description>
          <div className="flex items-center gap-3 px-3 py-3 mb-2 border-b border-[var(--color-border-subtle)]">
            <Search className="size-4 text-[var(--color-text-muted)]" />
            <input
              aria-label="Search commands"
              placeholder="Where do you want to go?"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full bg-transparent text-sm py-1 outline-none"
            />
            <Dialog.Close
              className="text-[10px] text-[var(--color-text-muted)] p-1"
              aria-label="Close commands"
            >
              Esc
            </Dialog.Close>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {views.map((item) => (
              <button
                data-command
                type="button"
                key={item.id}
                className="workspace-menu-item w-full text-left hover:bg-[var(--color-surface-hover)]"
                onClick={() => {
                  onNavigate(item.id);
                  onClose();
                }}
              >
                <item.icon className="size-4 text-[var(--color-accent-ink)]" />
                <span>{item.label}</span>
              </button>
            ))}
            {themes.length > 0 && <p className="menu-label">Change atmosphere</p>}
            {themes.map((theme) => (
              <button
                data-command
                type="button"
                key={theme.id}
                className="workspace-menu-item w-full hover:bg-[var(--color-surface-hover)]"
                onClick={() => {
                  setTheme(theme);
                  onClose();
                }}
              >
                <span className="size-3 rounded-full" style={{ background: theme.accentHex }} />
                <span>{theme.name}</span>
              </button>
            ))}
            {!views.length && !themes.length && (
              <p className="p-6 text-sm text-[var(--color-text-secondary)]">
                No matches. Try “tasks”, “agents”, or a color.
              </p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
