import * as Dialog from '@radix-ui/react-dialog';
import { Search, Settings2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { PRESET_THEMES } from '../../lib/theme-engine';
import { useThemeStore } from '../../stores/themeStore';
import { type ActiveTab, WORKSPACE_VIEWS } from './navigation';

export function CommandPalette({
  isOpen,
  onClose,
  onNavigate,
  onOpenSettings,
}: {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: ActiveTab) => void;
  onOpenSettings?: () => void;
}) {
  const [query, setQuery] = useState('');
  const previousFocus = useRef<HTMLElement | null>(null);
  const setTheme = useThemeStore((state) => state.setTheme);
  const search = query.trim().toLowerCase();
  const showSettings =
    Boolean(onOpenSettings) &&
    ('settings preferences options configuration project'
      .split(' ')
      .some((kw) => kw.includes(search)) ||
      'settings & preferences'.includes(search));
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
          className="command-dialog fixed top-[18vh] left-1/2 -translate-x-1/2 w-[480px] max-w-[calc(100vw-2rem)] appearance-panel z-[81] p-3"
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
          <div className="command-search">
            <Search className="size-4 text-[var(--color-text-muted)]" />
            <input
              aria-label="Search commands"
              placeholder="Where do you want to go?"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full bg-transparent text-sm py-1 outline-none"
            />
            <Dialog.Close className="quiet-icon text-xs" aria-label="Close commands">
              Esc
            </Dialog.Close>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {showSettings && (
              <button
                data-command
                type="button"
                className="workspace-menu-item w-full text-left hover:bg-[var(--color-surface-hover)]"
                onClick={() => {
                  onOpenSettings?.();
                  onClose();
                }}
              >
                <Settings2 className="size-4 text-[var(--color-accent-ink)]" />
                <span>Settings & Preferences</span>
              </button>
            )}
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
                  const current = useThemeStore.getState().currentTheme;
                  setTheme({
                    ...theme,
                    isDark: current.isDark,
                    appearance: current.appearance,
                    atmosphere: current.atmosphere,
                  });
                  onClose();
                }}
              >
                <span className="size-3 rounded-full" style={{ background: theme.accentHex }} />
                <span>{theme.name}</span>
              </button>
            ))}
            {!views.length && !themes.length && !showSettings && (
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
