/** Cloud resource kinds, in the order setup runs and the manifest lists them. */
export type CloudResourceKind =
  | 'workers'
  | 'r2'
  | 'd1'
  | 'kv'
  | 'queue'
  | 'durableObjects'
  | 'hyperdrive'
  | 'turnstile';

export interface CloudResourceOption {
  kind: CloudResourceKind;
  title: string;
  description: string;
  /** Set up a step for this kind during provisioning, and how the step is named. */
  step: (prefix: string) => string;
  /** The account API token permission that creates it. */
  permission: string;
  /** An input the resource needs before it can be created. */
  needs?: 'postgres' | 'domains';
}

/** Choice order on the setup screen; setup itself follows `SETUP_ORDER`. */
export const CLOUD_RESOURCES: CloudResourceOption[] = [
  {
    kind: 'r2',
    title: 'R2',
    description: 'File storage for images, audio and other assets',
    step: (prefix) => `Create the ${prefix}-assets bucket`,
    permission: 'Workers R2 Storage: Edit',
  },
  {
    kind: 'd1',
    title: 'D1',
    description: 'A SQL database',
    step: (prefix) => `Create the ${prefix}-db database`,
    permission: 'D1: Edit',
  },
  {
    kind: 'kv',
    title: 'KV',
    description: 'Fast key-value config',
    step: (prefix) => `Create the ${prefix}-config namespace`,
    permission: 'Workers KV Storage: Edit',
  },
  {
    kind: 'queue',
    title: 'Queues',
    description: 'Background jobs',
    step: (prefix) => `Create the ${prefix}-jobs queue`,
    permission: 'Queues: Edit',
  },
  {
    kind: 'durableObjects',
    title: 'Durable Objects',
    description: 'Live game and session servers',
    step: () => 'Add a Durable Object binding',
    permission: 'Workers Scripts: Edit',
  },
  {
    kind: 'workers',
    title: 'Workers',
    description: 'Your app’s server code, named for this project',
    step: (prefix) => `Name the Worker ${prefix}`,
    permission: 'Workers Scripts: Edit',
  },
  {
    kind: 'hyperdrive',
    title: 'Hyperdrive',
    description: 'Fast access to your Postgres',
    step: (prefix) => `Connect ${prefix}-postgres to your database`,
    permission: 'Hyperdrive: Edit',
    needs: 'postgres',
  },
  {
    kind: 'turnstile',
    title: 'Turnstile',
    description: 'Bot protection on sign-up',
    step: (prefix) => `Create the ${prefix}-turnstile widget`,
    permission: 'Turnstile: Edit',
    needs: 'domains',
  },
];

export const SETUP_ORDER: CloudResourceKind[] = [
  'workers',
  'r2',
  'd1',
  'kv',
  'queue',
  'durableObjects',
  'hyperdrive',
  'turnstile',
];

export const DEFAULT_KINDS: CloudResourceKind[] = ['r2', 'kv', 'queue', 'durableObjects'];

/** Durable Objects and Workers are declared in wrangler configuration, not created. */
export const isProvisioned = (kind: CloudResourceKind) =>
  kind !== 'durableObjects' && kind !== 'workers';

export function resourceOption(kind: CloudResourceKind) {
  return CLOUD_RESOURCES.find((option) => option.kind === kind) as CloudResourceOption;
}

/** A project name as a resource name prefix: lowercase words joined by single hyphens. */
export function resourcePrefix(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export function validPrefix(prefix: string): boolean {
  return /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,39}$/.test(prefix);
}

/** Domains typed one per line or separated by commas or spaces. */
export function parseDomains(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((domain) =>
          domain
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/\/+$/, ''),
        )
        .filter(Boolean),
    ),
  ];
}

/** The selected kinds in setup order, without duplicates or unknown kinds. */
export function orderedKinds(kinds: readonly string[]): CloudResourceKind[] {
  return SETUP_ORDER.filter((kind) => kinds.includes(kind));
}

/** The token permissions creating the selected kinds needs, each once. */
export function requiredPermissions(kinds: readonly CloudResourceKind[]): string[] {
  return [
    ...new Set(
      orderedKinds(kinds)
        .filter(isProvisioned)
        .map((kind) => resourceOption(kind).permission),
    ),
  ];
}
