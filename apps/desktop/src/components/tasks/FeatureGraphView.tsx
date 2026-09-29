import { graphlib, layout } from '@dagrejs/dagre';
import { EmptyState } from '@jackalope/ui';
import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  type ReactFlowInstance,
} from '@xyflow/react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Maximize2,
  Network,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { QueueItem } from '../../lib/queue';
import { isActive } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { AgentAvatar } from '../agents/AgentAvatar';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import '@xyflow/react/dist/style.css';
import './feature-graph.css';

export function FeatureGraphView({
  items,
  mergedRunIds,
  onSelectRun,
}: {
  items: QueueItem[];
  mergedRunIds: string[];
  onSelectRun?: (runId: string) => void;
}) {
  const { runs } = useExecutionStore(useShallow((s) => ({ runs: s.runs })));
  const [selectedFeature, setSelectedFeature] = useState<string>('all');
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);

  const features = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.feature) set.add(item.feature);
    }
    return Array.from(set);
  }, [items]);

  const filteredItems = useMemo(() => {
    if (selectedFeature === 'all') return items;
    return items.filter((i) => i.feature === selectedFeature);
  }, [items, selectedFeature]);

  const getItemState = useCallback(
    (item: QueueItem): 'merged' | 'active' | 'review' | 'attention' | 'queued' => {
      const original = runs.find((r) => r.id === item.runId);
      const run = original ? runs.find((r) => r.taskId === original.taskId) : undefined;
      if (item.runId && mergedRunIds.includes(item.runId)) return 'merged';
      if (
        item.error ||
        run?.dependencyInvalidated ||
        (run && ['failed', 'stopped', 'interrupted'].includes(run.status))
      )
        return 'attention';
      if (run && isActive(run)) return 'active';
      if (run && ['review', 'reviewed'].includes(run.status)) return 'review';
      if (item.runId) return 'attention';
      return 'queued';
    },
    [runs, mergedRunIds],
  );

  const { nodes, edges } = useMemo(() => {
    if (filteredItems.length === 0) return { nodes: [], edges: [] };

    const g = new graphlib.Graph().setGraph({
      rankdir: 'LR',
      nodesep: 40,
      ranksep: 90,
      marginx: 40,
      marginy: 40,
    });
    g.setDefaultEdgeLabel(() => ({}));

    const itemMap = new Map(filteredItems.map((i) => [i.id, i]));

    for (const item of filteredItems) {
      g.setNode(item.id, { width: 250, height: 85 });
    }

    for (const item of filteredItems) {
      for (const depId of item.dependencies) {
        if (itemMap.has(depId)) {
          g.setEdge(depId, item.id);
        }
      }
    }

    layout(g);

    const calculatedNodes = filteredItems.map((item) => {
      const nodePos = g.node(item.id) || { x: 0, y: 0 };
      const state = getItemState(item);

      return {
        id: item.id,
        position: { x: nodePos.x - 125, y: nodePos.y - 42 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          label: (
            <button
              type="button"
              className={`feature-graph-node node-${state} text-left`}
              onClick={() => {
                if (item.runId && onSelectRun) {
                  onSelectRun(item.runId);
                }
              }}
              aria-label={`Task: ${item.title}, agent: ${item.agent}, status: ${state}`}
              title={`${item.title} (${item.agent})`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="feature-graph-node-title" title={item.title}>
                  {item.title}
                </span>
                {item.runId && (
                  <ExternalLink size={12} className="text-[var(--color-text-muted)] shrink-0" />
                )}
              </div>

              <div className="feature-graph-node-meta">
                <span className="flex items-center gap-1 text-[var(--color-text-secondary)]">
                  <AgentAvatar
                    provider={item.agent}
                    working={state === 'active'}
                    waiting={state === 'attention'}
                    size="xs"
                  />
                  {item.agent}
                </span>
                {item.account && (
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    · {item.account}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between mt-2 pt-1 border-t border-[var(--color-border)]/50">
                <span
                  className={`feature-graph-badge ${
                    state === 'merged'
                      ? 'bg-[var(--color-success)]/15 text-[var(--color-success)]'
                      : state === 'active'
                        ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent-ink)]'
                        : state === 'review'
                          ? 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]'
                          : state === 'attention'
                            ? 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]'
                            : 'bg-[var(--color-surface-sunken)] text-[var(--color-text-muted)]'
                  }`}
                >
                  {state === 'merged' && <CheckCircle2 size={10} />}
                  {state === 'active' && <Loader2 size={10} className="animate-spin" />}
                  {state === 'review' && <CheckCircle2 size={10} />}
                  {state === 'attention' && <AlertCircle size={10} />}
                  {state === 'queued' && <Clock size={10} />}
                  {state === 'merged'
                    ? 'Integrated'
                    : state === 'active'
                      ? 'Working'
                      : state === 'review'
                        ? 'Review'
                        : state === 'attention'
                          ? 'Needs you'
                          : 'Waiting'}
                </span>

                {item.scopes.length > 0 && (
                  <span className="text-[10px] text-[var(--color-text-muted)] font-mono truncate max-w-[110px]">
                    {item.scopes[0]}
                  </span>
                )}
              </div>
            </button>
          ),
        },
      };
    });

    const calculatedEdges: Array<{
      id: string;
      source: string;
      target: string;
      animated: boolean;
      markerEnd: { type: MarkerType; color: string };
      style: { stroke: string; strokeWidth: number };
    }> = [];

    for (const item of filteredItems) {
      for (const depId of item.dependencies) {
        const sourceItem = itemMap.get(depId);
        if (sourceItem) {
          const sourceState = getItemState(sourceItem);
          const targetState = getItemState(item);
          const isActiveTransition = sourceState === 'merged' && targetState === 'active';

          calculatedEdges.push({
            id: `${depId}->${item.id}`,
            source: depId,
            target: item.id,
            animated: isActiveTransition,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: isActiveTransition ? '#3b82f6' : 'var(--color-text-muted)',
            },
            style: {
              stroke: isActiveTransition ? '#3b82f6' : 'var(--color-border)',
              strokeWidth: isActiveTransition ? 2 : 1.5,
            },
          });
        }
      }
    }

    return { nodes: calculatedNodes, edges: calculatedEdges };
  }, [filteredItems, getItemState, onSelectRun]);

  useEffect(() => {
    if (flow && nodes.length > 0) {
      const frame = requestAnimationFrame(() => {
        void flow.fitView({ padding: 0.2, maxZoom: 1 });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [flow, nodes.length]);

  const stats = useMemo(() => {
    const s = { merged: 0, active: 0, review: 0, attention: 0, queued: 0 };
    for (const item of filteredItems) {
      const st = getItemState(item);
      s[st] += 1;
    }
    return s;
  }, [filteredItems, getItemState]);

  return (
    <div className="feature-graph-wrapper space-y-3">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-[var(--color-surface-hover)]/60 p-2.5 rounded-lg border border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-[var(--color-accent-ink)]" />
          <span className="text-xs font-semibold text-[var(--color-text-primary)]">
            Execution Graph ({filteredItems.length} tasks)
          </span>

          {features.length > 1 && (
            <div className="ml-3">
              <Select
                value={selectedFeature}
                onValueChange={setSelectedFeature}
                aria-label="Filter by feature"
              >
                <SelectItem value="all">All features</SelectItem>
                {features.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </Select>
            </div>
          )}
        </div>

        {/* Live Status Badges */}
        <div className="flex items-center gap-2 text-xs">
          {stats.active > 0 && (
            <span className="px-2 py-0.5 rounded bg-[var(--color-accent)]/10 text-[var(--color-accent-ink)] font-medium flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" /> {stats.active} active
            </span>
          )}
          {stats.review > 0 && (
            <span className="px-2 py-0.5 rounded bg-[var(--color-warning)]/10 text-[var(--color-warning)] font-medium">
              {stats.review} in review
            </span>
          )}
          {stats.merged > 0 && (
            <span className="px-2 py-0.5 rounded bg-[var(--color-success)]/10 text-[var(--color-success)] font-medium">
              {stats.merged} merged
            </span>
          )}
          {stats.attention > 0 && (
            <span className="px-2 py-0.5 rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] font-medium">
              {stats.attention} needs attention
            </span>
          )}
          <span className="text-[var(--color-text-muted)] text-[11px]">{stats.queued} queued</span>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => void flow?.fitView({ padding: 0.2, maxZoom: 1 })}
            className="h-7 text-xs flex items-center gap-1 ml-2"
            title="Fit to view"
          >
            <Maximize2 size={12} />
            Fit
          </Button>
        </div>
      </div>

      {/* DAG Flow Canvas */}
      <div className="feature-graph-container">
        {filteredItems.length === 0 ? (
          <div className="h-full flex items-center justify-center p-6">
            <EmptyState
              icon={Network}
              level={3}
              title="No tasks queued"
              description="Plan a feature to see how its tasks run."
            />
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onInit={setFlow}
            fitView
            minZoom={0.2}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="var(--color-border)" gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
