import { forwardRef, useImperativeHandle, useRef } from 'react';
import { BorderBeamLayer } from './BorderBeam';
import { CloseIcon, SearchIcon } from './Icon';
import { IconButton } from './IconButton';
import { Input, type InputProps } from './input';
import { cn } from './utils';
import './search-field.css';

export type SearchFieldProps = Omit<InputProps, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  clearLabel?: string;
  containerClassName?: string;
  /** Results are loading: sweeps a beam along the field's bottom edge and sets aria-busy. */
  busy?: boolean;
};
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  (
    {
      value,
      onValueChange,
      clearLabel = 'Clear search',
      containerClassName,
      className,
      busy,
      ...props
    },
    ref,
  ) => {
    const input = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => input.current as HTMLInputElement, []);
    return (
      <div className={cn('ui-search-field', containerClassName)}>
        <BorderBeamLayer variant="line" active={!!busy} />
        <SearchIcon className="ui-search-icon" />
        <Input
          {...props}
          ref={input}
          aria-busy={busy || undefined}
          type="search"
          className={cn('ui-search-input', className)}
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
        />
        {value && !props.readOnly && (
          <IconButton
            type="button"
            label={clearLabel}
            className="ui-search-clear"
            disabled={props.disabled}
            onClick={() => {
              onValueChange('');
              input.current?.focus();
            }}
          >
            <CloseIcon />
          </IconButton>
        )}
      </div>
    );
  },
);
SearchField.displayName = 'SearchField';
