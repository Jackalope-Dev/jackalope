import assert from 'node:assert/strict';
import test from 'node:test';
import { definitionDigest, imageFiles, plan, repository, tags } from './computer-image.mjs';

test('the definition digest matches the app (image.rs uses the same fixture)', () => {
  const files = [
    ['Dockerfile', Buffer.from('FROM scratch\n')],
    ['start.sh', Buffer.from('#!/bin/sh\n')],
    ['agent.py', Buffer.from('print(1)\n')],
  ];
  assert.equal(definitionDigest(files), 'a2510b669187');
});

test('tags carry the version with the definition, the version and the commit', () => {
  assert.deepEqual(
    tags({
      repository: 'ghcr.io/owner/image',
      version: '0.2.0-beta.1+7',
      definition: 'abc',
      sha: '0123456789abcdef0123456789abcdef01234567',
    }),
    [
      'ghcr.io/owner/image:0.2.0-beta.1-7-abc',
      'ghcr.io/owner/image:0.2.0-beta.1-7',
      'ghcr.io/owner/image:sha-0123456789ab',
    ],
  );
});

test('the plan reads the repository, version and files from the desktop source', async () => {
  assert.equal(await repository(), 'ghcr.io/jackalope-dev/jackalope-computer');
  assert.deepEqual(await imageFiles(), ['Dockerfile', 'start.sh', 'agent.py']);
  const result = await plan('0123456789abcdef0123456789abcdef01234567');
  assert.match(result.definition, /^[0-9a-f]{12}$/);
  assert.equal(result.tags[0], `${result.repository}:${result.version}-${result.definition}`);
});
