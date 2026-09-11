import { createElement, forwardRef, type HTMLAttributes } from 'react';
import { cn } from './utils';
import './panel.css';

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'article' | 'aside' | 'div';
  variant?: 'elevated' | 'plain';
}
export const Panel = forwardRef<HTMLElement, PanelProps>(
  ({ as = 'section', variant = 'elevated', className, ...props }, ref) =>
    createElement(as, {
      ...props,
      ref,
      className: cn('ui-panel', className),
      'data-variant': variant,
    }),
);
Panel.displayName = 'Panel';
export function PanelHeader({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <header {...props} className={cn('ui-panel-header', className)} />;
}
export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('ui-panel-body', className)} />;
}
export function PanelFooter({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <footer {...props} className={cn('ui-panel-footer', className)} />;
}
