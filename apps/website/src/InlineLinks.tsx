import type { ReactNode } from 'react';

// Content paragraphs may contain Markdown-style links: [anchor](/path/) or [anchor](https://…).
// Only root-relative and https targets are recognised; anything else stays plain text.
const inlineLinkPattern = /\[([^\]]+)\]\(((?:\/(?!\/)|https:\/\/)[^)\s]*)\)/g;

export const stripInlineLinks = (text: string) => text.replace(inlineLinkPattern, '$1');

export function InlineLinks({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(inlineLinkPattern)) {
    const [whole, label, href] = match;
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <a key={`${match.index}-${href}`} href={href}>
        {label}
      </a>,
    );
    last = match.index + whole.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
