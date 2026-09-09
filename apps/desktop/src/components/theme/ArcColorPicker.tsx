import { applyThemeTokens } from '@jackalope/brand/theme';
import * as Popover from '@radix-ui/react-popover';
import { RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/Tooltip';
import { ThemeEditor } from './ThemeEditor';

export function ArcColorPicker({
  scope = 'project',
  variant = 'toolbar',
}: {
  scope?: 'app' | 'project';
  variant?: 'toolbar' | 'titlebar';
}) {
  const theme = useThemeStore();
  const currentTheme = scope === 'app' ? theme.appTheme : theme.currentTheme;
  const setTheme = scope === 'app' ? theme.setAppTheme : theme.setTheme;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(currentTheme);
  useEffect(() => {
    if (!open) return;
    useThemeStore.setState({ previewing: true });
    return () => {
      useThemeStore.setState({ previewing: false });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    applyThemeTokens(draft);
    return () => applyThemeTokens(useThemeStore.getState().currentTheme);
  }, [open, draft]);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(currentTheme);
        setOpen(next);
      }}
    >
      <Tooltip content="Personalize your workspace">
        <Popover.Trigger asChild>
          <button
            type="button"
            className={variant === 'titlebar' ? 'app-titlebar-button' : 'appearance-trigger'}
            aria-label="Personalize your workspace"
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={() => {
              if (open) setTheme(draft);
            }}
          >
            <span
              className={`${variant === 'titlebar' ? 'size-4' : 'size-5'} rounded-full`}
              style={{
                background: 'var(--color-palette-gradient)',
              }}
            />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={12}
          collisionPadding={16}
          onInteractOutside={() => setTheme(draft)}
          aria-label="Workspace appearance"
          className="workspace-appearance appearance-panel w-[340px] max-w-[calc(100vw-2rem)] p-5 z-[70]"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base tracking-tight font-semibold">Appearance</h2>
            <Popover.Close asChild>
              <button type="button" className="quiet-icon" aria-label="Cancel theme preview">
                <X className="size-4" />
              </button>
            </Popover.Close>
          </div>
          <ThemeEditor value={draft} onChange={setDraft} />
          <div className="flex justify-between items-center pt-5 mt-5 border-t border-[var(--color-border-subtle)]">
            <button
              type="button"
              onClick={() => setDraft(currentTheme)}
              className="text-xs text-[var(--color-text-secondary)] flex gap-1.5 items-center"
            >
              <RotateCcw className="size-3" />
              Reset preview
            </button>
            <Button
              size="sm"
              onClick={() => {
                setTheme(draft);
                setOpen(false);
              }}
            >
              Keep theme
            </Button>
          </div>
          <Popover.Arrow className="fill-[var(--color-surface-elevated)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
