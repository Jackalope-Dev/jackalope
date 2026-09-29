import * as Dialog from '@radix-ui/react-dialog';
import type { ScheduleTemplate } from '../../lib/schedule-templates';
import type { ScheduleDefinition as Definition } from '../../lib/schedules';

import { PROMPT_MAX_CHARS } from '../../lib/task-runtime';
import { isAgentAllowedForProject, type Project } from '../../stores/projectStore';
import { TaskKnowledge } from '../knowledge/TaskKnowledge';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { FormField } from '../ui/FormField';
import { InlineNotice } from '../ui/InlineNotice';
import { Input } from '../ui/input';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { Textarea } from '../ui/Textarea';
import { useDialogFocus } from '../ui/useDialogFocus';
import { ScheduleTiming } from './ScheduleTiming';

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
}) {
  const focus = useDialogFocus();
  const project = projects.find((item) => item.id === projectId);
  const monitorOnly = editing?.monitor?.action === 'notify';

  return (
    <Dialog.Root
      open={!!editing}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
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
            <div className="schedule-editor-body">
              <div className="schedule-editor-column">
                <section
                  className="schedule-editor-section"
                  aria-labelledby="schedule-task-heading"
                >
                  <h3 id="schedule-task-heading">What to do</h3>
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
                          disabled={monitorOnly}
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
                  {!monitorOnly && (
                    <>
                      <FormField label="Instructions">
                        <Textarea
                          id="schedule-instructions"
                          required={!monitorOnly}
                          disabled={monitorOnly}
                          maxLength={PROMPT_MAX_CHARS}
                          rows={10}
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
                    </>
                  )}
                  {monitorOnly && (
                    <p className="task-muted">
                      Watch committed changes on your local branch and receive a notification. No
                      agent task runs.
                    </p>
                  )}
                </section>
                {project && !monitorOnly && (
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
              </div>
              <div className="schedule-editor-column">
                <section
                  className="schedule-editor-section"
                  aria-labelledby="schedule-when-heading"
                >
                  <h3 id="schedule-when-heading">When to run</h3>
                  <ScheduleTiming
                    key={editing.id}
                    expression={editing.expression}
                    onChange={(expression) => onEditingChange({ ...editing, expression })}
                  />
                  <FormField label="Timezone">
                    <Input
                      id="schedule-timezone"
                      required
                      value={editing.timezone}
                      onChange={(e) => onEditingChange({ ...editing, timezone: e.target.value })}
                      placeholder="America/Denver"
                    />
                  </FormField>
                  <FormField label="After missed runs">
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
                </section>
                <section
                  className="schedule-editor-section"
                  aria-labelledby="schedule-behavior-heading"
                >
                  <h3 id="schedule-behavior-heading">Run behavior</h3>
                  <fieldset className="schedule-run-policy" aria-label="Run policy">
                    {[
                      { value: 'always', label: 'Run an agent every time' },
                      { value: 'run', label: 'Run only after code changes' },
                      { value: 'notify', label: 'Notify about changes without an agent' },
                    ].map(({ value, label }) => (
                      <label key={value}>
                        <input
                          type="radio"
                          name="schedule-policy"
                          value={value}
                          checked={(editing.monitor?.action ?? 'always') === value}
                          onChange={() =>
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
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </fieldset>
                  {editing.monitor && (
                    <label className="block" htmlFor="schedule-watch-path">
                      Tracked path to watch (optional)
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
                      <span className="task-muted">
                        Checks committed content on the saved local target branch, without fetching.
                        The first check records a baseline. Uncommitted edits are excluded.
                      </span>
                    </label>
                  )}
                  <p className="task-muted">
                    Target:{' '}
                    {project?.preferences?.baseBranch || project?.gitBranch || 'Choose a project'}.{' '}
                    {!monitorOnly &&
                      "Account and verification use the selected project's preferences when saved."}
                  </p>
                </section>
              </div>
            </div>
            <div className="schedule-editor-footer">
              {error && <InlineNotice tone="error">{error}</InlineNotice>}
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
