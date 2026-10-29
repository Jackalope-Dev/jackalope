/**
 * Agents sometimes return a whole answer wrapped in a ```markdown fence or indented
 * four spaces, which renders as one code block. Unwrap only those shapes; real code
 * blocks, and fences in other languages, are left as written.
 */
export function normalizeAgentMarkdown(content: string): string {
  return unwrapAgentMarkdown(readableFrontMatter(content));
}

function unwrapAgentMarkdown(content: string): string {
  const trimmed = content.trim();
  const fence = /^(`{3,}|~{3,})[ \t]*(markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/i.exec(
    trimmed,
  );
  if (fence && (fence[2] || looksLikeProse(fence[3]))) {
    // A nested fence of the same length would have ended this one early.
    if (!new RegExp(`^${fence[1]}`, 'm').test(fence[3])) return fence[3];
  }
  const lines = content.split(/\r?\n/);
  const filled = lines.filter((line) => line.trim());
  if (filled.length > 1 && filled.every((line) => /^( {4}|\t)/.test(line))) {
    const indent = Math.min(...filled.map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0));
    return lines.map((line) => line.slice(Math.min(indent, line.length))).join('\n');
  }
  return content;
}

/** Headings, lists or several sentences: an unlabelled fence around these is prose, not code. */
function looksLikeProse(body: string) {
  const markdown = /^(#{1,6} |[-*] |\d+\. |> )/m.test(body);
  const code = /[;{}]\s*$|^\s*(import|export|const|let|function|def|class|return)\b/m.test(body);
  return markdown && !code;
}

/**
 * Leading `key: value` metadata closed by `---`, as plans begin, otherwise renders as one
 * long heading. It becomes a list with readable labels; the opening `---` is optional
 * because agents sometimes drop it.
 */
function readableFrontMatter(content: string): string {
  const match = /^\s*(?:---[ \t]*\r?\n)?((?:[A-Za-z][\w-]*:[^\n]*\r?\n)+)---[ \t]*(?:\r?\n|$)/.exec(
    content,
  );
  if (!match) return content;
  const rows = match[1]
    .split(/\r?\n/)
    .map((line) => /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line))
    .filter((row): row is RegExpExecArray => !!row && !!row[2].trim())
    .map(
      ([, key, value]) => `- **${label(key)}:** ${value.trim().replace(/^(["'])(.*)\1$/, '$2')}`,
    );
  const rest = content.slice(match[0].length).replace(/^\s+/, '');
  return rows.length ? `${rows.join('\n')}\n\n${rest}` : rest;
}

/** `recommendedShape` or `shape_reason` as "Recommended shape" or "Shape reason". */
function label(key: string) {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
