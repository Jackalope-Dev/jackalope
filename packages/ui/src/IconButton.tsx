import { forwardRef } from 'react';
import { Button, type ButtonProps } from './Button';
export type IconButtonProps = Omit<ButtonProps, 'size' | 'aria-label'> & { label: string };
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, variant = 'ghost', type = 'button', ...props }, ref) => (
    <Button {...props} ref={ref} type={type} variant={variant} size="icon" aria-label={label} />
  ),
);
IconButton.displayName = 'IconButton';
