/**
 * The Git object reads the swarm needs from an Artifacts repository. The
 * binding gained these methods after Wrangler's bundled types were generated,
 * so they are declared here and checked at runtime.
 */

export interface TreeEntry {
  name: string;
  mode: string;
  hash: string;
  type: 'tree' | 'blob' | 'symlink' | 'gitlink' | 'exec';
}

export interface CommitMetadata {
  hash: string;
  treeHash: string;
  message: string;
  author: { name: string; email: string };
}

export interface ObjectReader {
  readCommit(hash: string): Promise<CommitMetadata | null>;
  readTree(hash: string): Promise<TreeEntry[] | null>;
  readBlob(hash: string): Promise<Blob | null>;
  log(opts?: { ref?: string; limit?: number }): Promise<CommitMetadata[]>;
}

export function objectReader(repo: unknown): ObjectReader {
  const candidate = repo as Partial<ObjectReader>;
  for (const method of ['readCommit', 'readTree', 'readBlob', 'log'] as const)
    if (typeof candidate[method] !== 'function')
      throw new Error(
        `This Artifacts binding cannot ${method}. Update the Worker's compatibility date.`,
      );
  return candidate as ObjectReader;
}

/** Caches immutable objects by hash so repeated analysis reads each object once. */
export class CachedReader implements ObjectReader {
  private readonly trees = new Map<string, Promise<TreeEntry[] | null>>();
  private readonly texts = new Map<string, Promise<string | null>>();
  constructor(private readonly inner: ObjectReader) {}
  readCommit(hash: string) {
    return this.inner.readCommit(hash);
  }
  log(opts?: { ref?: string; limit?: number }) {
    return this.inner.log(opts);
  }
  readBlob(hash: string) {
    return this.inner.readBlob(hash);
  }
  readTree(hash: string) {
    let tree = this.trees.get(hash);
    if (!tree) {
      tree = this.inner.readTree(hash);
      this.trees.set(hash, tree);
    }
    return tree;
  }
  /** UTF-8 text of a blob, or null when it is missing, too large or binary. */
  readText(hash: string, limit = 1_000_000) {
    let text = this.texts.get(hash);
    if (!text) {
      text = this.inner.readBlob(hash).then(async (blob) => {
        if (!blob || blob.size > limit) return null;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes.subarray(0, 8000).includes(0)) return null;
        return new TextDecoder().decode(bytes);
      });
      this.texts.set(hash, text);
    }
    return text;
  }
}

export interface RepoInfo {
  name: string;
  remote: string;
  defaultBranch: string;
}

/**
 * Repository metadata. Handles are RPC stubs whose fields are not readable
 * directly; `info()` is the supported call, though Wrangler's types omit it.
 */
export async function repoInfo(handle: unknown): Promise<RepoInfo> {
  const info = await (handle as { info(): Promise<Partial<RepoInfo>> }).info();
  if (typeof info?.remote !== 'string' || typeof info.defaultBranch !== 'string')
    throw new Error('Artifacts did not describe the repository.');
  return { name: String(info.name ?? ''), remote: info.remote, defaultBranch: info.defaultBranch };
}
