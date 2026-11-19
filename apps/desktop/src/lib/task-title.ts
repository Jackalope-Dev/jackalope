const PATH =
  /(\s+(?:in|at|inside|under|within|from)\s+)?(?<=^|[\s(])((?:[A-Za-z]:)?[\\/][^\s,;()'"`]*[^\s,;()'"`.!?:])/g;
const HOME = /^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\/Users\/[^/]+)(?=\/|$)/i;

const LEADING_ID =
  /^(?:resume\s+)?(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=[0-9a-f]*\d)[0-9a-f]{12,})\b[\s:,.\-–—]*/i;

/** Drops a leading run id (a UUID or long hex id, after an optional "resume") that resumed
    or scripted prompts start with, unless the id is all the title has. */
export function withoutLeadingId(title: string): string {
  const rest = title.replace(LEADING_ID, '');
  if (rest === title || !rest.trim()) return title;
  return rest[0].toUpperCase() + rest.slice(1);
}

const normalPath = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '');

/** Agents often restate the checkout's absolute path, which the task's project already
    shows: the root itself drops (with the "in" before it), paths inside it read relative to
    it, and other paths in the home folder start with ~. Other text is left unchanged. */
function shortenPaths(line: string, roots: readonly (string | null | undefined)[]): string {
  const bases = roots
    .filter((root): root is string => !!root?.trim())
    .map(normalPath)
    .sort((a, b) => b.length - a.length);
  return line.replace(PATH, (match, lead: string | undefined, raw: string) => {
    const path = normalPath(raw);
    const lower = path.toLowerCase();
    for (const base of bases) {
      const root = base.toLowerCase();
      if (lower === root) return lead ? '' : (base.split('/').pop() ?? match);
      if (lower.startsWith(`${root}/`)) return `${lead ?? ''}${path.slice(base.length + 1)}`;
    }
    const home = HOME.exec(path);
    return home ? `${lead ?? ''}~${path.slice(home[0].length)}` : match;
  });
}

/** The task's display title. `roots` are the task's project and workspace folders. */
export function taskTitle(
  prompt = '',
  savedTitle?: string,
  roots: readonly (string | null | undefined)[] = [],
): string {
  const firstLine = prompt.trim().split(/\r?\n/)[0];
  if (savedTitle?.trim() && savedTitle.trim() !== firstLine.slice(0, 160)) return savedTitle.trim();
  const lines = prompt
    .replace(/```[\s\S]*?(?:```|$)/g, '')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:#{1,6}\s*|[-*+]\s+|\d+[.)]\s+)/, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*`#]/g, ''),
    )
    .map((line) => shortenPaths(line, roots).replace(/\s+/g, ' ').trim())
    .filter(
      (line) =>
        line &&
        !/^(?:🎯\s*)?(?:objective|request|task|context|instructions|description)\s*:?$/i.test(line),
    );
  const objective =
    lines.find((line) => /^(?:🎯\s*)?(?:objective|task|request)\s*:/i.test(line)) ?? lines[0] ?? '';
  let title = withoutLeadingId(
    objective.replace(/^(?:🎯\s*)?(?:objective|task|request)\s*:\s*/i, ''),
  );
  for (let index = 0; index < 3; index++) {
    title = title.replace(
      /^(?:(?:hey|hi|hello)[,!]?\s+|please\s+|(?:can|could|would) you\s+|(?:i think\s+)?we (?:should|need to|want to)\s+|i (?:want|need|would like)(?: you)? to\s+|let['’]?s\s+|help me\s+|maybe\s+)/i,
      '',
    );
  }
  title = title.split(/(?:[.!?](?:\s|$)|\s+(?:because|so that|in order to)\s+)/)[0].trim();
  const words = title.split(/\s+/);
  if (words.length > 10) title = words.slice(0, 10).join(' ');
  if (title.length > 72) title = title.slice(0, 72).replace(/\s+\S*$/, '');
  // A cut inside a parenthetical drops its unclosed remainder.
  title = title
    .replace(/\s*\([^)]*$/, '')
    .replace(/(?:\s+(?:a|an|the|to|with|for|of|and|or|in|on|that|which))+$/i, '')
    .replace(/[,:;.!?\s]+$/, '');
  return title ? title[0].toUpperCase() + title.slice(1) : 'Untitled task';
}

/** A run's display title, with its own project and workspace paths shortened. */
export function runTitle(run: {
  prompt?: string;
  projectPath?: string | null;
  workspace?: string | null;
}): string {
  return taskTitle(run.prompt, undefined, [run.projectPath, run.workspace]);
}
