import { lazy, Suspense, startTransition, useEffect, useRef, useState } from 'react';

const TaskMarkdown = lazy(() => import('../tasks/TaskMarkdown'));

/**
 * A reply in a transcript. Recent and active replies render as Markdown straight away;
 * older ones show as plain text until they come near the viewport, so a long transcript
 * does not parse every reply up front. Once formatted, a reply stays formatted, and
 * `onFormatted` lets a virtualized list format it straight away when it scrolls back in.
 */
export function TranscriptResult({
  content,
  active,
  recent,
  onOpenLink,
  onFormatted,
}: {
  content: string;
  active: boolean;
  recent: boolean;
  onOpenLink: (url: string) => void;
  onFormatted?: () => void;
}) {
  const [seen, setSeen] = useState(false);
  const plain = useRef<HTMLParagraphElement>(null);
  const formatted = recent || active || seen;
  const reported = useRef(onFormatted);
  reported.current = onFormatted;
  useEffect(() => {
    if (formatted) reported.current?.();
  }, [formatted]);
  useEffect(() => {
    const element = plain.current;
    if (formatted || !element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        // Formatting can wait for scrolling and typing, which stay responsive meanwhile.
        if (entries.some((entry) => entry.isIntersecting)) startTransition(() => setSeen(true));
      },
      // Format a little ahead of scrolling so the reply is ready when it is read.
      { rootMargin: '800px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [formatted]);
  const text = (
    <p ref={formatted ? undefined : plain} className="whitespace-pre-wrap">
      {content}
    </p>
  );
  return formatted ? (
    <Suspense fallback={text}>
      <TaskMarkdown content={content} active={active} onOpenLink={onOpenLink} />
    </Suspense>
  ) : (
    text
  );
}
