import { z } from 'zod';
import { AccessError } from './service';

export const syncedSettingsSchema = z.strictObject({
  version: z.literal(1),
  accentHex: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  isDark: z.boolean(),
  appearance: z.enum(['manual', 'automatic']),
  atmosphere: z.number().min(0).max(64),
  harmony: z.enum(['single', 'duo', 'trio']),
  mascotReactions: z.boolean(),
  notifications: z.enum(['all', 'failures-only', 'none']),
  osNotifications: z.boolean(),
});

export async function settingsRoute(
  env: Env,
  memberId: string,
  deviceId: string,
  method: string,
  body?: unknown,
) {
  if (method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('UPDATE access_devices SET settings_sync=0 WHERE member_id=?').bind(memberId),
      env.DB.prepare('DELETE FROM access_settings WHERE member_id=?').bind(memberId),
    ]);
    return { revision: 0, settings: null };
  }
  const consent = await env.DB.prepare(
    'SELECT id FROM access_devices WHERE id=? AND member_id=? AND settings_sync=1',
  )
    .bind(deviceId, memberId)
    .first();
  if (!consent) throw new AccessError(403, 'settings_sync_disabled');
  if (method === 'PUT') {
    const { revision, settings } = z
      .strictObject({
        revision: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER - 1),
        settings: syncedSettingsSchema,
      })
      .parse(body);
    const changed = await env.DB.prepare(
      `INSERT INTO access_settings(member_id,revision,settings,updated_at)
       SELECT ?,1,?,? WHERE ?=0 AND EXISTS(SELECT 1 FROM access_devices WHERE id=? AND member_id=? AND settings_sync=1)
       ON CONFLICT(member_id) DO NOTHING RETURNING revision,settings`,
    )
      .bind(memberId, JSON.stringify(settings), Date.now(), revision, deviceId, memberId)
      .first<{ revision: number; settings: string }>();
    if (!changed) {
      const updated = await env.DB.prepare(
        `UPDATE access_settings SET revision=revision+1,settings=?,updated_at=? WHERE member_id=? AND revision=?
         AND EXISTS(SELECT 1 FROM access_devices WHERE id=? AND member_id=? AND settings_sync=1) RETURNING revision,settings`,
      )
        .bind(JSON.stringify(settings), Date.now(), memberId, revision, deviceId, memberId)
        .first<{ revision: number; settings: string }>();
      if (!updated) throw new AccessError(409, 'settings_conflict');
      return { revision: updated.revision, settings: JSON.parse(updated.settings) };
    }
    return { revision: changed.revision, settings: JSON.parse(changed.settings) };
  } else if (method !== 'GET') {
    throw new AccessError(405, 'method_not_allowed');
  }
  const row = await env.DB.prepare(
    'SELECT revision,settings FROM access_settings WHERE member_id=?',
  )
    .bind(memberId)
    .first<{ revision: number; settings: string }>();
  return row
    ? { revision: row.revision, settings: syncedSettingsSchema.parse(JSON.parse(row.settings)) }
    : { revision: 0, settings: null };
}
