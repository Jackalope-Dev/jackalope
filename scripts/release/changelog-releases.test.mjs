import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { withReleases } from '../../apps/website/src/changelog.ts';
import {
  changelogPath,
  changelogReleases,
  gitRunner,
  idsAtTag,
  releaseMap,
} from './changelog-releases.mjs';

function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'changelog-releases-'));
  const run = (...args) => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  run('init', '--quiet', '--initial-branch=master');
  run('config', 'user.email', 'fixture@example.invalid');
  run('config', 'user.name', 'Fixture');
  run('config', 'commit.gpgsign', 'false');
  run('config', 'tag.gpgsign', 'false');
  mkdirSync(join(directory, 'apps/website/src'), { recursive: true });
  const commit = (ids, message) => {
    writeFileSync(join(directory, changelogPath), JSON.stringify(ids.map((id) => ({ id }))));
    run('add', '.');
    run('commit', '--quiet', '-m', message);
  };
  return { directory, run, commit, git: gitRunner(directory) };
}

test('release state follows the first beta and stable tags that contain each entry', (t) => {
  const repo = repository();
  t.after(() => rmSync(repo.directory, { recursive: true, force: true }));
  repo.commit(['first'], 'first');
  repo.run('tag', 'beta-v0.1.9');
  repo.commit(['second', 'first'], 'second');
  repo.run('tag', 'beta-v0.1.10');
  repo.run('tag', 'stable-v0.1.11');
  repo.commit(['merged-only', 'second', 'first'], 'merged');
  // Store mirror tags and unrelated tags never decide release state.
  repo.run('tag', 'store-stable/v0.1.12');
  repo.run('tag', 'stable-v0.1.x');

  const { tags, releases } = releaseMap(repo.git);
  assert.equal(tags, 3);
  // Numeric ordering: 0.1.9 precedes 0.1.10.
  assert.equal(releases.first.beta.version, '0.1.9');
  assert.equal(releases.first.stable.version, '0.1.11');
  assert.equal(releases.second.beta.version, '0.1.10');
  assert.match(releases.second.stable.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(releases['merged-only'], undefined);

  const [merged, second] = withReleases(
    [{ id: 'merged-only' }, { id: 'second' }, { id: 'site', kind: 'website' }, { id: 'first' }],
    releases,
  );
  assert.equal(merged.state, 'coming-soon');
  assert.equal(merged.version, undefined);
  assert.equal(second.state, 'released');
  assert.equal(second.version, '0.1.11');
});

test('an entry only in a beta reads as beta, and a site entry stays outside the lifecycle', () => {
  const releases = {
    beta: { beta: { version: '0.1.30', date: '2026-10-31' } },
    site: { stable: { version: '0.1.31', date: '2026-10-31' } },
    broken: { stable: { version: 'latest', date: 'today' } },
  };
  const [beta, site, broken] = withReleases(
    [{ id: 'beta' }, { id: 'site', kind: 'website' }, { id: 'broken' }],
    releases,
  );
  assert.equal(beta.state, 'beta');
  assert.equal(beta.version, '0.1.30');
  assert.equal(site.kind, 'website');
  assert.equal(site.state, 'website');
  assert.equal(site.release, undefined);
  // Malformed release data never promotes an entry.
  assert.equal(broken.state, 'coming-soon');
});

test('a tag from before the changelog existed ships no entries', (t) => {
  const repo = repository();
  t.after(() => rmSync(repo.directory, { recursive: true, force: true }));
  writeFileSync(join(repo.directory, 'README.md'), 'fixture');
  repo.run('add', 'README.md');
  repo.run('commit', '--quiet', '-m', 'before');
  repo.run('tag', 'stable-v0.1.1');
  assert.equal(idsAtTag(repo.git, 'stable-v0.1.1').size, 0);
});

test('missing release history fails a required build and reads Coming soon otherwise', (t) => {
  const repo = repository();
  t.after(() => rmSync(repo.directory, { recursive: true, force: true }));
  repo.commit(['first'], 'first');
  const warnings = [];
  // No remote: the fetch fails, and no tags exist locally.
  assert.throws(
    () =>
      changelogReleases({
        git: repo.git,
        fetch: true,
        remotes: ['origin'],
        required: true,
        warn: () => {},
      }),
    /CHANGELOG_RELEASES=skip/,
  );
  assert.deepEqual(
    changelogReleases({ git: repo.git, warn: (message) => warnings.push(message) }),
    {},
  );
  assert.equal(warnings.length, 1);
});

test('an unreadable tag fails a required build instead of guessing', (t) => {
  const repo = repository();
  t.after(() => rmSync(repo.directory, { recursive: true, force: true }));
  writeFileSync(join(repo.directory, changelogPath), '{ not json');
  repo.run('add', '.');
  repo.run('commit', '--quiet', '-m', 'broken');
  repo.run('tag', 'beta-v0.2.0');
  assert.throws(() => changelogReleases({ git: repo.git, required: true }));
  assert.deepEqual(changelogReleases({ git: repo.git, warn: () => {} }), {});
});
