import { DropdownMenu as Menu } from '@jackalope/ui';
import { ChevronRight, Ellipsis, Monitor, Plus, Trash2 } from 'lucide-react';
import type { Host } from './native';

/** The computers this phone is paired with; each opens its work. */
export function Hosts({
  hosts,
  onOpen,
  onPair,
  onRemove,
}: {
  hosts: Host[];
  onOpen: (host: Host) => void;
  onPair: () => void;
  onRemove: (host: Host) => void;
}) {
  return (
    <main className="mobile-screen">
      <header className="mobile-bar mobile-glass">
        <h1>Computers</h1>
        <button
          type="button"
          className="mobile-icon-button"
          aria-label="Pair a computer"
          onClick={onPair}
        >
          <Plus size={22} aria-hidden="true" />
        </button>
      </header>
      <ul className="mobile-list mobile-card mobile-glass" aria-label="Paired computers">
        {hosts.map((host) => (
          <li key={host.id} className="mobile-row-wrap">
            <button type="button" className="mobile-row" onClick={() => onOpen(host)}>
              <span className="mobile-host-icon" aria-hidden="true">
                <Monitor size={18} />
              </span>
              <span className="mobile-row-body">
                <strong>{host.label}</strong>
                <small>{host.origin.replace(/^https?:\/\//, '')}</small>
              </span>
              <ChevronRight size={18} aria-hidden="true" className="mobile-row-chevron" />
            </button>
            <Menu.Root>
              <Menu.Trigger asChild>
                <button
                  type="button"
                  className="mobile-icon-button"
                  aria-label={`${host.label} options`}
                >
                  <Ellipsis size={18} aria-hidden="true" />
                </button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content className="workspace-menu" align="end">
                  <Menu.Item className="workspace-menu-item" onSelect={() => onRemove(host)}>
                    <Trash2 size={16} aria-hidden="true" />
                    Remove from this phone
                  </Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          </li>
        ))}
      </ul>
    </main>
  );
}
