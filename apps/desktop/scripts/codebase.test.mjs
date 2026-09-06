import assert from 'node:assert/strict';
import { test } from 'node:test';
import { directoryOf, GRAPH_LIMIT, mapGraph } from '../src/lib/codebase-graph.ts';

test('directory aggregation preserves direction and counts, without internal folder edges', () => {
  const paths = ['src/a.ts', 'src/b.ts', 'lib/c.ts', 'readme.md'];
  const snapshot = {
    references: [
      { source: paths[0], target: paths[1] },
      { source: paths[0], target: paths[2] },
      { source: paths[1], target: paths[2] },
      { source: paths[2], target: null },
    ],
  };
  const graph = mapGraph(snapshot, paths, true);
  assert.equal(directoryOf('readme.md'), '.');
  assert.equal(graph.nodes.find((node) => node.id === 'src').count, 2);
  assert.deepEqual(
    graph.edges.map(({ source, target, count }) => ({ source, target, count })),
    [{ source: 'src', target: 'lib', count: 2 }],
  );
  assert.deepEqual(
    mapGraph(snapshot, paths.slice(0, 2), false).edges.map((edge) => edge.target),
    ['src/b.ts'],
  );
});

test('bounded graph always includes the selected file and handles unusual paths', () => {
  const paths = Array.from({ length: 200 }, (_, i) => `src/${i}.ts`);
  const focus = 'z/selected.ts';
  const graph = mapGraph({ references: [] }, [...paths, focus], false, focus);
  assert.equal(graph.nodes.length, GRAPH_LIMIT);
  assert.equal(graph.total, 201);
  assert.ok(graph.nodes.some((node) => node.id === focus));
  const unusual = mapGraph(
    { references: [{ source: 'constructor/a.ts', target: '__proto__/b.ts' }] },
    ['constructor/a.ts', '__proto__/b.ts'],
    true,
  );
  assert.equal(unusual.nodes.length, 2);
  assert.ok(unusual.nodes.every((node) => Number.isFinite(node.position.x)));
  assert.deepEqual(mapGraph({ references: [] }, [], true).nodes, []);
});
