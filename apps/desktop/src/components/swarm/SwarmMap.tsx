import { Badge } from '@jackalope/ui';
import { ArrowUpRight, GitMerge } from 'lucide-react';
import { type KeyboardEvent, useMemo, useState } from 'react';
import {
  SWARM_PHASES,
  type SwarmAgent,
  type SwarmMapModel,
  type SwarmPhase,
} from '../../lib/swarm-map';
import { selectWork } from '../../lib/work-selection';
import { AgentAvatar } from '../agents/AgentAvatar';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';
import './swarm-map.css';

const WIDTH = 880;
const HEIGHT = 464;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const ORBIT = { rx: 360, ry: 168 };
const FILE_RING = { rx: 210, ry: 98 };
const DOCK = { rx: 104, ry: 50 };
const HUB = 38;
const NODE = 22;
const NODES_SHOWN = 24;
const FILES_SHOWN = 8;

const LABEL: Record<SwarmPhase, string> = Object.fromEntries(
  SWARM_PHASES.map(({ phase, label }) => [phase, label]),
) as Record<SwarmPhase, string>;

type Point = { x: number; y: number };
const onRing = (ring: { rx: number; ry: number }, angle: number): Point => ({
  x: CX + ring.rx * Math.cos(angle),
  y: CY + ring.ry * Math.sin(angle),
});
const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;
const fileName = (path: string) => path.split('/').pop() || path;

/** Where a node's edge meets the hub, so lines end at its rim instead of its center. */
function towardHub(from: Point, inset = HUB + 6): Point {
  const dx = from.x - CX;
  const dy = from.y - CY;
  const length = Math.hypot(dx, dy) || 1;
  return { x: CX + (dx / length) * inset, y: CY + (dy / length) * inset };
}

/** Bends a conflict arc away from the hub so it never crosses the branch. */
function arcControl(from: Point, to: Point): Point {
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  let normal = { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
  if (normal.x * (mid.x - CX) + normal.y * (mid.y - CY) < 0)
    normal = { x: -normal.x, y: -normal.y };
  return { x: mid.x + normal.x * length * 0.3, y: mid.y + normal.y * length * 0.3 };
}

function layout(model: SwarmMapModel) {
  const orbiting = model.agents.filter((agent) => agent.phase !== 'merged');
  const shown = orbiting.slice(0, NODES_SHOWN);
  const angles = new Map<string, number>();
  const points = new Map<string, Point>();
  shown.forEach((agent, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(shown.length, 1);
    angles.set(agent.id, angle);
    points.set(agent.id, onRing(ORBIT, angle));
  });
  const docked = model.agents.filter((agent) => agent.phase === 'merged');
  docked.forEach((agent, index) => {
    const angle = Math.PI / 2 + ((index - (docked.length - 1) / 2) * Math.PI) / 7;
    points.set(agent.id, onRing(DOCK, angle));
  });
  const files = model.hotFiles
    .map((file) => {
      const own = file.agents.flatMap((id) => {
        const angle = angles.get(id);
        return angle === undefined ? [] : [angle];
      });
      if (own.length < 2) return null;
      const angle = Math.atan2(
        own.reduce((sum, a) => sum + Math.sin(a), 0),
        own.reduce((sum, a) => sum + Math.cos(a), 0),
      );
      return { ...file, angle };
    })
    .filter((file) => file !== null)
    .slice(0, FILES_SHOWN);
  // Spread files that would land on top of each other.
  files.sort((a, b) => a.angle - b.angle);
  for (let index = 1; index < files.length; index++)
    if (files[index].angle - files[index - 1].angle < 0.32)
      files[index].angle = files[index - 1].angle + 0.32;
  return {
    shown,
    hidden: orbiting.length - shown.length,
    docked,
    points,
    files: files.map((file) => ({ ...file, point: onRing(FILE_RING, file.angle) })),
  };
}

/**
 * The swarm at a glance: every task orbits the target branch, lines carry its
 * work inward, files several agents share sit between them, and conflicts arc
 * from agent to agent. Merged work docks beside the branch.
 */
export function SwarmMap({
  model,
  target,
  delivery = null,
}: {
  model: SwarmMapModel;
  target: string | null;
  /** What the branch is doing after merges, when the project deploys. */
  delivery?: 'deploying' | 'deployed' | 'paused' | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusPhase, setFocusPhase] = useState<SwarmPhase | null>(null);
  const placed = useMemo(() => layout(model), [model]);
  const byId = useMemo(
    () => new Map(model.agents.map((agent) => [agent.id, agent])),
    [model.agents],
  );
  const current = (selected && byId.get(selected)) || null;
  const lit = hovered ?? selected;
  const related = useMemo(() => {
    if (!lit) return null;
    const ids = new Set([lit]);
    for (const link of model.links)
      if (link.from === lit || link.to === lit) ids.add(link.from).add(link.to);
    return ids;
  }, [lit, model.links]);
  const dim = (agent: SwarmAgent) =>
    (focusPhase !== null && agent.phase !== focusPhase) ||
    (related !== null && !related.has(agent.id));
  const open = (agent: SwarmAgent) => {
    if (!agent.runId) return;
    selectWork({ task: agent.runId });
    navigateWorkspace('kanban');
  };
  const choose = (id: string) => setSelected((prior) => (prior === id ? null : id));
  const keyChoose = (event: KeyboardEvent, id: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    choose(id);
  };
  const empty = model.agents.length === 0;

  return (
    <section className="swarm-map" aria-label="Swarm map">
      <div className="swarm-stream">
        {SWARM_PHASES.map(({ phase, label }) => (
          <button
            key={phase}
            type="button"
            className="swarm-stage"
            data-phase={phase}
            aria-pressed={focusPhase === phase}
            disabled={!model.counts[phase] && focusPhase !== phase}
            onClick={() => setFocusPhase((prior) => (prior === phase ? null : phase))}
          >
            <strong>{model.counts[phase]}</strong>
            <span>
              <i className="swarm-dot" data-phase={phase} aria-hidden="true" />
              {label}
            </span>
          </button>
        ))}
      </div>

      <div className="swarm-map-body" data-selected={current ? true : undefined}>
        <div className="swarm-canvas">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            onClick={(event) => event.target === event.currentTarget && setSelected(null)}
            onKeyDown={(event) => event.key === 'Escape' && setSelected(null)}
          >
            <title>{`${model.agents.length} tasks around ${target ?? 'the target branch'}`}</title>
            <defs>
              <radialGradient id="swarm-hub-glow">
                <stop offset="0%" className="swarm-glow-core" />
                <stop offset="100%" className="swarm-glow-edge" />
              </radialGradient>
            </defs>
            <ellipse className="swarm-orbit" cx={CX} cy={CY} rx={ORBIT.rx} ry={ORBIT.ry} />
            <ellipse
              className="swarm-orbit swarm-orbit-inner"
              cx={CX}
              cy={CY}
              rx={FILE_RING.rx}
              ry={FILE_RING.ry}
            />
            <circle className="swarm-hub-halo" cx={CX} cy={CY} r={HUB * 2.6} />

            {placed.shown.map((agent) => {
              const point = placed.points.get(agent.id) as Point;
              const end = towardHub(point);
              const shared = placed.files.some((file) => file.agents.includes(agent.id));
              return (
                <path
                  key={`flow:${agent.id}`}
                  className="swarm-flow"
                  data-phase={agent.phase}
                  data-dim={dim(agent) || undefined}
                  data-quiet={shared || undefined}
                  d={`M${point.x},${point.y} L${end.x},${end.y}`}
                />
              );
            })}
            {placed.files.flatMap((file) =>
              file.agents.flatMap((id) => {
                const point = placed.points.get(id);
                const agent = byId.get(id);
                if (!point || !agent || agent.phase === 'merged') return [];
                return [
                  <path
                    key={`share:${file.path}:${id}`}
                    className="swarm-share"
                    data-conflicted={file.conflicted || undefined}
                    data-dim={dim(agent) || undefined}
                    d={`M${point.x},${point.y} L${file.point.x},${file.point.y}`}
                  />,
                ];
              }),
            )}
            {placed.files.map((file) => {
              const end = towardHub(file.point);
              return (
                <path
                  key={`file-flow:${file.path}`}
                  className="swarm-share swarm-share-hub"
                  data-conflicted={file.conflicted || undefined}
                  d={`M${file.point.x},${file.point.y} L${end.x},${end.y}`}
                />
              );
            })}
            {model.links.map((link) => {
              const from = placed.points.get(link.from);
              const to = placed.points.get(link.to);
              // A conflicted file on the map already joins the two agents in red.
              if (!from || !to || placed.files.some((file) => file.path === link.path)) return null;
              const bend = arcControl(from, to);
              const agent = byId.get(link.from) as SwarmAgent;
              return (
                <path
                  key={`conflict:${link.from}:${link.to}:${link.path}`}
                  className="swarm-conflict-arc"
                  data-dim={(dim(agent) && dim(byId.get(link.to) as SwarmAgent)) || undefined}
                  d={`M${from.x},${from.y} Q${bend.x},${bend.y} ${to.x},${to.y}`}
                >
                  <title>{`Conflict in ${link.path}`}</title>
                </path>
              );
            })}

            {placed.shown
              .filter((agent) => agent.phase === 'ready')
              .map((agent) => {
                const point = placed.points.get(agent.id) as Point;
                const end = towardHub(point);
                return (
                  <circle
                    key={`spark:${agent.id}`}
                    className="swarm-spark"
                    data-dim={dim(agent) || undefined}
                    r={3}
                  >
                    <animateMotion
                      dur="2.4s"
                      repeatCount="indefinite"
                      path={`M${point.x},${point.y} L${end.x},${end.y}`}
                    />
                  </circle>
                );
              })}

            <g className="swarm-hub" data-delivery={delivery ?? undefined}>
              <circle cx={CX} cy={CY} r={HUB * 1.9} fill="url(#swarm-hub-glow)" />
              <circle className="swarm-hub-core" cx={CX} cy={CY} r={HUB} />
              {delivery && (
                <circle className="swarm-hub-deploy" cx={CX} cy={CY} r={HUB + 7} pathLength={100} />
              )}
              <foreignObject x={CX - 10} y={CY - 24} width={20} height={20}>
                <GitMerge size={20} className="swarm-hub-icon" />
              </foreignObject>
              <text className="swarm-hub-label" x={CX} y={CY + 14}>
                {clip(target ?? 'Target', 12)}
              </text>
              {delivery === 'deploying' || delivery === 'paused' ? (
                <text className="swarm-hub-merged" x={CX} y={CY + 27}>
                  {delivery === 'deploying' ? 'deploying' : 'paused'}
                </text>
              ) : (
                model.counts.merged > 0 && (
                  <text className="swarm-hub-merged" x={CX} y={CY + 27}>
                    {model.counts.merged} merged
                  </text>
                )
              )}
            </g>

            {placed.files.map((file) => (
              <g
                key={`file:${file.path}`}
                className="swarm-file"
                data-conflicted={file.conflicted || undefined}
                transform={`translate(${file.point.x},${file.point.y})`}
              >
                <title>{`${file.path} · ${file.agents.length} agents${file.conflicted ? ' · conflict' : ''}`}</title>
                <rect x={-6} y={-6} width={12} height={12} rx={3} />
                <text y={-11}>{clip(fileName(file.path), 18)}</text>
              </g>
            ))}

            {placed.docked.map((agent) => {
              const point = placed.points.get(agent.id) as Point;
              return (
                // biome-ignore lint/a11y/useSemanticElements: an SVG node cannot be a <button>.
                <g
                  key={agent.id}
                  className="swarm-docked"
                  data-dim={dim(agent) || undefined}
                  data-selected={selected === agent.id || undefined}
                  role="button"
                  tabIndex={0}
                  aria-label={`${agent.title}, merged`}
                  transform={`translate(${point.x},${point.y})`}
                  onClick={() => choose(agent.id)}
                  onKeyDown={(event) => keyChoose(event, agent.id)}
                >
                  <title>{`${agent.title} · merged`}</title>
                  <circle className="swarm-focus" r={11} />
                  <circle r={6} />
                </g>
              );
            })}

            {placed.shown.map((agent) => {
              const point = placed.points.get(agent.id) as Point;
              const below = point.y >= CY - 20;
              return (
                // biome-ignore lint/a11y/useSemanticElements: an SVG node cannot be a <button>.
                <g
                  key={agent.id}
                  className="swarm-node"
                  data-phase={agent.phase}
                  data-dim={dim(agent) || undefined}
                  data-selected={selected === agent.id || undefined}
                  role="button"
                  tabIndex={0}
                  aria-label={`${agent.title}, ${LABEL[agent.phase]}: ${agent.detail}`}
                  aria-pressed={selected === agent.id}
                  transform={`translate(${point.x},${point.y})`}
                  onClick={() => choose(agent.id)}
                  onKeyDown={(event) => keyChoose(event, agent.id)}
                  onPointerEnter={() => setHovered(agent.id)}
                  onPointerLeave={() => setHovered(null)}
                >
                  <circle className="swarm-node-halo" r={NODE + 10} />
                  <circle className="swarm-focus" r={NODE + 6} />
                  <circle className="swarm-node-core" r={NODE} />
                  <circle className="swarm-node-ring" r={NODE} pathLength={100} />
                  <foreignObject x={-12} y={-12} width={24} height={24}>
                    <AgentAvatar provider={agent.agent} size="sm" />
                  </foreignObject>
                  {agent.conflicts > 0 && (
                    <g
                      className="swarm-node-badge"
                      transform={`translate(${NODE - 4},${-NODE + 4})`}
                    >
                      <circle r={8} />
                      <text y={3.5}>{agent.conflicts}</text>
                    </g>
                  )}
                  <text className="swarm-node-title" y={below ? NODE + 16 : -NODE - 18}>
                    {clip(agent.title, 24)}
                  </text>
                  <text className="swarm-node-phase" y={below ? NODE + 29 : -NODE - 6}>
                    {LABEL[agent.phase]}
                  </text>
                </g>
              );
            })}
          </svg>
          {empty && (
            <div className="swarm-empty">
              <strong className="swarm-empty-title">No agents in the swarm yet</strong>
              <span>Start a goal and plan it as a swarm; each task joins the map as it runs.</span>
            </div>
          )}
          {placed.hidden > 0 && (
            <p className="swarm-overflow">{placed.hidden} more tasks are listed below.</p>
          )}
        </div>

        {current && (
          <aside className="swarm-detail" aria-label="Selected task">
            <header>
              <AgentAvatar provider={current.agent} size="md" />
              <div>
                <strong className="swarm-detail-title" title={current.title}>
                  {current.title}
                </strong>
                <small>
                  {[current.agent, current.plan, current.host && `on ${current.host}`]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </div>
            </header>
            <p className="swarm-detail-phase">
              <i className="swarm-dot" data-phase={current.phase} aria-hidden="true" />
              <span>
                <b>{LABEL[current.phase]}</b> · {current.detail}
              </span>
            </p>
            {current.conflicts > 0 && (
              <Badge variant="danger">
                {current.conflicts} {current.conflicts === 1 ? 'conflict' : 'conflicts'} with other
                agents
              </Badge>
            )}
            {current.files.length > 0 && (
              <div className="swarm-detail-files">
                <small>
                  {current.phase === 'queued' ? 'Planned scope' : 'Changed files'}
                  {current.truncated ? ' (partial)' : ''}
                </small>
                <ul>
                  {current.files.slice(0, 6).map((path) => (
                    <li key={path}>
                      <code title={path}>{path}</code>
                    </li>
                  ))}
                </ul>
                {current.files.length > 6 && <small>{current.files.length - 6} more</small>}
              </div>
            )}
            {current.runId && (
              <Button onClick={() => open(current)}>
                {current.phase === 'ready' || current.phase === 'attention'
                  ? 'Review task'
                  : 'Open task'}
                <ArrowUpRight size={14} aria-hidden="true" />
              </Button>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
