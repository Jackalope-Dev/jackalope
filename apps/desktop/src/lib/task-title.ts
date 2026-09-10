export function taskTitle(prompt: string): string {
  const objective = prompt.trim().replace(/^### 🎯 Objective\r?\n/, '');
  const firstLine = objective.split(/\r?\n/).find((line) => line.trim()) ?? '';
  const title = firstLine
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return title.length > 100 ? `${title.slice(0, 99).trimEnd()}…` : title || 'Untitled task';
}
