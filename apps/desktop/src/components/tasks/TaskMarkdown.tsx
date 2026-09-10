import { memo, useEffect, useMemo } from 'react';
import { Streamdown } from 'streamdown';
import { useColorScheme } from '../../hooks/useColorScheme';
import { createMarkdownHighlighter } from '../../lib/markdown-highlighter';
import { ResultImage } from '../../lib/result-images';
import { safeResultLink } from '../../lib/task-workflow';
import 'streamdown/styles.css';
import './rich-content.css';

export default memo(function TaskMarkdown({
  content,
  active,
  onOpenLink,
}: {
  content: string;
  active: boolean;
  onOpenLink: (url: string) => void;
}) {
  const scheme = useColorScheme();
  const highlighter = useMemo(createMarkdownHighlighter, []);
  useEffect(() => highlighter.dispose, [highlighter]);
  const plugins = useMemo(() => ({ code: highlighter.plugin }), [highlighter]);
  return (
    <div className={`task-markdown ${scheme}`}>
      <Streamdown
        skipHtml
        mode={active ? 'streaming' : 'static'}
        isAnimating={active}
        plugins={plugins}
        controls={{ code: { copy: true, download: false }, table: false, image: false }}
        components={{
          img: ({ src, alt }) => <ResultImage src={src} alt={alt} onOpenLink={onOpenLink} />,
          table: ({ children }) => (
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Wide tables need keyboard scrolling.
            <section className="task-result-table" aria-label="Result table" tabIndex={0}>
              <table>{children}</table>
            </section>
          ),
          a: ({ href, children }) => {
            const safe = safeResultLink(href);
            return safe ? (
              <button
                type="button"
                className="task-link result-link"
                onClick={() => onOpenLink(safe)}
              >
                {children}
              </button>
            ) : (
              <span>{children}</span>
            );
          },
        }}
      >
        {content}
      </Streamdown>
    </div>
  );
});
