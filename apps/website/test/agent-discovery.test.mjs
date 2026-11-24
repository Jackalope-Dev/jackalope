import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { agentDiscoveryFiles } from '../src/agent-discovery.ts';

const origin = 'https://jackalope.dev';
const files = agentDiscoveryFiles(origin);

test('agent skills index lists each published SKILL.md with its digest', () => {
  const index = JSON.parse(files['.well-known/agent-skills/index.json']);
  assert.equal(index.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json');
  assert.ok(index.skills.length > 0);
  for (const skill of index.skills) {
    assert.match(skill.name, /^[a-z0-9-]+$/);
    const source = files[skill.url.slice(1)];
    assert.ok(source, `${skill.url} is published`);
    assert.match(source, new RegExp(`^---\\nname: ${skill.name}\\n`));
    assert.equal(skill.digest, `sha256:${createHash('sha256').update(source).digest('hex')}`);
  }
});

test('API and AI catalogs point only at published files', () => {
  const catalog = JSON.parse(files['.well-known/api-catalog']);
  const ai = JSON.parse(files['.well-known/ai-catalog.json']);
  const urls = [
    ...catalog.linkset.flatMap((entry) => [
      ...entry['service-desc'].map((link) => link.href),
      ...entry['service-doc'].map((link) => link.href),
    ]),
    ...ai.entries.map((entry) => entry.url),
  ];
  for (const url of urls) assert.ok(files[url.slice(origin.length + 1)], url);
  for (const entry of ai.entries) {
    assert.match(entry.identifier, /^urn:air:jackalope\.dev:/);
    assert.ok(entry.representativeQueries.length >= 2);
  }
});
