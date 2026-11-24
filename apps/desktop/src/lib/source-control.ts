/** A project's code host. A remote on a host Jackalope does not recognize goes through the GitHub CLI. */
export type HostKind = 'github' | 'gitlab' | 'bitbucket';

export type MergeMethod = 'merge' | 'squash' | 'rebase' | 'fastForward';

/** What Jackalope offers on a host; actions it cannot do there are hidden. */
interface HostCapabilities {
  create: boolean;
  draft: boolean;
  merge: boolean;
  mergeMethods: MergeMethod[];
  follow: boolean;
  reviewThreads: boolean;
  ciLogs: boolean;
  /** Whether the repository's own issue tracker can be read. */
  issues: boolean;
  changeRequestList: boolean;
}

export interface HostAccess {
  state: 'ready' | 'unchecked' | 'missing' | 'signedOut' | 'notConnected' | 'error';
  /** The host's or CLI's own words, with what to do next. */
  message: string;
}

/** `project_source_control`: where a project's remote lives and what can be done there. */
export interface ProjectHost {
  kind: HostKind;
  recognized: boolean;
  host: string;
  repository: string;
  /** The kind chosen for this project in its settings, overriding detection. */
  chosen: HostKind | null;
  capabilities: HostCapabilities;
  access: HostAccess;
}

export interface ConfiguredHost {
  host: string;
  kind: HostKind;
}

export interface BitbucketConnection {
  email: string;
  name: string | null;
  scopes: string[];
}

/** The words a host uses for its change requests and checks. */
interface HostTerms {
  host: string;
  /** "pull request" or "merge request". */
  noun: string;
  /** Sentence case of `noun`. */
  Noun: string;
  /** "PR" or "MR". */
  short: string;
  /** How the change request is reached: "your GitHub CLI", "your GitLab CLI", "your Bitbucket API token". */
  via: string;
}

const TERMS: Record<HostKind, HostTerms> = {
  github: {
    host: 'GitHub',
    noun: 'pull request',
    Noun: 'Pull request',
    short: 'PR',
    via: 'your GitHub CLI',
  },
  gitlab: {
    host: 'GitLab',
    noun: 'merge request',
    Noun: 'Merge request',
    short: 'MR',
    via: 'your GitLab CLI',
  },
  bitbucket: {
    host: 'Bitbucket',
    noun: 'pull request',
    Noun: 'Pull request',
    short: 'PR',
    via: 'your Bitbucket API token',
  },
};

export const hostTerms = (kind?: HostKind | null) => TERMS[kind ?? 'github'];

const MERGE_METHOD_LABELS: Record<MergeMethod, string> = {
  merge: 'Merge commit',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge',
  fastForward: 'Fast-forward',
};

/** The merge methods to offer: what the change request allows, else the host's own. */
export function mergeMethods(
  kind: HostKind | undefined,
  allowed?: readonly MergeMethod[] | null,
): MergeMethod[] {
  if (allowed?.length) return [...allowed];
  if (kind === 'gitlab') return ['merge', 'squash'];
  if (kind === 'bitbucket') return ['merge', 'squash', 'fastForward'];
  return ['merge', 'squash', 'rebase'];
}

/** GitLab's merge method is set per project; "Merge" there follows that setting. */
export const mergeMethodLabel = (kind: HostKind | undefined, method: MergeMethod) =>
  kind === 'gitlab' && method === 'merge' ? 'Merge' : MERGE_METHOD_LABELS[method];

/** The scopes a Bitbucket API token needs, as Bitbucket lists them when creating one. */
export const BITBUCKET_SCOPES = [
  'read:user:bitbucket',
  'read:repository:bitbucket',
  'read:pullrequest:bitbucket',
  'write:pullrequest:bitbucket',
  'read:pipeline:bitbucket',
  'read:issue:bitbucket',
] as const;

/** Where to create a Bitbucket API token with scopes. */
export const BITBUCKET_TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens';
