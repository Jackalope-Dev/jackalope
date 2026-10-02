import { createHash } from 'node:crypto';
import type { CommitMetadata, ObjectReader, TreeEntry } from '../src/objects';

const sha = (value: string) => createHash('sha1').update(value).digest('hex');

/** An in-memory object store shaped like the Artifacts binding's Git reads. */
export class FakeRepo implements ObjectReader {
  readonly blobs = new Map<string, string>();
  readonly trees = new Map<string, TreeEntry[]>();
  readonly commits = new Map<string, CommitMetadata>();
  treeReads = 0;

  /** Stores a snapshot of `files` (path → content) and returns its commit hash. */
  commit(files: Record<string, string>, message = 'snapshot') {
    const root = this.writeTree(files, '');
    const hash = sha(`commit ${root} ${message} ${this.commits.size}`);
    this.commits.set(hash, { hash, treeHash: root, message, author: { name: 'a', email: 'a@x' } });
    return hash;
  }

  private writeTree(files: Record<string, string>, prefix: string): string {
    const children = new Map<string, Record<string, string>>();
    const entries: TreeEntry[] = [];
    for (const [path, content] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) {
        const hash = sha(`blob ${content}`);
        this.blobs.set(hash, content);
        entries.push({ name: rest, mode: '100644', hash, type: 'blob' });
      } else {
        const name = rest.slice(0, slash);
        children.set(name, { ...children.get(name), [path]: content });
      }
    }
    for (const [name, subset] of children)
      entries.push({
        name,
        mode: '40000',
        hash: this.writeTree(subset, `${prefix}${name}/`),
        type: 'tree',
      });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const hash = sha(`tree ${JSON.stringify(entries)}`);
    this.trees.set(hash, entries);
    return hash;
  }

  /** Copies another repo's objects, as a fork shares its parent's history. */
  forkFrom(parent: FakeRepo) {
    for (const [k, v] of parent.blobs) this.blobs.set(k, v);
    for (const [k, v] of parent.trees) this.trees.set(k, v);
    for (const [k, v] of parent.commits) this.commits.set(k, v);
    return this;
  }

  async readCommit(hash: string) {
    return this.commits.get(hash) ?? null;
  }
  async readTree(hash: string) {
    this.treeReads++;
    return this.trees.get(hash) ?? null;
  }
  async readBlob(hash: string) {
    const content = this.blobs.get(hash);
    return content === undefined ? null : new Blob([content]);
  }
  async log() {
    return [...this.commits.values()].slice(-1);
  }
}
