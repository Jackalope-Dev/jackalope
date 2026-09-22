import { FormField, Input, Textarea } from '@jackalope/ui';
import { useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { type SavedAction, useSavedActionsStore } from '../../stores/savedActionsStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';

const empty = (): SavedAction => ({
  id: crypto.randomUUID(),
  name: '',
  kind: 'prompt',
  body: '',
  projectId: null,
});
export function SavedActions() {
  const { actions, save, remove } = useSavedActionsStore();
  const projects = useProjectStore((state) => state.projects);
  const [draft, setDraft] = useState(empty);
  const [error, setError] = useState('');
  return (
    <div className="project-workspace-fields">
      <p className="task-muted">
        Prompts fill a conversation draft. Commands are offered in an idle task terminal and run
        only when you choose Run command. Saved on this device.
      </p>
      {actions.map((action) => (
        <div className="flex flex-wrap items-center gap-2" key={action.id}>
          <span className="flex-1">
            {action.name} · {action.kind} ·{' '}
            {action.projectId
              ? (projects.find((project) => project.id === action.projectId)?.name ??
                'Unavailable project')
              : 'All projects'}
          </span>
          <Button variant="ghost" onClick={() => setDraft(action)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              remove(action.id);
              if (draft.id === action.id) setDraft(empty());
            }}
          >
            Delete
          </Button>
        </div>
      ))}
      <form
        className="project-workspace-fields"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            save(draft);
            setDraft(empty());
            setError('');
          } catch (reason) {
            setError(String(reason));
          }
        }}
      >
        <FormField label="Name">
          <Input
            aria-label="Saved action name"
            value={draft.name}
            maxLength={80}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </FormField>
        <FormField label="Type">
          <Select
            aria-label="Saved action type"
            value={draft.kind}
            onValueChange={(kind) => setDraft({ ...draft, kind: kind as SavedAction['kind'] })}
          >
            <SelectItem value="prompt">Prompt preset</SelectItem>
            <SelectItem value="command">Terminal command</SelectItem>
          </Select>
        </FormField>
        <FormField label="Available in">
          <Select
            aria-label="Saved action scope"
            value={draft.projectId ?? '__all'}
            onValueChange={(value) =>
              setDraft({ ...draft, projectId: value === '__all' ? null : value })
            }
          >
            <SelectItem value="__all">All projects</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </Select>
        </FormField>
        <FormField label={draft.kind === 'command' ? 'Command' : 'Prompt'}>
          <Textarea
            aria-label="Saved action text"
            rows={5}
            maxLength={12000}
            value={draft.body}
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          />
        </FormField>
        <div className="flex gap-2">
          <Button type="submit" disabled={!draft.name.trim() || !draft.body.trim()}>
            Save action
          </Button>
          <Button variant="ghost" onClick={() => setDraft(empty())}>
            Clear
          </Button>
        </div>
      </form>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </div>
  );
}
