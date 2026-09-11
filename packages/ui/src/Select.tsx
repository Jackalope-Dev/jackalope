import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import './select.css';

type SelectProps = Pick<
  SelectPrimitive.SelectProps,
  'value' | 'onValueChange' | 'disabled' | 'name' | 'required' | 'children'
> &
  Pick<
    ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>,
    'id' | 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'aria-invalid' | 'className'
  > & { placeholder?: string; nonce?: string };

export function Select({
  value,
  onValueChange,
  disabled,
  name,
  required,
  children,
  className = '',
  placeholder,
  nonce,
  ...triggerProps
}: SelectProps) {
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
      required={required}
    >
      <SelectPrimitive.Trigger {...triggerProps} className={`themed-select ${className}`}>
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={16} aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="themed-select-menu"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
        >
          <SelectPrimitive.ScrollUpButton className="themed-select-scroll">
            <ChevronUp size={16} aria-hidden="true" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="themed-select-viewport" nonce={nonce}>
            {children}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="themed-select-scroll">
            <ChevronDown size={16} aria-hidden="true" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function SelectItem({ children, ...props }: SelectPrimitive.SelectItemProps) {
  return (
    <SelectPrimitive.Item {...props} className="themed-select-option">
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="themed-select-check">
        <Check size={16} aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
