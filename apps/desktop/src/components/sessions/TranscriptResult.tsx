import { lazy, Suspense, useEffect, useRef, useState } from 'react';

const TaskMarkdown = lazy(() => import('../tasks/TaskMarkdown'));

/**
 * A reply in a transcript. Recent and active replies render as Markdown straight away;
 * older ones show as plain text until they come near the viewport, so a long transcript
 * does not parse every reply up front. Once formatted, a reply stays formatted.
 */
export function TranscriptResult({
  content,
  active,
  recent,
  onOpenLink,
}: {
  content: string;
  active: boolean;
  recent: boolean;
  onOpenLink: (url: string) => void;
}) {
  const [seen, setSeen] = useState(false);
  const plain = useRef<HTMLParagraphElement>(null);
  const formatted = recent || active || seen;
  useEffect(() => {
    const element = plain.current;
    if (formatted || !element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
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
