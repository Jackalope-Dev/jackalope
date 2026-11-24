import {
  Button,
  ChoiceCards,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  FieldCheck,
  FormField,
  InlineNotice,
  Input,
  Select,
  SelectItem,
  type SetupStep,
  SetupSteps,
  Switch,
  Textarea,
  useDialogFocus,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { BellRing, GitCommitHorizontal, Repeat } from 'lucide-react';
import { useState } from 'react';
import { PROMPT_MAX_CHARS } from '../../lib/run-types';
import type { ScheduleTemplate } from '../../lib/schedule-templates';
import { describeSchedule } from '../../lib/schedule-when';
import type { ScheduleDefinition as Definition } from '../../lib/schedules';
import { isAgentAllowedForProject, type Project } from '../../stores/projectStore';
import { TaskKnowledge } from '../knowledge/TaskKnowledge';
import { ActionError } from '../ui/ActionError';
import { WhenPicker } from './WhenPicker';

const POLICIES = [
  {
    value: 'always',
    title: 'Run an agent every time',
    icon: <Repeat size={18} />,
  },
  {
    value: 'run',
    title: 'Run only after code changes',
    icon: <GitCommitHorizontal size={18} />,
  },
  {
    value: 'notify',
    title: 'Notify about changes without an agent',
    icon: <BellRing size={18} />,
  },
] as const;

/** Whether the scheduler can read a timezone; it uses the same IANA names as the browser. */
function validTimezone(zone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return Boolean(zone.trim());
  } catch {
    return false;
  }
}

export function ScheduleEditDialog({
  editing,
  template,
  projects,
  projectId,
  onProjectIdChange,
  agent,
  onAgentChange,
  prompt,
  onPromptChange,
  templateContext,
  onTemplateContextChange,
  finalPrompt,
  runners,
  busy,
  error,
  onClose,
  onCloseAutoFocus,
  onSave,
  onEditingChange,
  existing = false,
}: {
  editing: Definition | null;
  template: ScheduleTemplate | null;
  projects: Project[];
  projectId: string;
  onProjectIdChange: (id: string) => void;
  agent: string;
  onAgentChange: (agent: string) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  templateContext: string;
  onTemplateContextChange: (ctx: string) => void;
  finalPrompt: string;

  runners: readonly { id: string; name: string; available: boolean }[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  onSave: () => Promise<void>;
  onEditingChange: (def: Definition) => void;
  /** An already saved schedule opens with every step showing; a new one walks the steps. */
  existing?: boolean;
}) {
  const focus = useDialogFocus();
  const project = projects.find((item) => item.id === projectId);
  const monitorOnly = editing?.monitor?.action === 'notify';
  const [step, setStep] = useState(0);

  const timezoneOk = editing ? validTimezone(editing.timezone) : true;
  const agentName =
    agent === 'auto' ? 'Jackalope chooses the agent' : runners.find((r) => r.id === agent)?.name;
  const whatReady = Boolean(editing?.name.trim() && project && (monitorOnly || prompt.trim()));
  const policy = editing?.monitor?.action ?? 'always';
  const next = (to: number, ready = true) =>
    !existing && (
      <Button type="button" size="sm" disabled={!ready} onClick={() => setStep(to)}>
        Continue
      </Button>
    );
  const stateOf = (index: number): SetupStep['state'] =>
    existing || index < step ? 'done' : index === step ? 'current' : 'upcoming';

  const scheduleSteps = (): SetupStep[] => {
    if (!editing) return [];
    return [
      {
        id: 'what',
        title: 'What to do',
        hint: 'Name it, pick the project and agent, and say what each run should do.',
        state: stateOf(0),
        summary: existing
          ? undefined
          : `${editing.name || 'Untitled'} · ${project?.name ?? 'No project'}${monitorOnly ? '' : ` · ${agentName ?? agent}`}`,
        content: (
          <div className="schedule-step">
            <div className="schedule-fields">
              <FormField label="Name">
                <Input
                  id="schedule-name"
                  required
                  maxLength={160}
                  value={editing.name}
                  onChange={(e) => onEditingChange({ ...editing, name: e.target.value })}
                />
              </FormField>
              <FormField label="Project">
                <Select
                  id="schedule-project"
                  value={projectId}
                  onValueChange={(value) => {
                    onProjectIdChange(value);
                    const nextProject = projects.find((item) => item.id === value);
                    if (agent !== 'auto' && !isAgentAllowedForProject(nextProject, agent)) {
                      onAgentChange('auto');
                    }
                    onEditingChange({
                      ...editing,
                      request: {
                        ...editing.request,
                        contextSelection: editing.request.contextSelection
                          ? { memoryOff: editing.request.contextSelection.memoryOff }
                          : undefined,
                      },
                    });
                  }}
                  aria-label="Schedule project"
                  placeholder="Choose a project"
                >
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </Select>
              </FormField>
              {!monitorOnly && (
                <FormField label="Agent">
                  <Select
                    id="schedule-agent"
                    value={agent}
                    onValueChange={onAgentChange}
                    aria-label="Schedule agent"
                    placeholder="Choose an agent"
                  >
                    <SelectItem value="auto">Let Jackalope choose</SelectItem>
                    {runners.map((r) => (
                      <SelectItem
                        key={r.id}
                        value={r.id}
                        disabled={
                          !r.available || !project || !isAgentAllowedForProject(project, r.id)
                        }
                      >
                        {r.name}
                      </SelectItem>
                    ))}
                  </Select>
                </FormField>
              )}
            </div>
            {!monitorOnly ? (
              <>
                <FormField label="Instructions">
                  <Textarea
                    id="schedule-instructions"
                    required
                    maxLength={PROMPT_MAX_CHARS}
                    rows={6}
                    value={prompt}
                    onChange={(e) => onPromptChange(e.target.value)}
                  />
                </FormField>
                {template && (
                  <FormField label="Project context (optional)">
                    <Textarea
                      id="schedule-template-context"
                      rows={2}
                      maxLength={4000}
                      value={templateContext}
                      onChange={(event) => onTemplateContextChange(event.target.value)}
                      placeholder={template.contextHint}
                    />
                  </FormField>
                )}
                {project && (
                  <TaskKnowledge
                    embedded
                    key={project.id}
                    projectId={project.id}
                    projectPath={project.path}
                    prompt={finalPrompt}
                    selection={editing.request.contextSelection}
                    onChange={(contextSelection) =>
                      onEditingChange({
                        ...editing,
                        request: { ...editing.request, contextSelection },
                      })
                    }
                  />
                )}
              </>
            ) : (
              <p className="task-muted">
                Watch committed changes on your local branch and receive a notification. No agent
                task runs.
              </p>
            )}
            {next(1, whatReady)}
          </div>
        ),
      },
      {
        id: 'when',
        title: 'When',
        hint: 'How often it runs, in which timezone, and what happens after a missed run.',
        state: stateOf(1),
        summary: existing
          ? undefined
          : `${describeSchedule(editing.expression)} · ${editing.timezone}`,
        content: (
          <div className="schedule-step">
            <WhenPicker
              key={editing.id}
              idPrefix="schedule"
              expression={editing.expression}
              timezone={timezoneOk ? editing.timezone : 'UTC'}
              onChange={(expression) => onEditingChange({ ...editing, expression })}
            />
            <div className="schedule-fields">
              <div className="schedule-timezone-field">
                <FormField label="Timezone">
                  <Input
                    id="schedule-timezone"
                    className="schedule-timezone"
                    required
                    aria-describedby="schedule-timezone-check"
                    value={editing.timezone}
                    onChange={(e) => onEditingChange({ ...editing, timezone: e.target.value })}
                    placeholder="America/Denver"
                  />
                </FormField>
                <FieldCheck id="schedule-timezone-check" tone={timezoneOk ? 'ok' : 'error'}>
                  {timezoneOk
                    ? 'Recognised timezone'
                    : 'Use a timezone name such as America/Denver or Europe/London.'}
                </FieldCheck>
              </div>
              <FormField
                label="After missed runs"
                description="Overlapping or interrupted runs are skipped and failed starts are not retried. Pausing keeps active runs."
              >
                <Select
                  id="schedule-missed"
                  value={editing.missed}
                  onValueChange={(missed) =>
                    onEditingChange({ ...editing, missed: missed as 'skip' | 'once' })
                  }
                  aria-label="Missed runs"
                >
                  <SelectItem value="skip">Skip to the next occurrence</SelectItem>
                  <SelectItem value="once">Catch up once when available</SelectItem>
                </Select>
              </FormField>
            </div>
            {next(2, timezoneOk)}
          </div>
        ),
      },
      {
        id: 'how',
        title: 'How it runs',
        hint: 'Every time, only after code changes, or just a notification.',
        state: stateOf(2),
        content: (
          <div className="schedule-step">
            <ChoiceCards
              label="Run policy"
              className="schedule-run-policy"
              value={policy}
              onValueChange={(value) =>
                onEditingChange({
                  ...editing,
                  monitor:
                    value === 'always'
                      ? null
                      : {
                          path: editing.monitor?.path ?? '',
                          action: value as 'notify' | 'run',
                        },
                })
              }
              options={POLICIES.map((item) => ({ ...item }))}
            />
            {editing.monitor && (
              <FormField
                label="Tracked path to watch (optional)"
                description="Checks committed content on the saved local target branch, without fetching. The first check records a baseline. Uncommitted edits are excluded."
              >
                <Input
                  id="schedule-watch-path"
                  maxLength={500}
                  value={editing.monitor.path}
                  onChange={(e) =>
                    onEditingChange({
                      ...editing,
                      monitor: {
                        action: editing.monitor?.action ?? 'notify',
                        path: e.target.value,
                      },
                    })
                  }
                  placeholder="src or package.json; blank watches the whole branch"
                />
              </FormField>
            )}
            <p className="task-muted">
              Target: {project?.preferences?.baseBranch || project?.gitBranch || 'Choose a project'}
              .{' '}
              {!monitorOnly &&
                "Account and verification use the selected project's preferences when saved."}
            </p>
          </div>
        ),
      },
    ];
  };

  return (
    <Dialog.Root
      open={!!editing}
      onOpenChange={(value) => {
        if (!value && !busy) {
          onClose();
          setStep(0);
        }
      }}
    >
      <DialogContent
        {...focus}
        onCloseAutoFocus={onCloseAutoFocus}
        contained
        className="schedule-editor"
      >
        <DialogCloseButton disabled={busy} label="Close schedule" />
        <DialogHeader
          title={template?.name ?? 'Schedule recurring work'}
          description={
            template?.outcome ??
            'Choose instructions, an agent, and a repeat schedule for your project.'
          }
        />
        {editing && (
          <form
            className="schedule-editor-form"
            onSubmit={(e) => {
              e.preventDefault();
              void onSave();
            }}
          >
            <SetupSteps
              label="Schedule recurring work"
              className="schedule-editor-steps"
              steps={scheduleSteps()}
            />
            <div className="schedule-editor-footer">
              <ActionError error={error} />
              {!projects.length && (
                <InlineNotice>
                  Add a project in Projects, then return to configure this schedule.
                </InlineNotice>
              )}
              <div className="schedule-editor-actions">
                <div className="flex items-center gap-3">
                  <Switch
                    id="schedule-enabled"
                    label={monitorOnly ? 'Enable local checks' : 'Enable automatic runs'}
                    checked={editing.enabled}
                    onCheckedChange={(enabled) => onEditingChange({ ...editing, enabled })}
                  />
                  <label htmlFor="schedule-enabled">
                    {monitorOnly ? 'Enable local checks' : 'Enable automatic runs'}
                  </label>
                </div>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    (!existing && step < 2) ||
                    !project ||
                    (!monitorOnly &&
                      (!agent || (agent !== 'auto' && !isAgentAllowedForProject(project, agent))))
                  }
                  loading={busy}
                  loadingLabel="Saving…"
                >
                  Save schedule
                </Button>
              </div>
              <p className="task-muted text-xs">
                {monitorOnly
                  ? 'Local checks use no agent.'
                  : 'Enabled runs use these instructions, saved context, and project connections. Changes need review.'}{' '}
                Leave off to save paused. Keep Jackalope open and this computer awake.
              </p>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog.Root>
  );
}
