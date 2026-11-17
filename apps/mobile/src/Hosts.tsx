import { ConfirmDialog, FlowDiagram, type FlowState } from '@jackalope/ui';
import { ChevronRight, Monitor, Plus, Smartphone, Trash2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Bar } from './Bar';
import type { Host } from './native';
import { connectionState, lastSeen, workRows, workSummary } from './status';
import type { ComputerState } from './useComputers';

/** The link from this phone to a computer, from what the last request actually returned. */
function link(state?: ComputerState): FlowState {
  if (!state) return 'checking';
  return state.error ? 'failed' : 'connected';
}

/** Under the link: what needs you there, or when this phone last reached it. */
function describe(state?: ComputerState) {
  if (state?.error) {
    const status = connectionState(state.error);
    return `${status[0].toUpperCase()}${status.slice(1)} · ${lastSeen(state.lastSeen)}`;
  }
  if (!state?.snapshot) return 'Checking…';
  return workSummary(workRows(state.snapshot)) || 'Nothing needs you';
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
      <Bar title="Computers" onBack={onBack} />
      <ul className="mobile-computers" aria-label="Paired computers">
        {hosts.map((host, index) => {
          const state = computers[host.id];
          const address = host.origin.replace(/^https?:\/\//, '');
          return (
            <li
              key={host.id}
              className="mobile-computer mobile-card mobile-glass mobile-enter"
              style={{ '--enter': Math.min(index, 8) } as CSSProperties}
            >
              <FlowDiagram
                className="mobile-flow"
                from={{ label: 'This phone', icon: <Smartphone size={16} /> }}
                to={{ label: host.label, icon: <Monitor size={16} /> }}
                via={
                  host.origin.startsWith('http://')
                    ? 'Local'
                    : /\.ts\.net(?::\d+)?$/.test(address)
                      ? 'Tailscale HTTPS'
                      : 'HTTPS'
                }
                state={link(state)}
                error={state?.error}
              />
              <p className="mobile-computer-summary">{describe(state)}</p>
              <div className="mobile-computer-actions">
                <button type="button" className="mobile-computer-open" onClick={() => onOpen(host)}>
                  Open its work
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
                <ConfirmDialog
                  title={`Remove ${host.label} from this phone?`}
                  description="This phone stops seeing its work. The computer keeps this phone in Remote access until you remove it there too; pair again any time."
                  label="Remove"
                  busyLabel="Removing…"
                  onConfirm={() => onRemove(host)}
                  trigger={
                    <button
                      type="button"
                      className="mobile-icon-button"
                      aria-label={`Remove ${host.label} from this phone`}
                    >
                      <Trash2 size={18} aria-hidden="true" />
                    </button>
                  }
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mobile-note">
        Each computer runs its own work and this phone talks to each one directly, so one being
        offline never hides the others.
      </p>
      <button
        type="button"
        className="ui-button mobile-fab"
        data-variant="primary"
        data-size="lg"
        onClick={onPair}
      >
        <Plus size={20} aria-hidden="true" />
        Pair a computer
      </button>
    </main>
  );
}
