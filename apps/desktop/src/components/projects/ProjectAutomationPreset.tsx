import { describeError } from '@jackalope/contracts/errors';
import { Button, ChoiceCards, InlineNotice, SettingBody, SettingGroup } from '@jackalope/ui';
import { Gauge, Hand, Rocket } from 'lucide-react';
import { useState } from 'react';
import { isTauriEnvironment } from '../../lib/native/env';
import { type PlanSettings, planCommands } from '../../lib/plan-mode';
import {
  AUTOMATION_PRESETS,
  type AutomationPreset,
  type AutomationValues,
  automationChanges,
  automationValues,
  automationWrites,
  matchingPreset,
} from '../../lib/project-automation';
import { type Project, useProjectStore } from '../../stores/projectStore';
import { ActionError } from '../ui/ActionError';

const OPTIONS = [
  {
    value: 'hands-on' as const,
    title: 'Hands-on',
    description:
      'Agents ask before tool use and plan decisions. You check and teach them yourself.',
    icon: <Hand size={18} aria-hidden="true" />,
  },
  {
    value: 'balanced' as const,
    title: 'Balanced',
    description: 'Routine tool use is approved and work splits into subtasks. Plans still ask you.',
    icon: <Gauge size={18} aria-hidden="true" />,
  },
  {
    value: 'autonomous' as const,
    title: 'Autonomous',
    description:
      'Agents check their results, learn, and settle routine plan questions so long builds keep moving.',
    icon: <Rocket size={18} aria-hidden="true" />,
  },
];

const PRESET_NAMES: Record<AutomationPreset, string> = {
  'hands-on': 'Hands-on',
  balanced: 'Balanced',
  autonomous: 'Autonomous',
};

/**
 * Sets the automation toggles and plan autonomy together. The preset is derived from the
 * current values every render, so it never overrides what the controls below say.
 */
export function ProjectAutomationPreset({
  project,
  plan,
  onPlanSaved,
}: {
  project: Project;
  /** The project's plan settings, or undefined outside the desktop app or while loading. */
  plan: PlanSettings | undefined;
  onPlanSaved: (next: PlanSettings) => void;
}) {
  const [applied, setApplied] = useState<{
    preset: AutomationPreset;
    previous: AutomationValues;
    changes: ReturnType<typeof automationChanges>;
  }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = automationValues(project.preferences, plan);
  const preset = matchingPreset(current);

  const write = async (values: AutomationValues) => {
    const { preferences, plan: nextPlan } = automationWrites(
      values,
      plan ?? { questionCap: 3, exportPath: '' },
    );
    useProjectStore.getState().updateProjectPreferences(project.id, preferences);
    if (plan && isTauriEnvironment()) {
      await planCommands.saveSettings(project.id, nextPlan);
      onPlanSaved(nextPlan);
    }
  };

  const apply = async (next: AutomationPreset, previous = current) => {
    setBusy(true);
    setError('');
    try {
      await write(AUTOMATION_PRESETS[next]);
      setApplied({
        preset: next,
        previous,
        changes: automationChanges(previous, AUTOMATION_PRESETS[next]),
      });
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!applied) return;
    setBusy(true);
    setError('');
    try {
      await write(applied.previous);
      setApplied(undefined);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingGroup
      title="How hands-on?"
      description={
        preset === 'custom'
          ? 'Custom: your settings below mix presets. Pick one to set them all at once.'
          : 'Sets the switches below together. You can still change any of them on its own.'
      }
    >
      <SettingBody>
        <ChoiceCards
          label="How hands-on should agents be in this project?"
          value={preset === 'custom' ? undefined : preset}
          disabled={busy}
          onValueChange={(next) => void apply(next)}
          options={OPTIONS}
        />
        {!plan && isTauriEnvironment() && (
          <p className="settings-section-subtitle">
            Plan autonomy settings are still loading; a preset picked now sets only the task
            switches.
          </p>
        )}
        {applied && (
          <InlineNotice
            tone="success"
            action={
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void undo()}>
                Undo
              </Button>
            }
          >
            {applied.changes.length ? (
              <>
                Switched to {PRESET_NAMES[applied.preset]}:{' '}
                {applied.changes
                  .map((change) => `${change.label} ${change.to ? 'on' : 'off'}`)
                  .join(', ')}
                .
              </>
            ) : (
              <>Already {PRESET_NAMES[applied.preset]}; nothing changed.</>
            )}
          </InlineNotice>
        )}
        <ActionError error={error} />
      </SettingBody>
    </SettingGroup>
  );
}
