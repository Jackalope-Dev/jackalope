import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { EMAIL_PALETTE } from '@jackalope/brand/email';
import { z } from 'zod';
import {
  type Broadcast,
  broadcastSchema,
  type ChangelogEntry,
  changelogEntries,
  createBroadcastDraft,
} from './broadcast';
import { button, emailShell, escapeHtml } from './mail-templates';
import { providerJson } from './provider';

const c = EMAIL_PALETTE;

/** The Anthropic key is an optional secret, so it is not in the generated Env. */
export type ProductNotesEnv = Env & { ANTHROPIC_API_KEY?: string };

const DEFAULT_PRODUCT_NOTES_MODEL = 'claude-sonnet-5';
/** At most this many drafting attempts per month before the owner composes by hand. */
const MAX_ATTEMPTS = 3;
const MAX_NOTIFY_ATTEMPTS = 5;
/** How long an autosent campaign waits in Sequenzy, so the owner can still stop it. */
const AUTOSEND_DELAY = 2 * 3600000;

/**
 * Voice for the drafting model. PRODUCT_NOTES_PROMPT replaces it; the release
 * rules and the output contract travel with the request, so they always apply.
 */
const DEFAULT_PRODUCT_NOTES_PROMPT = `You write the monthly product notes email for Jackalope, a desktop app for Windows, macOS and Linux that runs coding agents such as Codex, Claude Code and Gemini CLI in parallel, each in its own Git worktree, with a terminal command and a phone companion.

Write like one person on a small team telling people what changed. Short, plain sentences. Friendly and direct. Say what someone can now do, not how it was built.

Do not use marketing language, hype, superlatives, exclamation marks, emoji, em dashes or en dashes. Do not use AI jargon such as "leverage", "seamless", "supercharge" or "unlock". Never invent features, numbers, dates, quotes or reasons that the entries do not state.`;

/** What the model returns. It maps onto broadcastSchema once ids are checked. */
const draftOutputSchema = z.object({
  subject: z.string().describe('Email subject, under 80 characters.'),
  preview: z.string().describe('Inbox preview text, one sentence, under 120 characters.'),
  headline: z.string().describe('Short headline at the top of the email, under 70 characters.'),
  intro: z.string().describe('Opening, one or two short paragraphs separated by a blank line.'),
  outro: z.string().describe('Closing, one short paragraph.'),
  entries: z
    .array(z.string())
    .describe('Ids of the 3 to 5 chosen changes, most important first, copied exactly.'),
});

export type Candidate = {
  id: string;
  /** What happened to the entry during the month. */
  change: 'released' | 'beta' | 'added';
  /** Where the entry stands now. */
  state: 'released' | 'beta' | 'coming-soon';
  version?: string;
  title: string;
  description: string;
  items: string[];
};

export type Month = { month: string; start: string; end: string; label: string };

/** The calendar month before `now`, in UTC. `end` is the first day of the next month. */
export function previousMonth(now: number): Month {
  const today = new Date(now);
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return {
    month: start.toISOString().slice(0, 7),
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    label: start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

const isWebsite = (entry: ChangelogEntry) =>
  entry.kind === 'website' || (!entry.kind && entry.status === 'Website');

const entryState = (entry: ChangelogEntry): Candidate['state'] =>
  entry.release?.stable ? 'released' : entry.release?.beta ? 'beta' : 'coming-soon';

/**
 * App changes worth mentioning for a month: added to the changelog during it,
 * or moved into a beta or stable release during it. Website entries are left
 * out; the note is about the app.
 */
export function monthlyCandidates(entries: ChangelogEntry[], { start, end }: Month): Candidate[] {
  const within = (date?: string) => !!date && date >= start && date < end;
  return entries.flatMap((entry) => {
    if (isWebsite(entry)) return [];
    const change: Candidate['change'] | null = within(entry.release?.stable?.date)
      ? 'released'
      : within(entry.release?.beta?.date)
        ? 'beta'
        : within(entry.date)
          ? 'added'
          : null;
    if (!change) return [];
    const state = entryState(entry);
    const version =
      state === 'released'
        ? entry.release?.stable?.version
        : state === 'beta'
          ? entry.release?.beta?.version
          : undefined;
    return [
      {
        id: entry.id,
        change,
        state,
        ...(version ? { version } : {}),
        title: entry.title,
        description: entry.description,
        items: entry.items ?? [],
      },
    ];
  });
}

class DraftError extends Error {}

/**
 * Turns model output into a broadcast. Unknown or repeated ids are dropped, the
 * list is capped at five, and a draft with no real change or with fields the
 * composer would refuse is rejected rather than stored.
 */
export function toBroadcast(output: unknown, candidates: Candidate[], origin: string): Broadcast {
  const parsed = draftOutputSchema.safeParse(output);
  if (!parsed.success) throw new DraftError('draft_invalid');
  const known = new Set(candidates.map((candidate) => candidate.id));
  const entries = [...new Set(parsed.data.entries)].filter((id) => known.has(id)).slice(0, 5);
  if (!entries.length) throw new DraftError('draft_without_entries');
  const draft = broadcastSchema.safeParse({
    subject: parsed.data.subject,
    preview: parsed.data.preview,
    headline: parsed.data.headline,
    intro: parsed.data.intro,
    outro: parsed.data.outro,
    entries,
    extras: [],
    action: { label: 'Read the changelog', url: `${origin}/changelog/` },
    tag: '',
  });
  if (!draft.success) throw new DraftError('draft_invalid');
  return draft.data;
}

function draftRequest(month: Month, candidates: Candidate[]) {
  return `Draft the product notes email for ${month.label}.

Choose the best 3 to 5 changes below for people who use the app (fewer if there are fewer). Prefer changes people will notice and can use. Return their ids exactly as given.

Each change has a "state" that you must respect:
- "released": in the stable release, available to everyone who updates.
- "beta": only in the beta channel. Say it is in beta and do not describe it as available to everyone.
- "coming-soon": finished but not in any release yet. Say it is coming soon, never that people can use it today.
"change" says what happened during the month: "released" moved into a stable release, "beta" moved into a beta, "added" was finished.

The email shows each chosen change's own title and description below your intro, so the intro should set the scene in a sentence or two rather than repeat them. The outro is a short sign-off; you can invite replies, since replies reach the team.

Changes (JSON):
${JSON.stringify(candidates)}`;
}

/** Asks Claude for a draft. Throws DraftError on refusals, truncation or unusable output. */
async function composeDraft(
  env: ProductNotesEnv,
  month: Month,
  candidates: Candidate[],
  request: typeof fetch = fetch,
) {
  const model = env.PRODUCT_NOTES_MODEL || DEFAULT_PRODUCT_NOTES_MODEL;
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    fetch: request,
    maxRetries: 2,
    timeout: 120000,
  });
  const response = await client.messages.parse({
    model,
    max_tokens: 8000,
    system: env.PRODUCT_NOTES_PROMPT || DEFAULT_PRODUCT_NOTES_PROMPT,
    messages: [{ role: 'user', content: draftRequest(month, candidates) }],
    output_config: { format: zodOutputFormat(draftOutputSchema) },
  });
  if (response.stop_reason === 'refusal') throw new DraftError('draft_refused');
  if (response.stop_reason === 'max_tokens') throw new DraftError('draft_truncated');
  return { draft: toBroadcast(response.parsed_output, candidates, env.ACCESS_WEB_ORIGIN), model };
}

/** Why the monthly job cannot run, or an empty list when it can. */
function productNotesMissing(env: ProductNotesEnv) {
  if (env.PRODUCT_NOTES_ENABLED !== 'true') return ['PRODUCT_NOTES_ENABLED'];
  return (
    [
      ['ANTHROPIC_API_KEY', env.ANTHROPIC_API_KEY],
      ['SEQUENZY_API_KEY', env.SEQUENZY_API_KEY],
      ['ADMIN_EMAIL', env.ADMIN_EMAIL],
      ['ACCESS_EMAIL_FROM', env.ACCESS_EMAIL_FROM],
      ...(env.PRODUCT_NOTES_AUTOSEND === 'true'
        ? [['ACCESS_AUDIENCE_LIST', env.ACCESS_AUDIENCE_LIST]]
        : []),
    ] as [string, string | undefined][]
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

let reportedInactive = false;

type Row = {
  state: string;
  attempts: number;
  next_at: number;
  notified_at: number | null;
  notify_attempts: number;
  draft: string | null;
  reason: string | null;
  campaign_url: string | null;
};

/**
 * Monthly product notes, run from the five-minute cron. One D1 row per month is
 * both the guard and the record: the first tick of a month claims it, drafts
 * from the previous month's app changes, and notifies the owner. Later ticks
 * only retry a failed draft (three attempts) or an unsent notification.
 *
 * Off by default and inert until configured: with the flag off it touches
 * nothing, and with the flag on but a setting missing it logs once per isolate.
 * With PRODUCT_NOTES_AUTOSEND on, the draft also goes to Sequenzy and is
 * scheduled two hours out, which the owner can still cancel there.
 */
export async function runMonthlyProductNotes(
  env: ProductNotesEnv,
  {
    now = Date.now(),
    request = fetch as typeof fetch,
    website = undefined as typeof fetch | undefined,
  } = {},
) {
  if (env.PRODUCT_NOTES_ENABLED !== 'true') return 'disabled';
  const missing = productNotesMissing(env);
  if (missing.length) {
    if (!reportedInactive)
      console.log(JSON.stringify({ event: 'product_notes_inactive', missing }));
    reportedInactive = true;
    return 'unconfigured';
  }
  const month = previousMonth(now);
  const row = await env.DB.prepare(
    'SELECT state,attempts,next_at,notified_at,notify_attempts,draft,reason,campaign_url FROM product_note_drafts WHERE month=?',
  )
    .bind(month.month)
    .first<Row>();
  if (row && ['ready', 'handed_off'].includes(row.state)) {
    if (!row.notified_at && row.notify_attempts < MAX_NOTIFY_ATTEMPTS && row.draft)
      await notifyOwner(env, month, row, request, now);
    return row.state;
  }
  if (row && !['failed', 'drafting'].includes(row.state)) return row.state;
  if (row && (row.attempts >= MAX_ATTEMPTS || row.next_at > now)) return 'waiting';

  const claimed = await env.DB.prepare(
    "INSERT INTO product_note_drafts(month,state,attempts,next_at,created_at,updated_at) VALUES(?,'drafting',1,?,?,?) ON CONFLICT(month) DO UPDATE SET state='drafting',attempts=attempts+1,next_at=excluded.next_at,updated_at=excluded.updated_at WHERE state IN ('failed','drafting') AND attempts<? AND next_at<=? RETURNING attempts",
  )
    .bind(month.month, now + 15 * 60000, now, now, MAX_ATTEMPTS, now)
    .first<{ attempts: number }>();
  if (!claimed) return 'waiting';

  let stage = 'changelog';
  try {
    const entries = await changelogEntries(env, website);
    const candidates = monthlyCandidates(entries, month);
    if (!candidates.length) {
      await env.DB.prepare(
        "UPDATE product_note_drafts SET state='skipped',reason='no_app_changes',candidates='[]',updated_at=? WHERE month=?",
      )
        .bind(now, month.month)
        .run();
      console.log(JSON.stringify({ event: 'product_notes_skipped', month: month.month }));
      return 'skipped';
    }
    stage = 'draft';
    const { draft, model } = await composeDraft(env, month, candidates, request);
    stage = 'store';
    await env.DB.prepare(
      "UPDATE product_note_drafts SET state='ready',draft=?,candidates=?,model=?,reason=NULL,updated_at=? WHERE month=?",
    )
      .bind(
        JSON.stringify(draft),
        JSON.stringify(candidates.map((candidate) => candidate.id)),
        model,
        now,
        month.month,
      )
      .run();
    const stored: Row = {
      state: 'ready',
      attempts: claimed.attempts,
      next_at: 0,
      notified_at: null,
      notify_attempts: 0,
      draft: JSON.stringify(draft),
      reason: null,
      campaign_url: null,
    };
    if (env.PRODUCT_NOTES_AUTOSEND === 'true')
      Object.assign(stored, await autosend(env, month, draft, entries, request, now));
    await notifyOwner(env, month, stored, request, now);
    console.log(JSON.stringify({ event: 'product_notes_ready', month: month.month, model }));
    return stored.state;
  } catch (error) {
    const reason = error instanceof DraftError ? error.message : `${stage}_failed`;
    await env.DB.prepare(
      "UPDATE product_note_drafts SET state='failed',reason=?,next_at=?,updated_at=? WHERE month=?",
    )
      .bind(reason, now + claimed.attempts * 3600000, now, month.month)
      .run();
    console.log(
      JSON.stringify({
        event: 'product_notes_failed',
        month: month.month,
        reason,
        attempt: claimed.attempts,
      }),
    );
    return 'failed';
  }
}

/**
 * Hands the draft to Sequenzy and schedules it. A failure leaves the draft
 * ready in the composer, so the owner still reviews and sends it by hand.
 */
async function autosend(
  env: ProductNotesEnv,
  month: Month,
  draft: Broadcast,
  entries: ChangelogEntry[],
  request: typeof fetch,
  now: number,
): Promise<Partial<Row>> {
  let campaign: Awaited<ReturnType<typeof createBroadcastDraft>>;
  try {
    campaign = await createBroadcastDraft(env, draft, entries, request, now);
  } catch {
    await env.DB.prepare('UPDATE product_note_drafts SET reason=? WHERE month=?')
      .bind('autosend_failed', month.month)
      .run();
    return { reason: 'autosend_failed' };
  }
  let reason: string | null = null;
  try {
    if (!campaign.id) throw new Error('campaign_without_id');
    const response = await request(
      `https://api.sequenzy.com/api/v1/campaigns/${encodeURIComponent(campaign.id)}/schedule`,
      {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${env.SEQUENZY_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ scheduledAt: new Date(now + AUTOSEND_DELAY).toISOString() }),
      },
    );
    const result = await providerJson(response);
    if (result.success !== true) throw new Error('schedule_rejected');
  } catch {
    reason = 'schedule_failed';
  }
  await env.DB.prepare(
    "UPDATE product_note_drafts SET state='handed_off',campaign_id=?,campaign_url=?,reason=? WHERE month=?",
  )
    .bind(campaign.id, campaign.url, reason, month.month)
    .run();
  return { state: 'handed_off', campaign_url: campaign.url, reason };
}

/** Plain notice to the owner that a draft is waiting, with a link to the composer. */
function ownerNotice(
  env: ProductNotesEnv,
  month: Month,
  row: Pick<Row, 'state' | 'draft' | 'reason' | 'campaign_url'>,
) {
  const draft = row.draft ? broadcastSchema.safeParse(JSON.parse(row.draft)) : null;
  const subject = draft?.success ? draft.data.subject : '';
  const scheduled = row.state === 'handed_off' && !row.reason;
  const lines = [
    scheduled
      ? `The ${month.label} product notes are scheduled in Sequenzy to go out in about two hours. Open the campaign there to change or cancel it.`
      : row.state === 'handed_off'
        ? `The ${month.label} product notes are a draft in Sequenzy, but scheduling failed. Open it there to review and send.`
        : `Claude drafted the ${month.label} product notes. Nothing has been sent. Open the composer to review, edit and create the Sequenzy draft.`,
    subject ? `Subject: ${subject}` : '',
  ].filter(Boolean);
  const link =
    row.state === 'handed_off' && row.campaign_url?.startsWith('https://')
      ? { label: 'Open in Sequenzy', url: row.campaign_url }
      : env.PRODUCT_NOTES_ADMIN_URL?.startsWith('https://')
        ? { label: 'Review the draft', url: env.PRODUCT_NOTES_ADMIN_URL }
        : null;
  const content = `<h1 class="lead-title" style="margin:0 0 22px;font-size:32px;line-height:1.1;letter-spacing:-1px;font-weight:600;color:${c.ink}">${escapeHtml(`${month.label} product notes`)}</h1>
${lines.map((line) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.75;color:${c.muted}">${escapeHtml(line)}</p>`).join('')}
${link ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 0"><tr><td>${button(link.label, link.url, { arrow: true })}</td></tr></table>` : ''}`;
  const title = scheduled
    ? `${month.label} product notes are scheduled`
    : `${month.label} product notes are ready to review`;
  return {
    subject: title,
    body: emailShell({
      subject: title,
      preheader: lines[0] ?? title,
      origin: env.ACCESS_WEB_ORIGIN,
      content,
      footer: 'Sent to the Jackalope admin because monthly product notes are turned on.',
    }),
  };
}

async function notifyOwner(
  env: ProductNotesEnv,
  month: Month,
  row: Row,
  request: typeof fetch,
  now: number,
) {
  try {
    const notice = ownerNotice(env, month, row);
    const response = await request('https://api.sequenzy.com/api/v1/transactional/send', {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${env.SEQUENZY_API_KEY}`,
        'content-type': 'application/json',
        'Idempotency-Key': `product-notes:${month.month}`,
      },
      body: JSON.stringify({
        to: env.ADMIN_EMAIL,
        from: env.ACCESS_EMAIL_FROM,
        replyTo: env.ACCESS_EMAIL_REPLY_TO,
        subject: notice.subject,
        body: notice.body,
        trackingSettings: { openTracking: false, clickTracking: false },
      }),
    });
    if (!(await providerJson(response)).success) throw new Error('mail_provider_rejected');
    await env.DB.prepare('UPDATE product_note_drafts SET notified_at=? WHERE month=?')
      .bind(now, month.month)
      .run();
  } catch {
    await env.DB.prepare(
      'UPDATE product_note_drafts SET notify_attempts=notify_attempts+1 WHERE month=?',
    )
      .bind(month.month)
      .run();
  }
}

/** The newest monthly draft, for the composer. */
export async function latestProductNote(env: ProductNotesEnv) {
  const row = await env.DB.prepare(
    'SELECT month,state,draft,model,reason,updated_at,campaign_url FROM product_note_drafts ORDER BY month DESC LIMIT 1',
  ).first<{
    month: string;
    state: string;
    draft: string | null;
    model: string | null;
    reason: string | null;
    updated_at: number;
    campaign_url: string | null;
  }>();
  const parsed = row?.draft ? broadcastSchema.safeParse(JSON.parse(row.draft)) : null;
  return {
    enabled: env.PRODUCT_NOTES_ENABLED === 'true' && !productNotesMissing(env).length,
    autosend: env.PRODUCT_NOTES_AUTOSEND === 'true',
    latest: row
      ? {
          month: row.month,
          state: row.state,
          draft: parsed?.success ? parsed.data : null,
          model: row.model,
          reason: row.reason,
          updatedAt: row.updated_at,
          campaignUrl: row.campaign_url,
        }
      : null,
  };
}
