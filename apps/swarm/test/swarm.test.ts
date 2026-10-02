import { describe, expect, it } from 'vitest';
import { authorized } from '../src/auth';
import { changedFiles } from '../src/changes';
import { allConflicts, conflictsBetween } from '../src/conflicts';
import { changedHunks, overlappingHunks, splitLines } from '../src/diff';
import { forkName } from '../src/names';
import { CachedReader } from '../src/objects';
import { FakeRepo } from './fake-repo';

const lines = (count: number) => Array.from({ length: count }, (_, i) => `line ${i + 1}`);
const file = (values: string[]) => `${values.join('\n')}\n`;

describe('line hunks', () => {
  it('reports replaced, inserted and deleted lines in base coordinates', () => {
    const base = lines(10);
    const next = [...base];
    next[2] = 'changed';
    next.splice(6, 0, 'inserted');
    next.splice(9, 1);
    expect(changedHunks(base, next)).toEqual([
      { start: 2, end: 3 },
      { start: 6, end: 6 },
      { start: 8, end: 9 },
    ]);
    expect(changedHunks(base, [...base])).toEqual([]);
  });

  it('treats an oversized changed middle as one conservative hunk', () => {
    const base = lines(3000);
    const next = base.map((line, i) => (i > 0 && i < 2999 ? `${line}!` : line));
    expect(changedHunks(base, next)).toEqual([{ start: 1, end: 2999 }]);
  });

  it('counts touching edits as overlapping, like Git', () => {
    expect(overlappingHunks([{ start: 2, end: 4 }], [{ start: 4, end: 5 }])).toHaveLength(1);
    expect(overlappingHunks([{ start: 2, end: 4 }], [{ start: 6, end: 7 }])).toHaveLength(0);
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
  });
});

describe('fork changes', () => {
  it('walks only changed subtrees', async () => {
    const repo = new FakeRepo();
    const tree: Record<string, string> = { 'README.md': 'hi\n' };
    for (let i = 0; i < 50; i++) tree[`pkg${i}/src/index.ts`] = `export const n = ${i};\n`;
    const base = repo.commit(tree);
    const next: Record<string, string> = {
      ...tree,
      'pkg7/src/index.ts': 'export const n = 700;\n',
      'pkg7/src/new.ts': 'new\n',
    };
    delete next['README.md'];
    const head = repo.commit(next);
    repo.treeReads = 0;
    const changes = await changedFiles(new CachedReader(repo), base, head);
    expect(changes.files.map((f) => [f.path, f.base !== null, f.head !== null])).toEqual([
      ['pkg7/src/index.ts', true, true],
      ['pkg7/src/new.ts', false, true],
      ['README.md', true, false],
    ]);
    // Root, pkg7 and pkg7/src on both sides; untouched packages are never read.
    expect(repo.treeReads).toBeLessThanOrEqual(6);
  });
});

describe('conflicts between agent forks', () => {
  const setup = () => {
    const origin = new FakeRepo();
    const base = origin.commit({ 'src/app.ts': file(lines(40)), 'docs/a.md': 'a\n' });
    return { origin, base };
  };

  it('finds overlapping line edits and ignores separate regions', async () => {
    const { origin, base } = setup();
    const a = new FakeRepo().forkFrom(origin);
    const b = new FakeRepo().forkFrom(origin);
    const c = new FakeRepo().forkFrom(origin);
    const edit = (index: number, text: string) => {
      const next = lines(40);
      next[index] = text;
      return file(next);
    };
    const headA = a.commit({ 'src/app.ts': edit(10, 'A'), 'docs/a.md': 'a\n' });
    const headB = b.commit({ 'src/app.ts': edit(11, 'B'), 'docs/a.md': 'a\n' });
    const headC = c.commit({ 'src/app.ts': edit(30, 'C'), 'docs/a.md': 'a\n' });
    const repos = { a, b, c } as Record<string, FakeRepo>;
    const readers = new Map(Object.entries(repos).map(([k, v]) => [k, new CachedReader(v)]));
    const snapshot = async (fork: string, head: string) => ({
      fork,
      baseCommit: base,
      files: (await changedFiles(readers.get(fork) as CachedReader, base, head)).files,
    });
    const conflicts = await allConflicts(
      [await snapshot('a', headA), await snapshot('b', headB), await snapshot('c', headC)],
      (fork) => readers.get(fork) as CachedReader,
    );
    expect(conflicts).toEqual([
      {
        forks: ['a', 'b'],
        path: 'src/app.ts',
        kind: 'overlapping-lines',
        lines: [{ left: [11, 11], right: [12, 12] }],
      },
    ]);
  });

  it('classifies deletes, duplicate additions and identical results', async () => {
    const { origin, base } = setup();
    const a = new FakeRepo().forkFrom(origin);
    const b = new FakeRepo().forkFrom(origin);
    const headA = a.commit({ 'docs/a.md': 'a\n', 'src/new.ts': 'one\n' });
    const headB = b.commit({
      'src/app.ts': file(['x', ...lines(40)]),
      'docs/a.md': 'a\n',
      'src/new.ts': 'two\n',
    });
    const ra = new CachedReader(a);
    const rb = new CachedReader(b);
    const result = await conflictsBetween(
      { fork: 'a', baseCommit: base, files: (await changedFiles(ra, base, headA)).files },
      { fork: 'b', baseCommit: base, files: (await changedFiles(rb, base, headB)).files },
      { left: ra, right: rb },
    );
    expect(result.map((c) => [c.path, c.kind])).toEqual([
      ['src/app.ts', 'delete-vs-edit'],
      ['src/new.ts', 'both-added'],
    ]);
    const same = await conflictsBetween(
      { fork: 'a', baseCommit: base, files: [{ path: 'x', base: null, head: 'h' }] },
      { fork: 'b', baseCommit: base, files: [{ path: 'x', base: null, head: 'h' }] },
      { left: ra, right: rb },
    );
    expect(same).toEqual([]);
  });
});

describe('access', () => {
  const secret = 's'.repeat(40);
  const request = (headers: Record<string, string>) => new Request('https://swarm/v1', { headers });

  it('accepts the bearer token or a swarm WebSocket subprotocol only', async () => {
    expect(await authorized(request({ Authorization: `Bearer ${secret}` }), secret)).toBe(true);
    expect(
      await authorized(request({ 'Sec-WebSocket-Protocol': `json, swarm.${secret}` }), secret),
    ).toBe(true);
    expect(await authorized(request({ Authorization: 'Bearer wrong' }), secret)).toBe(false);
    expect(await authorized(request({}), secret)).toBe(false);
    // A short or missing secret never authorizes, even when it matches.
    expect(await authorized(request({ Authorization: 'Bearer short' }), 'short')).toBe(false);
  });

  it('names forks from the repository and attempt', () => {
    expect(forkName('app', '3f2a9c1e-77b0-4d0a-9e1b-123456789abc')).toBe('app--3f2a9c1e77b0');
    expect(() => forkName('app', 'x')).toThrow(/six/);
  });
});
