import { SegmentedNav, type SegmentItem } from '@jackalope/ui';

/** Peer views of one workspace area, as a segmented control aligned with the page gutter. */
export function WorkspaceSubnavigation<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: readonly SegmentItem<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="workspace-subnavigation">
      <SegmentedNav label={label} items={items} value={value} onChange={onChange} />
    </div>
  );
}
