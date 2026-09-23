import { useSavedActionsStore } from '../../stores/savedActionsStore';
import { Select, SelectItem } from '../ui/Select';

export function PromptPresets({
  projectId,
  onInsert,
}: {
  projectId: string;
  onInsert: (text: string) => void;
}) {
  const actions = useSavedActionsStore((state) => state.actions).filter(
    (action) => action.kind === 'prompt' && (!action.projectId || action.projectId === projectId),
  );
  if (!actions.length) return null;
  return (
    <Select
      aria-label="Insert prompt preset"
      value="__choose"
      onValueChange={(id) => {
        const action = actions.find((action) => action.id === id);
        if (action) onInsert(action.body);
      }}
    >
      <SelectItem value="__choose" disabled>
        Insert prompt preset…
      </SelectItem>
      {actions.map((action) => (
        <SelectItem key={action.id} value={action.id}>
          {action.name}
        </SelectItem>
      ))}
    </Select>
  );
}
