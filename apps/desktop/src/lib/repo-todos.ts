export const TODO_FILES = [
  'TODO.md',
  'TASKS.md',
  'ROADMAP.md',
  'docs/TODO.md',
  'docs/TASKS.md',
  'docs/ROADMAP.md',
] as const;

export interface RepoTodoDocument {
  path: string;
  content: string | null;
  error: string | null;
}

export interface RepoTodoItem {
  line: number;
  title: string;
  completed: boolean;
  section: string;
  sectionLine: number;
  depth: number;
}

const taskPattern = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*)$/;

export function parseRepoTodos(content: string): RepoTodoItem[] {
  const items: RepoTodoItem[] = [];
  let section = 'Tasks';
  let sectionLine = -1;
  let fence: { marker: string; length: number } | null = null;
  for (const [line, raw] of content.split('\n').entries()) {
    const text = raw.replace(/\r$/, '');
    const marker = text.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], length: marker[1].length };
      else if (
        marker[1][0] === fence.marker &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = null;
      continue;
    }
    if (fence) continue;
    const heading = text.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*$/);
    if (heading) {
      section = heading[1];
      sectionLine = line;
    }
    const task = text.match(taskPattern);
    if (task)
      items.push({
        line,
        title: task[4],
        completed: task[2] !== ' ',
        section,
        sectionLine,
        depth: text.match(/^\s*/)?.[0].length ?? 0,
      });
  }
  return items;
}

export function updateRepoTodo(
  content: string,
  line: number,
  change: { title?: string; completed?: boolean },
): string {
  if (change.title !== undefined && (!change.title.trim() || /[\r\n]/.test(change.title)))
    throw new Error('Use a single, non-empty line for the TODO.');
  const lines = content.split('\n');
  const original = lines[line];
  if (original === undefined || !parseRepoTodos(content).some((item) => item.line === line))
    throw new Error('This TODO has changed. Reopen it to edit.');
  const ending = original.endsWith('\r') ? '\r' : '';
  lines[line] =
    original
      .replace(/\r$/, '')
      .replace(
        taskPattern,
        (_, prefix, checked, suffix, title) =>
          `${prefix}${change.completed === undefined ? checked : change.completed ? 'x' : ' '}${suffix}${change.title ?? title}`,
      ) + ending;
  return lines.join('\n');
}

export function appendRepoTodo(content: string, title: string): string {
  if (!title.trim() || /[\r\n]/.test(title))
    throw new Error('Use a single, non-empty line for the TODO.');
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  return `${content}${content && !content.endsWith('\n') ? newline : ''}- [ ] ${title.trim()}${newline}`;
}
