import { forwardRef, useImperativeHandle, useRef } from 'react';
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
};
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  (
    { value, onValueChange, clearLabel = 'Clear search', containerClassName, className, ...props },
    ref,
  ) => {
    const input = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => input.current as HTMLInputElement);
    return (
      <div className={cn('ui-search-field', containerClassName)}>
        <SearchIcon className="ui-search-icon" />
        <Input
          {...props}
          ref={input}
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
