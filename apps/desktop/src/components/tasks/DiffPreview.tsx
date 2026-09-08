import { Component, lazy, type ReactNode, Suspense } from 'react';

const RichDiff = lazy(() => import('./RichDiff'));

class DiffBoundary extends Component<{ patch: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div>
        <p className="task-notice">
          The formatted diff is unavailable. The original patch is shown below.
        </p>
        <section
          aria-label="Original patch"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The fallback patch needs keyboard scrolling.
          tabIndex={0}
          className="max-h-96 overflow-auto select-text"
        >
          <pre>{this.props.patch}</pre>
        </section>
      </div>
    ) : (
      this.props.children
    );
  }
}

export function DiffPreview(props: { patch: string; file?: string }) {
  return (
    <DiffBoundary patch={props.patch}>
      <Suspense fallback={<p role="status">Opening diff…</p>}>
        <RichDiff {...props} />
      </Suspense>
    </DiffBoundary>
  );
}
