import type { FileDiffMetadata } from '@pierre/diffs';

export interface ReviewAnchor {
  file: string;
  line: number;
  side: 'additions' | 'deletions';
  excerpt?: string;
}

export interface ReviewComment extends ReviewAnchor {
  id: string;
  revision: string;
  text: string;
  resolved: boolean;
}

export function appendFeedbackDraft(current: string, feedback: string, limit = 12000): string {
  if (current === feedback || current.endsWith(`\n\n${feedback}`)) return current;
  const combined = [current, feedback].filter(Boolean).join('\n\n');
  if (new TextEncoder().encode(combined).length > limit)
    throw new Error('Send or shorten your follow-up before adding more feedback.');
  return combined;
}

export function reviewFeedback(comments: ReviewComment[], revision: string): string {
  const pending = comments.filter((comment) => !comment.resolved);
  if (!pending.length) throw new Error('Add a comment before preparing feedback.');
  const text = [
    'Address these review comments, preserve unrelated work, and verify the changes. Confirm each location against the current source before editing.',
    ...pending.map(
      (comment, index) =>
        `${index + 1}. ${comment.file}:${comment.line} (${comment.side === 'deletions' ? 'original' : 'updated'} code${comment.revision !== revision ? '; earlier patch, location needs rechecking' : ''})\n${comment.excerpt ? `Reviewed code: ${JSON.stringify(comment.excerpt)}\n` : ''}${comment.text}`,
    ),
  ].join('\n\n');
  if (new TextEncoder().encode(text).length > 12000)
    throw new Error('Shorten the comments or resolve some before adding feedback.');
  return text;
}

export function reviewExcerpt(
  file: FileDiffMetadata,
  line: number,
  side: ReviewAnchor['side'],
): string | undefined {
  const key = side === 'additions' ? 'addition' : 'deletion';
  const hunk = file.hunks.find(
    (hunk) => line >= hunk[`${key}Start`] && line < hunk[`${key}Start`] + hunk[`${key}Count`],
  );
  if (!hunk) return;
  return file[`${key}Lines`][hunk[`${key}LineIndex`] + line - hunk[`${key}Start`]]
    ?.trimEnd()
    .slice(0, 500);
}
