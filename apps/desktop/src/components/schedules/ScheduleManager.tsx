import * as Dialog from '@radix-ui/react-dialog';
import { useDialogFocus } from '../ui/useDialogFocus';
import { AlertCircle, Bot, CalendarClock, CheckCircle2, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useMascotStore } from '../../stores/mascotStore';
import { useScheduleStore } from '../../stores/scheduleStore';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

export function ScheduleManager() {
  const dialogFocus = useDialogFocus();
  const { schedules, toggleSchedule, addSchedule, deleteSchedule, runNow } = useScheduleStore();
  const { say, setMood } = useMascotStore();

  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cronExpression, setCronExpression] = useState('0 2 * * *');
  const [prompt, setPrompt] = useState('');
  const [assignedAgentProvider, setAssignedAgentProvider] = useState('Agent Antigravity');

  const handleManualRun = async (id: string, taskName: string) => {
    setMood('working');
    say(`Running scheduled routine "${taskName}" now...`, 2500);
    await runNow(id);
    setMood('success');
    say(`Scheduled run for "${taskName}" completed without errors!`, 3500);
  };

  const handleCreateSchedule = () => {
    if (!name.trim()) return;
    addSchedule({
      name,
      description: description || 'Autonomous recurring agent job',
      cronExpression,
      targetProjectId: 'jackalope-core',
      assignedAgentProvider,
      prompt: prompt || 'Execute automated verification',
      enabled: true,
    });
    setName('');
    setDescription('');
    setPrompt('');
    setShowAddModal(false);
    say('Automated routine created and scheduled!', 3000);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
        <div>
          <h1 className="task-title">Schedules</h1>
          <p className="task-muted mt-2">
            Plan recurring work. Automatic execution is not connected yet.
          </p>
        </div>

        <Button
          size="sm"
          onClick={() => setShowAddModal(true)}
          className="gap-1.5 text-xs shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New schedule</span>
        </Button>
      </div>

      {/* Schedules List */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
          Saved schedules ({schedules.length})
        </div>

        <div className="grid grid-cols-1 gap-3">
          {schedules.map((sch) => (
            <div
              key={sch.id}
              className={`p-4 rounded-2xl border transition-all shadow-sm flex flex-col justify-between space-y-3 ${
                sch.enabled
                  ? 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-focus)]'
                  : 'border-[var(--color-border)]/60 bg-[var(--color-surface-sunken)]/50'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-[var(--color-text-primary)]">
                      {sch.name}
                    </h3>
                    <span className="font-mono text-xs px-2 py-0.5 rounded-full bg-[var(--color-surface-sunken)] text-[var(--color-accent-ink)] border border-[var(--color-border)]">
                      {sch.cronExpression}
                    </span>
                    {sch.enabled ? (
                      <Badge variant="success" className="text-xs">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="default" className="text-xs">
                        Paused
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)]">{sch.description}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleManualRun(sch.id, sch.name)}
                    className="gap-1.5 text-xs"
                  >
                    <Play className="w-3 h-3 text-[var(--color-accent-ink)]" />
                    <span>Create planned task</span>
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSchedule(sch.id)}
                    className="text-xs"
                  >
                    {sch.enabled ? 'Pause' : 'Resume'}
                  </Button>

                  <button
                    type="button"
                    onClick={() => deleteSchedule(sch.id)}
                    className="p-2 rounded-lg hover:bg-red-500/20 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors cursor-pointer"
                    title="Delete schedule"
                    aria-label={`Delete ${sch.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Execution Status & Agent Details */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--color-border-subtle)] text-xs text-[var(--color-text-muted)] font-mono">
                <div className="flex items-center gap-2">
                  <Bot className="w-3 h-3 text-[var(--color-accent-ink)]" />
                  <span>{sch.assignedAgentProvider}</span>
                  <span>•</span>
                  <span>Next Run: {sch.nextRun}</span>
                </div>

                {sch.lastRun && (
                  <div className="flex items-center gap-1.5">
                    {sch.lastRun.status === 'success' ? (
                      <CheckCircle2 className="w-3 h-3 text-[var(--color-success)]" />
                    ) : (
                      <AlertCircle className="w-3 h-3 text-[var(--color-danger)]" />
                    )}
                    <span className="text-[var(--color-text-secondary)]">
                      Last: {sch.lastRun.summary} ({sch.lastRun.durationSeconds}s)
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add Schedule Modal */}
      <Dialog.Root open={showAddModal} onOpenChange={setShowAddModal}>
        <Dialog.Portal>
          <Dialog.Overlay className="task-dialog-overlay" />
          <Dialog.Content {...dialogFocus} className="task-dialog appearance-panel space-y-4">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-[var(--color-accent-ink)]" />
              <Dialog.Title className="text-xl font-medium">New schedule</Dialog.Title>
            </div>

            <Dialog.Description className="task-muted">
              Save a recurring task plan. Automatic runs are not connected yet.
            </Dialog.Description>
            <div className="space-y-3 text-left">
              <div>
                <label
                  htmlFor="schedule-name"
                  className="text-xs font-semibold text-[var(--color-text-secondary)]"
                >
                  Name
                </label>
                <Input
                  id="schedule-name"
                  placeholder="e.g. Daily Build & Performance Benchmark"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 text-xs"
                />
              </div>

              <div>
                <label
                  htmlFor="schedule-cron"
                  className="text-xs font-semibold text-[var(--color-text-secondary)]"
                >
                  Cron Expression (5-part)
                </label>
                <Input
                  id="schedule-cron"
                  placeholder="0 2 * * *"
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  className="mt-1 text-xs font-mono"
                />
                <span className="text-xs text-[var(--color-text-muted)] mt-1 block">
                  Example: <code>0 2 * * *</code> (Every day at 2am) or <code>0 * * * *</code>{' '}
                  (Hourly)
                </span>
              </div>

              <div>
                <label
                  htmlFor="schedule-agent-provider"
                  className="text-xs font-semibold text-[var(--color-text-secondary)]"
                >
                  Assigned Agent Provider
                </label>
                <select
                  id="schedule-agent-provider"
                  value={assignedAgentProvider}
                  onChange={(e) => setAssignedAgentProvider(e.target.value)}
                  className="w-full h-9 mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3 text-xs text-[var(--color-text-primary)] focus:outline-none"
                >
                  <option>Agent Antigravity</option>
                  <option>Agent Claude-3.7-Sonnet</option>
                  <option>Local Ollama</option>
                  <option>Agent Aider</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="schedule-prompt"
                  className="text-xs font-semibold text-[var(--color-text-secondary)]"
                >
                  Instructions
                </label>
                <textarea
                  id="schedule-prompt"
                  rows={2}
                  placeholder="What should the agent execute during this routine?"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-2.5 text-xs text-[var(--color-text-primary)] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-border)]">
              <Button variant="ghost" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateSchedule} disabled={!name.trim()}>
                Save schedule
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
