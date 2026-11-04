import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import type { ChangelogEntry } from '../src/access/broadcast';
import {
  type Candidate,
  monthlyCandidates,
  type ProductNotesEnv,
  previousMonth,
  runMonthlyProductNotes,
  toBroadcast,
} from '../src/access/product-notes';
import { adminRoutes } from '../src/admin';

const november = Date.UTC(2026, 10, 1, 0, 5);
const configured: ProductNotesEnv = {
  ...env,
  PRODUCT_NOTES_ENABLED: 'true',
  PRODUCT_NOTES_AUTOSEND: 'false',
  ANTHROPIC_API_KEY: 'fixture-anthropic-key',
  SEQUENZY_API_KEY: 'fixture-provider',
  ADMIN_EMAIL: 'owner@example.invalid',
  ACCESS_EMAIL_FROM: 'Jackalope <hello@example.invalid>',
  ACCESS_AUDIENCE_LIST: 'fixturelist12345678901234',
  ACCESS_WEB_ORIGIN: 'https://jackalope.dev',
  PRODUCT_NOTES_ADMIN_URL: 'https://api.example.invalid/admin/access#notes',
};

const entry = (id: string, overrides: Partial<ChangelogEntry> = {}): ChangelogEntry => ({
  id,
  date: '2026-09-01',
  kind: 'app',
  title: `Title ${id}`,
  description: `Description ${id}`,
  items: ['One item'],
  ...overrides,
});
const october = [
  entry('added-in-october', { date: '2026-10-20' }),
  entry('beta-in-october', { release: { beta: { version: '0.1.30', date: '2026-10-31' } } }),
  entry('stable-in-october', {
    release: {
      beta: { version: '0.1.20', date: '2026-09-20' },
      stable: { version: '0.1.31', date: '2026-10-31' },
    },
  }),
  entry('stable-in-september', {
    release: { stable: { version: '0.1.15', date: '2026-09-30' } },
  }),
  entry('added-in-november', { date: '2026-11-01' }),
  entry('website-in-october', { kind: 'website', date: '2026-10-10' }),
  // Feeds published before `kind` existed marked site changes by status.
  { ...entry('legacy-website', { date: '2026-10-11' }), kind: undefined, status: 'Website' },
];

type Call = { url: string; body: unknown };
/** Stands in for the website, Claude and Sequenzy. Never reaches the network. */
function services(output: unknown, feed: ChangelogEntry[] = october) {
  const calls: Call[] = [];
  const website = (async () => Response.json(feed)) as typeof fetch;
  const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const raw = input instanceof Request ? await input.text() : init?.body;
    calls.push({ url, body: typeof raw === 'string' ? JSON.parse(raw) : raw });
    if (url.startsWith('https://api.anthropic.com/'))
      return Response.json({
        id: 'msg_fixture',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: JSON.stringify(output) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    if (url.endsWith('/transactional/send'))
      return Response.json({ success: true, jobId: 'job_fixture' });
    if (url.endsWith('/campaigns'))
      return Response.json({
        success: true,
        campaign: { id: 'camp_fixture', url: 'https://sequenzy.example.invalid/c/1' },
      });
    if (url.endsWith('/schedule'))
      return Response.json({ success: true, campaign: { status: 'scheduled' } });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { calls, website, request };
}
const output = (entries: string[], overrides: Record<string, unknown> = {}) => ({
  subject: 'What changed in Jackalope in October',
  preview: 'A short look at the month.',
  headline: 'October in Jackalope',
  intro: 'A few changes landed this month.',
  outro: 'Reply if anything is unclear.',
  entries,
  ...overrides,
});

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as Env & { TEST_MIGRATIONS: { name: string; queries: string[] }[] }).TEST_MIGRATIONS,
  );
});
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM product_note_drafts').run();
});
const row = (month = '2026-10') =>
  env.DB.prepare('SELECT * FROM product_note_drafts WHERE month=?')
    .bind(month)
    .first<Record<string, string | number | null>>();

it('covers the previous calendar month in UTC, across a year boundary', () => {
  expect(previousMonth(november)).toMatchObject({
    month: '2026-10',
    start: '2026-10-01',
    end: '2026-11-01',
  });
  expect(previousMonth(Date.UTC(2027, 0, 1))).toMatchObject({
    month: '2026-12',
    start: '2026-12-01',
    end: '2027-01-01',
  });
});

it('picks app entries added or moved into a release during the month, never website ones', () => {
  const candidates = monthlyCandidates(october, previousMonth(november));
  expect(
    candidates.map(({ id, change, state, version }) => ({ id, change, state, version })),
  ).toEqual([
    { id: 'added-in-october', change: 'added', state: 'coming-soon', version: undefined },
    { id: 'beta-in-october', change: 'beta', state: 'beta', version: '0.1.30' },
    { id: 'stable-in-october', change: 'released', state: 'released', version: '0.1.31' },
  ]);
});

it('keeps only real candidate ids from model output and rejects drafts without any', () => {
  const candidates = monthlyCandidates(october, previousMonth(november));
  const draft = toBroadcast(
    output(['invented', 'beta-in-october', 'beta-in-october', 'website-in-october']),
    candidates,
    'https://jackalope.dev',
  );
  expect(draft.entries).toEqual(['beta-in-october']);
  expect(draft.action?.url).toBe('https://jackalope.dev/changelog/');
  expect(() => toBroadcast(output(['invented']), candidates, 'https://jackalope.dev')).toThrow(
    'draft_without_entries',
  );
  expect(() =>
    toBroadcast(
      output(['beta-in-october'], { subject: 'x'.repeat(400) }),
      candidates,
      'https://jackalope.dev',
    ),
  ).toThrow('draft_invalid');
  expect(() => toBroadcast({ subject: 1 }, candidates, 'https://jackalope.dev')).toThrow(
    'draft_invalid',
  );
  const many: Candidate[] = Array.from({ length: 8 }, (_, index) => ({
    ...candidates[0],
    id: `change-${index}`,
  }));
  expect(
    toBroadcast(output(many.map((candidate) => candidate.id)), many, 'https://jackalope.dev')
      .entries,
  ).toHaveLength(5);
});

it('does nothing at all until the flag and every setting are present', async () => {
  const { calls, website, request } = services(output(['beta-in-october']));
  expect(
    await runMonthlyProductNotes(
      { ...configured, PRODUCT_NOTES_ENABLED: 'false' },
      { now: november, request, website },
    ),
  ).toBe('disabled');
  for (const missing of ['ANTHROPIC_API_KEY', 'SEQUENZY_API_KEY', 'ADMIN_EMAIL'] as const)
    expect(
      await runMonthlyProductNotes(
        { ...configured, [missing]: '' },
        { now: november, request, website },
      ),
    ).toBe('unconfigured');
  expect(
    await runMonthlyProductNotes(
      { ...configured, PRODUCT_NOTES_AUTOSEND: 'true', ACCESS_AUDIENCE_LIST: '' },
      { now: november, request, website },
    ),
  ).toBe('unconfigured');
  expect(calls).toHaveLength(0);
  expect(await row()).toBeNull();
});

it('drafts once a month, stores the draft and notifies the owner once', async () => {
  const { calls, website, request } = services(
    output(['stable-in-october', 'beta-in-october', 'invented']),
  );
  expect(await runMonthlyProductNotes(configured, { now: november, request, website })).toBe(
    'ready',
  );
  const stored = await row();
  expect(stored?.state).toBe('ready');
  expect(JSON.parse(String(stored?.draft)).entries).toEqual([
    'stable-in-october',
    'beta-in-october',
  ]);
  expect(JSON.parse(String(stored?.candidates))).toHaveLength(3);
  expect(stored?.notified_at).toBe(november);
  const notices = calls.filter((call) => call.url.endsWith('/transactional/send'));
  expect(notices).toHaveLength(1);
  expect(notices[0].body).toMatchObject({ to: configured.ADMIN_EMAIL });
  // Review first: nothing reaches the subscriber audience.
  expect(calls.some((call) => call.url.includes('/campaigns'))).toBe(false);
  // The model only ever sees the month's app candidates.
  const sent = JSON.stringify(calls.find((call) => call.url.includes('anthropic'))?.body);
  expect(sent).not.toContain('website-in-october');
  expect(sent).not.toContain('stable-in-september');

  const before = calls.length;
  for (const minutes of [5, 60, 60 * 24 * 10])
    expect(
      await runMonthlyProductNotes(configured, {
        now: november + minutes * 60000,
        request,
        website,
      }),
    ).toBe('ready');
  expect(calls).toHaveLength(before);
});

it('records an empty month as skipped and does not ask Claude', async () => {
  const { calls, website, request } = services(output([]), [october[3], october[5]]);
  expect(await runMonthlyProductNotes(configured, { now: november, request, website })).toBe(
    'skipped',
  );
  expect((await row())?.state).toBe('skipped');
  expect(
    await runMonthlyProductNotes(configured, { now: november + 300000, request, website }),
  ).toBe('skipped');
  expect(calls).toHaveLength(0);
});

it('stops after three failed drafts with invalid ids and never notifies', async () => {
  const { calls, website, request } = services(output(['invented']));
  let now = november;
  for (let attempt = 1; attempt <= 5; attempt++) {
    await runMonthlyProductNotes(configured, { now, request, website });
    now += 24 * 3600000;
  }
  const stored = await row();
  expect(stored?.state).toBe('failed');
  expect(stored?.reason).toBe('draft_without_entries');
  expect(stored?.attempts).toBe(3);
  expect(calls.filter((call) => call.url.includes('anthropic'))).toHaveLength(3);
  expect(calls.some((call) => call.url.endsWith('/transactional/send'))).toBe(false);
});

it('hands the draft to Sequenzy and schedules it only when autosend is on', async () => {
  const { calls, website, request } = services(output(['stable-in-october']));
  expect(
    await runMonthlyProductNotes(
      { ...configured, PRODUCT_NOTES_AUTOSEND: 'true' },
      { now: november, request, website },
    ),
  ).toBe('handed_off');
  const stored = await row();
  expect(stored?.campaign_id).toBe('camp_fixture');
  expect(stored?.reason).toBeNull();
  const schedule = calls.find((call) => call.url.endsWith('/schedule'));
  const { scheduledAt } = (schedule?.body ?? {}) as { scheduledAt?: string };
  expect(Date.parse(scheduledAt ?? '')).toBeGreaterThan(november);
  expect(calls.filter((call) => call.url.endsWith('/transactional/send'))).toHaveLength(1);
});

it('shows the latest draft in the composer and lets the owner dismiss it', async () => {
  const { website, request } = services(output(['stable-in-october']));
  await runMonthlyProductNotes(configured, { now: november, request, website });
  const call = (path: string, body?: unknown) =>
    adminRoutes(
      new Request(`https://api.jackalope.dev/admin/api/access/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { origin: 'https://api.jackalope.dev' },
        body: body ? JSON.stringify(body) : undefined,
      }),
      configured,
      (r) => r.json(),
    );
  const composer = (await (await call('broadcast')).json()) as {
    monthly: { enabled: boolean; latest: { month: string; state: string; draft: unknown } };
  };
  expect(composer.monthly.enabled).toBe(true);
  expect(composer.monthly.latest).toMatchObject({ month: '2026-10', state: 'ready' });
  expect(composer.monthly.latest.draft).toMatchObject({ entries: ['stable-in-october'] });
  expect((await call('product-notes', { month: '2026-10', action: 'send' })).status).toBe(400);
  expect((await call('product-notes', { month: '2026-10', action: 'dismiss' })).status).toBe(200);
  expect((await row())?.state).toBe('dismissed');
  // A dismissed month is finished: later ticks do not draft it again.
  expect(
    await runMonthlyProductNotes(configured, { now: november + 600000, request, website }),
  ).toBe('dismissed');
});
