import { parsePatchFiles } from '@pierre/diffs';
import { FileDiff, Virtualizer } from '@pierre/diffs/react';
import { useMemo, useState } from 'react';
import { useColorScheme } from '../../hooks/useColorScheme';
import { Button } from '../ui/button';
import './rich-content.css';

export default function RichDiff({ patch, file }: { patch: string; file?: string }) {
  const scheme = useColorScheme();
  const [split, setSplit] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [raw, setRaw] = useState(false);
  const parsed = useMemo(() => {
    try {
      const files = parsePatchFiles(patch, undefined, true).flatMap((entry) => entry.files);
      return files.length ? files : undefined;
    } catch {
      return undefined;
    }
  }, [patch]);
  const selected = file
    ? parsed?.filter((entry) => entry.name === file || entry.prevName === file)
    : parsed;
  const unmatched = Boolean(file && !selected?.length);
  const files = unmatched ? parsed : selected;
  return (
    <div className="rich-diff">
      <fieldset className="rich-content-toolbar" aria-label="Diff display">
        <Button variant="ghost" aria-pressed={split} onClick={() => setSplit(!split)}>
          {split ? 'Split view' : 'Unified view'}
        </Button>
        <Button variant="ghost" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
          Wrap lines
        </Button>
        <Button variant="ghost" aria-pressed={raw} onClick={() => setRaw(!raw)}>
          Original patch
        </Button>
      </fieldset>
      {unmatched && (
        <p className="task-notice">Showing all changes because this file could not be isolated.</p>
      )}
      {!parsed && patch && (
        <p className="task-notice">Showing the original patch because it could not be rendered.</p>
      )}
      {raw || !files ? (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The original patch supports keyboard scrolling.
        <section className="rich-diff-raw" aria-label="Original patch" tabIndex={0}>
          <pre style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}>
            {patch || 'No text changes to display.'}
          </pre>
        </section>
      ) : (
        <section
          aria-label="Code changes"
          className="rich-diff-region"
          ref={(node) => {
            const viewport = node?.firstElementChild;
            if (viewport instanceof HTMLElement) viewport.tabIndex = 0;
          }}
        >
          <Virtualizer
            className="rich-diff-scroll"
            style={{
              height: `min(60vh, ${Math.min(
                640,
                Math.max(
                  120,
                  files.reduce(
                    (height, entry) =>
                      height + (split ? entry.splitLineCount : entry.unifiedLineCount) * 20 + 56,
                    0,
                  ),
                ),
              )}px)`,
            }}
          >
            {files.map((entry) => (
              <FileDiff
                key={entry.name}
                fileDiff={entry}
                options={{
                  diffStyle: split ? 'split' : 'unified',
                  overflow: wrap ? 'wrap' : 'scroll',
                  theme: { light: 'github-light', dark: 'github-dark' },
                  themeType: scheme,
                  preferredHighlighter: 'shiki-js',
                }}
              />
            ))}
          </Virtualizer>
        </section>
      )}
    </div>
  );
}
