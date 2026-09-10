import assert from 'node:assert/strict';
import test from 'node:test';
import { submissionPath, submit, updateSubmission } from './store-submit.mjs';

const receipt = { identity: 'Jackalope.App', publisher: 'CN=Publisher', version: '0.2.0' };
const app = {
  packageIdentityName: receipt.identity,
  publisherName: receipt.publisher,
  lastPublishedApplicationSubmission: { id: '1' },
};
const draft = {
  id: '2',
  applicationPackages: [
    { fileName: 'old.msix', version: '0.1.0.0', architecture: 'x64', fileStatus: 'Uploaded' },
  ],
  fileUploadUrl: 'https://example.blob.core.windows.net/package?sig=private',
  visibility: 'Hidden',
  listings: { 'en-us': { baseListing: { description: 'Keep listing' } } },
  targetPublishMode: 'Manual',
  packageDeliveryOptions: { packageRollout: { isPackageRollout: true }, isMandatoryUpdate: false },
};

test('channels cannot silently fall back from beta to the base audience', () => {
  assert.throws(() => submissionPath('9NBLGGH4R315', 'beta'), /flight ID/);
  assert.throws(() => submissionPath('9NBLGGH4R315', 'preview'), /channel/);
  assert.equal(submissionPath('9NBLGGH4R315', 'stable', 'unused'), '/applications/9NBLGGH4R315');
});

test('package update preserves audience/listings, replaces packages, and releases after certification', () => {
  const updated = updateSubmission(draft, 'stable', 'new.msix', receipt.version);
  assert.deepEqual(updated.listings, draft.listings);
  assert.equal(updated.visibility, 'Hidden');
  assert.equal(updated.targetPublishMode, 'Immediate');
  assert.equal(updated.applicationPackages[0].fileStatus, 'PendingDelete');
  assert.equal(updated.applicationPackages[1].fileStatus, 'PendingUpload');
  assert.equal(updated.packageDeliveryOptions.packageRollout.isPackageRollout, false);
  assert.equal(draft.applicationPackages[0].fileStatus, 'Uploaded');
  assert.throws(() => updateSubmission(draft, 'stable', 'new.msix', '0.1.0'), /Increase/);
});

test('pending draft and mismatched identity stop before any writes', async () => {
  for (const value of [
    { ...app, pendingApplicationSubmission: { id: 'other' } },
    { ...app, publisherName: 'CN=Other' },
  ]) {
    const calls = [];
    await assert.rejects(
      submit(
        {
          appId: '9NBLGGH4R315',
          channel: 'stable',
          receipt,
          token: 'test',
          checkpoint: () => assert.fail('No checkpoint expected'),
          upload: () => assert.fail('No upload expected'),
        },
        async (url, options) => {
          calls.push([url, options.method]);
          return Response.json(value);
        },
      ),
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 'GET');
  }
});

for (const channel of ['stable', 'beta']) {
  test(`${channel} uploads before committing and records submission without polling certification`, async () => {
    const events = [];
    const checkpoints = [];
    const flightDraft = { ...draft, flightPackages: draft.applicationPackages };
    const result = await submit(
      {
        appId: '9NBLGGH4R315',
        channel,
        flightId: 'flight-1',
        receipt,
        token: 'test',
        fileName: 'new.msix',
        checkpoint: async (value) => checkpoints.push(value),
        upload: async (url) => {
          assert.equal(url.hostname, 'example.blob.core.windows.net');
          events.push('upload');
        },
      },
      async (url, options) => {
        assert.equal(options.redirect, 'error');
        events.push(`${options.method} ${new URL(url).pathname}`);
        if (url.endsWith('/commit')) return Response.json({ status: 'CommitStarted' });
        if (options.method === 'PUT') {
          const body = JSON.parse(options.body);
          assert.equal(body.targetPublishMode, 'Immediate');
          assert.equal(
            body[channel === 'beta' ? 'flightPackages' : 'applicationPackages'].at(-1).fileName,
            'new.msix',
          );
        }
        return Response.json(url.includes('/submissions') ? flightDraft : app);
      },
    );
    assert.equal(result.published, false);
    assert.equal(checkpoints[0].status, 'DraftCreated');
    assert.equal(checkpoints[1].status, 'Submitted');
    assert.equal(events.at(-2), 'upload');
    assert.match(events.at(-1), /\/commit$/);
    assert.equal(
      events.some((event) => event.startsWith('DELETE')),
      false,
    );
  });
}

test('failed upload keeps the draft checkpoint and never commits', async () => {
  const checkpoints = [];
  await assert.rejects(
    submit(
      {
        appId: '9NBLGGH4R315',
        channel: 'stable',
        receipt,
        token: 'test',
        fileName: 'new.msix',
        checkpoint: async (value) => checkpoints.push(value),
        upload: async () => {
          throw new Error('Upload failed');
        },
      },
      async (url) => {
        assert.equal(url.endsWith('/commit'), false);
        return Response.json(url.includes('/submissions') ? draft : app);
      },
    ),
    /Upload failed/,
  );
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].status, 'DraftCreated');
});
