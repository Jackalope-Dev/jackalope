import type { CodebaseSnapshot } from './codebase';

export function affectedFiles(snapshot: CodebaseSnapshot, changed: string[]) {
  const reverse = new Map<string, Set<string>>();
  for (const reference of snapshot.references) {
    if (!reference.target || reference.status !== 'resolved') continue;
    const sources = reverse.get(reference.target) ?? new Set<string>();
    sources.add(reference.source);
    reverse.set(reference.target, sources);
  }
  const visited = new Set(changed);
  const queue = [...changed];
  for (let index = 0; index < queue.length; index++) {
    for (const source of reverse.get(queue[index]) ?? []) {
      if (visited.has(source)) continue;
      visited.add(source);
      queue.push(source);
    }
  }
  return queue.filter((path) => !changed.includes(path)).sort();
}
