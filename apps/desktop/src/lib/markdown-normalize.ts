/**
 * Agents sometimes return a whole answer wrapped in a ```markdown fence or indented
 * four spaces, which renders as one code block. Unwrap only those shapes; real code
 * blocks, and fences in other languages, are left as written.
 */
export function normalizeAgentMarkdown(content: string): string {
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
