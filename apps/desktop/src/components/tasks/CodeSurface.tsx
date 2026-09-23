import type { ReactNode } from 'react';

export function CodeSurface({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: This scroll region needs keyboard access to long code and logs.
    <section className={`task-experience-code ${className}`} tabIndex={0} aria-label={label}>
      <pre>{children}</pre>
    </section>
  );
}
