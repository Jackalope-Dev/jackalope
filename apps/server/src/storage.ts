import type { Feedback, Telemetry } from './contracts';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function retentionDays(value: string): number {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('invalid_retention');
  return days;
}
export async function saveTelemetry(env: Env, data: Telemetry, now = Date.now()) {
  const expires = now + retentionDays(env.TELEMETRY_DAYS) * 86400000;
  const statements = await Promise.all(
    data.events.map(async (event) => {
      const payload = JSON.stringify(canonical(event));
      return env.DB.prepare(
        'INSERT INTO events(install_id,id,received_at,expires_at,hash,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(install_id,id) DO UPDATE SET hash=excluded.hash WHERE hash<>excluded.hash',
      ).bind(data.installId, event.id, now, expires, await digest(payload), payload);
    }),
  );
  await env.DB.batch(statements);
  return { accepted: data.events.length };
}
export async function saveFeedback(env: Env, data: Feedback, now = Date.now()) {
  const payload = JSON.stringify(canonical(data));
  await env.DB.prepare(
    'INSERT INTO feedback(id,received_at,expires_at,hash,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash WHERE hash<>excluded.hash',
  )
    .bind(
      data.id,
      now,
      now + retentionDays(env.FEEDBACK_DAYS) * 86400000,
      await digest(payload),
      payload,
    )
    .run();
  return { accepted: true, id: data.id };
}
export async function prune(env: Env, now = Date.now()) {
  let events = 0;
  let feedback = 0;
  for (let batch = 0; batch < 20; batch++) {
    const result = await env.DB.batch([
      env.DB.prepare(
        'DELETE FROM events WHERE rowid IN (SELECT rowid FROM events WHERE expires_at <= ? LIMIT 5000) RETURNING 1',
      ).bind(now),
      env.DB.prepare(
        'DELETE FROM feedback WHERE id IN (SELECT id FROM feedback WHERE expires_at <= ? LIMIT 5000) RETURNING 1',
      ).bind(now),
    ]);
    events += result[0].results.length;
    feedback += result[1].results.length;
    if (result.every((value) => value.results.length === 0)) break;
  }
  return { events, feedback };
}
