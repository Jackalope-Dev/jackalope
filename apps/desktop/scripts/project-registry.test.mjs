import assert from 'node:assert/strict';
import test from 'node:test';

const { useProjectStore: projects, setRegistryAppAccent } = await import(
  '../src/stores/projectStore.ts'
);
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('CLI mirror keeps each saved project accent, orders updates and retries failed writes', async () => {
  const calls = [];
  let release;
  let fail = false;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command, args) => {
        assert.equal(command, 'project_registry_save');
        calls.push(args.projects);
        if (calls.length === 1)
          await new Promise((resolve) => {
            release = resolve;
          });
        if (fail) throw new Error('Host unavailable');
      },
    },
  };
  const project = (id, theme) => ({
    id,
    name: id,
    path: `/fixture/${id}`,
    worktrees: [],
    preferences: { theme },
  });
  try {
    projects.setState({
      projects: [project('work', { accentHex: '#00aa88' }), project('personal')],
    });
    await flush();
    setRegistryAppAccent('#aa00ff');
    projects.getState().updateProjectPreferences('work', { theme: { accentHex: '#112233' } });
    assert.equal(calls.length, 1, 'native writes wait for earlier snapshots');
    release();
    await flush();
    assert.deepEqual(
      calls.at(-1).map((project) => project.accent),
      ['#112233', '#aa00ff'],
    );
    fail = true;
    projects.getState().updateProjectPreferences('work', { theme: { accentHex: '#334455' } });
    await flush();
    const beforeRetry = calls.length;
    fail = false;
    projects.setState({ projects: [...projects.getState().projects] });
    await flush();
    assert.equal(calls.length, beforeRetry + 1);
    assert.equal(calls.at(-1)[0].accent, '#334455');
    projects.setState({ projects: [...projects.getState().projects] });
    await flush();
    assert.equal(calls.length, beforeRetry + 1, 'saved snapshots are not written repeatedly');
  } finally {
    delete globalThis.window;
  }
});
