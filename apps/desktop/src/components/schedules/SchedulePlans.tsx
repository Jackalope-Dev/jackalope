import * as Dialog from '@radix-ui/react-dialog';
import { CalendarClock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { isCronExpression, scheduleProject } from '../../lib/planning';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { type ScheduledTask, useScheduleStore } from '../../stores/scheduleStore';
import { useTaskStore } from '../../stores/taskStore';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { EmptyState } from '../ui/EmptyState';
import { Input } from '../ui/input';
import { Select, SelectItem } from '../ui/Select';
import { useDialogFocus } from '../ui/useDialogFocus';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';

const TIMING = [
  { value: '0 9 * * *', label: 'Daily at 9:00' },
  { value: '0 9 * * 1-5', label: 'Weekdays at 9:00' },
  { value: '0 * * * *', label: 'Every hour' },
];
export function SchedulePlans({
  onOpenProject,
  onPlanning,
}: {
  onOpenProject: () => void;
  onPlanning: () => void;
}) {
  const { projects, activeProjectId, selectProject } = useProjectStore();
  const { schedules, addSchedule, updateSchedule, deleteSchedule, toggleSchedule } =
    useScheduleStore();
  const runners = useExecutionStore((state) => state.runners);
  const focus = useDialogFocus();
  const [filter, setFilter] = useState(activeProjectId ?? 'all');
  const [editing, setEditing] = useState<ScheduledTask | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [targetProjectId, setTargetProjectId] = useState(activeProjectId ?? '');
  const [agent, setAgent] = useState('Unassigned');
  const [timing, setTiming] = useState(TIMING[0].value);
  const [custom, setCustom] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; projectId: string } | null>(null);
  const open = (schedule: ScheduledTask | null) => {
    setEditing(schedule);
    setName(schedule?.name ?? '');
    setPrompt(schedule?.prompt ?? '');
    setTargetProjectId(schedule?.targetProjectId ?? activeProjectId ?? projects[0]?.id ?? '');
    setAgent(schedule?.assignedAgentProvider ?? 'Unassigned');
    setTiming(schedule?.cronExpression ?? TIMING[0].value);
    setCustom(!!schedule && !TIMING.some((item) => item.value === schedule.cronExpression));
  };
  const target = projects.find((project) => project.id === targetProjectId);
  const valid = !!target && !!name.trim() && !!prompt.trim() && isCronExpression(timing);
  const save = () => {
    if (!valid) return;
    const value = {
      name: name.trim(),
      prompt: prompt.trim(),
      targetProjectId,
      assignedAgentProvider: agent,
      cronExpression: timing.trim(),
      description: editing?.description ?? '',
      enabled: editing?.enabled ?? true,
    };
    if (editing) updateSchedule(editing.id, value);
    else addSchedule(value);
    setEditing(undefined);
  };
  const createTask = (schedule: ScheduledTask) => {
    const project = scheduleProject(schedule, projects);
    if (!project) return;
    useTaskStore.getState().addTask({
      projectId: project.id,
      title: schedule.name,
      rawPrompt: schedule.prompt,
      assignedAgent: schedule.assignedAgentProvider,
      status: 'backlog',
    });
    setFeedback({
      message: `Added “${schedule.name}” to ${project.name}'s Tasks.`,
      projectId: project.id,
    });
  };
  const visible = schedules.filter(
    (schedule) => filter === 'all' || schedule.targetProjectId === filter,
  );
  return (
    <section className="task-page">
      <WorkspaceHeading
        title="Schedules"
        description="Plans saved in earlier versions never start automatically. Use New schedule above to set up recurring execution."
        action={
          <Button onClick={() => (projects.length ? open(null) : onOpenProject())}>
            <Plus size={18} />
            {projects.length ? 'New schedule plan' : 'Open project'}
          </Button>
        }
      />
      {projects.length > 0 && (
        <div className="mb-6 max-w-sm">
          <Select aria-label="Schedule project" value={filter} onValueChange={setFilter}>
            <SelectItem value="all">All projects</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </Select>
        </div>
      )}
      {feedback && (
        <div className="task-notice flex flex-wrap items-center justify-between gap-3">
          <p role="status">{feedback.message}</p>
          <Button
            variant="outline"
            onClick={() => {
              selectProject(feedback.projectId);
              onPlanning();
            }}
          >
            View tasks
          </Button>
        </div>
      )}
      {!visible.length ? (
        <EmptyState
          icon={CalendarClock}
          title={schedules.length ? 'No plans for this project' : 'Plan work you want to repeat'}
          description="Save the instructions and intended timing. You can create a planning task manually from each plan."
        />
      ) : (
        <div className="schedule-list">
          {visible.map((schedule) => {
            const project = scheduleProject(schedule, projects);
            return (
              <article key={schedule.id} className="schedule-row">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-medium break-words">{schedule.name}</h2>
                  <p className="task-muted mt-1">
                    {project?.name ?? 'Project unavailable'} ·{' '}
                    {TIMING.find((item) => item.value === schedule.cronExpression)?.label ??
                      schedule.cronExpression}{' '}
                    · {schedule.enabled ? 'Saved plan' : 'Paused plan'}
                  </p>
                  <p className="task-muted mt-2 whitespace-pre-wrap">{schedule.prompt}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={!project}
                    onClick={() => createTask(schedule)}
                  >
                    Create planned task
                  </Button>
                  <Button variant="ghost" onClick={() => toggleSchedule(schedule.id)}>
                    {schedule.enabled ? 'Pause plan' : 'Resume plan'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${schedule.name}`}
                    onClick={() => open(schedule)}
                  >
                    <Pencil size={16} />
                  </Button>
                  <ConfirmAction
                    title="Delete schedule plan?"
                    description={`Remove “${schedule.name}”? Tasks already created from it are kept.`}
                    onConfirm={() => deleteSchedule(schedule.id)}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={`Delete ${schedule.name}`}>
                        <Trash2 size={16} />
                      </Button>
                    }
                  />
                </div>
                {!project && (
                  <p className="task-error">
                    Edit this plan to choose a project before creating a task.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
      <Dialog.Root
        open={editing !== undefined}
        onOpenChange={(value) => {
          if (!value) setEditing(undefined);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="task-dialog-overlay" />
          <Dialog.Content {...focus} className="task-dialog appearance-panel">
            <Dialog.Close className="task-close" aria-label="Close schedule plan">
              <X size={18} />
            </Dialog.Close>
            <Dialog.Title className="text-xl font-medium pr-10">
              {editing ? 'Edit schedule plan' : 'New schedule plan'}
            </Dialog.Title>
            <Dialog.Description className="task-muted mt-3">
              Save a reusable plan. This does not schedule automatic execution.
            </Dialog.Description>
            <form
              className="space-y-4 mt-5"
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <label htmlFor="schedule-name" className="block space-y-2">
                <span className="block text-sm">Name</span>
                <Input
                  id="schedule-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={160}
                  placeholder="Weekly dependency review"
                />
              </label>
              <label htmlFor="schedule-project" className="block space-y-2">
                <span className="block text-sm">Project</span>
                <Select
                  id="schedule-project"
                  aria-label="Project for this plan"
                  value={targetProjectId}
                  onValueChange={setTargetProjectId}
                >
                  {!target && (
                    <SelectItem value={targetProjectId || 'missing'} disabled>
                      Choose a project
                    </SelectItem>
                  )}
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </Select>
              </label>
              <label htmlFor="schedule-intended-timing" className="block space-y-2">
                <span className="block text-sm">Intended timing</span>
                <Select
                  id="schedule-intended-timing"
                  aria-label="Intended timing"
                  value={custom ? 'custom' : timing}
                  onValueChange={(value) => {
                    setCustom(value === 'custom');
                    if (value !== 'custom') setTiming(value);
                  }}
                >
                  {TIMING.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom timing</SelectItem>
                </Select>
              </label>
              {custom && (
                <label htmlFor="schedule-cron-expression" className="block space-y-2">
                  <span className="block text-sm">Cron expression</span>
                  <Input
                    id="schedule-cron-expression"
                    value={timing}
                    onChange={(event) => setTiming(event.target.value)}
                    aria-invalid={!isCronExpression(timing)}
                    aria-describedby="schedule-format"
                  />
                  <span id="schedule-format" className="task-muted text-xs">
                    Five numeric fields: minute, hour, day, month, weekday. Example: 0 9 * * 1-5.
                  </span>
                  {!isCronExpression(timing) && (
                    <span role="alert" className="task-error block">
                      Enter a valid five-part expression.
                    </span>
                  )}
                </label>
              )}
              <label htmlFor="schedule-preferred-agent" className="block space-y-2">
                <span className="block text-sm">Preferred agent</span>
                <Select
                  id="schedule-preferred-agent"
                  aria-label="Preferred agent"
                  value={agent}
                  onValueChange={setAgent}
                >
                  <SelectItem value="Unassigned">Choose later</SelectItem>
                  {agent !== 'Unassigned' && !runners.some((r) => r.id === agent) && (
                    <SelectItem value={agent}>{agent} (saved preference)</SelectItem>
                  )}
                  {runners.map((runner) => (
                    <SelectItem key={runner.id} value={runner.id} disabled={!runner.available}>
                      {runner.name}
                    </SelectItem>
                  ))}
                </Select>
              </label>
              <label htmlFor="schedule-instructions" className="block space-y-2">
                <span className="block text-sm">Instructions</span>
                <textarea
                  id="schedule-instructions"
                  className="task-input w-full"
                  rows={4}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  required
                  maxLength={24000}
                />
              </label>
              <div className="flex justify-end gap-2 pt-3">
                <Button variant="ghost" type="button" onClick={() => setEditing(undefined)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!valid}>
                  Save plan
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
