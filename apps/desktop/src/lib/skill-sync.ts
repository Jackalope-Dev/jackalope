/**
 * Agent skills on this computer and their account sync. The native host finds
 * skills, decides what syncs and does every transfer; this side parses the
 * page it returns, accepting only the fields below, and holds the page's
 * presentation logic.
 */
import { invokeNative } from './native/transport.ts';

export type SkillRoot = 'claude' | 'codex' | 'agents';
type SkillScope = 'personal' | 'project';
export type SkillStatus =
  | 'local'
  | 'blocked'
  | 'synced'
  | 'changed'
  | 'update'
  | 'conflict'
  | 'elsewhere';
type SkillTracking = 'outside' | 'untracked' | 'ignored' | 'tracked' | 'mixed';
export type SkillBlocked =
  | 'repository'
  | 'partlyTracked'
  | 'tooLarge'
  | 'tooManyFiles'
  | 'binary'
  | 'fileName'
  | 'name'
  | 'sensitive'
  | 'noCommit';

export interface SkillHolder {
  device: string;
  /** Holds the newest revision the account has. */
  current: boolean;
}

export interface SkillCard {
  /** This computer's copy, or the account id for a skill not on this computer. */
  id: string;
  syncedId: string | null;
  name: string;
  description: string;
  scope: SkillScope;
  root: SkillRoot;
  project: { id: string; name: string } | null;
  path: string | null;
  tracking: SkillTracking | null;
  status: SkillStatus;
  blocked: SkillBlocked | null;
  files: number;
  characters: number;
  modifiedAt: string | null;
  error: string | null;
  holders: SkillHolder[];
}

export interface SkillDevice {
  id: string;
  name: string | null;
  platform: string | null;
  here: boolean;
}

interface SkillSyncView {
  available: boolean;
  settingsSync: boolean;
  enabled: boolean;
  owner: string | null;
  lastSyncedAt: string | null;
  uploaded: number;
  downloaded: number;
  /** Synced skills were deleted from another computer, which turned sync off. */
  reset: boolean;
}

export interface SkillsPage {
  sync: SkillSyncView;
  skills: SkillCard[];
  devices: SkillDevice[];
}

interface SkillFile {
  path: string;
  content: string;
}

export interface SkillContent {
  name: string;
  files: SkillFile[];
  /** The account's newer copy when it differs from this computer's. */
  account: SkillFile[] | null;
}

export const EMPTY_SKILLS_PAGE: SkillsPage = {
  sync: {
    available: false,
    settingsSync: false,
    enabled: false,
    owner: null,
    lastSyncedAt: null,
    uploaded: 0,
    downloaded: 0,
    reset: false,
  },
  skills: [],
  devices: [],
};

const ROOTS: readonly SkillRoot[] = ['claude', 'codex', 'agents'];
const SCOPES: readonly SkillScope[] = ['personal', 'project'];
const STATUSES: readonly SkillStatus[] = [
  'local',
  'blocked',
  'synced',
  'changed',
  'update',
  'conflict',
  'elsewhere',
];
const TRACKING: readonly SkillTracking[] = ['outside', 'untracked', 'ignored', 'tracked', 'mixed'];
const BLOCKED: readonly SkillBlocked[] = [
  'repository',
  'partlyTracked',
  'tooLarge',
  'tooManyFiles',
  'binary',
  'fileName',
  'name',
  'sensitive',
  'noCommit',
];

function fail(): never {
  throw new Error('Invalid skills response.');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, keys: readonly string[]) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail();
}
function text(value: unknown, max = 4096): string {
  if (typeof value !== 'string' || value.length > max) fail();
  return value;
}
function optionalText(value: unknown, max = 4096): string | null {
  return value === null ? null : text(value, max);
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail();
  return value;
}
function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') fail();
  return value;
}
function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  if (!options.includes(value as T)) fail();
  return value as T;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail();
  return value;
}

function parseCard(value: unknown): SkillCard {
  const card = record(value);
  only(card, [
    'id',
    'syncedId',
    'name',
    'description',
    'scope',
    'root',
    'project',
    'path',
    'tracking',
    'status',
    'blocked',
    'files',
    'characters',
    'modifiedAt',
    'error',
    'holders',
  ]);
  const project = card.project === null ? null : record(card.project);
  if (project) only(project, ['id', 'name']);
  return {
    id: text(card.id, 64),
    syncedId: optionalText(card.syncedId, 64),
    name: text(card.name, 200),
    description: text(card.description, 2048),
    scope: oneOf(card.scope, SCOPES),
    root: oneOf(card.root, ROOTS),
    project: project ? { id: text(project.id, 200), name: text(project.name, 500) } : null,
    path: optionalText(card.path),
    tracking: card.tracking === null ? null : oneOf(card.tracking, TRACKING),
    status: oneOf(card.status, STATUSES),
    blocked: card.blocked === null ? null : oneOf(card.blocked, BLOCKED),
    files: count(card.files),
    characters: count(card.characters),
    modifiedAt: optionalText(card.modifiedAt, 64),
    error: optionalText(card.error, 2000),
    holders: list(card.holders, 50).map((item) => {
      const holder = record(item);
      only(holder, ['device', 'current']);
      return { device: text(holder.device, 64), current: flag(holder.current) };
    }),
  };
}

/** The native page, or an error for any unexpected field or type. */
export function parseSkillsPage(value: unknown): SkillsPage {
  const page = record(value);
  only(page, ['sync', 'skills', 'devices']);
  const sync = record(page.sync);
  only(sync, [
    'available',
    'settingsSync',
    'enabled',
    'owner',
    'lastSyncedAt',
    'uploaded',
    'downloaded',
    'reset',
  ]);
  return {
    sync: {
      available: flag(sync.available),
      settingsSync: flag(sync.settingsSync),
      enabled: flag(sync.enabled),
      owner: optionalText(sync.owner, 200),
      lastSyncedAt: optionalText(sync.lastSyncedAt, 64),
      uploaded: count(sync.uploaded),
      downloaded: count(sync.downloaded),
      reset: flag(sync.reset),
    },
    skills: list(page.skills, 2000).map(parseCard),
    devices: list(page.devices, 50).map((item) => {
      const device = record(item);
      only(device, ['id', 'name', 'platform', 'here']);
      return {
        id: text(device.id, 64),
        name: optionalText(device.name, 200),
        platform: optionalText(device.platform, 32),
        here: flag(device.here),
      };
    }),
  };
}

export type SkillSyncAction =
  | { action: 'status' }
  | { action: 'configure'; enabled: boolean; owner: string }
  | { action: 'sync'; owner: string }
  | { action: 'share'; owner: string; id: string; share: boolean }
  | { action: 'resolve'; owner: string; id: string; keep: 'local' | 'account' }
  | { action: 'delete'; owner: string };

export async function skillSync(action: SkillSyncAction): Promise<SkillsPage> {
  return parseSkillsPage(await invokeNative<unknown>('app_skill_sync', { action }));
}

export function readSkill(id: string) {
  return invokeNative<SkillContent>('skills_read', { id });
}

export interface SkillTarget {
  scope: SkillScope;
  root: SkillRoot;
  projectId: string | null;
}

export function createSkill(
  target: SkillTarget,
  name: string,
  description: string,
  keepOutOfCommits: boolean,
) {
  return invokeNative<string>('skills_create', {
    skill: { ...target, name, description, keepOutOfCommits },
  });
}

export function importSkill(target: SkillTarget, keepOutOfCommits: boolean) {
  return invokeNative<string | null>('skills_import', { target, keepOutOfCommits });
}

export function exportSkill(id: string) {
  return invokeNative<string | null>('skills_export', { id });
}

export function openSkill(id: string, target: 'file' | 'folder') {
  return invokeNative<void>('skills_open', { id, target });
}

export function keepSkillOutOfCommits(id: string) {
  return invokeNative<boolean>('skills_keep_out', { id });
}

export const ROOT_LABELS: Record<SkillRoot, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  agents: 'Shared agents folder',
};

/** The folder a new skill goes into, for the create and import forms. */
export function targetFolder(target: SkillTarget): string {
  if (target.scope === 'personal')
    return target.root === 'claude'
      ? '~/.claude/skills'
      : target.root === 'codex'
        ? '~/.codex/skills'
        : '~/.agents/skills';
  return target.root === 'agents' ? '.agents/skills' : '.claude/skills';
}

/** A folder name agents accept, from what the person typed. */
export function skillSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/, '')
    .slice(0, 64);
}

export type Tone = 'default' | 'accent' | 'success' | 'warning' | 'danger';

export const STATUS_LABELS: Record<SkillStatus, { label: string; tone: Tone }> = {
  synced: { label: 'Synced', tone: 'success' },
  changed: { label: 'Changes to upload', tone: 'accent' },
  update: { label: 'Update ready', tone: 'accent' },
  conflict: { label: 'Changed in two places', tone: 'danger' },
  local: { label: 'Only on this computer', tone: 'default' },
  blocked: { label: 'Can’t sync', tone: 'warning' },
  elsewhere: { label: 'On other devices', tone: 'default' },
};

/** Why a skill cannot sync, and what to do about it. */
export function blockedReason(blocked: SkillBlocked): string {
  switch (blocked) {
    case 'repository':
      return 'Committed to the repository, which already shares it.';
    case 'partlyTracked':
      return 'Some files are committed. Commit the rest or remove them from the repository to sync it.';
    case 'tooLarge':
      return 'Larger than 24,000 characters, the most a synced skill can hold.';
    case 'tooManyFiles':
      return 'Has more than 20 files, the most a synced skill can hold.';
    case 'binary':
      return 'Holds a file that is not text. Only text files sync.';
    case 'fileName':
      return 'Has a file nested more than two folders deep or with a name that can’t sync.';
    case 'name':
      return 'Rename the folder with lowercase letters, numbers and dashes to sync it.';
    case 'sensitive':
      return 'Looks like it holds a credential, so it stays on this computer.';
    case 'noCommit':
      return 'This project has no commit yet, so other computers can’t match it.';
  }
}

export type SkillFilter = 'all' | 'synced' | 'local' | 'attention';

const ORDER: Record<SkillStatus, number> = {
  conflict: 0,
  update: 1,
  changed: 2,
  synced: 3,
  local: 4,
  elsewhere: 5,
  blocked: 6,
};

function needsAttention(card: SkillCard) {
  return card.status === 'conflict' || card.error !== null;
}

function matchesFilter(card: SkillCard, filter: SkillFilter) {
  if (filter === 'synced') return card.syncedId !== null;
  if (filter === 'local') return card.syncedId === null;
  if (filter === 'attention') return needsAttention(card);
  return true;
}

/** Cards for a filter and search, most urgent first, then by name. */
export function visibleSkills(cards: SkillCard[], filter: SkillFilter, query: string): SkillCard[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return cards
    .filter((card) => matchesFilter(card, filter))
    .filter((card) => {
      const haystack = [
        card.name,
        card.description,
        card.project?.name ?? '',
        ROOT_LABELS[card.root],
      ]
        .join(' ')
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
}

export function filterCounts(cards: SkillCard[]): Record<SkillFilter, number> {
  return {
    all: cards.length,
    synced: cards.filter((card) => matchesFilter(card, 'synced')).length,
    local: cards.filter((card) => matchesFilter(card, 'local')).length,
    attention: cards.filter(needsAttention).length,
  };
}

/** A device's display name. */
export function deviceName(device: SkillDevice): string {
  if (device.name) return device.name;
  const platform =
    device.platform === 'macos'
      ? 'Mac'
      : device.platform === 'windows'
        ? 'Windows PC'
        : device.platform === 'linux'
          ? 'Linux computer'
          : 'Computer';
  return device.here ? `This ${platform}` : platform;
}

export interface OrbitNode {
  device: SkillDevice;
  /** Holds this skill. */
  holds: boolean;
  /** Holds the newest revision. */
  current: boolean;
  x: number;
  y: number;
}

/**
 * Places the account's devices on a ring around a skill, this computer first at
 * the top, then clockwise. Coordinates are in a 0–100 box.
 */
export function orbit(devices: SkillDevice[], holders: SkillHolder[], radius = 38): OrbitNode[] {
  const ordered = [...devices].sort((a, b) => Number(b.here) - Number(a.here));
  return ordered.map((device, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(ordered.length, 1);
    const holder = holders.find((item) => item.device === device.id);
    return {
      device,
      holds: holder !== undefined,
      current: holder?.current ?? false,
      x: Math.round((50 + radius * Math.cos(angle)) * 100) / 100,
      y: Math.round((50 + radius * Math.sin(angle)) * 100) / 100,
    };
  });
}

/** How far a skill has spread: devices holding the newest copy out of all devices. */
export function reach(devices: SkillDevice[], holders: SkillHolder[]) {
  const current = devices.filter((device) =>
    holders.some((holder) => holder.device === device.id && holder.current),
  ).length;
  return { current, total: devices.length };
}

export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

/** Line differences from `before` to `after`; very long texts compare as a whole. */
export function lineDiff(before: string, after: string, limit = 600): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length > limit || b.length > limit)
    return [
      ...a.map((text) => ({ kind: 'removed' as const, text })),
      ...b.map((text) => ({ kind: 'added' as const, text })),
    ];
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ kind: 'removed', text: a[i] });
      i += 1;
    } else {
      lines.push({ kind: 'added', text: b[j] });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) lines.push({ kind: 'removed', text: a[i] });
  for (; j < b.length; j += 1) lines.push({ kind: 'added', text: b[j] });
  return lines;
}

/** One line under the page heading describing sync on this computer. */
export function syncSummary(page: SkillsPage, busy: boolean): string {
  const { sync } = page;
  if (sync.reset)
    return 'Synced skills were deleted from another computer, so skill sync turned off here.';
  if (!sync.available) return 'Sign in to sync skills between your computers.';
  if (!sync.settingsSync) return 'Turn on settings sync in Settings → Privacy to sync skills.';
  if (!sync.enabled) return 'Skills stay on this computer until you sync one.';
  if (busy) return 'Syncing skills…';
  const synced = page.skills.filter((card) => card.syncedId !== null).length;
  const devices = page.devices.length;
  const skills = synced === 1 ? '1 skill' : `${synced} skills`;
  return devices > 1
    ? `${skills} synced across ${devices} computers.`
    : `${skills} synced with your account.`;
}

/**
 * Per device, for the page-wide view: whether it holds any synced skill and
 * whether it holds the newest copy of every synced skill this computer knows.
 */
export function deviceCoverage(cards: SkillCard[], devices: SkillDevice[]): SkillHolder[] {
  const synced = cards.filter((card) => card.syncedId !== null);
  return devices.flatMap((device) => {
    const held = synced.map((card) => card.holders.find((holder) => holder.device === device.id));
    if (!held.some(Boolean)) return [];
    return [{ device: device.id, current: held.every((holder) => holder?.current === true) }];
  });
}
