import {
  type AdminAdapter,
  createAdminAdapter,
  type FieldMeta,
  memoryAuditStore,
  type Page,
  signedAuth,
} from '@lopebase/adapter';

// Read-only operator view for LopeBase. Personal data is never sent (`ids_only`),
// so member and device rows carry identifiers, states, dates and counts only.
export const lopebasePath = '/api/lopebase';
export type LopeBaseEnv = Env & {
  LOPEBASE_SIGNING_SECRET?: string;
  LOPEBASE_SIGNING_SECRET_PREVIOUS?: string;
};
type Row = Record<string, unknown>;

const day = 86400000;
const iso = (value: unknown) => (typeof value === 'number' ? new Date(value).toISOString() : null);
// Cursors are `<created_at>.<id>` from the last row, matching the list order.
function after(cursor: string | undefined): [number, string] | null {
  const match = /^(\d{1,16})\.([0-9a-f-]{36})$/.exec(cursor ?? '');
  return match ? [Number(match[1]), match[2]] : null;
}
async function page(
  env: Env,
  select: string,
  table: string,
  shape: (row: Row) => Row,
  query: { limit?: number; cursor?: string; search?: string },
): Promise<Page<Row>> {
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), 100);
  const where: string[] = [];
  const values: unknown[] = [];
  const position = after(query.cursor);
  if (position) {
    where.push(`(${table}.created_at<? OR (${table}.created_at=? AND ${table}.id<?))`);
    values.push(position[0], position[0], position[1]);
  }
  const search = query.search?.trim();
  if (search) {
    where.push(`${table}.id=?`);
    values.push(search);
  }
  const { results } = await env.DB.prepare(
    `${select}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${table}.created_at DESC,${table}.id DESC LIMIT ?`,
  )
    .bind(...values, limit + 1)
    .all<Row>();
  const rows = results.slice(0, limit);
  const last = rows.at(-1);
  return {
    rows: rows.map(shape),
    nextCursor: results.length > limit && last ? `${last.created_at}.${last.id}` : undefined,
  };
}

const memberSelect =
  'SELECT m.id,m.status,m.source,m.created_at,m.approved_at,m.verified_at,m.newsletter,m.invited_by,(SELECT count(*) FROM access_devices d WHERE d.member_id=m.id AND d.expires_at>unixepoch()*1000) AS devices FROM access_members m';
const member = (row: Row): Row => ({
  id: row.id,
  status: row.status,
  source: row.source,
  created_at: iso(row.created_at),
  approved_at: iso(row.approved_at),
  verified_at: iso(row.verified_at),
  newsletter: row.newsletter === 1,
  invited_by: row.invited_by,
  devices: row.devices,
});
const deviceSelect =
  'SELECT d.id,d.member_id,d.platform,d.app_version,d.build_kind,d.profile_kind,d.created_at,d.last_seen_at,d.expires_at FROM access_devices d';
const device = (row: Row): Row => ({
  ...row,
  created_at: iso(row.created_at),
  last_seen_at: iso(row.last_seen_at),
  expires_at: iso(row.expires_at),
});
const date = (name: string, label: string, inList = false): FieldMeta => ({
  name,
  label,
  type: 'date',
  inList,
});

function create(env: LopeBaseEnv): AdminAdapter {
  return createAdminAdapter({
    connectorId: 'jackalope',
    personalData: 'ids_only',
    authenticate: signedAuth({
      secrets: [env.LOPEBASE_SIGNING_SECRET, env.LOPEBASE_SIGNING_SECRET_PREVIOUS],
      capabilities: ['users.read', 'system.read'],
    }),
    audit: memoryAuditStore(),
    async overview() {
      const now = Date.now();
      const counts = await env.DB.prepare(
        `SELECT
          (SELECT count(*) FROM access_members WHERE status='approved') AS users,
          (SELECT count(*) FROM access_members WHERE status='waiting') AS waitlist,
          (SELECT count(*) FROM access_members WHERE created_at>?) AS signups_7d,
          (SELECT count(DISTINCT member_id) FROM access_devices WHERE last_seen_at>?) AS active_users_28d,
          (SELECT count(*) FROM access_beta_requests WHERE status='pending') AS beta_requests_pending`,
      )
        .bind(now - 7 * day, now - 28 * day)
        .first<Record<string, number>>();
      const stats = {
        users: counts?.users ?? 0,
        signups_7d: counts?.signups_7d ?? 0,
        active_users_28d: counts?.active_users_28d ?? 0,
        waitlist: counts?.waitlist ?? 0,
        beta_requests_pending: counts?.beta_requests_pending ?? 0,
      };
      return {
        stats,
        attentionItems: stats.beta_requests_pending
          ? [
              {
                title: `${stats.beta_requests_pending} Store beta request${stats.beta_requests_pending === 1 ? '' : 's'} pending`,
                severity: 'info' as const,
              },
            ]
          : [],
      };
    },
    resources: [
      {
        name: 'users',
        label: 'Members',
        readCapability: 'users.read',
        fields: [
          { name: 'id', label: 'ID', type: 'string' },
          {
            name: 'status',
            label: 'Status',
            type: 'enum',
            enumValues: ['waiting', 'approved', 'revoked'],
            inList: true,
          },
          { name: 'source', label: 'Source', type: 'string', inList: true },
          date('created_at', 'Joined', true),
          date('approved_at', 'Approved', true),
          date('verified_at', 'Verified'),
          { name: 'newsletter', label: 'Newsletter', type: 'boolean' },
          { name: 'invited_by', label: 'Invited by', type: 'relation', relation: 'users' },
          { name: 'devices', label: 'Active devices', type: 'number', inList: true },
        ],
        list: (query) => page(env, memberSelect, 'm', member, query),
        get: async (id) => {
          const row = await env.DB.prepare(`${memberSelect} WHERE m.id=?`).bind(id).first<Row>();
          return row ? member(row) : null;
        },
      },
      {
        name: 'devices',
        label: 'Desktop devices',
        readCapability: 'users.read',
        fields: [
          { name: 'id', label: 'ID', type: 'string' },
          { name: 'member_id', label: 'Member', type: 'relation', relation: 'users', inList: true },
          { name: 'platform', label: 'Platform', type: 'string', inList: true },
          { name: 'app_version', label: 'Version', type: 'string', inList: true },
          { name: 'build_kind', label: 'Build', type: 'string' },
          { name: 'profile_kind', label: 'Profile', type: 'string' },
          date('created_at', 'Linked'),
          date('last_seen_at', 'Last seen', true),
          date('expires_at', 'Expires'),
        ],
        list: (query) => page(env, deviceSelect, 'd', device, query),
        get: async (id) => {
          const row = await env.DB.prepare(`${deviceSelect} WHERE d.id=?`).bind(id).first<Row>();
          return row ? device(row) : null;
        },
      },
    ],
  });
}

// One adapter per environment object keeps the adapter's per-isolate rate limit intact.
const adapters = new WeakMap<object, AdminAdapter>();
export function lopebase(env: LopeBaseEnv): AdminAdapter | null {
  if (!env.LOPEBASE_SIGNING_SECRET) return null;
  let adapter = adapters.get(env);
  if (!adapter) {
    adapter = create(env);
    adapters.set(env, adapter);
  }
  return adapter;
}
