import type { CachedReader, TreeEntry } from './objects';

/** One path an agent's fork changed relative to the commit it started from. */
export interface ChangedFile {
  path: string;
  /** Blob hash at the base commit, or null when the agent added the path. */
  base: string | null;
  /** Blob hash at the fork head, or null when the agent deleted the path. */
  head: string | null;
}

export interface ForkChanges {
  files: ChangedFile[];
  /** True when the tree walk stopped at its limit; listed files are still accurate. */
  truncated: boolean;
}

const ENTRY_LIMIT = 50_000;
const FILE_LIMIT = 2_000;

const isFile = (entry: TreeEntry) => entry.type !== 'tree' && entry.type !== 'gitlink';

/**
 * Paths that differ between two commits. Subtrees with equal hashes are skipped,
 * so cost follows the size of the change rather than the repository.
 */
export async function changedFiles(
  reader: CachedReader,
  baseCommit: string,
  headCommit: string,
): Promise<ForkChanges> {
  if (baseCommit === headCommit) return { files: [], truncated: false };
  const [base, head] = await Promise.all([
    reader.readCommit(baseCommit),
    reader.readCommit(headCommit),
  ]);
  if (!base) throw new Error(`Base commit ${baseCommit.slice(0, 12)} is not in this repository.`);
  if (!head) throw new Error(`Commit ${headCommit.slice(0, 12)} is not in this repository.`);
  const files: ChangedFile[] = [];
  let visited = 0;
  let truncated = false;

  const walk = async (prefix: string, baseTree: string | null, headTree: string | null) => {
    if (baseTree === headTree || truncated) return;
    const [left, right] = await Promise.all([
      baseTree ? reader.readTree(baseTree) : Promise.resolve([]),
      headTree ? reader.readTree(headTree) : Promise.resolve([]),
    ]);
    const before = new Map((left ?? []).map((entry) => [entry.name, entry]));
    const after = new Map((right ?? []).map((entry) => [entry.name, entry]));
    for (const name of new Set([...before.keys(), ...after.keys()])) {
      visited++;
      if (visited > ENTRY_LIMIT || files.length >= FILE_LIMIT) {
        truncated = true;
        return;
      }
      const a = before.get(name);
      const b = after.get(name);
      if (a?.hash === b?.hash && a?.type === b?.type) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      const aTree = a?.type === 'tree' ? a.hash : null;
      const bTree = b?.type === 'tree' ? b.hash : null;
      if (aTree || bTree) await walk(path, aTree, bTree);
      const aFile = a && isFile(a) ? a.hash : null;
      const bFile = b && isFile(b) ? b.hash : null;
      if (aFile !== bFile) files.push({ path, base: aFile, head: bFile });
    }
  };

  await walk('', base.treeHash, head.treeHash);
  files.sort((x, y) => x.path.localeCompare(y.path));
  return { files, truncated };
}
