import { z } from 'zod';
import { AccessError } from './service';

const MAX = Number.MAX_SAFE_INTEGER - 1;
/** Synced lesson rows per member, tombstones included. */
const LESSON_ROWS = 2000;
/** History records kept per member; older ones are pruned on upload. */
const RECORD_ROWS = 4000;
const PAGE_LESSONS = 40;
const PAGE_RECORDS = 100;

// The desktop never sends these; refusing them keeps a faulty client from
// storing an obvious credential.
const CREDENTIAL =
  /-----BEGIN [A-Z ]*PRIVATE KEY|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_\w{20,}|\bsk-[A-Za-z0-9_-]{20,}|\bxox[abps]-[A-Za-z0-9-]{10,}/;
const text = (max: number, min = 0) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((value) => !value.includes('\0') && !CREDENTIAL.test(value));
const slug = z.string().regex(/^[a-z-]{1,24}$/);
const project = z.string().regex(/^[a-f0-9]{64}$/);
const counter = z.number().int().min(0).max(MAX);

const lessonBody = z.strictObject({
  title: text(120, 1).refine((value) => !/[\r\n]/.test(value) && value.trim().length > 0),
  content: text(800, 1),
  keywords: z.array(text(60, 2)).max(10),
  enabled: z.boolean(),
  kind: slug,
  status: z.enum(['probation', 'active', 'archived']),
  statement: text(500),
  origin: slug,
  bornAt: text(40),
  archivedReason: slug.nullable().default(null),
  managed: z.boolean(),
  distinct: z.boolean().default(false),
});
const lesson = z
  .strictObject({
    id: z.uuid(),
    project,
    revision: counter.min(1),
    updatedAt: counter,
    deleted: z.boolean(),
    lesson: lessonBody.optional(),
  })
  .refine((value) => value.deleted === (value.lesson === undefined));
const record = z.strictObject({
  id: z.uuid(),
  entryId: z.uuid(),
  project,
  at: text(40),
  action: z.enum([
    'born',
    'merged',
    'patched',
    'retired',
    'promoted',
    'archived',
    'restored',
    'edited',
    'deleted',
    'curated',
  ]),
  reason: text(400),
  revision: counter,
  origin: slug,
  title: text(120),
});
const unique = (items: { id: string }[]) =>
  new Set(items.map((item) => item.id)).size === items.length;
const pushSchema = z.strictObject({
  epoch: counter.min(1),
  lessons: z.array(lesson).max(25).refine(unique),
  records: z.array(record).max(100).refine(unique),
});
const pullSchema = z.strictObject({ epoch: counter, cursor: counter });

type LessonRow = {
  id: string;
  project: string;
  revision: number;
  updated_at: number;
  deleted: number;
  body: string | null;
  seq: number;
};

// Uploads are accepted only from a device with settings sync consent, in the
// member's current epoch.
const GUARD =
  'FROM access_members m WHERE m.id=? AND m.lesson_epoch=? AND EXISTS(SELECT 1 FROM access_devices d WHERE d.id=? AND d.member_id=m.id AND d.settings_sync=1)';

export async function lessonsRoute(
  env: Env,
  memberId: string,
  deviceId: string,
  action: 'pull' | 'push' | 'delete',
  body?: unknown,
) {
  if (action === 'delete') {
    await deleteLessons(env, memberId);
    return { success: true };
  }
  const consent = await env.DB.prepare(
    'SELECT m.lesson_epoch AS epoch FROM access_devices d JOIN access_members m ON m.id=d.member_id WHERE d.id=? AND d.member_id=? AND d.settings_sync=1',
  )
    .bind(deviceId, memberId)
    .first<{ epoch: number }>();
  if (!consent) throw new AccessError(403, 'settings_sync_disabled');
  if (action === 'pull') {
    const { epoch, cursor } = pullSchema.parse(body);
    if (epoch !== 0 && epoch !== consent.epoch) throw new AccessError(409, 'lessons_reset');
    const [lessons, records] = await Promise.all([
      env.DB.prepare(
        'SELECT id,project,revision,updated_at,deleted,body,seq FROM access_lessons WHERE member_id=? AND seq>? ORDER BY seq LIMIT ?',
      )
        .bind(memberId, cursor, PAGE_LESSONS + 1)
        .all<LessonRow>(),
      env.DB.prepare(
        'SELECT record,seq FROM access_lesson_records WHERE member_id=? AND seq>? ORDER BY seq LIMIT ?',
      )
        .bind(memberId, cursor, PAGE_RECORDS + 1)
        .all<{ record: string; seq: number }>(),
    ]);
    // Cut both lists at the earliest page boundary so nothing is skipped.
    const limits = [
      lessons.results.length > PAGE_LESSONS ? lessons.results[PAGE_LESSONS - 1].seq : Infinity,
      records.results.length > PAGE_RECORDS ? records.results[PAGE_RECORDS - 1].seq : Infinity,
    ];
    const boundary = Math.min(...limits);
    const more = boundary !== Infinity;
    const pageLessons = lessons.results.filter((row) => row.seq <= boundary);
    const pageRecords = records.results.filter((row) => row.seq <= boundary);
    const last = Math.max(
      cursor,
      ...pageLessons.map((row) => row.seq),
      ...pageRecords.map((row) => row.seq),
    );
    return {
      epoch: consent.epoch,
      cursor: more ? boundary : last,
      more,
      lessons: pageLessons.map((row) => ({
        id: row.id,
        project: row.project,
        revision: row.revision,
        updatedAt: row.updated_at,
        deleted: row.deleted === 1,
        ...(row.body ? { lesson: lessonBody.parse(JSON.parse(row.body)) } : {}),
      })),
      records: pageRecords.map((row) => record.parse(JSON.parse(row.record))),
    };
  }
  const push = pushSchema.parse(body);
  if (push.epoch !== consent.epoch) throw new AccessError(409, 'lessons_reset');
  const ids = push.lessons.map((item) => item.id);
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    const known = await env.DB.prepare(
      `SELECT count(*) AS known,(SELECT count(*) FROM access_lessons WHERE member_id=?) AS total FROM access_lessons WHERE member_id=? AND id IN (${marks})`,
    )
      .bind(memberId, memberId, ...ids)
      .first<{ known: number; total: number }>();
    if ((known?.total ?? 0) + ids.length - (known?.known ?? 0) > LESSON_ROWS)
      throw new AccessError(413, 'lessons_full');
  }
  const count = push.lessons.length + push.records.length;
  if (count) {
    const guard = [memberId, push.epoch, deviceId];
    const statements = [
      env.DB.prepare(
        `UPDATE access_members SET lesson_seq=lesson_seq+? WHERE id=? AND lesson_epoch=? AND EXISTS(SELECT 1 FROM access_devices d WHERE d.id=? AND d.member_id=access_members.id AND d.settings_sync=1)`,
      ).bind(count, ...guard),
      ...push.lessons.map((item, index) =>
        env.DB.prepare(
          `INSERT INTO access_lessons(member_id,id,project,revision,updated_at,deleted,body,seq)
           SELECT m.id,?,?,?,?,?,?,m.lesson_seq-? ${GUARD}
           ON CONFLICT(member_id,id) DO UPDATE SET project=excluded.project,revision=excluded.revision,
           updated_at=excluded.updated_at,deleted=excluded.deleted,body=excluded.body,seq=excluded.seq
           WHERE excluded.revision>access_lessons.revision
           OR (excluded.revision=access_lessons.revision AND excluded.updated_at>access_lessons.updated_at)`,
        ).bind(
          item.id,
          item.project,
          item.revision,
          item.updatedAt,
          item.deleted ? 1 : 0,
          item.lesson ? JSON.stringify(item.lesson) : null,
          count - 1 - index,
          ...guard,
        ),
      ),
      ...push.records.map((item, index) =>
        env.DB.prepare(
          `INSERT INTO access_lesson_records(member_id,id,project,record,seq)
           SELECT m.id,?,?,?,m.lesson_seq-? ${GUARD} ON CONFLICT(member_id,id) DO NOTHING`,
        ).bind(
          item.id,
          item.project,
          JSON.stringify(item),
          count - 1 - push.lessons.length - index,
          ...guard,
        ),
      ),
      env.DB.prepare(
        `DELETE FROM access_lesson_records WHERE member_id=? AND seq<=(SELECT seq FROM access_lesson_records WHERE member_id=? ORDER BY seq DESC LIMIT 1 OFFSET ${RECORD_ROWS})`,
      ).bind(memberId, memberId),
    ];
    const [counter] = await env.DB.batch(statements);
    if (counter.meta.changes !== 1) throw new AccessError(409, 'lessons_reset');
  }
  if (!ids.length) return { lessons: [] };
  const stored = await env.DB.prepare(
    `SELECT id,revision,updated_at AS updatedAt FROM access_lessons WHERE member_id=? AND id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(memberId, ...ids)
    .all<{ id: string; revision: number; updatedAt: number }>();
  return { lessons: stored.results };
}

/** Removes synced lessons and history and moves the member to a new epoch. */
export function deleteLessonStatements(env: Env, memberId: string) {
  return [
    env.DB.prepare('DELETE FROM access_lessons WHERE member_id=?').bind(memberId),
    env.DB.prepare('DELETE FROM access_lesson_records WHERE member_id=?').bind(memberId),
    env.DB.prepare('UPDATE access_members SET lesson_epoch=lesson_epoch+1 WHERE id=?').bind(
      memberId,
    ),
  ];
}

async function deleteLessons(env: Env, memberId: string) {
  await env.DB.batch(deleteLessonStatements(env, memberId));
}
