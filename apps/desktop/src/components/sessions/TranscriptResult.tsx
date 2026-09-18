import { lazy, Suspense, useState } from 'react';
import { Button } from '../ui/button';

const TaskMarkdown = lazy(() => import('../tasks/TaskMarkdown'));

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
  const [formatted, setFormatted] = useState(false);
  return recent || active || formatted ? (
    <Suspense fallback={<p className="whitespace-pre-wrap">{content}</p>}>
      <TaskMarkdown content={content} active={active} onOpenLink={onOpenLink} />
    </Suspense>
  ) : (
    <>
      <p className="whitespace-pre-wrap">{content}</p>
      <Button variant="ghost" onClick={() => setFormatted(true)}>
        Format earlier response
      </Button>
    </>
  );
}
