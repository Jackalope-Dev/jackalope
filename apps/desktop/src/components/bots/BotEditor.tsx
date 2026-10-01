import { Checkbox, FormField, Input, Textarea } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { effectiveConnections } from '../../lib/mcp-connection';
import {
  BOT_INSTRUCTIONS_MAX,
  BOT_NAME_MAX,
  type Bot,
  type BotDraft,
  validateBot,
} from '../../stores/botStore';
import { useMcpStore } from '../../stores/mcpStore';
import { useProjectStore } from '../../stores/projectStore';
import { ComposerAgentPicker } from '../sessions/ComposerAgentPicker';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogFooter, DialogHeader } from '../ui/Dialog';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';

/** Creates or edits a bot. Saving changes defaults for new conversations only. */
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
  const [error, setError] = useState('');
  const servers = useMcpStore((state) => state.servers);
  const project = projects.find((item) => item.id === draft.projectId);
  useEffect(() => {
    if (draft.projectId) void useMcpStore.getState().loadServers(draft.projectId);
  }, [draft.projectId]);
  const connections = effectiveConnections(servers, draft.projectId);
  const patch = (next: Partial<BotDraft>) => setDraft((current) => ({ ...current, ...next }));
  const bytes = new TextEncoder().encode(draft.instructions).length;
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bot-editor" contained>
        <DialogHeader
          title={bot ? `Edit ${bot.name}` : 'New bot'}
          description="A bot keeps its role, agent and apps for every conversation you start with it."
        />
        <DialogCloseButton />
        <form
          id="bot-editor-form"
          className="bot-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            const message = validateBot(draft);
            if (message) {
              setError(message);
              return;
            }
            try {
              onSave(draft);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        >
          <div className="bot-editor-row">
            <FormField label="Name">
              <Input
                value={draft.name}
                maxLength={BOT_NAME_MAX}
                required
                autoFocus
                onChange={(event) => patch({ name: event.target.value })}
              />
            </FormField>
            <FormField label="Role" description="One line shown in the bot list.">
              <Input
                value={draft.role}
                maxLength={120}
                placeholder="Reviews changes before they merge"
                onChange={(event) => patch({ role: event.target.value })}
              />
            </FormField>
          </div>
          <div className="bot-editor-row">
            <FormField label="Project">
              <Select
                value={draft.projectId}
                placeholder="Choose a project"
                onValueChange={(projectId) =>
                  patch({ projectId, connectionIds: null, agent: 'auto', model: null })
                }
              >
                {projects.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </Select>
            </FormField>
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
            </div>
          </div>
          <FormField
            label="Instructions"
            description={`Repeated to the agent with every message in this bot’s conversations. ${bytes.toLocaleString()} of ${BOT_INSTRUCTIONS_MAX.toLocaleString()} bytes.`}
          >
            <Textarea
              rows={7}
              value={draft.instructions}
              placeholder="How should this bot work? What should it always or never do?"
              onChange={(event) => patch({ instructions: event.target.value })}
            />
          </FormField>
          <fieldset className="bot-editor-apps">
            <legend>Apps and tools</legend>
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
                onChange={() => patch({ connectionIds: connections.map((server) => server.id) })}
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
                  No connections are enabled for this project yet. Add them in Connected apps or
                  Connections.
                </p>
              ))}
          </fieldset>
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="bot-editor-form">
            {bot ? 'Save bot' : 'Create bot'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}
