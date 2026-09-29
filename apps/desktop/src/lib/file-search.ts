/**
 * Ranks project paths for quick open. Every query character must appear in
 * order; matches in the file name, at word starts and in runs score higher,
 * and shorter paths win ties.
 */
export function searchFiles(files: string[], query: string, limit = 8): string[] {
  const needle = query.trim().toLowerCase().replace(/\\/g, '/');
  if (!needle) return [];
  const scored: { path: string; score: number }[] = [];
  for (const path of files) {
    const score = scorePath(path, needle);
    if (score !== null) scored.push({ path, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
    .slice(0, limit)
    .map((item) => item.path);
}

function scorePath(path: string, needle: string): number | null {
  const haystack = path.toLowerCase();
  const nameStart = haystack.lastIndexOf('/') + 1;
  const name = haystack.slice(nameStart);
  if (name.includes(needle)) return 1000 + (name.startsWith(needle) ? 200 : 0) - name.length;
  if (haystack.includes(needle)) return 600 - haystack.length / 10;
  let score = 0;
  let previous = -2;
  let index = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, index);
    if (found < 0) return null;
    if (found === previous + 1) score += 5;
    const before = haystack[found - 1];
    if (found === 0 || before === '/' || before === '-' || before === '_' || before === '.')
      score += 8;
    if (found >= nameStart) score += 3;
    previous = found;
    index = found + 1;
  }
  return score;
}
