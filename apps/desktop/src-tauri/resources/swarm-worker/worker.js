var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/auth.ts
async function authorized(request, secret) {
  if (!secret || secret.length < 32) return false;
  const header = request.headers.get("Authorization") ?? "";
  const protocol = (request.headers.get("Sec-WebSocket-Protocol") ?? "").split(",").map((value) => value.trim()).find((value) => value.startsWith("swarm."));
  const presented = header.startsWith("Bearer ") ? header.slice(7) : protocol?.slice(6) ?? "";
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(secret))
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
__name(authorized, "authorized");

// src/names.ts
var SwarmError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
  status;
  static {
    __name(this, "SwarmError");
  }
};
function forkName(repo, attemptId) {
  const suffix = attemptId.replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toLowerCase();
  if (suffix.length < 6)
    throw new SwarmError("Use an attempt ID with at least six letters or digits.");
  return `${repo.slice(0, 80)}--${suffix}`;
}
__name(forkName, "forkName");
var text = /* @__PURE__ */ __name((value, limit, fallback = "") => typeof value === "string" ? value.trim().slice(0, limit) : fallback, "text");

// src/swarm.ts
import { DurableObject } from "cloudflare:workers";

// src/changes.ts
var ENTRY_LIMIT = 5e4;
var FILE_LIMIT = 2e3;
var isFile = /* @__PURE__ */ __name((entry) => entry.type !== "tree" && entry.type !== "gitlink", "isFile");
async function changedFiles(reader, baseCommit, headCommit) {
  if (baseCommit === headCommit) return { files: [], truncated: false };
  const [base, head] = await Promise.all([
    reader.readCommit(baseCommit),
    reader.readCommit(headCommit)
  ]);
  if (!base) throw new Error(`Base commit ${baseCommit.slice(0, 12)} is not in this repository.`);
  if (!head) throw new Error(`Commit ${headCommit.slice(0, 12)} is not in this repository.`);
  const files = [];
  let visited = 0;
  let truncated = false;
  const walk = /* @__PURE__ */ __name(async (prefix, baseTree, headTree) => {
    if (baseTree === headTree || truncated) return;
    const [left, right] = await Promise.all([
      baseTree ? reader.readTree(baseTree) : Promise.resolve([]),
      headTree ? reader.readTree(headTree) : Promise.resolve([])
    ]);
    const before = new Map((left ?? []).map((entry) => [entry.name, entry]));
    const after = new Map((right ?? []).map((entry) => [entry.name, entry]));
    for (const name of /* @__PURE__ */ new Set([...before.keys(), ...after.keys()])) {
      visited++;
      if (visited > ENTRY_LIMIT || files.length >= FILE_LIMIT) {
        truncated = true;
        return;
      }
      const a = before.get(name);
      const b = after.get(name);
      if (a?.hash === b?.hash && a?.type === b?.type) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      const aTree = a?.type === "tree" ? a.hash : null;
      const bTree = b?.type === "tree" ? b.hash : null;
      if (aTree || bTree) await walk(path, aTree, bTree);
      const aFile = a && isFile(a) ? a.hash : null;
      const bFile = b && isFile(b) ? b.hash : null;
      if (aFile !== bFile) files.push({ path, base: aFile, head: bFile });
    }
  }, "walk");
  await walk("", base.treeHash, head.treeHash);
  files.sort((x, y) => x.path.localeCompare(y.path));
  return { files, truncated };
}
__name(changedFiles, "changedFiles");

// src/diff.ts
var EXACT_CELL_LIMIT = 4e6;
function splitLines(text2) {
  if (text2 === "") return [];
  const lines = text2.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
__name(splitLines, "splitLines");
function changedHunks(base, next) {
  let prefix = 0;
  while (prefix < base.length && prefix < next.length && base[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (suffix < base.length - prefix && suffix < next.length - prefix && base[base.length - 1 - suffix] === next[next.length - 1 - suffix])
    suffix++;
  const a = base.slice(prefix, base.length - suffix);
  const b = next.slice(prefix, next.length - suffix);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0 || b.length === 0 || (a.length + 1) * (b.length + 1) > EXACT_CELL_LIMIT)
    return [{ start: prefix, end: prefix + a.length }];
  return lcsHunks(a, b).map((hunk) => ({ start: hunk.start + prefix, end: hunk.end + prefix }));
}
__name(changedHunks, "changedHunks");
function lcsHunks(a, b) {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i2 = a.length - 1; i2 >= 0; i2--) {
    for (let j2 = b.length - 1; j2 >= 0; j2--) {
      table[i2 * width + j2] = a[i2] === b[j2] ? table[(i2 + 1) * width + j2 + 1] + 1 : Math.max(table[(i2 + 1) * width + j2], table[i2 * width + j2 + 1]);
    }
  }
  const hunks = [];
  let open = null;
  let i = 0;
  let j = 0;
  const close = /* @__PURE__ */ __name(() => {
    if (open) hunks.push(open);
    open = null;
  }, "close");
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      close();
      i++;
      j++;
    } else if (j < b.length && (i === a.length || table[i * width + j + 1] >= table[(i + 1) * width + j])) {
      open ??= { start: i, end: i };
      j++;
    } else {
      open ??= { start: i, end: i };
      i++;
      open.end = i;
    }
  }
  close();
  return hunks;
}
__name(lcsHunks, "lcsHunks");
function overlappingHunks(left, right) {
  const overlaps = [];
  for (const a of left)
    for (const b of right)
      if (a.start <= b.end && b.start <= a.end) overlaps.push({ left: a, right: b });
  return overlaps;
}
__name(overlappingHunks, "overlappingHunks");

// src/conflicts.ts
var display = /* @__PURE__ */ __name((hunk) => [
  hunk.start + 1,
  Math.max(hunk.start + 1, hunk.end)
], "display");
async function conflictsBetween(left, right, readers) {
  const theirs = new Map(right.files.map((file) => [file.path, file]));
  const conflicts = [];
  for (const mine of left.files) {
    const other = theirs.get(mine.path);
    if (!other) continue;
    if (mine.head === other.head) continue;
    const forks = [left.fork, right.fork];
    if (mine.base === null && other.base === null) {
      conflicts.push({ forks, path: mine.path, kind: "both-added" });
      continue;
    }
    if (mine.head === null || other.head === null) {
      conflicts.push({ forks, path: mine.path, kind: "delete-vs-edit" });
      continue;
    }
    if (mine.base !== other.base || mine.base === null) {
      conflicts.push({ forks, path: mine.path, kind: "same-file" });
      continue;
    }
    const [base, a, b] = await Promise.all([
      readers.left.readText(mine.base),
      readers.left.readText(mine.head),
      readers.right.readText(other.head)
    ]);
    if (base === null || a === null || b === null) {
      conflicts.push({ forks, path: mine.path, kind: "same-file" });
      continue;
    }
    const baseLines = splitLines(base);
    const overlaps = overlappingHunks(
      changedHunks(baseLines, splitLines(a)),
      changedHunks(baseLines, splitLines(b))
    );
    if (overlaps.length)
      conflicts.push({
        forks,
        path: mine.path,
        kind: "overlapping-lines",
        lines: overlaps.map(({ left: l, right: r }) => ({ left: display(l), right: display(r) }))
      });
  }
  return conflicts;
}
__name(conflictsBetween, "conflictsBetween");
async function allConflicts(forks, reader) {
  const sorted = [...forks].sort((a, b) => a.fork.localeCompare(b.fork));
  const results = [];
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++)
      results.push(
        ...await conflictsBetween(sorted[i], sorted[j], {
          left: reader(sorted[i].fork),
          right: reader(sorted[j].fork)
        })
      );
  return results;
}
__name(allConflicts, "allConflicts");

// src/objects.ts
function objectReader(repo) {
  const candidate = repo;
  for (const method of ["readCommit", "readTree", "readBlob", "log"])
    if (typeof candidate[method] !== "function")
      throw new Error(
        `This Artifacts binding cannot ${method}. Update the Worker's compatibility date.`
      );
  return candidate;
}
__name(objectReader, "objectReader");
var CachedReader = class {
  constructor(inner) {
    this.inner = inner;
  }
  inner;
  static {
    __name(this, "CachedReader");
  }
  trees = /* @__PURE__ */ new Map();
  texts = /* @__PURE__ */ new Map();
  readCommit(hash) {
    return this.inner.readCommit(hash);
  }
  log(opts) {
    return this.inner.log(opts);
  }
  readBlob(hash) {
    return this.inner.readBlob(hash);
  }
  readTree(hash) {
    let tree = this.trees.get(hash);
    if (!tree) {
      tree = this.inner.readTree(hash);
      this.trees.set(hash, tree);
    }
    return tree;
  }
  /** UTF-8 text of a blob, or null when it is missing, too large or binary. */
  readText(hash, limit = 1e6) {
    let text2 = this.texts.get(hash);
    if (!text2) {
      text2 = this.inner.readBlob(hash).then(async (blob) => {
        if (!blob || blob.size > limit) return null;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes.subarray(0, 8e3).includes(0)) return null;
        return new TextDecoder().decode(bytes);
      });
      this.texts.set(hash, text2);
    }
    return text2;
  }
};
async function repoInfo(handle) {
  const info = await handle.info();
  if (typeof info?.remote !== "string" || typeof info.defaultBranch !== "string")
    throw new Error("Artifacts did not describe the repository.");
  return { name: String(info.name ?? ""), remote: info.remote, defaultBranch: info.defaultBranch };
}
__name(repoInfo, "repoInfo");

// src/swarm.ts
var HASH = /^[0-9a-f]{40}$/;
var REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
var TOKEN_TTL = 86400;
var Swarm = class extends DurableObject {
  static {
    __name(this, "Swarm");
  }
  chain = Promise.resolve();
  /** Runs work one at a time so concurrent pushes never interleave state writes. */
  serial(work) {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => void 0);
    return next;
  }
  async records() {
    const stored = await this.ctx.storage.list({ prefix: "fork:" });
    return [...stored.values()].sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
  }
  async state(repo) {
    return {
      repo,
      forks: await this.records(),
      conflicts: await this.ctx.storage.get("conflicts") ?? [],
      updatedAt: await this.ctx.storage.get("updatedAt") ?? (/* @__PURE__ */ new Date(0)).toISOString()
    };
  }
  /** Creates the attempt's fork and returns a write token for pushing to it. */
  async register(repo, input) {
    if (!REPO.test(repo)) throw new SwarmError("Unknown repository name.");
    const attemptId = text(input.attemptId, 80);
    const baseCommit = text(input.baseCommit, 40).toLowerCase();
    if (!HASH.test(baseCommit))
      throw new SwarmError("Send the 40-character commit the attempt started from.");
    const fork = forkName(repo, attemptId);
    return this.serial(async () => {
      const existing = await this.ctx.storage.get(`fork:${fork}`);
      const base = await this.env.ARTIFACTS.get(repo);
      let created;
      if (existing) {
        const handle = await this.env.ARTIFACTS.get(fork);
        const token = await handle.createToken("write", TOKEN_TTL);
        created = {
          remote: (await repoInfo(handle)).remote,
          token: token.plaintext,
          tokenExpiresAt: token.expiresAt
        };
      } else {
        const forked = await base.fork(fork, {
          description: text(input.title, 200, "Jackalope agent attempt"),
          defaultBranchOnly: true
        });
        created = {
          remote: forked.remote,
          token: forked.token,
          tokenExpiresAt: new Date(Date.now() + TOKEN_TTL * 1e3).toISOString()
        };
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const record = existing ?? {
        fork,
        attemptId,
        agent: text(input.agent, 60, "agent"),
        title: text(input.title, 200, "Untitled attempt"),
        baseCommit,
        head: null,
        files: [],
        truncated: false,
        error: null,
        registeredAt: now,
        updatedAt: now
      };
      await this.ctx.storage.put(`fork:${fork}`, record);
      await this.touch(repo);
      return {
        fork,
        remote: created.remote,
        token: created.token,
        tokenExpiresAt: created.tokenExpiresAt,
        branch: (await repoInfo(base)).defaultBranch
      };
    });
  }
  /** A new write token for an existing fork; tokens expire after a day. */
  async token(fork) {
    if (!await this.ctx.storage.get(`fork:${fork}`)) throw new SwarmError("Unknown fork.", 404);
    const handle = await this.env.ARTIFACTS.get(fork);
    const token = await handle.createToken("write", TOKEN_TTL);
    const { remote } = await repoInfo(handle);
    return { fork, remote, token: token.plaintext, tokenExpiresAt: token.expiresAt };
  }
  /** Re-reads one fork after a push and recomputes conflicts across all forks. */
  async analyze(repo, fork) {
    return this.serial(async () => {
      const record = await this.ctx.storage.get(`fork:${fork}`);
      if (!record) throw new SwarmError("Unknown fork.", 404);
      const readers = /* @__PURE__ */ new Map();
      const reader = /* @__PURE__ */ __name(async (name) => {
        let cached = readers.get(name);
        if (!cached) {
          cached = new CachedReader(objectReader(await this.env.ARTIFACTS.get(name)));
          readers.set(name, cached);
        }
        return cached;
      }, "reader");
      const now = (/* @__PURE__ */ new Date()).toISOString();
      try {
        const handle = await this.env.ARTIFACTS.get(fork);
        const own = await reader(fork);
        const { defaultBranch } = await repoInfo(handle);
        const [head] = await own.log({ ref: defaultBranch, limit: 1 });
        if (!head) throw new SwarmError("The fork has no commits yet. Push the attempt first.");
        const changes = await changedFiles(own, record.baseCommit, head.hash);
        Object.assign(record, {
          head: head.hash,
          files: changes.files,
          truncated: changes.truncated,
          error: null,
          updatedAt: now
        });
      } catch (cause) {
        Object.assign(record, {
          error: cause instanceof Error ? cause.message : String(cause),
          updatedAt: now
        });
      }
      await this.ctx.storage.put(`fork:${fork}`, record);
      const forks = await this.records();
      for (const other of forks)
        if (other.fork !== fork) await reader(other.fork).catch(() => void 0);
      const conflicts = await allConflicts(
        forks.filter((item) => item.head && !item.error),
        (name) => readers.get(name)
      );
      await this.ctx.storage.put("conflicts", conflicts);
      await this.touch(repo);
      return this.broadcast(repo);
    });
  }
  /** Stops tracking a fork, optionally deleting its repository. */
  async release(repo, fork, remove) {
    return this.serial(async () => {
      await this.ctx.storage.delete(`fork:${fork}`);
      if (remove) await this.env.ARTIFACTS.delete(fork).catch(() => false);
      const remaining = new Set((await this.records()).map((item) => item.fork));
      const conflicts = (await this.ctx.storage.get("conflicts") ?? []).filter(
        (conflict) => conflict.forks.every((name) => remaining.has(name))
      );
      await this.ctx.storage.put("conflicts", conflicts);
      await this.touch(repo);
      return this.broadcast(repo);
    });
  }
  async touch(repo) {
    await this.ctx.storage.put({ updatedAt: (/* @__PURE__ */ new Date()).toISOString(), repo });
  }
  async broadcast(repo) {
    const state = await this.state(repo);
    const message = JSON.stringify({ type: "state", state });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
      }
    }
    return state;
  }
  /** Live state for subscribers; hibernates between pushes. */
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    const repo = await this.ctx.storage.get("repo") ?? new URL(request.url).searchParams.get("repo") ?? "";
    pair[1].send(JSON.stringify({ type: "state", state: await this.state(repo) }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage() {
  }
};

// src/index.ts
var json = /* @__PURE__ */ __name((body2, status = 200) => Response.json(body2, { status, headers: { "Cache-Control": "no-store" } }), "json");
async function body(request) {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
__name(body, "body");
var NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, version: env.SWARM_VERSION ?? null });
    if (!await authorized(request, env.SWARM_TOKEN))
      return json({ error: "Send the swarm token as a bearer token." }, 401);
    const match = /^\/v1\/swarms\/([^/]+)(?:\/(live|forks)(?:\/([^/]+)(?:\/(analyze|token))?)?)?$/.exec(
      url.pathname
    );
    if (!match) return json({ error: "Not found." }, 404);
    const [, repo, section, fork, action] = match;
    if (!NAME.test(repo) || fork && !NAME.test(fork))
      return json({ error: "Invalid name." }, 400);
    if (fork && !fork.startsWith(`${repo.slice(0, 80)}--`))
      return json({ error: "That fork does not belong to this repository." }, 400);
    const namespace = env.SWARM;
    const swarm = namespace.get(namespace.idFromName(repo));
    try {
      if (section === "live") {
        if (request.headers.get("Upgrade") !== "websocket")
          return json({ error: "Expected a WebSocket upgrade." }, 426);
        return swarm.fetch(
          new Request(`https://swarm/live?repo=${encodeURIComponent(repo)}`, request)
        );
      }
      if (!section && request.method === "GET") return json(await swarm.state(repo));
      if (section === "forks" && !fork && request.method === "POST")
        return json(await swarm.register(repo, await body(request)), 201);
      if (fork && action === "analyze" && request.method === "POST")
        return json(await swarm.analyze(repo, fork));
      if (fork && action === "token" && request.method === "POST")
        return json(await swarm.token(fork));
      if (fork && !action && request.method === "DELETE")
        return json(await swarm.release(repo, fork, url.searchParams.get("delete") === "1"));
      return json({ error: "Not found." }, 404);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const known = cause instanceof SwarmError || /^(Unknown|Send|Use|That|The fork)/.test(message);
      if (/^Unknown fork|not found/i.test(message)) return json({ error: message }, 404);
      return json({ error: message }, known ? 400 : 502);
    }
  }
};
export {
  Swarm,
  index_default as default
};
