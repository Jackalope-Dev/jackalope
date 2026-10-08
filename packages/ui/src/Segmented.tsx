import type { ReactNode, Ref } from 'react';
import { useSegmentIndicator } from './useSegmentIndicator';
import { cn } from './utils';
import './segmented.css';

export interface SegmentItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Shown as a quiet count chip after the label; announced as part of the name. */
  count?: number;
  disabled?: boolean;
}

function SegmentLabel({ item }: { item: SegmentItem<string> }) {
  return (
    <>
      {item.label}
      {item.count !== undefined && <span className="ui-segment-count">{item.count}</span>}
    </>
  );
}

/** Pressed filter choices on one track; the chosen option is a raised segment. */
export function SegmentedControl<T extends string>({
  label,
  items,
  value,
  onChange,
  activeRef,
  className,
}: {
  label: string;
  items: readonly SegmentItem<T>[];
  value: T;
  onChange: (value: T) => void;
  activeRef?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  const track = useSegmentIndicator<HTMLFieldSetElement>();
  return (
    <fieldset ref={track} className={cn('ui-segmented', className)}>
      <legend className="ui-sr-only">{label}</legend>
      <span className="ui-segmented-indicator" aria-hidden="true" />
      {items.map((item) => (
        <button
          key={item.id}
          ref={value === item.id ? activeRef : undefined}
          type="button"
          className="ui-segment"
          aria-pressed={value === item.id}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
        >
          <SegmentLabel item={item} />
        </button>
      ))}
    </fieldset>
  );
}

/**
 * Navigation between peer views with the same look as SegmentedControl. The current view
 * carries aria-current so assistive technology announces it as the open page.
 */
export function SegmentedNav<T extends string>({
  label,
  items,
  value,
  onChange,
  className,
}: {
  label: string;
  items: readonly SegmentItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const track = useSegmentIndicator<HTMLElement>();
  return (
    <nav ref={track} aria-label={label} className={cn('ui-segmented', className)}>
      <span className="ui-segmented-indicator" aria-hidden="true" />
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="ui-segment"
          aria-current={value === item.id ? 'page' : undefined}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
        >
          <SegmentLabel item={item} />
        </button>
      ))}
    </nav>
  );
}
