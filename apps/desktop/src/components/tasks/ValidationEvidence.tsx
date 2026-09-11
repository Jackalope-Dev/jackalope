import { Disclosure, DisclosureSummary } from '@jackalope/ui';
export function ValidationEvidence({ text }: { text: string }) {
  let formatted = text;
  if (text.startsWith('{')) {
    try {
      formatted = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // Truncated reports remain readable as plain text.
    }
  }
  return text.length > 400 ? (
    <Disclosure className="w-full min-w-0 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-xs">
      <DisclosureSummary className="cursor-pointer p-2">Read recorded findings</DisclosureSummary>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Long evidence needs keyboard scrolling. */}
      <section aria-label="Recorded findings" tabIndex={0} className="max-h-80 overflow-auto p-2">
        <pre className="whitespace-pre-wrap [overflow-wrap:anywhere] font-mono">{formatted}</pre>
      </section>
    </Disclosure>
  ) : (
    <span className="max-w-full [overflow-wrap:anywhere] px-2 py-0.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] font-mono">
      {text}
    </span>
  );
}
