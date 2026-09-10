import { graphlib, layout } from '@dagrejs/dagre';
import type { CodebaseSnapshot } from './codebase.ts';

export const GRAPH_LIMIT = 60;
export const directoryOf = (path: string) =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';

export function dependencyCycles(snapshot: CodebaseSnapshot): string[][] {
  return snapshot.cycles;
}

export function mapGraph(
  snapshot: CodebaseSnapshot,
  paths: string[],
  folderView: boolean,
  focus?: string | null,
  scope: string | null = null,
) {
  const included = new Set(paths);
  const counts = new Map<string, number>();
  const directories = new Set<string>();
  const group = (path: string) => {
    if (!folderView) return path;
    if (scope === null) {
      const id = path.includes('/') ? path.split('/')[0] : '.';
      directories.add(id);
      return id;
    }
    const relative = scope === '.' ? path : path.slice(scope.length + 1);
    if (!relative.includes('/')) return path;
    const id = `${scope}/${relative.split('/')[0]}`;
    directories.add(id);
    return id;
  };
  for (const path of paths) {
    const id = group(path);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const ids = [...counts.keys()]
    .sort((a, b) => (a === focus ? -1 : b === focus ? 1 : a.localeCompare(b)))
    .slice(0, GRAPH_LIMIT);
  const visible = new Set(ids);
  const links = new Map<string, { source: string; target: string; count: number }>();
  for (const ref of snapshot.references) {
    if (!ref.target || !included.has(ref.source) || !included.has(ref.target)) continue;
    const source = group(ref.source);
    const target = group(ref.target);
    if (!visible.has(source) || !visible.has(target) || (folderView && source === target)) continue;
    const key = JSON.stringify([source, target]);
    const link = links.get(key) ?? { source, target, count: 0 };
    link.count += 1;
    links.set(key, link);
  }
  const graph = new graphlib.Graph().setGraph({
    rankdir: 'LR',
    nodesep: 24,
    ranksep: 85,
    marginx: 24,
    marginy: 24,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  const connected = new Set([...links.values()].flatMap((link) => [link.source, link.target]));
  const isolated = ids.filter((id) => !connected.has(id));
  for (const id of ids.filter((id) => connected.has(id)))
    graph.setNode(`file:${id}`, { width: 240, height: 64 });
  for (const link of links.values()) graph.setEdge(`file:${link.source}`, `file:${link.target}`);
  layout(graph);
  const gridY = connected.size ? Math.max(...graph.nodes().map((id) => graph.node(id).y)) + 100 : 0;
  return {
    total: counts.size,
    nodes: ids.map((id) => ({
      id,
      count: counts.get(id) ?? 0,
      directory: directories.has(id),
      position: connected.has(id)
        ? { x: graph.node(`file:${id}`).x - 120, y: graph.node(`file:${id}`).y - 32 }
        : {
            x: (isolated.indexOf(id) % 3) * 280,
            y: gridY + Math.floor(isolated.indexOf(id) / 3) * 96,
          },
    })),
    edges: [...links.entries()].map(([id, link]) => ({ id, ...link })),
  };
}
