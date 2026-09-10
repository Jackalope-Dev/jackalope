import { lazy, Suspense } from 'react';

const Markdown = lazy(() => import('react-markdown'));

export function ReleaseNotes({ notes }: { notes: string }) {
  const text = notes.slice(0, 24000);
  return (
    <div className="space-y-2 break-words text-sm mt-2 [&_h2]:font-medium [&_h2]:mt-4 [&_h3]:font-medium [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1">
      <Suspense fallback={<p className="whitespace-pre-wrap">{text}</p>}>
        <Markdown
          skipHtml
          disallowedElements={['img']}
          components={{ a: ({ children }) => <span>{children}</span> }}
        >
          {text}
        </Markdown>
      </Suspense>
    </div>
  );
}
