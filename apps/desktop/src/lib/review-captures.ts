import type { ScreenshotArtifact } from './task-runtime.ts';

/** Most distinct pages captured per attempt; matches the native limit. */
export const REVIEW_PAGE_LIMIT = 6;

export interface ReviewCapture {
  path: string;
  viewport: 'desktop' | 'narrow';
  width: number;
  height: number;
  /** Why the page was chosen: `configured`, `plan` or `visited`. */
  reasons: string[];
  /** Plan criteria tagged `browser` that name this page. */
  criteria: string[];
  before?: ScreenshotArtifact | null;
  after?: ScreenshotArtifact | null;
}

export interface ReviewCaptures {
  capturedAt: string;
  /** Whether the before side ran; when false, `notes` says why. */
  beforeAvailable: boolean;
  pages: ReviewCapture[];
  notes: string[];
}

/** Captures run when a preview command is saved, unless the project turned them off. */
export function reviewCapturesOn(
  preferences: { previewCommand?: string; reviewCaptures?: boolean } | undefined,
): boolean {
  return !!preferences?.previewCommand?.trim() && preferences.reviewCaptures !== false;
}

/** Saved review pages as the native side reads them: trimmed, nonblank paths. */
export function reviewPagesForRegistry(pages: string[] | undefined): string[] | undefined {
  const kept = (pages ?? []).map((page) => page.trim()).filter(Boolean);
  return kept.length ? kept : undefined;
}

/** Pages with at least one image, in capture order. */
export function capturedPages(captures: ReviewCaptures | null | undefined): ReviewCapture[] {
  return (captures?.pages ?? []).filter((page) => page.after || page.before);
}
