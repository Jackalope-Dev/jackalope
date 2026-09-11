import * as Primitive from '@radix-ui/react-tooltip';
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react';
import { cn } from './utils';
import './overlays.css';
export function Tooltip({
  children,
  content,
  side = 'bottom',
  className,
}: {
  children: ReactElement;
  content: ReactNode;
  side?: ComponentPropsWithoutRef<typeof Primitive.Content>['side'];
  className?: string;
}) {
  return (
    <Primitive.Provider delayDuration={350}>
      <Primitive.Root>
        <Primitive.Trigger asChild>{children}</Primitive.Trigger>
        <Primitive.Portal>
          <Primitive.Content
            className={cn('ui-tooltip', className)}
            side={side}
            sideOffset={8}
            collisionPadding={12}
          >
            {content}
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
    </Primitive.Provider>
  );
}
