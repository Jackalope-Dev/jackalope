import { applyThemeTokens } from '@jackalope/brand/theme';
import { Button, Popover, Tooltip } from '@jackalope/ui';
import { RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useThemeStore } from '../../stores/themeStore';
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
  // The project picker themes the open project; with none open it themes the app.
  const project = useProjectStore((state) =>
    scope === 'project'
      ? state.projects.find((item) => item.id === state.activeProjectId)
      : undefined,
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(currentTheme);
  /** Saves the draft only when it changed, so opening and dismissing the panel never creates
      a project theme the person didn't choose. */
  const keep = (next: typeof draft) => {
    if (next === currentTheme) return;
    if (project) useProjectStore.getState().updateProjectPreferences(project.id, { theme: next });
    else theme.setAppTheme(next);
  };
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
      <Tooltip content="Change theme">
        <Popover.Trigger asChild>
          <button
            type="button"
            className={variant === 'titlebar' ? 'app-titlebar-button' : 'appearance-trigger'}
            aria-label="Change theme"
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={() => {
              if (open) keep(draft);
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
          onInteractOutside={() => keep(draft)}
          aria-label="Workspace appearance"
          className="workspace-appearance appearance-panel w-[340px] max-w-[calc(100vw-2rem)] p-5 z-[70]"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base tracking-tight font-semibold">
              {project ? `${project.name} appearance` : 'Appearance'}
            </h2>
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
            <span className="flex gap-2">
              {project?.preferences?.theme && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    useProjectStore.getState().updateProjectPreferences(project.id, {
                      theme: undefined,
                    });
                    setOpen(false);
                  }}
                >
                  Use app theme
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  keep(draft);
                  setOpen(false);
                }}
              >
                Keep theme
              </Button>
            </span>
          </div>
          <Popover.Arrow className="fill-[var(--color-surface-elevated)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
