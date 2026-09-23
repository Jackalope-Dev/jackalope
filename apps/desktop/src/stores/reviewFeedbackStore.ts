import { create } from 'zustand';
import type { ReviewComment } from '../lib/review-feedback';

const key = 'jackalope-review-feedback';
type Threads = Record<string, ReviewComment[]>;
function read(): Threads {
  const stored = localStorage.getItem(key);
  if (!stored) return {};
  const value = JSON.parse(stored).state?.threads;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Object.values(value).every(
      (comments) =>
        Array.isArray(comments) &&
        comments.every(
          (comment) =>
            comment &&
            typeof comment.id === 'string' &&
            typeof comment.file === 'string' &&
            typeof comment.text === 'string' &&
            typeof comment.revision === 'string' &&
            typeof comment.resolved === 'boolean' &&
            Number.isSafeInteger(comment.line) &&
            comment.line > 0 &&
            ['additions', 'deletions'].includes(comment.side) &&
            (comment.excerpt === undefined || typeof comment.excerpt === 'string'),
        ),
    )
  )
    throw new Error('Saved comments could not be read. The original record is preserved.');
  return value;
}
function initial() {
  try {
    return { threads: read(), error: '' };
  } catch (cause) {
    return { threads: {}, error: String(cause) };
  }
}
interface ReviewFeedbackState {
  threads: Threads;
  error: string;
  save: (task: string, comment: ReviewComment) => void;
  remove: (task: string, id: string) => void;
}

export const useReviewFeedbackStore = create<ReviewFeedbackState>()((set) => {
  const update = (change: (threads: Threads) => Threads) => {
    const threads = change(read());
    const value = JSON.stringify({ state: { threads }, version: 0 });
    if (value.length > 2_000_000)
      throw new Error('Comment storage is full. Remove old comments before saving another.');
    localStorage.setItem(key, value);
    set({ threads, error: '' });
  };
  return {
    ...initial(),
    save: (task, comment) =>
      update((threads) => ({
        ...threads,
        [task]: [...(threads[task] ?? []).filter((item) => item.id !== comment.id), comment],
      })),
    remove: (task, id) =>
      update((threads) => ({
        ...threads,
        [task]: (threads[task] ?? []).filter((item) => item.id !== id),
      })),
  };
});
if (typeof window !== 'undefined')
  window.addEventListener('storage', (event) => {
    if (event.key === key) useReviewFeedbackStore.setState(initial());
  });
