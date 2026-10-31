import { Checkbox, DropdownMenu as Menu } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  describeDrift,
  FEATURE_MAP_LIMIT,
  type FeatureDrift,
  type FeatureMapEntry,
  featurePageError,
  newSuggestions,
  parseSources,
  withoutMissingPaths,
} from '../../lib/feature-map';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { type Project, useProjectStore } from '../../stores/projectStore';
import { Setting, SettingActions, SettingBody, SettingGroup } from '../settings/Setting';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { DialogCloseButton, DialogContent, DialogFooter, DialogHeader } from '../ui/Dialog';
import { FormField } from '../ui/FormField';
import { InlineNotice } from '../ui/InlineNotice';
import { Input } from '../ui/input';
import { OptionsMenu } from '../ui/OptionsMenu';
import { Textarea } from '../ui/Textarea';
import { useDialogFocus } from '../ui/useDialogFocus';
import './feature-map.css';

interface Draft {
  name: string;
  page: string;
  working: string;
  steps: string;
  sources: string;
}

const EMPTY_DRAFT: Draft = { name: '', page: '', working: '', steps: '', sources: '' };

function toDraft(entry: FeatureMapEntry): Draft {
  return {
    name: entry.name,
    page: entry.page,
    working: entry.working ?? '',
    steps: entry.steps ?? '',
    sources: (entry.sources ?? []).join('\n'),
  };
}

function FeatureEditor({
  entry,
  onSave,
  onClose,
}: {
  entry: FeatureMapEntry | null;
  onSave: (entry: FeatureMapEntry) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(entry ? toDraft(entry) : EMPTY_DRAFT);
  const [submitted, setSubmitted] = useState(false);
  const focus = useDialogFocus();
  const patch = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));
  const nameError = submitted && !draft.name.trim() ? 'Enter a name.' : '';
  const pageError = submitted ? featurePageError(draft.page) : '';
  const save = () => {
    setSubmitted(true);
    if (!draft.name.trim() || featurePageError(draft.page)) return;
    const sources = parseSources(draft.sources);
    onSave({
      name: draft.name.trim(),
      page: draft.page.trim(),
      working: draft.working.trim() || undefined,
      steps: draft.steps.trim() || undefined,
      sources: sources.length ? sources : undefined,
      // The suggested route file belongs to the page it was found for.
      routeFile: entry?.routeFile && draft.page.trim() === entry.page ? entry.routeFile : undefined,
    });
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogContent {...focus} className="feature-map-dialog">
        <DialogCloseButton />
        <DialogHeader
          title={entry ? `Edit ${entry.name}` : 'Add feature'}
          description="Review screenshots prefer this page when work changes its source files."
        />
        <form
          id="feature-map-editor"
          className="feature-map-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <FormField label="Name" error={nameError}>
            <Input
              value={draft.name}
              maxLength={120}
              placeholder="Billing settings"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </FormField>
          <FormField
            label="Page"
            description="Screenshots open this page only. Add a query such as ?tab=billing to reach a state."
            error={pageError}
          >
            <Input
              value={draft.page}
              maxLength={300}
              placeholder="/settings/billing"
              onChange={(event) => patch({ page: event.target.value })}
            />
          </FormField>
          <FormField label="Working looks like">
            <Input
              value={draft.working}
              maxLength={500}
              placeholder="Current plan and next invoice date are shown"
              onChange={(event) => patch({ working: event.target.value })}
            />
          </FormField>
          <FormField label="How to reach it" description="Optional steps a reviewer follows.">
            <Textarea
              rows={2}
              value={draft.steps}
              maxLength={500}
              placeholder="Sign in, open Settings, choose Billing"
              onChange={(event) => patch({ steps: event.target.value })}
            />
          </FormField>
          <FormField
            label="Source paths"
            description="One per line, relative to the project, such as src/billing/**. Without any, the page is never preferred."
          >
            <Textarea
              rows={3}
              value={draft.sources}
              placeholder="src/billing/**"
              onChange={(event) => patch({ sources: event.target.value })}
            />
          </FormField>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="feature-map-editor">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}

function SuggestionPicker({
  suggestions,
  onAdd,
  onClose,
}: {
  suggestions: FeatureMapEntry[];
  onAdd: (entries: FeatureMapEntry[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(() => new Set(suggestions.map((_, index) => index)));
  const focus = useDialogFocus();
  const toggle = (index: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogContent {...focus} className="feature-map-dialog">
        <DialogCloseButton />
        <DialogHeader
          title="Suggested features"
          description={
            suggestions.length
              ? 'Found in your route files and router setup. Add the ones that matter, then describe what working looks like.'
              : undefined
          }
        />
        {suggestions.length ? (
          <ul className="feature-map-suggestions">
            {suggestions.map((entry, index) => (
              <li key={entry.page}>
                <label className="feature-map-suggestion">
                  <Checkbox checked={selected.has(index)} onChange={() => toggle(index)} />
                  <span className="feature-map-suggestion-text">
                    <strong>{entry.name}</strong>
                    <span className="feature-map-path">{entry.page}</span>
                    {entry.routeFile && (
                      <span className="feature-map-path task-muted">{entry.routeFile}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <InlineNotice tone="info">
            No new routes were found. Add features yourself with Add feature.
          </InlineNotice>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {suggestions.length ? 'Cancel' : 'Close'}
          </Button>
          {suggestions.length > 0 && (
            <Button
              type="button"
              disabled={selected.size === 0}
              onClick={() => onAdd(suggestions.filter((_, index) => selected.has(index)))}
            >
              {selected.size === 1 ? 'Add 1 feature' : `Add ${selected.size} features`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}

/**
 * The project's feature map: pages review screenshots prefer when work changes
 * their sources. Suggestions and drift are read locally; every change to the
 * saved map needs the person's confirmation.
 */
export function FeatureMapSettings({ project }: { project: Project }) {
  const updateProjectPreferences = useProjectStore((state) => state.updateProjectPreferences);
  const entries = project.preferences?.featureMap ?? [];
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<FeatureMapEntry[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [drift, setDrift] = useState<FeatureDrift[]>([]);
  const [error, setError] = useState('');
  const native = isTauriEnvironment();
  const serialized = JSON.stringify(entries);

  useEffect(() => {
    setDrift([]);
    if (!native || serialized === '[]') return;
    let current = true;
    const timer = window.setTimeout(() => {
      nativeTask<FeatureDrift[]>('project_feature_drift', {
        projectPath: project.path,
        features: JSON.parse(serialized),
      })
        .then((found) => current && setDrift(found))
        .catch(() => current && setDrift([]));
    }, 300);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [native, project.path, serialized]);

  const save = (featureMap: FeatureMapEntry[]) =>
    updateProjectPreferences(project.id, { featureMap });

  const suggest = async () => {
    setSuggesting(true);
    setError('');
    try {
      const found = await nativeTask<FeatureMapEntry[]>('project_feature_suggestions', {
        projectPath: project.path,
      });
      setSuggestions(newSuggestions(entries, found));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSuggesting(false);
    }
  };

  const full = entries.length >= FEATURE_MAP_LIMIT;
  const editingEntry = editing?.index != null ? (entries[editing.index] ?? null) : null;
  const removingEntry = removing != null ? entries[removing] : undefined;

  return (
    <SettingGroup
      title="Feature map"
      description="Pages worth a screenshot when work changes their source files. Review shows what working looks like on each."
    >
      {error && (
        <SettingBody>
          <InlineNotice tone="error">{error}</InlineNotice>
        </SettingBody>
      )}
      {entries.length === 0 && (
        <SettingBody>
          <p className="task-muted feature-map-empty">
            No features yet. Suggest them from your routes or add one.
          </p>
        </SettingBody>
      )}
      {entries.map((entry, index) => {
        const problem = drift.find((item) => item.index === index);
        return (
          <Setting
            // biome-ignore lint/suspicious/noArrayIndexKey: entries have no identity; names and pages can repeat.
            key={index}
            className="feature-map-row"
            title={entry.name || 'Unnamed feature'}
            description={
              <>
                <span className="feature-map-path">{entry.page}</span>
                {entry.working && <> · {entry.working}</>}
                {problem && (
                  <span className="feature-map-drift" role="status">
                    <AlertTriangle size={14} aria-hidden="true" />
                    {describeDrift(problem)}
                  </span>
                )}
              </>
            }
          >
            <Button variant="outline" onClick={() => setEditing({ index })}>
              Edit
            </Button>
            <OptionsMenu label={`${entry.name || 'Feature'} options`}>
              {problem && (
                <Menu.Item
                  className="workspace-menu-item"
                  onSelect={() =>
                    save(
                      entries.map((item, at) =>
                        at === index ? withoutMissingPaths(item, problem) : item,
                      ),
                    )
                  }
                >
                  Drop missing paths
                </Menu.Item>
              )}
              <Menu.Item className="workspace-menu-item" onSelect={() => setRemoving(index)}>
                Remove…
              </Menu.Item>
            </OptionsMenu>
          </Setting>
        );
      })}
      {native && (
        <SettingActions>
          <Button
            variant="outline"
            loading={suggesting}
            loadingLabel="Reading routes…"
            disabled={full}
            onClick={() => void suggest()}
          >
            Suggest from code
          </Button>
          <Button variant="outline" disabled={full} onClick={() => setEditing({ index: null })}>
            Add feature
          </Button>
        </SettingActions>
      )}
      {editing && (
        <FeatureEditor
          entry={editingEntry}
          onClose={() => setEditing(null)}
          onSave={(entry) => {
            save(
              editing.index == null
                ? [...entries, entry]
                : entries.map((item, at) => (at === editing.index ? entry : item)),
            );
            setEditing(null);
          }}
        />
      )}
      {suggestions && (
        <SuggestionPicker
          suggestions={suggestions.slice(0, FEATURE_MAP_LIMIT - entries.length)}
          onClose={() => setSuggestions(null)}
          onAdd={(added) => {
            save([...entries, ...added]);
            setSuggestions(null);
          }}
        />
      )}
      <ConfirmAction
        open={removingEntry !== undefined}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removingEntry?.name || 'this feature'}?`}
        description="Review screenshots stop preferring its page. Your code is not changed."
        label="Remove"
        busyLabel="Removing…"
        onConfirm={() => {
          if (removing != null) save(entries.filter((_, at) => at !== removing));
          setRemoving(null);
        }}
      />
    </SettingGroup>
  );
}
