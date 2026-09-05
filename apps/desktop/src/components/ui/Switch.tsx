import type { ButtonHTMLAttributes } from 'react';

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  description?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  className = '',
  id,
  ...rest
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 ease-in-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent-ink)] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? 'bg-[var(--color-accent)] border-transparent'
          : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)]'
      } ${className}`}
      {...rest}
    >
      <span
        className={`pointer-events-none inline-block size-4 transform rounded-full shadow-sm ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
        style={{
          backgroundColor: checked ? 'var(--color-on-accent, #101010)' : 'var(--color-text-secondary)',
        }}
      />
    </button>
  );
}
