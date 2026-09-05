import { Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

interface VisualNode {
  id: string;
  label: string;
  category: 'core' | 'ui' | 'agent' | 'worktree' | 'integration';
  detail: string;
  status: 'active' | 'synced' | 'pending';
  x: number;
  y: number;
}

const NODES: VisualNode[] = [
  {
    id: 'desktop',
    label: 'Tauri v2 Desktop Core',
    category: 'core',
    detail: 'Rust IPC & Tokio event loop',
    status: 'synced',
    x: 220,
    y: 160,
  },
  {
    id: 'git-engine',
    label: 'Git Worktree Engine',
    category: 'core',
    detail: 'Branch isolation & auto-stash',
    status: 'active',
    x: 220,
    y: 280,
  },
  {
    id: 'ui-shell',
    label: 'React 19 Shell & Radix',
    category: 'ui',
    detail: 'WAI-ARIA accessible primitives',
    status: 'synced',
    x: 480,
    y: 80,
  },
  {
    id: 'arc-theme',
    label: 'Arc/Zen Dynamic Palette',
    category: 'ui',
    detail: 'Live OKLCH & surface-tinting',
    status: 'synced',
    x: 480,
    y: 200,
  },
  {
    id: 'mascot',
    label: 'Jackalope Mascot Engine',
    category: 'ui',
    detail: 'Reactive motion & mood states',
    status: 'active',
    x: 480,
    y: 320,
  },
  {
    id: 'agent-harness',
    label: 'Agent Mesh & Process Harness',
    category: 'agent',
    detail: 'Claude Code, Aider, Ollama',
    status: 'active',
    x: 740,
    y: 140,
  },
  {
    id: 'intent-refiner',
    label: 'Proactive Intent Engine',
    category: 'agent',
    detail: 'Clarification questions & meta-prompts',
    status: 'active',
    x: 740,
    y: 260,
  },
  {
    id: 'worktree-1',
    label: '.worktrees/feat-auto-prompt',
    category: 'worktree',
    detail: 'Running Agent Claude-3.7',
    status: 'active',
    x: 960,
    y: 180,
  },
  {
    id: 'browser-tool',
    label: 'Playwright Browser Automation',
    category: 'integration',
    detail: 'Open-source web agent harness',
    status: 'pending',
    x: 740,
    y: 380,
  },
];

export function CodebaseMap() {
  const [selectedNode, setSelectedNode] = useState<VisualNode | null>(NODES[0]);
  const [filter, setFilter] = useState<'all' | 'core' | 'ui' | 'agent' | 'worktree'>('all');

  const filteredNodes = NODES.filter((n) => filter === 'all' || n.category === filter);

  return (
    <div className="tool-page flex-1 flex flex-col h-full overflow-y-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
        <div>
          <h1 className="task-title">Codebase</h1>
          <p className="task-muted mt-2">Explore sample modules and their relationships.</p>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]">
          {(['all', 'core', 'ui', 'agent', 'worktree'] as const).map((cat) => (
            <button
              type="button"
              key={cat}
              onClick={() => setFilter(cat)}
              aria-pressed={filter === cat}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all capitalize cursor-pointer ${
                filter === cat
                  ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] font-semibold shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Visual Canvas & Details Split */}
      <div className="tool-layout map-layout">
        {/* Graph Canvas */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-6 relative overflow-auto min-h-[460px]">
          {/* Subtle Grid Background */}
          <div
            className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, var(--color-text-primary) 1px, transparent 0)',
              backgroundSize: '24px 24px',
            }}
          />

          {/* SVG Connection Lines (decorative) */}
          <svg
            aria-hidden="true"
            className="absolute inset-0 w-full h-full pointer-events-none stroke-[var(--color-border)] stroke-[1.5] stroke-dasharray-[4]"
          >
            <line x1="280" y1="180" x2="480" y2="100" />
            <line x1="280" y1="180" x2="480" y2="220" />
            <line x1="280" y1="180" x2="480" y2="340" />
            <line x1="480" y1="220" x2="740" y2="160" />
            <line x1="280" y1="300" x2="740" y2="280" />
            <line x1="740" y1="160" x2="960" y2="200" />
            <line x1="740" y1="280" x2="960" y2="200" />
            <line x1="740" y1="280" x2="740" y2="400" />
          </svg>

          {/* Nodes */}
          <div className="relative w-[1100px] min-w-[1100px] h-[520px]">
            {filteredNodes.map((node) => {
              const isSelected = selectedNode?.id === node.id;
              return (
                <motion.button
                  type="button"
                  aria-pressed={isSelected}
                  key={node.id}
                  onClick={() => setSelectedNode(node)}
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  whileHover={{ scale: 1.05 }}
                  className={`absolute p-3 text-left rounded-xl border transition-all cursor-pointer shadow-md select-none w-52 ${
                    isSelected
                      ? 'border-[var(--color-accent)] bg-[var(--color-surface-elevated)] ring-2 ring-[var(--color-accent)]/30'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-focus)]'
                  }`}
                  style={{ left: node.x, top: node.y }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs uppercase font-mono font-semibold text-[var(--color-text-muted)]">
                      {node.category}
                    </span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        node.status === 'active'
                          ? 'bg-[var(--color-accent)]'
                          : node.status === 'synced'
                            ? 'bg-emerald-400'
                            : 'bg-amber-400'
                      }`}
                    />
                  </div>
                  <div className="text-xs font-bold text-[var(--color-text-primary)] truncate">
                    {node.label}
                  </div>
                  <div className="text-xs text-[var(--color-text-secondary)] truncate mt-0.5">
                    {node.detail}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Node Inspection Sidebar */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 flex flex-col justify-between shadow-sm">
          {selectedNode ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <Badge variant="accent" className="uppercase font-mono text-xs">
                  {selectedNode.category}
                </Badge>
                <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                  {selectedNode.label}
                </h3>
                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                  {selectedNode.detail}
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-[var(--color-border)] text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Status</span>
                  <span className="capitalize font-medium text-[var(--color-text-primary)]">
                    {selectedNode.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">License</span>
                  <span className="font-mono text-[var(--color-success)]">
                    Apache-2.0 / Permissive
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">IPC Channel</span>
                  <span className="font-mono text-xs text-[var(--color-accent-ink)]">
                    tauri://ipc/{selectedNode.id}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-[var(--color-text-muted)]">
              Click any architecture node on the canvas to inspect dependencies.
            </div>
          )}

          <div className="pt-4 border-t border-[var(--color-border)]">
            <Button variant="secondary" size="sm" className="w-full gap-2 text-xs">
              <Sparkles className="w-3.5 h-3.5 text-[var(--color-accent-ink)]" />
              <span>Expand Module Sub-Graph</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
