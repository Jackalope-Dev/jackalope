import {
  Button,
  Checkbox,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  Select,
  SelectItem,
  Switch,
  Textarea,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { Check } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { effectiveConnections } from '../../lib/mcp-connection';
import {
  BOT_INSTRUCTIONS_MAX,
  BOT_NAME_MAX,
  type Bot,
  type BotDraft,
  botProjectIds,
  validateBot,
} from '../../stores/botStore';
import { useMcpStore } from '../../stores/mcpStore';
import { useProjectStore } from '../../stores/projectStore';
import { BotComputerSettings } from '../computers/BotComputerSettings';
import { BrowserProfileSettings } from '../projects/BrowserProfileSettings';
import { ComposerAgentPicker } from '../sessions/ComposerAgentPicker';
import { ActionError } from '../ui/ActionError';
import { BotAppearancePicker } from './BotAppearancePicker';
import { BotWakes } from './BotWakes';
import { describeError } from '@jackalope/contracts/errors';

const STEPS = [
  {
    id: 'look',
    title: 'Name and look',
    short: 'Look',
    description: 'Give your bot a name and a face.',
  },
  {
    id: 'work',
    title: 'Project and agent',
    short: 'Agent',
    description: 'Choose where it works and who does the work.',
  },
  {
    id: 'brief',
    title: 'Role and instructions',
    short: 'Role',
    description: 'Tell it what it is for and how to behave.',
  },
  {
    id: 'apps',
    title: 'Apps and tools',
    short: 'Tools',
    description: 'Choose which connections its conversations can use.',
  },
  {
    id: 'wakes',
    title: 'Wake-ups and teamwork',
    short: 'Wake-ups',
    description: 'Choose what wakes it on its own and whether it works with other bots.',
  },
] as const;

/** Creates or edits a bot one focused step at a time. Saving changes defaults for new conversations only. */
export function BotEditor({
  bot,
  initial,
  onSave,
  onClose,
}: {
  bot?: Bot;
  initial: BotDraft;
  onSave: (draft: BotDraft) => void;
  onClose: () => void;
}) {
  const projects = useProjectStore((state) => state.projects);
  const [draft, setDraft] = useState<BotDraft>(initial);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [wakeOpen, setWakeOpen] = useState(false);
  const servers = useMcpStore((state) => state.servers);
  const project = projects.find((item) => item.id === draft.projectId);
  useEffect(() => {
    if (draft.projectId) void useMcpStore.getState().loadServers(draft.projectId);
  }, [draft.projectId]);
  // Each step body remounts, so focus moves into it for keyboard and screen-reader users.
  const focusStep = useCallback((node: HTMLDivElement | null) => {
    node
      ?.querySelector<HTMLElement>('input:not([type="radio"]), textarea, button, [tabindex="0"]')
      ?.focus();
  }, []);
  const connections = effectiveConnections(servers, draft.projectId);
  const patch = (next: Partial<BotDraft>) => setDraft((current) => ({ ...current, ...next }));
  const characters = [...draft.instructions].length;
  const last = step === STEPS.length - 1;
  // Editing shows every section on one page; creating walks through one step at a time.
  const show = (index: number) => !!bot || step === index;
  const heading = (index: number) =>
    bot ? <h3 className="bot-editor-section-title">{STEPS[index].title}</h3> : null;
  const stepError = (index: number) =>
    index === 0 && !draft.name.trim()
      ? 'Give the bot a name.'
      : index === 1 && !draft.projectId
        ? 'Choose the project this bot works in.'
        : '';
  const go = (index: number) => {
    for (let earlier = step; earlier < index; earlier++) {
      const message = stepError(earlier);
      if (message) {
        setStep(earlier);
        setError(message);
        return;
      }
    }
    setError('');
    setStep(index);
  };
  const save = () => {
    if (wakeOpen) {
      setError('Save or cancel the wake-up you are editing first.');
      return;
    }
    const message = validateBot(draft);
    if (message) {
      setError(message);
      return;
    }
    try {
      onSave(draft);
    } catch (cause) {
      setError(describeError(cause));
    }
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bot-editor" contained>
        <DialogHeader
          title={bot ? `Edit ${bot.name}` : 'New bot'}
          description={bot ? undefined : STEPS[step].description}
        />
        <DialogCloseButton />
        {!bot && (
          <ol className="bot-editor-steps" aria-label="Steps">
            {STEPS.map((item, index) => (
              <li key={item.id} className="bot-editor-steps-item">
                <button
                  type="button"
                  className="bot-editor-step"
                  aria-current={index === step ? 'step' : undefined}
                  data-done={index < step || undefined}
                  disabled={!bot && index > step}
                  onClick={() => go(index)}
                >
                  <span className="bot-editor-step-mark" aria-hidden="true">
                    {index < step ? <Check size={12} strokeWidth={3} /> : index + 1}
                  </span>
                  <span className="bot-editor-step-title" title={item.title}>
                    {item.short}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {/* One scroll area: the per-bot browser and computer cards sit after the form, not in it,
            so their own buttons and fields never submit the bot. */}
        <div className="bot-editor-body">
          <form
            id="bot-editor-form"
            className="bot-editor-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (bot || last) save();
              else go(step + 1);
            }}
          >
            <div
              ref={focusStep}
              className="bot-editor-step-body"
              data-all={bot ? true : undefined}
              key={bot ? 'all' : STEPS[step].id}
            >
              {show(0) && (
                <>
                  {heading(0)}
                  <FormField label="Name">
                    <Input
                      value={draft.name}
                      maxLength={BOT_NAME_MAX}
                      required
                      placeholder="Reviewer"
                      onChange={(event) => patch({ name: event.target.value })}
                    />
                  </FormField>
                  <BotAppearancePicker
                    appearance={draft.appearance}
                    agent={draft.agent}
                    onChange={(appearance) => patch({ appearance })}
                  />
                </>
              )}
              {show(1) && (
                <>
                  {heading(1)}
                  <FormField
                    label="Home project"
                    description="Its chosen connections and wake-ups start here unless a wake-up picks another project."
                  >
                    <Select
                      value={draft.projectId}
                      placeholder="Choose a project"
                      onValueChange={(projectId) =>
                        patch({
                          projectId,
                          projectIds: draft.projectIds?.filter((id) => id !== projectId),
                          connectionIds: null,
                          agent: 'auto',
                          model: null,
                        })
                      }
                    >
                      {projects.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </Select>
                  </FormField>
                  {draft.projectId && projects.length > 1 && (
                    <fieldset className="bot-editor-field">
                      <legend className="bot-editor-label">Also works in</legend>
                      <p className="form-field-description">
                        Start conversations with it from these projects too; each runs in the
                        project it started from.
                      </p>
                      <div className="bot-editor-connections">
                        {projects
                          .filter((item) => item.id !== draft.projectId)
                          .map((item) => (
                            <label key={item.id} className="bot-editor-connection">
                              <Checkbox
                                checked={draft.projectIds?.includes(item.id) ?? false}
                                onChange={(event) => {
                                  const projectIds = event.target.checked
                                    ? [...(draft.projectIds ?? []), item.id]
                                    : (draft.projectIds ?? []).filter((id) => id !== item.id);
                                  patch({
                                    projectIds,
                                    // Wake-ups in a project it no longer works in move home.
                                    wakes: draft.wakes.map((wake) =>
                                      wake.projectId && !projectIds.includes(wake.projectId)
                                        ? { ...wake, projectId: undefined }
                                        : wake,
                                    ),
                                  });
                                }}
                              />
                              {item.name}
                            </label>
                          ))}
                      </div>
                    </fieldset>
                  )}
                  <div className="bot-editor-field">
                    <span className="bot-editor-label">Agent and model</span>
                    {project ? (
                      <ComposerAgentPicker
                        project={project}
                        allowCompare={false}
                        value={draft.agent === 'auto' ? [] : [draft.agent]}
                        model={draft.model}
                        onChange={(agents) => patch({ agent: agents[0] ?? 'auto' })}
                        onModelChange={(model) => patch({ model })}
                      />
                    ) : (
                      <p className="task-muted">Choose a project first.</p>
                    )}
                    <p className="form-field-description">
                      Automatic lets Jackalope pick for each conversation.
                    </p>
                  </div>
                </>
              )}
              {show(2) && (
                <>
                  {heading(2)}
                  <FormField label="Role" description="One line shown in the bot list.">
                    <Input
                      value={draft.role}
                      maxLength={120}
                      placeholder="Reviews changes before they merge"
                      onChange={(event) => patch({ role: event.target.value })}
                    />
                  </FormField>
                  <FormField
                    label="Instructions"
                    description={`Repeated to the agent with every message in this bot’s conversations. ${characters.toLocaleString()} of ${BOT_INSTRUCTIONS_MAX.toLocaleString()} characters.`}
                  >
                    <Textarea
                      rows={8}
                      value={draft.instructions}
                      placeholder="How should this bot work? What should it always or never do?"
                      onChange={(event) => patch({ instructions: event.target.value })}
                    />
                  </FormField>
                </>
              )}
              {show(3) && (
                <fieldset className="bot-editor-apps">
                  {heading(3)}
                  <legend className="sr-only">Apps and tools</legend>
                  <label className="bot-editor-choice">
                    <input
                      type="radio"
                      name="bot-connections"
                      checked={draft.connectionIds === null}
                      onChange={() => patch({ connectionIds: null })}
                    />
                    <span>
                      <strong>Every enabled connection</strong>
                      <small>Includes connections you add later.</small>
                    </span>
                  </label>
                  <label className="bot-editor-choice">
                    <input
                      type="radio"
                      name="bot-connections"
                      checked={draft.connectionIds !== null}
                      onChange={() =>
                        patch({ connectionIds: connections.map((server) => server.id) })
                      }
                    />
                    <span>
                      <strong>Only the connections I choose</strong>
                      <small>Applies when a conversation starts.</small>
                    </span>
                  </label>
                  {draft.connectionIds !== null &&
                    (connections.length ? (
                      <div className="bot-editor-connections">
                        {connections.map((server) => (
                          <label key={server.id} className="bot-editor-connection">
                            <Checkbox
                              checked={draft.connectionIds?.includes(server.id) ?? false}
                              onChange={(event) =>
                                patch({
                                  connectionIds: event.target.checked
                                    ? [...(draft.connectionIds ?? []), server.id]
                                    : (draft.connectionIds ?? []).filter((id) => id !== server.id),
                                })
                              }
                            />
                            {server.name}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="task-muted">
                        No connections are enabled for this project yet. Add them in Connected apps
                        or Connections.
                      </p>
                    ))}
                </fieldset>
              )}
              {show(4) && (
                <>
                  {heading(4)}
                  <label className="bot-editor-choice bot-editor-teamwork">
                    <Switch
                      checked={draft.collaborate}
                      onCheckedChange={(collaborate) => patch({ collaborate })}
                      aria-describedby="bot-teamwork-help"
                    />
                    <span>
                      <strong>Works with other bots</strong>
                      <small id="bot-teamwork-help">
                        It can find other bots, ask them for help and take their requests. Each
                        message appears in both conversations.
                      </small>
                    </span>
                  </label>
                  <div className="bot-editor-field">
                    <span className="bot-editor-label">Wake-ups</span>
                    <p className="form-field-description">
                      Wake-ups continue the bot’s latest open conversation. Conversations a bot
                      starts pause after 20 replies until you resume them.
                    </p>
                    <BotWakes
                      wakes={draft.wakes}
                      projectId={draft.projectId}
                      projects={botProjectIds(draft).flatMap((id) => {
                        const item = projects.find((candidate) => candidate.id === id);
                        return item ? [{ id: item.id, name: item.name }] : [];
                      })}
                      connectionIds={draft.connectionIds}
                      connections={connections.map((server) => ({
                        id: server.id,
                        name: server.name,
                      }))}
                      onChange={(wakes) => patch({ wakes })}
                      onEditingChange={setWakeOpen}
                    />
                  </div>
                </>
              )}
            </div>
            <ActionError error={error} />
          </form>
          {bot && <BrowserProfileSettings owner={{ kind: 'bot', id: bot.id, name: bot.name }} />}
          {bot && <BotComputerSettings bot={{ id: bot.id, name: bot.name }} />}
        </div>
        <DialogFooter>
          {bot || step === 0 ? (
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
          ) : (
            <Button variant="outline" type="button" onClick={() => go(step - 1)}>
              Back
            </Button>
          )}
          <Button type="submit" form="bot-editor-form">
            {bot ? 'Save bot' : last ? 'Create bot' : 'Next'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}
