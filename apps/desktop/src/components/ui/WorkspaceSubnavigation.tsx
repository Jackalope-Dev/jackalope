export function WorkspaceSubnavigation<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: readonly { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <nav aria-label={label} className="workspace-subnavigation">
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          aria-current={value === item.id ? 'page' : undefined}
          onClick={() => onChange(item.id)}
          className="workspace-nav-item"
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
