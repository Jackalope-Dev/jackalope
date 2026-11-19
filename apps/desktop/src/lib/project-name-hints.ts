interface NamedProject {
  id: string;
  name: string;
  path: string;
}

const segments = (path: string) => path.split(/[\\/]+/).filter(Boolean);

/**
 * For projects whose names clash, the shortest run of trailing parent folders that tells
 * each one apart (VS Code style), keyed by project id. Unique names get no hint; when parent
 * folders cannot separate two projects the full path is used, and the same folder added
 * twice gets none because no path tells the entries apart.
 */
export function projectNameHints(projects: readonly NamedProject[]): Map<string, string> {
  const hints = new Map<string, string>();
  const byName = new Map<string, NamedProject[]>();
  for (const project of projects) {
    const key = project.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), project]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const paths = group.map((project) => segments(project.path));
    group.forEach((project, index) => {
      const own = paths[index];
      const others = paths.filter((other, at) => at !== index && other.join('/') !== own.join('/'));
      if (!others.length) return;
      const parents = own.slice(0, -1);
      const tail = (parts: string[], length: number) => parts.slice(0, -1).slice(-length).join('/');
      for (let length = 1; length <= parents.length; length++) {
        const hint = parents.slice(-length).join('/');
        if (others.every((other) => tail(other, length) !== hint)) {
          hints.set(project.id, hint);
          return;
        }
      }
      hints.set(project.id, project.path);
    });
  }
  return hints;
}
