import { IconButton, DropdownMenu as Menu } from '@jackalope/ui';
import { MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';

/** A row or card's secondary actions behind one options button; children are menu items. */
export function OptionsMenu({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton label={label} disabled={disabled}>
          <MoreHorizontal size={16} aria-hidden="true" />
        </IconButton>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="workspace-menu" align="end" sideOffset={6}>
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
