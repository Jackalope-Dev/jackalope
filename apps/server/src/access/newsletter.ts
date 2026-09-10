import { audienceEligible, audienceState, MANAGED_TAGS, type MemberRow } from './audience';
import { providerJson } from './provider';

const RECONCILE_INTERVAL = 6 * 3600000;
const COLUMNS =
  'email,status,source,newsletter,newsletter_confirmed_at,created_at,approved_at,verified_at,waitlist_verified_at,first_download_at,first_desktop_at,referral_count,waitlist_referrer_id,invited_by,preferences,campaign';

export async function syncNewsletter(env: Env, request = fetch, now = Date.now()) {
  if (env.EARLY_ACCESS_ENABLED !== 'true' || !env.SEQUENZY_API_KEY || !env.ACCESS_AUDIENCE_LIST)
    return;
  const rows = await env.DB.prepare(
    `SELECT id FROM access_members WHERE newsletter_next_at<=? AND newsletter_attempts<5
       AND (sequenzy_state IS NOT NULL OR (newsletter=1 AND newsletter_confirmed_at IS NOT NULL AND status!='revoked'))
     ORDER BY newsletter_next_at LIMIT 10`,
  )
    .bind(now)
    .all<{ id: string }>();

  await Promise.all(
    rows.results.map(async ({ id }) => {
      const member = await env.DB.prepare(
        `UPDATE access_members SET newsletter_attempts=newsletter_attempts+1,newsletter_next_at=?
         WHERE id=? AND newsletter_next_at<=? AND newsletter_attempts<5
         RETURNING ${COLUMNS},sequenzy_state,newsletter_attempts`,
      )
        .bind(now + 300000, id, now)
        .first<MemberRow & { sequenzy_state: string | null; newsletter_attempts: number }>();
      if (!member) return;

      const eligible = audienceEligible(member);
      // Refresh snapshots recorded before existing provider contacts were updated.
      const desired = eligible
        ? JSON.stringify({ ...audienceState(member), syncVersion: 2 })
        : null;
      const settle = (next: number) =>
        env.DB.prepare(
          'UPDATE access_members SET newsletter_next_at=?,newsletter_attempts=0,newsletter_synced_at=?,sequenzy_state=? WHERE id=?',
        ).bind(next, eligible ? now : null, desired, id);

      // Nothing changed since the last push, so spend no provider call on it.
      if (desired === member.sequenzy_state) {
        await env.DB.prepare(
          'UPDATE access_members SET newsletter_next_at=?,newsletter_attempts=0 WHERE id=?',
        )
          .bind(now + RECONCILE_INTERVAL, id)
          .run();
        return;
      }

      try {
        const state = eligible ? audienceState(member) : null;
        const send = async (method: string, path: string, body: unknown) => {
          const response = await request(`https://api.sequenzy.com/api/v1/subscribers${path}`, {
            method,
            redirect: 'manual',
            signal: AbortSignal.timeout(15000),
            headers: {
              Authorization: `Bearer ${env.SEQUENZY_API_KEY}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(body),
          });
          const result = await providerJson(response);
          if (result.success !== true) throw new Error('audience_rejected');
          return result;
        };
        const path = `/${encodeURIComponent(member.email)}`;
        if (state) {
          const result = await send('POST', '', {
            email: member.email,
            tags: state.tags,
            customAttributes: state.attributes,
            lists: [env.ACCESS_AUDIENCE_LIST],
            duplicateStrategy: 'merge',
            // The single-use email link confirms this specific newsletter request.
            optInMode: 'confirmed',
            enrollInSequences: false,
          });
          const subscriber = result.subscriber as { tags?: unknown } | undefined;
          if (
            !Array.isArray(subscriber?.tags) ||
            subscriber.tags.some((tag) => typeof tag !== 'string')
          )
            throw new Error('audience_response_invalid');
          const previous = member.sequenzy_state ? JSON.parse(member.sequenzy_state) : null;
          const cleared = Object.fromEntries(
            Object.keys(previous?.attributes ?? {}).map((key) => [key, null]),
          );
          await send('PATCH', path, {
            tags: [
              ...new Set([
                ...subscriber.tags.filter(
                  (tag: string) => !MANAGED_TAGS.some((managed) => managed === tag),
                ),
                ...state.tags,
              ]),
            ],
            customAttributes: { ...cleared, ...state.attributes },
            customAttributesStrategy: 'merge',
          });
        } else {
          await send('PATCH', path, { status: 'unsubscribed' });
        }
        await settle(now + RECONCILE_INTERVAL).run();
      } catch {
        console.error('access_audience_sync_failed', { attempt: member.newsletter_attempts });
        await env.DB.prepare('UPDATE access_members SET newsletter_next_at=? WHERE id=?')
          .bind(now + Math.min(3600000, 60000 * 2 ** member.newsletter_attempts), id)
          .run();
      }
    }),
  );
}

/** Brings a member forward in the sweep after their state changes. */
export function markAudienceStale(env: Env, id: string) {
  return env.DB.prepare(
    'UPDATE access_members SET newsletter_next_at=0,newsletter_attempts=0 WHERE id=?',
  ).bind(id);
}
