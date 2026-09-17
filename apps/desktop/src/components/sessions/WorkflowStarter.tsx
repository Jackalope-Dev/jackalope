import { Disclosure, DisclosureSummary, Input } from '@jackalope/ui';
import { useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import {
  type RecipeId,
  recipePrompt,
  type WorkflowContext,
  workflowRecipes,
} from '../../lib/workflow-recipes';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';

export function WorkflowStarter({
  projectPath,
  onDraft,
  embedded = false,
}: {
  projectPath: string;
  onDraft: (text: string) => void;
  embedded?: boolean;
}) {
  const [kind, setKind] = useState<RecipeId>('issue');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recipe = workflowRecipes.find((item) => item.id === kind) ?? workflowRecipes[0];
  const prepare = async () => {
    if (busy || !value.trim()) return;
    setBusy(true);
    setError('');
    try {
      const context =
        kind === 'dependency'
          ? undefined
          : await nativeTask<WorkflowContext>('project_github_context', {
              projectPath,
              kind,
              number: value,
            });
      onDraft(recipePrompt(kind, value, context));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const content = (
    <div className="space-y-3 py-3">
      <Select
        aria-label="Workflow recipe"
        value={kind}
        disabled={busy}
        onValueChange={(id) => {
          setKind(id as RecipeId);
          setValue('');
          setError('');
        }}
      >
        {workflowRecipes.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.label}
          </SelectItem>
        ))}
      </Select>
      <label className="block">
        {recipe.input}
        <Input
          value={value}
          disabled={busy}
          maxLength={200}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void prepare();
            }
          }}
        />
      </label>
      <p className="task-muted">
        GitHub items are read from this project's repository. Review the prepared request before
        sending it.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={busy || !value.trim()}
        loading={busy}
        loadingLabel="Reading…"
        onClick={() => void prepare()}
      >
        Prepare task draft
      </Button>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </div>
  );
  return embedded ? (
    content
  ) : (
    <Disclosure>
      <DisclosureSummary>Start from a repeatable workflow</DisclosureSummary>
      {content}
    </Disclosure>
  );
}
