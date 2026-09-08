import { code } from '@streamdown/code';
import { Streamdown } from 'streamdown';
import { useColorScheme } from '../../hooks/useColorScheme';
import { safeResultLink } from '../../lib/task-workflow';
import 'streamdown/styles.css';
import './rich-content.css';

export default function TaskMarkdown({
  content,
  active,
  onOpenLink,
}: {
  content: string;
  active: boolean;
  onOpenLink: (url: string) => void;
}) {
  const scheme = useColorScheme();
  return (
    <div className={`task-markdown ${scheme}`}>
      <Streamdown
        skipHtml
        mode={active ? 'streaming' : 'static'}
        isAnimating={active}
        plugins={{ code }}
        controls={{ code: { copy: true, download: false }, table: false, image: false }}
        components={{
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
}
