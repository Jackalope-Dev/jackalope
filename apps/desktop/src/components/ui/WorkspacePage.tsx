import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import './workspace-layout.css';

export const WorkspacePage = forwardRef<HTMLElement, ComponentPropsWithoutRef<'section'>>(
  ({ className = '', ...props }, ref) => (
    <section ref={ref} className={`workspace-page-layout ${className}`} {...props} />
  ),
);
WorkspacePage.displayName = 'WorkspacePage';
