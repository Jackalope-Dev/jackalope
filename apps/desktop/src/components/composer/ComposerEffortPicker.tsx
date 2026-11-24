import { Button, Choice, Popover } from '@jackalope/ui';
import { ChevronDown, Gauge } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isTauriEnvironment } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import { effortLabel, type ReasoningEffort } from '../../lib/reasoning-effort';
import './composer.css';

/**
 * The provider effort levels `agent` (Automatic for `auto`) takes with `model`, and
 * whether they were read. A failed read offers none, so no level is sent unchecked.
 */
export function useEffortLevels(
  projectId: string | undefined,
  agent: string,
  model: string | undefined,
) {
  const [state, setState] = useState<{ levels: ReasoningEffort[]; loaded: boolean }>({
    levels: [],
    loaded: false,
  });
  useEffect(() => {
    if (!isTauriEnvironment() || !agent) {
      setState({ levels: [], loaded: !!agent });
      return;
    }
    let canceled = false;
    setState((current) => ({ ...current, loaded: false }));
    invokeNative<ReasoningEffort[]>('task_effort_levels', { projectId, agent, model })
      .then((levels) => {
        if (!canceled) setState({ levels, loaded: true });
      })
      .catch(() => {
        if (!canceled) setState({ levels: [], loaded: true });
      });
    return () => {
      canceled = true;
    };
  }, [projectId, agent, model]);
  return state;
}

/**
 * Chooses how hard the model thinks for the next send: the agent's own default or one
 * of the levels its model takes, from Decisions' model records or Jackalope's measured
 * table. Hidden when the agent or model takes none. Separate from the task approach.
 */
export function ComposerEffortPicker({
  levels,
  loaded,
  automatic,
  value,
  onChange,
  open,
  onOpenChange,
  disabled,
}: {
  levels: ReasoningEffort[];
  loaded: boolean;
  /** Automatic picks the agent later, so its model clamps the level. */
  automatic?: boolean;
  value: ReasoningEffort | null;
  onChange: (value: ReasoningEffort | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}) {
  // A remembered level the newly chosen agent or model lacks no longer applies.
  useEffect(() => {
    if (loaded && value && !levels.includes(value)) onChange(null);
  }, [loaded, levels, value, onChange]);
  if (!levels.length) return null;
  const label = value ? effortLabel(value) : 'Default';
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="outline"
          className="composer-effort-trigger"
          aria-label={`Effort: ${label}`}
        >
          <Gauge size={16} aria-hidden="true" />
          <span>{label}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="composer-effort" align="end" sideOffset={8}>
          <fieldset className="composer-effort-options">
            <legend className="sr-only">Effort</legend>
            <Choice
              selected={!value}
              onClick={() => {
                onChange(null);
                onOpenChange(false);
              }}
              title="Default"
              description={automatic ? 'Each agent’s own setting' : 'The agent’s own setting'}
            />
            {levels.map((level) => (
              <Choice
                key={level}
                selected={value === level}
                onClick={() => {
                  onChange(level);
                  onOpenChange(false);
                }}
                title={effortLabel(level)}
              />
            ))}
          </fieldset>
          <p className="composer-effort-hint">
            {automatic
              ? 'Applies to the next message. The chosen agent’s model takes the nearest level it supports.'
              : 'Applies to the next message.'}
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
