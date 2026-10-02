import { DurableObject } from 'cloudflare:workers';
import { type ChangedFile, changedFiles } from './changes';
import { allConflicts, type Conflict } from './conflicts';
import { forkName, SwarmError, text } from './names';
import { CachedReader, objectReader, repoInfo } from './objects';

/** One agent attempt working in its own fork of the shared repository. */
export interface ForkRecord {
  fork: string;
  attemptId: string;
  agent: string;
  title: string;
  /** The commit the attempt started from; changes are measured against it. */
  baseCommit: string;
  head: string | null;
  files: ChangedFile[];
  truncated: boolean;
  error: string | null;
  registeredAt: string;
  updatedAt: string;
}

export interface SwarmState {
  repo: string;
  forks: ForkRecord[];
  conflicts: Conflict[];
  updatedAt: string;
}

const HASH = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const TOKEN_TTL = 86_400;

/**
 * Coordinates every agent fork of one Artifacts repository. A single instance
 * per repository serializes analysis and fans live state out to subscribers.
 */
export class Swarm extends DurableObject<Env> {
  private chain: Promise<unknown> = Promise.resolve();

  /** Runs work one at a time so concurrent pushes never interleave state writes. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async records(): Promise<ForkRecord[]> {
    const stored = await this.ctx.storage.list<ForkRecord>({ prefix: 'fork:' });
    return [...stored.values()].sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
  }

  async state(repo: string): Promise<SwarmState> {
    return {
      repo,
      forks: await this.records(),
      conflicts: (await this.ctx.storage.get<Conflict[]>('conflicts')) ?? [],
      updatedAt: (await this.ctx.storage.get<string>('updatedAt')) ?? new Date(0).toISOString(),
    };
  }

  /** Creates the attempt's fork and returns a write token for pushing to it. */
  async register(repo: string, input: Record<string, unknown>) {
    if (!REPO.test(repo)) throw new SwarmError('Unknown repository name.');
    const attemptId = text(input.attemptId, 80);
    const baseCommit = text(input.baseCommit, 40).toLowerCase();
    if (!HASH.test(baseCommit))
      throw new SwarmError('Send the 40-character commit the attempt started from.');
    const fork = forkName(repo, attemptId);
    return this.serial(async () => {
      const existing = await this.ctx.storage.get<ForkRecord>(`fork:${fork}`);
      const base = await this.env.ARTIFACTS.get(repo);
      let created: { remote: string; token: string; tokenExpiresAt: string };
      if (existing) {
        const handle = await this.env.ARTIFACTS.get(fork);
        const token = await handle.createToken('write', TOKEN_TTL);
        created = {
          remote: (await repoInfo(handle)).remote,
          token: token.plaintext,
          tokenExpiresAt: token.expiresAt,
        };
      } else {
        created = await base.fork(fork, {
          description: text(input.title, 200, 'Jackalope agent attempt'),
          defaultBranchOnly: true,
        });
      }
      const now = new Date().toISOString();
      const record: ForkRecord = existing ?? {
        fork,
        attemptId,
        agent: text(input.agent, 60, 'agent'),
        title: text(input.title, 200, 'Untitled attempt'),
        baseCommit,
        head: null,
        files: [],
        truncated: false,
        error: null,
        registeredAt: now,
        updatedAt: now,
      };
      await this.ctx.storage.put(`fork:${fork}`, record);
      await this.touch(repo);
      return {
        fork,
        remote: created.remote,
        token: created.token,
        tokenExpiresAt: created.tokenExpiresAt,
        branch: (await repoInfo(base)).defaultBranch,
      };
    });
  }

  /** A new write token for an existing fork; tokens expire after a day. */
  async token(fork: string) {
    if (!(await this.ctx.storage.get(`fork:${fork}`))) throw new SwarmError('Unknown fork.', 404);
    const handle = await this.env.ARTIFACTS.get(fork);
    const token = await handle.createToken('write', TOKEN_TTL);
    const { remote } = await repoInfo(handle);
    return { fork, remote, token: token.plaintext, tokenExpiresAt: token.expiresAt };
  }

  /** Re-reads one fork after a push and recomputes conflicts across all forks. */
  async analyze(repo: string, fork: string): Promise<SwarmState> {
    return this.serial(async () => {
      const record = await this.ctx.storage.get<ForkRecord>(`fork:${fork}`);
      if (!record) throw new SwarmError('Unknown fork.', 404);
      const readers = new Map<string, CachedReader>();
      const reader = async (name: string) => {
        let cached = readers.get(name);
        if (!cached) {
          cached = new CachedReader(objectReader(await this.env.ARTIFACTS.get(name)));
          readers.set(name, cached);
        }
        return cached;
      };
      const now = new Date().toISOString();
      try {
        const handle = await this.env.ARTIFACTS.get(fork);
        const own = await reader(fork);
        const { defaultBranch } = await repoInfo(handle);
        const [head] = await own.log({ ref: defaultBranch, limit: 1 });
        if (!head) throw new SwarmError('The fork has no commits yet. Push the attempt first.');
        const changes = await changedFiles(own, record.baseCommit, head.hash);
        Object.assign(record, {
          head: head.hash,
          files: changes.files,
          truncated: changes.truncated,
          error: null,
          updatedAt: now,
        });
      } catch (cause) {
        Object.assign(record, {
          error: cause instanceof Error ? cause.message : String(cause),
          updatedAt: now,
        });
      }
      await this.ctx.storage.put(`fork:${fork}`, record);
      const forks = await this.records();
      for (const other of forks)
        if (other.fork !== fork) await reader(other.fork).catch(() => undefined);
      const conflicts = await allConflicts(
        forks.filter((item) => item.head && !item.error),
        (name) => readers.get(name) as CachedReader,
      );
      await this.ctx.storage.put('conflicts', conflicts);
      await this.touch(repo);
      return this.broadcast(repo);
    });
  }

  /** Stops tracking a fork, optionally deleting its repository. */
  async release(repo: string, fork: string, remove: boolean) {
    return this.serial(async () => {
      await this.ctx.storage.delete(`fork:${fork}`);
      if (remove) await this.env.ARTIFACTS.delete(fork).catch(() => false);
      const remaining = new Set((await this.records()).map((item) => item.fork));
      const conflicts = ((await this.ctx.storage.get<Conflict[]>('conflicts')) ?? []).filter(
        (conflict) => conflict.forks.every((name) => remaining.has(name)),
      );
      await this.ctx.storage.put('conflicts', conflicts);
      await this.touch(repo);
      return this.broadcast(repo);
    });
  }

  private async touch(repo: string) {
    await this.ctx.storage.put({ updatedAt: new Date().toISOString(), repo });
  }

  private async broadcast(repo: string) {
    const state = await this.state(repo);
    const message = JSON.stringify({ type: 'state', state });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // A closed subscriber is cleaned up by the runtime.
      }
    }
    return state;
  }

  /** Live state for subscribers; hibernates between pushes. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    const repo =
      (await this.ctx.storage.get<string>('repo')) ??
      new URL(request.url).searchParams.get('repo') ??
      '';
    pair[1].send(JSON.stringify({ type: 'state', state: await this.state(repo) }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage() {
    // Subscribers only listen; state changes arrive through pushes.
  }
}
