import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  ChoiceCards,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  FormField,
  InlineNotice,
  Input,
  Select,
  SelectItem,
  Switch,
  Textarea,
} from '@jackalope/ui';
import { CalendarClock, GitCommitHorizontal, Plug, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { connectionTools, describeWake } from '../../lib/bot-hub';
import { isTauriEnvironment } from '../../lib/native/env';
import {
  BOT_WAKES_MAX,
  type BotWake,
  type BotWakeTrigger,
  validateWake,
  WAKE_PROMPT_MAX,
} from '../../stores/botStore';
import { WhenPicker } from '../schedules/WhenPicker';
import { ActionError } from '../ui/ActionError';

const INTERVALS = [
  { value: 5, label: 'Every 5 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 240, label: 'Every 4 hours' },
  { value: 1440, label: 'Once a day' },
];

function newTrigger(kind: BotWakeTrigger['kind'], connectionId = ''): BotWakeTrigger {
  return kind === 'schedule'
    ? {
        kind,
        expression: '0 9 * * 1-5',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }
    : kind === 'repoChange'
      ? { kind, path: '' }
      : { kind, connectionId, tool: '', arguments: {}, intervalMinutes: 15 };
}

const WAKE_NAMES: Record<BotWakeTrigger['kind'], string> = {
  schedule: 'Weekday check-in',
  repoChange: 'Project changed',
  connection: 'New connection data',
};

function newWake(kind: BotWakeTrigger['kind'], connectionId = ''): BotWake {
  return {
    id: crypto.randomUUID(),
    name: WAKE_NAMES[kind],
    prompt: '',
    enabled: true,
    trigger: newTrigger(kind, connectionId),
  };
}

/** The wake-ups that start a bot's conversations without the person, edited one at a time. */
export function BotWakes({
  wakes,
  projectId,
  projects = [],
  connectionIds,
  connections,
  onChange,
  onEditingChange,
}: {
  wakes: BotWake[];
  projectId: string;
  /** Every project the bot works in; with more than one, each wake-up picks its own. */
  projects?: { id: string; name: string }[];
  connectionIds: string[] | null;
  connections: { id: string; name: string }[];
  onChange: (wakes: BotWake[]) => void;
  /** Lets the editor refuse to save while a wake-up form is still open. */
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState<BotWake | null>(null);
  useEffect(() => onEditingChange?.(editing !== null), [editing, onEditingChange]);
  const [error, setError] = useState('');
  const usable = connections.filter((item) => !connectionIds || connectionIds.includes(item.id));
  const nameOf = (id: string) => connections.find((item) => item.id === id)?.name;
  const save = () => {
    if (!editing) return;
    const message = validateWake(editing, connectionIds);
    if (message) {
      setError(message);
      return;
    }
    const exists = wakes.some((wake) => wake.id === editing.id);
    onChange(
      exists ? wakes.map((wake) => (wake.id === editing.id ? editing : wake)) : [...wakes, editing],
    );
    setEditing(null);
    setError('');
  };
  return (
    <div className="bot-wakes">
      {wakes.length > 0 && (
        <ul className="bots-list">
          {wakes.map((wake) => (
            <li key={wake.id} className="bots-routine">
              <span>
                <strong>{wake.name}</strong>
                <small>
                  {describeWake(
                    wake,
                    nameOf(wake.trigger.kind === 'connection' ? wake.trigger.connectionId : ''),
                  )}
                  {projects.length > 1 &&
                    ` · ${projects.find((item) => item.id === (wake.projectId ?? projectId))?.name ?? 'Home project'}`}
                </small>
              </span>
              <span className="bot-wake-actions">
                <Switch
                  aria-label={`Turn on ${wake.name}`}
                  checked={wake.enabled}
                  onCheckedChange={(enabled) =>
                    onChange(
                      wakes.map((item) => (item.id === wake.id ? { ...item, enabled } : item)),
                    )
                  }
                />
                <Button variant="ghost" type="button" onClick={() => setEditing(wake)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  aria-label={`Remove ${wake.name}`}
                  onClick={() => onChange(wakes.filter((item) => item.id !== wake.id))}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <WakeForm
          isNew={!wakes.some((wake) => wake.id === editing.id)}
          wake={editing}
          projectId={editing.projectId ?? projectId}
          projects={projects}
          connections={usable}
          error={error}
          onChange={setEditing}
          onCancel={() => {
            setEditing(null);
            setError('');
          }}
          onSave={save}
        />
      ) : (
        wakes.length < BOT_WAKES_MAX && (
          <div className="bot-wake-add">
            <Button
              variant="outline"
              type="button"
              onClick={() => setEditing(newWake('schedule', usable[0]?.id))}
            >
              <Plus size={16} aria-hidden="true" />
              Add a wake-up
            </Button>
          </div>
        )
      )}
    </div>
  );
}

function WakeForm({
  isNew,
  wake,
  projectId,
  projects,
  connections,
  error,
  onChange,
  onCancel,
  onSave,
}: {
  isNew: boolean;
  wake: BotWake;
  projectId: string;
  projects: { id: string; name: string }[];
  connections: { id: string; name: string }[];
  error: string;
  onChange: (wake: BotWake) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const trigger = wake.trigger;
  const setTrigger = (next: Partial<BotWakeTrigger>) =>
    onChange({ ...wake, trigger: { ...trigger, ...next } as BotWakeTrigger });
  return (
    <div className="bots-routine-form bot-wake-form">
      <ChoiceCards
        label="What wakes the bot"
        className="bot-wake-kinds"
        value={trigger.kind}
        onValueChange={(kind) => {
          if (kind === trigger.kind) return;
          const keepName = !isNew || wake.name !== WAKE_NAMES[trigger.kind];
          onChange({
            ...wake,
            name: keepName ? wake.name : WAKE_NAMES[kind],
            trigger: newTrigger(kind, connections[0]?.id),
          });
        }}
        options={[
          {
            value: 'schedule',
            title: 'On a schedule',
            description: 'At set times, like weekdays at 9.',
            icon: <CalendarClock size={18} />,
          },
          {
            value: 'repoChange',
            title: 'When the project changes',
            description: 'After new commits on the target branch.',
            icon: <GitCommitHorizontal size={18} />,
          },
          {
            value: 'connection',
            title: 'When connection data changes',
            description: connections.length
              ? 'When a read-only tool returns something new.'
              : 'Add a connection this bot may use first.',
            icon: <Plug size={18} />,
            disabled: !connections.length,
          },
        ]}
      />
      <FormField label="Wake-up name">
        <Input
          value={wake.name}
          maxLength={80}
          onChange={(event) => onChange({ ...wake, name: event.target.value })}
        />
      </FormField>
      {projects.length > 1 && (
        <FormField label="Project" description="Where it watches for changes and starts work.">
          <Select
            value={projectId}
            onValueChange={(id) =>
              onChange({ ...wake, projectId: id === projects[0]?.id ? undefined : id })
            }
          >
            {projects.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </Select>
        </FormField>
      )}
      {trigger.kind === 'schedule' && (
        <WhenPicker
          key={wake.id}
          expression={trigger.expression}
          timezone={trigger.timezone}
          onChange={(expression) => setTrigger({ expression })}
        />
      )}
      {trigger.kind === 'repoChange' && (
        <FormField
          label="Path to watch"
          description="Optional. Checks the project's target branch every minute and wakes the bot when this path or, if empty, anything changes."
        >
          <Input
            value={trigger.path}
            maxLength={500}
            placeholder="src/api"
            onChange={(event) => setTrigger({ path: event.target.value })}
          />
        </FormField>
      )}
      {trigger.kind === 'connection' && (
        <ConnectionFields
          projectId={projectId}
          connections={connections}
          trigger={trigger}
          onChange={setTrigger}
        />
      )}
      <FormField
        label="What should it do when it wakes?"
        description={`The wake-up message also says what woke it. ${[...wake.prompt].length.toLocaleString()} of ${WAKE_PROMPT_MAX.toLocaleString()} characters.`}
      >
        <Textarea
          rows={3}
          value={wake.prompt}
          placeholder="Review what changed and tell me anything that needs a decision."
          onChange={(event) => onChange({ ...wake, prompt: event.target.value })}
        />
      </FormField>
      <ActionError error={error} />
      <div className="bots-composer-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={onSave}>
          Save wake-up
        </Button>
      </div>
    </div>
  );
}

function ConnectionFields({
  projectId,
  connections,
  trigger,
  onChange,
}: {
  projectId: string;
  connections: { id: string; name: string }[];
  trigger: Extract<BotWakeTrigger, { kind: 'connection' }>;
  onChange: (next: Partial<BotWakeTrigger>) => void;
}) {
  const [tools, setTools] = useState<{ name: string; description?: string }[] | null>(null);
  const [error, setError] = useState('');
  const [argsError, setArgsError] = useState('');
  const [args, setArgs] = useState(() =>
    Object.keys(trigger.arguments).length ? JSON.stringify(trigger.arguments, null, 2) : '',
  );
  useEffect(() => {
    let current = true;
    setTools(null);
    setError('');
    if (!trigger.connectionId || !isTauriEnvironment()) return;
    connectionTools(projectId, trigger.connectionId)
      .then((found) => current && setTools(found))
      .catch((cause) => current && setError(describeError(cause)));
    return () => {
      current = false;
    };
  }, [projectId, trigger.connectionId]);
  return (
    <>
      <div className="bots-routine-timing">
        <FormField label="Connection">
          <Select
            value={trigger.connectionId}
            onValueChange={(connectionId) => onChange({ connectionId, tool: '' })}
          >
            {connections.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </Select>
        </FormField>
        <FormField label="Check">
          <Select
            value={String(trigger.intervalMinutes)}
            onValueChange={(value) => onChange({ intervalMinutes: Number(value) })}
          >
            {INTERVALS.map((item) => (
              <SelectItem key={item.value} value={String(item.value)}>
                {item.label}
              </SelectItem>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField
        label="Tool to watch"
        description="Only tools the connection marks read-only are listed. Each check calls the tool; a different result wakes the bot."
      >
        {tools === null && !error ? (
          <p className="task-muted">
            {trigger.connectionId ? 'Reading tools…' : 'Choose a connection.'}
          </p>
        ) : tools?.length ? (
          <Select
            value={trigger.tool}
            placeholder="Choose a tool"
            onValueChange={(tool) => onChange({ tool })}
          >
            {tools.map((tool) => (
              <SelectItem key={tool.name} value={tool.name}>
                {tool.name}
              </SelectItem>
            ))}
          </Select>
        ) : (
          <InlineNotice tone={error ? 'error' : 'info'}>
            {error || 'This connection has no read-only tools to watch.'}
          </InlineNotice>
        )}
      </FormField>
      <Disclosure>
        <DisclosureSummary>Tool arguments</DisclosureSummary>
        <DisclosureBody>
          <FormField
            label="Arguments as JSON"
            description="Optional, such as a project or label filter."
          >
            <Textarea
              rows={3}
              value={args}
              placeholder={'{ "state": "open" }'}
              onChange={(event) => {
                setArgs(event.target.value);
                try {
                  const parsed = event.target.value.trim() ? JSON.parse(event.target.value) : {};
                  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                    throw new Error();
                  onChange({ arguments: parsed });
                  setArgsError('');
                } catch {
                  setArgsError('Write a JSON object. The last valid arguments are kept.');
                }
              }}
            />
          </FormField>
          {argsError && <InlineNotice tone="warning">{argsError}</InlineNotice>}
        </DisclosureBody>
      </Disclosure>
    </>
  );
}
