import { z } from 'zod';
import { tokenHash } from './crypto';

const choices = <T extends string>(values: [T, ...T[]]) =>
  z
    .array(z.enum(values))
    .max(values.length)
    .transform((items) => [...new Set(items)]);
export const preferencesSchema = z.strictObject({
  platforms: choices(['macos', 'windows', 'linux']),
  agents: choices([
    'codex',
    'claude',
    'opencode',
    'grok',
    'antigravity',
    'cursor',
    'gemini',
    'other',
    'exploring',
  ]),
  priorities: choices(['parallel', 'review', 'context', 'accounts', 'recurring', 'remote']),
});
const campaignValue = z
  .string()
  .max(80)
  .regex(/^[a-zA-Z0-9_.-]*$/);
export const campaignSchema = z.strictObject({
  source: campaignValue.optional(),
  medium: campaignValue.optional(),
  campaign: campaignValue.optional(),
  landing: z
    .string()
    .max(180)
    .regex(/^\/[a-zA-Z0-9/_-]*$/),
});

export async function savePreferences(
  env: Env,
  token: string,
  preferences: z.infer<typeof preferencesSchema>,
  now = Date.now(),
) {
  const result = await env.DB.prepare(
    "UPDATE access_members SET preferences=?,survey_hash=NULL,survey_expires_at=NULL WHERE survey_hash=? AND survey_expires_at>? AND status!='revoked'",
  )
    .bind(JSON.stringify(preferences), await tokenHash(token), now)
    .run();
  return result.meta.changes === 1;
}

export async function waitlistInsights(env: Env) {
  const [totals, platforms, agents, priorities, sources] = await Promise.all([
    env.DB.prepare(
      "SELECT count(*) AS requested,count(preferences) AS responded,sum(status='approved') AS approved,sum(first_desktop_at IS NOT NULL) AS connected FROM access_members WHERE status!='revoked'",
    ).first(),
    ...['platforms', 'agents', 'priorities'].map((field) =>
      env.DB.prepare(
        `SELECT j.value AS label,count(*) AS count FROM access_members m,json_each(m.preferences,'$.${field}') j WHERE m.status!='revoked' GROUP BY j.value ORDER BY count DESC,label`,
      ).all(),
    ),
    env.DB.prepare(
      "SELECT coalesce(json_extract(campaign,'$.source'),'direct-or-unknown') AS label,count(*) AS count FROM access_members WHERE status!='revoked' GROUP BY label ORDER BY count DESC,label LIMIT 20",
    ).all(),
  ]);
  return {
    totals,
    platforms: platforms.results,
    agents: agents.results,
    priorities: priorities.results,
    sources: sources.results,
  };
}
