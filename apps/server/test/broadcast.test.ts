import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import {
  type Broadcast,
  broadcastEmail,
  broadcastSchema,
  changelogEntries,
  createBroadcastDraft,
} from '../src/access/broadcast';
import { accessEmail } from '../src/access/mail';

const bindings: Env = {
  ...env,
  EARLY_ACCESS_ENABLED: 'true',
  SEQUENZY_API_KEY: 'test-provider-key',
  ACCESS_AUDIENCE_LIST: 'fixturelist12345678901234',
  ACCESS_WEB_ORIGIN: 'https://jackalope.dev',
  ACCESS_EMAIL_FROM: 'Jackalope <hello@hello.jackalope.dev>',
  ACCESS_EMAIL_REPLY_TO: 'contact@jackalope.dev',
};

const published = [
  {
    id: 'share-a-head-start',
    date: '2026-09-09',
    status: 'In development',
    title: 'Share a head start.',
    description: 'Early access passes share colourful ticket designs.',
    items: ['Open an available pass to copy its link.'],
    note: 'Development milestone, not a public release.',
  },
  {
    id: 'app-version',
    date: '2026-09-09',
    title: 'App version on the welcome screen.',
    description: 'See which version is running before connecting.',
  },
];
const feed = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

const draft = (overrides: Partial<Broadcast> = {}) =>
  broadcastSchema.parse({
    subject: 'What shipped in Jackalope',
    headline: 'A few things worth knowing.',
    intro: 'Two changes landed this week.\n\nBoth are small but useful.',
    entries: ['share-a-head-start'],
    ...overrides,
  });

it('reads the product notes the website publishes', async () => {
  expect(await changelogEntries(bindings, feed(published))).toHaveLength(2);
  await expect(changelogEntries(bindings, feed(published, 502))).rejects.toThrow(
    'changelog_unavailable',
  );
  // A feed that is not the shape we expect is refused rather than half-rendered.
  await expect(changelogEntries(bindings, feed([{ id: 'x' }]))).rejects.toThrow(
    'changelog_unavailable',
  );
});

it('includes only the changes that were ticked', () => {
  const { html } = broadcastEmail(draft(), published, 'https://jackalope.dev');
  expect(html).toContain('Share a head start.');
  expect(html).not.toContain('App version on the welcome screen.');
  expect(html).toContain('In development');
  expect(html).toContain('Both are small but useful.');
});

it('carries custom sections and an optional action alongside the changelog', () => {
  const { html } = broadcastEmail(
    draft({
      extras: [{ title: 'A note on Windows', body: 'The installer is signed now.' }],
      action: { label: 'Read the notes', url: 'https://jackalope.dev/changelog/' },
    }),
    published,
    'https://jackalope.dev',
  );
  expect(html).toContain('A note on Windows');
  expect(html).toContain('The installer is signed now.');
  expect(html).toContain('https://jackalope.dev/changelog/');
  expect(html).toContain('Read the notes');
});

it('escapes composed copy instead of letting it become markup', () => {
  const { html } = broadcastEmail(
    draft({ headline: 'Shipped <script>alert(1)</script>', entries: [] }),
    published,
    'https://jackalope.dev',
  );
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).toContain('&lt;script&gt;');
});

it('wears the same chrome as an access email', () => {
  const note = broadcastEmail(draft(), published, 'https://jackalope.dev').html;
  const access = accessEmail(
    { to: 'you@example.com', kind: 'welcome', token: 'preview' },
    'https://jackalope.dev',
  ).body;
  for (const shared of ['#faf8f6', '#29241f', 'Jackalope Digital LLC', 'icon-128.png'])
    expect(note.includes(shared) && access.includes(shared)).toBe(true);
  // Broadcasts must offer a way out; access mail is transactional and does not.
  expect(note).toContain('{{unsubscribe_link}}');
  expect(access).not.toContain('{{unsubscribe_link}}');
});

it('hands Sequenzy a draft, never a send, and targets the opted-in audience', async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const send = (async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ success: true, campaign: { id: 'camp_1', url: 'https://sequenzy' } });
  }) as typeof fetch;

  const result = await createBroadcastDraft(bindings, draft(), published, send);
  expect(result).toMatchObject({ id: 'camp_1', url: 'https://sequenzy' });
  expect(calls[0].url).toContain('/campaigns');
  expect(calls[0].body).toMatchObject({
    status: 'draft',
    fromEmail: 'hello@hello.jackalope.dev',
    replyTo: 'contact@jackalope.dev',
    targetLists: { type: 'lists', listIds: ['fixturelist12345678901234'] },
  });
});

it('narrows the audience to one managed tag when asked', async () => {
  const calls: Record<string, unknown>[] = [];
  const send = (async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({ success: true, campaign: { id: 'camp_2' } });
  }) as typeof fetch;

  await createBroadcastDraft(bindings, draft({ tag: 'platform-windows' }), published, send);
  expect(calls[0].targetLists).toMatchObject({
    type: 'filtered',
    filterJoinOperator: 'and',
    filters: [
      { field: 'list', operator: 'is', value: 'fixturelist12345678901234' },
      { field: 'tag', operator: 'contains', value: 'platform-windows' },
    ],
  });
});

it('refuses a tag it does not manage and a note with nothing in it', () => {
  expect(broadcastSchema.safeParse({ ...draft(), tag: 'anything-goes' }).success).toBe(false);
  expect(broadcastSchema.safeParse({ subject: 'Hi', headline: '' }).success).toBe(false);
  expect(
    broadcastSchema.safeParse({ ...draft(), action: { label: 'Go', url: 'javascript:alert(1)' } })
      .success,
  ).toBe(false);
});

it('reports a rejected draft instead of reporting success', async () => {
  const send = (async () => Response.json({ success: false })) as typeof fetch;
  await expect(createBroadcastDraft(bindings, draft(), published, send)).rejects.toThrow(
    'broadcast_rejected',
  );
});
