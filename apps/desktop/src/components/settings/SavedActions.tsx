import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  FormField,
  Input,
  Select,
  SelectItem,
  SettingActions,
  SettingBody,
  SettingGroup,
  SettingRow,
  Textarea,
} from '@jackalope/ui';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProjectStore } from '../../stores/projectStore';
import { type SavedAction, useSavedActionsStore } from '../../stores/savedActionsStore';
import { ActionError } from '../ui/ActionError';

const empty = (): SavedAction => ({
  id: crypto.randomUUID(),
  name: '',
  kind: 'prompt',
  body: '',
  projectId: null,
});
export function SavedActions() {
  const { actions, save, remove } = useSavedActionsStore(
    useShallow((s) => ({ actions: s.actions, save: s.save, remove: s.remove })),
  );
  const projects = useProjectStore((state) => state.projects);
  const [draft, setDraft] = useState(empty);
  const [error, setError] = useState('');
  const editing = actions.some((action) => action.id === draft.id);
  return (
    <>
      {actions.length > 0 && (
        <SettingGroup
          title="Saved actions"
          description="Prompts fill a conversation draft. Commands are offered in an idle task terminal and run only when you choose Run command. Saved on this device."
        >
          {actions.map((action) => (
            <SettingRow
              key={action.id}
              title={action.name}
              description={`${action.kind === 'command' ? 'Terminal command' : 'Prompt preset'} · ${
                action.projectId
                  ? (projects.find((project) => project.id === action.projectId)?.name ??
                    'Unavailable project')
                  : 'All projects'
              }`}
            >
              <div className="flex gap-2">
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
            </SettingRow>
          ))}
        </SettingGroup>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            save(draft);
            setDraft(empty());
            setError('');
          } catch (reason) {
            setError(describeError(reason));
          }
        }}
      >
        <SettingGroup
          title={editing ? `Edit ${draft.name || 'saved action'}` : 'New saved action'}
          description={
            actions.length
              ? undefined
              : 'Prompts fill a conversation draft. Commands are offered in an idle task terminal and run only when you choose Run command. Saved on this device.'
          }
        >
          <SettingBody>
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
          </SettingBody>
          <SettingActions>
            <Button type="submit" disabled={!draft.name.trim() || !draft.body.trim()}>
              Save action
            </Button>
            <Button variant="ghost" onClick={() => setDraft(empty())}>
              {editing ? 'Cancel' : 'Clear'}
            </Button>
          </SettingActions>
        </SettingGroup>
      </form>
      <ActionError error={error} />
    </>
  );
}
