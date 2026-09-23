import { DropdownMenu as Menu } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { MoreHorizontal } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';

export function ChatOptions({
  items,
  onClose,
}: {
  items: { id: string; label: string; content: (close: () => void) => ReactNode }[];
  onClose?: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const item = items.find((entry) => entry.id === selected);
  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="outline"
            size="icon"
            aria-label="Chat options"
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            className="workspace-menu"
            align="end"
            sideOffset={8}
            collisionPadding={12}
            onCloseAutoFocus={(event) => {
              if (item) event.preventDefault();
            }}
          >
            {items.map((entry) => (
              <Menu.Item
                key={entry.id}
                className="workspace-menu-item"
                onSelect={() => setSelected(entry.id)}
              >
                {entry.label}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <Dialog.Root open={!!item} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent
          className="chat-options-dialog"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (onClose) onClose();
            else trigger.current?.focus();
          }}
        >
          <DialogHeader title={item?.label} />
          <DialogCloseButton />
          {item?.content(() => setSelected(null))}
        </DialogContent>
      </Dialog.Root>
    </>
  );
}
