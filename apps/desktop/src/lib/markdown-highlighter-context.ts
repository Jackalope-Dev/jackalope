import { createContext } from 'react';
import type { createMarkdownHighlighter } from './markdown-highlighter.ts';

/** The code highlighter replies in one transcript share, created on first use. */
export interface SharedMarkdownHighlighter {
  current?: ReturnType<typeof createMarkdownHighlighter>;
}

/**
 * Lets a transcript give its replies one highlighting worker and cache, so replies that
 * scroll in and out of a virtualized list do not each start a worker.
 */
export const MarkdownHighlighterContext = createContext<SharedMarkdownHighlighter | null>(null);
