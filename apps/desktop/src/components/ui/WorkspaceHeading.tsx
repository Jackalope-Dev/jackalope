import type { ReactNode } from 'react';

export function WorkspaceHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-5 pb-6">
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold tracking-[-0.045em] leading-tight text-[var(--color-text-primary)]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            {description}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}
