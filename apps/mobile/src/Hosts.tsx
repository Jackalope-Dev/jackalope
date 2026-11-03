import { DropdownMenu as Menu } from '@jackalope/ui';
import { ChevronRight, Ellipsis, Monitor, Plus, Trash2 } from 'lucide-react';
import { Bar } from './Bar';
import type { Host } from './native';
import { workRows, workSummary } from './status';
import type { ComputerState } from './useComputers';

/** What a computer row says under its name: unreachable, what needs you, or its address. */
function describe(host: Host, state?: ComputerState) {
  const address = host.origin.replace(/^https?:\/\//, '');
  if (state?.error) return `Unreachable · ${address}`;
  const summary = state?.snapshot ? workSummary(workRows(state.snapshot)) : '';
  return summary ? `${summary} · ${address}` : address;
}

/** The computers this phone is paired with; each opens its own work. */
export function Hosts({
  hosts,
  computers,
  onBack,
  onOpen,
  onPair,
  onRemove,
}: {
  hosts: Host[];
  computers: Record<string, ComputerState>;
  onBack: () => void;
  onOpen: (host: Host) => void;
  onPair: () => void;
  onRemove: (host: Host) => void;
}) {
  return (
    <main className="mobile-screen">
      <Bar title="Computers" onBack={onBack}>
        <button
          type="button"
          className="mobile-icon-button"
          aria-label="Pair a computer"
          onClick={onPair}
        >
          <Plus size={22} aria-hidden="true" />
        </button>
      </Bar>
      <ul className="mobile-list mobile-card mobile-glass" aria-label="Paired computers">
        {hosts.map((host) => (
          <li key={host.id} className="mobile-row-wrap">
            <button type="button" className="mobile-row" onClick={() => onOpen(host)}>
              <span
                className="mobile-host-icon"
                data-unreachable={computers[host.id]?.error ? true : undefined}
                aria-hidden="true"
              >
                <Monitor size={18} />
              </span>
              <span className="mobile-row-body">
                <strong>{host.label}</strong>
                <small>{describe(host, computers[host.id])}</small>
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
      <p className="mobile-note">
        Each computer runs its own work. Pair every computer you want to check in on.
      </p>
    </main>
  );
}
