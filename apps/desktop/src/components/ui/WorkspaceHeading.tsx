import type { ReactNode } from 'react';

export function WorkspaceHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-5 pb-6">
      <div className="max-w-xl">
        {eyebrow && <p className="mb-3 text-[11px] tracking-[0.16em] uppercase text-[var(--color-text-muted)]">{eyebrow}</p>}
        <h1 className="text-[28px] font-semibold tracking-[-0.045em] leading-tight text-[var(--color-text-primary)]">{title}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">{description}</p>
      </div>
      {action}
    </header>
  );
}
