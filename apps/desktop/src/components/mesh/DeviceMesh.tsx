import {
  CheckCircle2,
  Cloud,
  Laptop,
  Monitor,
  Plus,
  RefreshCw,
  Server,
  Smartphone,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface DeviceItem {
  id: string;
  name: string;
  type: 'desktop' | 'laptop' | 'server' | 'mobile';
  os: string;
  status: 'online' | 'syncing' | 'idle';
  lastSeen: string;
  isCurrent: boolean;
}

const INITIAL_DEVICES: DeviceItem[] = [
  {
    id: 'dev-1',
    name: 'DEV-WORKSTATION',
    type: 'desktop',
    os: 'Windows 11 (Tauri Host)',
    status: 'online',
    lastSeen: 'Active now',
    isCurrent: true,
  },
  {
    id: 'dev-2',
    name: 'MacBook Pro M3 Max',
    type: 'laptop',
    os: 'macOS Sonoma',
    status: 'online',
    lastSeen: '2m ago',
    isCurrent: false,
  },
  {
    id: 'dev-3',
    name: 'Compute Cluster (GPU Rig)',
    type: 'server',
    os: 'Ubuntu 24.04 (Headless)',
    status: 'syncing',
    lastSeen: '10s ago',
    isCurrent: false,
  },
];

export function DeviceMesh() {
  const [devices] = useState<DeviceItem[]>(INITIAL_DEVICES);
  const [backendType, setBackendType] = useState<'self-hosted' | 'cloud'>('cloud');
  const [endpoint, setEndpoint] = useState('https://mesh.jackalope.dev/v1');

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
        <div>
          <h1 className="task-title">Devices</h1>
          <p className="task-muted mt-2">Preview how work could move between your machines.</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            disabled
            title="Device pairing is not available yet"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Pair device</span>
          </Button>
        </div>
      </div>

      {/* Backend Infrastructure Toggle */}
      <div className="p-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-[var(--color-accent-ink)]" />
            <span className="text-xs font-semibold text-[var(--color-text-primary)]">
              Connection preview
            </span>
          </div>
          <div className="flex rounded-lg border border-[var(--color-border)] p-0.5 bg-[var(--color-surface-sunken)]">
            <button
              type="button"
              aria-pressed={backendType === 'cloud'}
              onClick={() => {
                setBackendType('cloud');
                setEndpoint('https://mesh.jackalope.dev/v1');
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all cursor-pointer ${
                backendType === 'cloud'
                  ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] font-semibold'
                  : 'text-[var(--color-text-secondary)]'
              }`}
            >
              Managed (jackalope.dev)
            </button>
            <button
              type="button"
              aria-pressed={backendType === 'self-hosted'}
              onClick={() => {
                setBackendType('self-hosted');
                setEndpoint('ws://127.0.0.1:8080/sync');
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all cursor-pointer ${
                backendType === 'self-hosted'
                  ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] font-semibold'
                  : 'text-[var(--color-text-secondary)]'
              }`}
            >
              Self-Hosted Relay
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            className="font-mono text-xs"
            placeholder="Relay endpoint URL"
          />
          <Button variant="secondary" size="sm" className="gap-1.5 shrink-0 text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Test Connection</span>
          </Button>
        </div>
      </div>

      {/* Connected Devices Grid */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
          Known Active Devices ({devices.length})
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {devices.map((dev) => {
            const Icon =
              dev.type === 'desktop'
                ? Monitor
                : dev.type === 'laptop'
                  ? Laptop
                  : dev.type === 'server'
                    ? Server
                    : Smartphone;

            return (
              <div
                key={dev.id}
                className={`p-4 rounded-2xl border transition-all shadow-sm flex flex-col justify-between space-y-4 ${
                  dev.isCurrent
                    ? 'border-[var(--color-accent)] bg-[var(--color-surface-elevated)] ring-1 ring-[var(--color-accent)]/20'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-focus)]'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-[var(--color-surface-sunken)] border border-[var(--color-border)] text-[var(--color-accent-ink)]">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-[var(--color-text-primary)]">
                          {dev.name}
                        </span>
                        {dev.isCurrent && (
                          <Badge variant="accent" className="text-xs px-1.5 py-0">
                            This Host
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-[var(--color-text-secondary)] block mt-0.5">
                        {dev.os}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border-subtle)] text-xs">
                  <span className="flex items-center gap-1.5 text-[var(--color-success)] font-medium">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{dev.status}</span>
                  </span>
                  <span className="text-[var(--color-text-muted)] font-mono">{dev.lastSeen}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
