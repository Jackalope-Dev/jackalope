import { type FileDiffMetadata, parsePatchFiles } from '@pierre/diffs';
import { FileDiff, Virtualizer, WorkerPoolContextProvider } from '@pierre/diffs/react';
import { useEffect, useMemo, useState } from 'react';
import { useColorScheme } from '../../hooks/useColorScheme';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import './rich-content.css';

const poolOptions = {
  poolSize: 2,
  totalASTLRUCacheSize: 32,
  workerFactory: () =>
    new Worker(new URL('../../lib/diff-highlight.worker.ts', import.meta.url), { type: 'module' }),
};
const highlighterOptions = {
  theme: { light: 'github-light', dark: 'github-dark' },
  preferredHighlighter: 'shiki-js' as const,
};

export default function RichDiff({ patch, file }: { patch: string; file?: string }) {
  const scheme = useColorScheme();
  const [split, setSplit] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [raw, setRaw] = useState(false);
  const [parse, setParse] = useState<{ patch: string; files?: FileDiffMetadata[] }>();
  const small = patch.length <= 64_000;
  const immediate = useMemo(() => {
    if (!small) return undefined;
    try {
      const files = parsePatchFiles(patch, undefined, true).flatMap((entry) => entry.files);
      return files.length ? files : undefined;
    } catch {
      return undefined;
    }
  }, [patch, small]);
  useEffect(() => {
    if (small) return;
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const fail = () => {
      clearTimeout(timer);
      worker?.terminate();
      setParse({ patch });
    };
    try {
      worker = new Worker(new URL('../../lib/patch.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<{ files?: FileDiffMetadata[] }>) => {
        clearTimeout(timer);
        setParse({ patch, files: event.data.files?.length ? event.data.files : undefined });
        worker?.terminate();
      };
      worker.onerror = fail;
      worker.postMessage(patch);
      timer = setTimeout(fail, 15_000);
    } catch {
      fail();
    }
    return () => {
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [patch, small]);
  const loading = !small && parse?.patch !== patch;
  const parsed = small ? immediate : loading ? undefined : parse?.files;
  const selected = file
    ? parsed?.filter((entry) => entry.name === file || entry.prevName === file)
    : parsed;
  const unmatched = Boolean(!loading && file && !selected?.length);
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
        <InlineNotice>Showing all changes because this file could not be isolated.</InlineNotice>
      )}
      {!loading && !parsed && patch && (
        <InlineNotice>Showing the original patch because it could not be rendered.</InlineNotice>
      )}
      {loading && !raw ? (
        <InlineNotice role="status">Preparing code changes…</InlineNotice>
      ) : raw || !files ? (
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
          <WorkerPoolContextProvider
            poolOptions={poolOptions}
            highlighterOptions={highlighterOptions}
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
          </WorkerPoolContextProvider>
        </section>
      )}
    </div>
  );
}
