import { z } from 'zod';
import { ServiceError } from '../errors';
import { CREDENTIAL } from './lessons';

const MAX = Number.MAX_SAFE_INTEGER - 1;
/** Synced skill rows per member, tombstones included. */
const SKILL_ROWS = 200;
/** Text a synced skill may hold across its files, in characters. */
const SKILL_CHARACTERS = 24_000;
const SKILL_FILES = 20;
const PAGE_SKILLS = 8;
const HOLDINGS = 2000;

const text = (max: number, min = 0) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((value) => !value.includes('\0') && !CREDENTIAL.test(value));
const counter = z.number().int().min(0).max(MAX);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
// A relative path of up to three parts; no part starts with a dot, so `..`,
// hidden files and absolute paths are impossible.
const filePath = z
  .string()
  .max(120)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*){0,2}$/);

const location = z
  .strictObject({
    scope: z.enum(['personal', 'project']),
    root: z.enum(['claude', 'codex', 'agents']),
    /** The project's root-commit key; never a folder or remote URL. */
    project: hash.nullable(),
    name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  })
  .refine((value) => (value.scope === 'project') === (value.project !== null));
const skillBody = z.strictObject({
  location,
  description: text(1024),
  files: z
    .array(z.strictObject({ path: filePath, content: text(SKILL_CHARACTERS) }))
    .min(1)
    .max(SKILL_FILES)
    .refine((files) => new Set(files.map((file) => file.path)).size === files.length)
    .refine((files) => files.some((file) => file.path === 'SKILL.md'))
    .refine(
      (files) => files.reduce((total, file) => total + file.content.length, 0) <= SKILL_CHARACTERS,
    ),
  hash,
});
const pushSchema = z
  .strictObject({
    epoch: counter.min(1),
    id: z.uuid(),
    /** The revision this device last exchanged; 0 for a new skill. */
    baseRevision: counter,
    deleted: z.boolean(),
    skill: skillBody.optional(),
  })
  .refine((value) => value.deleted === (value.skill === undefined))
  .refine((value) => !value.deleted || value.baseRevision > 0);
const pullSchema = z.strictObject({ epoch: counter, cursor: counter });
const haveSchema = z.strictObject({
  epoch: counter.min(1),
  have: z
    .array(z.strictObject({ id: z.uuid(), revision: counter.min(1) }))
    .max(SKILL_ROWS)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length),
});

type SkillRow = {
  id: string;
  revision: number;
  updated_at: number;
  deleted: number;
  body: string | null;
  seq: number;
};

const CONSENT =
  'EXISTS(SELECT 1 FROM access_devices d WHERE d.id=? AND d.member_id=m.id AND d.settings_sync=1)';

/**
 * Skills sync only from a device with settings sync consent, in the member's
 * current epoch. A write names the revision it replaces, so a device that
 * missed another device's change receives `conflict` and never overwrites it.
 */
/** A computer that stopped checking in this long ago, and holds nothing, isn't shown. */
const RECENT_DEVICE = 30 * 86400000;
const SHOWN_DEVICES = 10;
interface SkillDeviceRow {
  id: string;
  name: string | null;
  platform: string | null;
  machineKey: string | null;
  seen: number;
  settingsSync: number;
}
interface Holding {
  skill: string;
  device: string;
  revision: number;
}

/**
 * The computers skill sync involves, one entry per computer: connections sharing a machine
 * key are one computer, shown by the caller's connection or else its most recently seen one,
 * and their holdings move to that entry. A computer is shown when it is this one, holds a
 * synced skill, or has settings sync on and checked in recently. Old profiles, resets and
 * reconnects that never synced drop out. Each entry keeps the `{id,name,platform,here}` shape
 * shipped desktops parse strictly, and the machine key is never returned.
 */
export function skillDevices(
  rows: SkillDeviceRow[],
  holdings: Holding[],
  deviceId: string,
  now: number,
) {
  const held = new Set(holdings.map((holding) => holding.device));
  const computers = new Map<string, SkillDeviceRow[]>();
  for (const row of rows) {
    const key = row.machineKey ?? `device:${row.id}`;
    computers.set(key, [...(computers.get(key) ?? []), row]);
  }
  const shownAs = new Map<string, string>();
  const devices: { id: string; name: string | null; platform: string | null; here: boolean }[] = [];
  for (const connections of computers.values()) {
    const here = connections.some((row) => row.id === deviceId);
    const shown =
      here ||
      connections.some(
        (row) => held.has(row.id) || (row.settingsSync === 1 && row.seen > now - RECENT_DEVICE),
      );
    if (!shown) continue;
    // Rows arrive newest first, so the first is the most recently seen connection.
    const lead = connections.find((row) => row.id === deviceId) ?? connections[0];
    for (const row of connections) shownAs.set(row.id, lead.id);
    devices.push({
      id: lead.id,
      name: lead.name ?? connections.find((row) => row.name)?.name ?? null,
      platform: lead.platform ?? connections.find((row) => row.platform)?.platform ?? null,
      here,
    });
  }
  devices.sort((a, b) => Number(b.here) - Number(a.here));
  const kept = new Set(devices.slice(0, SHOWN_DEVICES).map((device) => device.id));
  const newest = new Map<string, Holding>();
  for (const holding of holdings) {
    const device = shownAs.get(holding.device);
    if (!device || !kept.has(device)) continue;
    const key = `${holding.skill}\n${device}`;
    const previous = newest.get(key);
    if (!previous || previous.revision < holding.revision)
      newest.set(key, { skill: holding.skill, device, revision: holding.revision });
  }
  return { devices: devices.slice(0, SHOWN_DEVICES), holdings: [...newest.values()] };
}

export async function skillsRoute(
  env: Env,
  memberId: string,
  deviceId: string,
  action: 'pull' | 'push' | 'have' | 'delete',
  body?: unknown,
  now = Date.now(),
) {
  if (action === 'delete') {
    await env.DB.batch(deleteSkillStatements(env, memberId));
    return { success: true };
  }
  const consent = await env.DB.prepare(
    'SELECT m.skill_epoch AS epoch FROM access_devices d JOIN access_members m ON m.id=d.member_id WHERE d.id=? AND d.member_id=? AND d.settings_sync=1',
  )
    .bind(deviceId, memberId)
    .first<{ epoch: number }>();
  if (!consent) throw new ServiceError(403, 'settings_sync_disabled');
  if (action === 'pull') {
    const { epoch, cursor } = pullSchema.parse(body);
    if (epoch !== 0 && epoch !== consent.epoch) throw new ServiceError(409, 'skills_reset');
    const rows = await env.DB.prepare(
      'SELECT id,revision,updated_at,deleted,body,seq FROM access_skills WHERE member_id=? AND seq>? ORDER BY seq LIMIT ?',
    )
      .bind(memberId, cursor, PAGE_SKILLS + 1)
      .all<SkillRow>();
    const more = rows.results.length > PAGE_SKILLS;
    const page = rows.results.slice(0, PAGE_SKILLS);
    return {
      epoch: consent.epoch,
      cursor: Math.max(cursor, ...page.map((row) => row.seq)),
      more,
      skills: page.map((row) => ({
        id: row.id,
        revision: row.revision,
        updatedAt: row.updated_at,
        deleted: row.deleted === 1,
        ...(row.body ? { skill: skillBody.parse(JSON.parse(row.body)) } : {}),
      })),
    };
  }
  if (action === 'have') {
    const { epoch, have } = haveSchema.parse(body);
    if (epoch !== consent.epoch) throw new ServiceError(409, 'skills_reset');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM access_skill_devices WHERE member_id=? AND device_id=?').bind(
        memberId,
        deviceId,
      ),
      env.DB.prepare(
        `INSERT INTO access_skill_devices(member_id,skill_id,device_id,revision)
         SELECT s.member_id,s.id,?,json_extract(j.value,'$.revision') FROM json_each(?) j
         JOIN access_skills s ON s.member_id=? AND s.id=json_extract(j.value,'$.id') AND s.deleted=0
         WHERE json_extract(j.value,'$.revision')<=s.revision`,
      ).bind(deviceId, JSON.stringify(have), memberId),
    ]);
    const [devices, holdings] = await Promise.all([
      env.DB.prepare(
        'SELECT id,name,platform,machine_key AS machineKey,coalesce(last_seen_at,created_at) AS seen,settings_sync AS settingsSync FROM access_devices WHERE member_id=? AND expires_at>? ORDER BY seen DESC,id LIMIT 50',
      )
        .bind(memberId, now)
        .all<SkillDeviceRow>(),
      env.DB.prepare(
        'SELECT skill_id AS skill,device_id AS device,revision FROM access_skill_devices WHERE member_id=? LIMIT ?',
      )
        .bind(memberId, HOLDINGS)
        .all<Holding>(),
    ]);
    return skillDevices(devices.results, holdings.results, deviceId, now);
  }
  const push = pushSchema.parse(body);
  if (push.epoch !== consent.epoch) throw new ServiceError(409, 'skills_reset');
  if (push.baseRevision === 0) {
    const rows = await env.DB.prepare(
      'SELECT count(*) AS total FROM access_skills WHERE member_id=?',
    )
      .bind(memberId)
      .first<{ total: number }>();
    if ((rows?.total ?? 0) >= SKILL_ROWS) throw new ServiceError(413, 'skills_full');
  }
  const revision = push.baseRevision + 1;
  const base =
    push.baseRevision === 0
      ? 'NOT EXISTS(SELECT 1 FROM access_skills s WHERE s.member_id=m.id AND s.id=?)'
      : 'EXISTS(SELECT 1 FROM access_skills s WHERE s.member_id=m.id AND s.id=? AND s.revision=?)';
  const baseValues = push.baseRevision === 0 ? [push.id] : [push.id, push.baseRevision];
  const guard = `m.id=? AND m.skill_epoch=? AND ${CONSENT} AND ${base}`;
  const guardValues = [memberId, push.epoch, deviceId, ...baseValues];
  const [counter] = await env.DB.batch([
    env.DB.prepare(`UPDATE access_members AS m SET skill_seq=skill_seq+1 WHERE ${guard}`).bind(
      ...guardValues,
    ),
    env.DB.prepare(
      `INSERT INTO access_skills(member_id,id,revision,updated_at,deleted,body,seq)
       SELECT m.id,?,?,?,?,?,m.skill_seq FROM access_members m WHERE ${guard}
       ON CONFLICT(member_id,id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at,
       deleted=excluded.deleted,body=excluded.body,seq=excluded.seq WHERE access_skills.revision=?`,
    ).bind(
      push.id,
      revision,
      now,
      push.deleted ? 1 : 0,
      push.skill ? JSON.stringify(push.skill) : null,
      ...guardValues,
      push.baseRevision,
    ),
    push.deleted
      ? env.DB.prepare(
          'DELETE FROM access_skill_devices WHERE member_id=? AND skill_id=? AND EXISTS(SELECT 1 FROM access_skills WHERE member_id=? AND id=? AND revision=? AND deleted=1)',
        ).bind(memberId, push.id, memberId, push.id, revision)
      : env.DB.prepare(
          `INSERT INTO access_skill_devices(member_id,skill_id,device_id,revision)
           SELECT member_id,id,?,revision FROM access_skills WHERE member_id=? AND id=? AND revision=? AND updated_at=?
           ON CONFLICT(member_id,skill_id,device_id) DO UPDATE SET revision=excluded.revision`,
        ).bind(deviceId, memberId, push.id, revision, now),
  ]);
  if (counter.meta.changes === 1) return { status: 'stored', revision, updatedAt: now };
  const current = await env.DB.prepare(
    'SELECT m.skill_epoch AS epoch,(SELECT revision FROM access_skills WHERE member_id=m.id AND id=?) AS revision FROM access_members m WHERE m.id=?',
  )
    .bind(push.id, memberId)
    .first<{ epoch: number; revision: number | null }>();
  if (!current || current.epoch !== push.epoch) throw new ServiceError(409, 'skills_reset');
  return { status: 'conflict', revision: current.revision ?? 0 };
}

/** Removes synced skills and device holdings and moves the member to a new epoch. */
export function deleteSkillStatements(env: Env, memberId: string) {
  return [
    env.DB.prepare('DELETE FROM access_skills WHERE member_id=?').bind(memberId),
    env.DB.prepare('DELETE FROM access_skill_devices WHERE member_id=?').bind(memberId),
    env.DB.prepare('UPDATE access_members SET skill_epoch=skill_epoch+1 WHERE id=?').bind(memberId),
  ];
}
