/** Removes `//` and block comments and trailing commas outside strings. */
function stripComments(text) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      result += text.slice(start, i + 1);
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      result += '\n';
    } else if (char === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
      if (i === 0) throw new Error('Unterminated comment in JSONC.');
    } else result += char;
  }
  return result.replace(/,(\s*[}\]])/g, '$1');
}

/** Parses JSON with comments, such as a wrangler.jsonc. */
export function parseJsonc(text) {
  return JSON.parse(stripComments(text));
}
