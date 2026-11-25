import { describeError } from '@jackalope/contracts/errors';
import { Button, Disclosure, DisclosureSummary, Input, Select, SelectItem } from '@jackalope/ui';
import { useState } from 'react';
import { useProjectHost } from '../../hooks/useProjectHost';
import { invokeNative } from '../../lib/native/transport';
import { hostTerms } from '../../lib/source-control';
import {
  type RecipeId,
  recipePrompt,
  recipesFor,
  type WorkflowContext,
} from '../../lib/workflow-recipes';
import { IssuePicker } from '../tasks/IssuePicker';
import { ActionError } from '../ui/ActionError';

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
  const [browse, setBrowse] = useState(false);
  const { data: host } = useProjectHost(projectPath);
  const recipes = recipesFor(host?.kind, host?.capabilities.issues !== false);
  const recipe = recipes.find((item) => item.id === kind) ?? recipes[0];
  const terms = hostTerms(host?.kind);
  const prepare = async () => {
    if (busy || !value.trim()) return;
    setBusy(true);
    setError('');
    try {
      const context =
        recipe.id === 'dependency'
          ? undefined
          : await invokeNative<WorkflowContext>('project_github_context', {
              projectPath,
              kind: recipe.id,
              number: value,
            });
      onDraft(recipePrompt(recipe.id, value, context, host?.kind));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };
  const content = (
    <div className="space-y-3 py-3">
      <Button
        type="button"
        variant="outline"
        aria-pressed={browse}
        onClick={() => setBrowse(!browse)}
      >
        {browse ? 'Use an item number' : `Browse issues and ${terms.noun}s`}
      </Button>
      {browse ? (
        <IssuePicker projectPath={projectPath} onDraft={onDraft} />
      ) : (
        <>
          <Select
            aria-label="Workflow recipe"
            value={recipe.id}
            disabled={busy}
            onValueChange={(id) => {
              setKind(id as RecipeId);
              setValue('');
              setError('');
            }}
          >
            {recipes.map((item) => (
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
          <p className="task-muted">{terms.host} items are read from this project's repository.</p>
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
          <ActionError error={error} />
        </>
      )}
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
