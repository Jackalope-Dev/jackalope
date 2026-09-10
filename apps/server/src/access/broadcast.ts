import { EMAIL_PALETTE } from '@jackalope/brand/email';
import { z } from 'zod';
import { MANAGED_TAGS } from './audience';
import { button, emailShell, escapeHtml } from './mail-templates';
import { providerJson } from './provider';

const c = EMAIL_PALETTE;

/** Shape of one entry in the website's published product-notes feed. */
const entrySchema = z.object({
  id: z.string().max(120),
  date: z.string().max(40),
  status: z.string().max(60).optional(),
  title: z.string().max(200),
  description: z.string().max(1000),
  items: z.array(z.string().max(400)).max(30).optional(),
  note: z.string().max(400).optional(),
});
export type ChangelogEntry = z.infer<typeof entrySchema>;

export const broadcastSchema = z.strictObject({
  subject: z.string().trim().min(3).max(150),
  preview: z.string().trim().max(150).default(''),
  headline: z.string().trim().min(3).max(120),
  intro: z.string().trim().max(1200).default(''),
  outro: z.string().trim().max(1200).default(''),
  entries: z.array(z.string().max(120)).max(12).default([]),
  /** Free-form additions that are not in the changelog. */
  extras: z
    .array(z.strictObject({ title: z.string().trim().max(200), body: z.string().trim().max(800) }))
    .max(6)
    .default([]),
  action: z
    .strictObject({
      label: z.string().trim().max(60),
      // https only: the preview renders this href in a real browser tab, so a
      // javascript: or data: URL composed here would run there.
      url: z.url({ protocol: /^https$/, hostname: z.regexes.domain }).max(300),
    })
    .nullish(),
  /** Narrows the audience to members carrying this managed tag. */
  tag: z
    .string()
    .max(60)
    .refine((value) => !value || (MANAGED_TAGS as readonly string[]).includes(value))
    .default(''),
});
export type Broadcast = z.infer<typeof broadcastSchema>;

/**
 * Reads the product notes the website publishes, so the composer and the public
 * changelog can never disagree about what shipped.
 */
export async function changelogEntries(
  env: Env,
  request = env.ACCESS_WEBSITE?.fetch.bind(env.ACCESS_WEBSITE) ?? fetch,
): Promise<ChangelogEntry[]> {
  try {
    const response = await request(`${env.ACCESS_WEB_ORIGIN}/changelog.json`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error('changelog_unavailable');
    return z
      .array(entrySchema)
      .max(400)
      .parse(await response.json());
  } catch {
    throw new Error('changelog_unavailable');
  }
}

const paragraphs = (text: string, size = 16) =>
  text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="margin:0 0 16px;font-size:${size}px;line-height:1.75;color:${c.muted}">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');

/** One ruled section of the note. Used for changelog entries and free additions alike. */
function section({
  stamp,
  title,
  body,
  items = [],
  note,
}: {
  stamp?: string;
  title: string;
  body: string;
  items?: string[];
  note?: string;
}) {
  const bullets = items
    .map(
      (item) =>
        `<li style="margin:0 0 8px;font-size:15px;line-height:1.7;color:${c.muted}">${escapeHtml(item)}</li>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px"><tr><td style="padding-top:24px;border-top:1px solid ${c.borderSubtle}">
${stamp ? `<p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${c.faint}">${escapeHtml(stamp)}</p>` : ''}
<h2 style="margin:0 0 10px;font-size:22px;line-height:1.25;letter-spacing:-.4px;font-weight:600;color:${c.ink}">${escapeHtml(title)}</h2>
${body ? paragraphs(body) : ''}
${bullets ? `<ul style="margin:${body ? '14px' : '0'} 0 0;padding-left:20px">${bullets}</ul>` : ''}
${note ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.7;color:${c.faint}">${escapeHtml(note)}</p>` : ''}
</td></tr></table>`;
}

const entryHtml = (entry: ChangelogEntry) =>
  section({
    stamp: entry.status,
    title: entry.title,
    body: entry.description,
    items: entry.items ?? [],
    note: entry.note,
  });

/**
 * Renders a product note through the same shell as every access email, so a
 * broadcast and a sign-in link arrive looking like the same studio wrote them.
 */
export function broadcastEmail(draft: Broadcast, entries: ChangelogEntry[], origin: string) {
  const chosen = draft.entries
    .map((id) => entries.find((entry) => entry.id === id))
    .filter((entry): entry is ChangelogEntry => !!entry);
  const extras = draft.extras
    .filter((extra) => extra.title || extra.body)
    .map((extra) => section({ title: extra.title || 'One more thing', body: extra.body }))
    .join('');

  const action = draft.action?.label && draft.action.url ? draft.action : null;
  const content = `<h1 class="lead-title" style="margin:0 0 22px;font-size:40px;line-height:1.08;letter-spacing:-1.4px;font-weight:600;color:${c.ink}">${escapeHtml(draft.headline)}</h1>
${draft.intro ? paragraphs(draft.intro, 17) : ''}
<div style="height:12px;line-height:12px">&nbsp;</div>
${chosen.map(entryHtml).join('')}${extras}
${draft.outro ? paragraphs(draft.outro) : ''}
${
  action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 0"><tr><td>${button(action.label, action.url, { arrow: true })}</td></tr></table>`
    : ''
}
<p style="margin:30px 0 0;font-size:15px;line-height:1.8;color:${c.muted}">Thanks for making room for Jackalope,<br><strong style="color:${c.ink}">Jackalope</strong></p>`;

  return {
    subject: draft.subject,
    preview: draft.preview || draft.intro.split('\n')[0] || draft.headline,
    html: emailShell({
      subject: draft.subject,
      preheader: draft.preview || draft.intro.split('\n')[0] || draft.headline,
      origin,
      content,
      // Sequenzy appends the required unsubscribe link to campaign sends.
      footer:
        'You are receiving this because you asked for Jackalope product notes when you joined the waitlist. {{unsubscribe_link}}',
    }),
  };
}

/**
 * Hands the composed note to Sequenzy as a draft campaign.
 *
 * It is deliberately never sent from here: the draft lands in the dashboard
 * with its audience and sender already set, and a person presses send after
 * reading it. That keeps one irreversible, outward-facing step behind a human.
 */
export async function createBroadcastDraft(
  env: Env,
  draft: Broadcast,
  entries: ChangelogEntry[],
  request = fetch,
  now = Date.now(),
) {
  const composed = broadcastEmail(draft, entries, env.ACCESS_WEB_ORIGIN);
  const audience = draft.tag
    ? {
        type: 'filtered',
        filterJoinOperator: 'and',
        filters: [
          { id: 'list', field: 'list', operator: 'is', value: env.ACCESS_AUDIENCE_LIST },
          { id: 'tag', field: 'tag', operator: 'contains', value: draft.tag },
        ],
      }
    : { type: 'lists', listIds: [env.ACCESS_AUDIENCE_LIST] };

  const response = await request('https://api.sequenzy.com/api/v1/campaigns', {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${env.SEQUENZY_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: `Product notes · ${new Date(now).toISOString().slice(0, 10)} · ${draft.headline}`.slice(
        0,
        120,
      ),
      subject: composed.subject,
      previewText: composed.preview,
      html: composed.html,
      status: 'draft',
      targetLists: audience,
      fromEmail: env.ACCESS_EMAIL_FROM.replace(/^.*<|>$/g, ''),
      replyTo: env.ACCESS_EMAIL_REPLY_TO,
      labels: ['product-notes'],
    }),
  });
  const result = await providerJson(response);
  if (result.success !== true) throw new Error('broadcast_rejected');
  const campaign = (result.campaign ?? {}) as Record<string, unknown>;
  return {
    id: typeof campaign.id === 'string' ? campaign.id : null,
    url: typeof campaign.url === 'string' ? campaign.url : null,
    recipients: typeof campaign.recipientCount === 'number' ? campaign.recipientCount : null,
  };
}
