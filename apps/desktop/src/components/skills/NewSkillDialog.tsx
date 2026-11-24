import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  Checkbox,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  SegmentedControl,
  Select,
  SelectItem,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useState } from 'react';
import {
  createSkill,
  importSkill,
  ROOT_LABELS,
  type SkillRoot,
  type SkillTarget,
  skillSlug,
  targetFolder,
} from '../../lib/skill-sync';
import { ActionError } from '../ui/ActionError';

export type NewSkillMode = 'template' | 'import';

interface Place {
  key: string;
  label: string;
  target: SkillTarget;
}

/** Every folder a new skill can go in: personal folders, then each project's. */
function skillPlaces(projects: { id: string; name: string }[]): Place[] {
  const personal = (['claude', 'codex', 'agents'] as SkillRoot[]).map((root) => {
    const target: SkillTarget = { scope: 'personal', root, projectId: null };
    return {
      key: `personal:${root}`,
      label: `Personal · ${ROOT_LABELS[root]} (${targetFolder(target)})`,
      target,
    };
  });
  const project = projects.flatMap((item) =>
    (['claude', 'agents'] as SkillRoot[]).map((root) => {
      const target: SkillTarget = { scope: 'project', root, projectId: item.id };
      return {
        key: `project:${root}:${item.id}`,
        label: `${item.name} · ${targetFolder(target)}`,
        target,
      };
    }),
  );
  return [...personal, ...project];
}

export function NewSkillDialog({
  mode,
  projects,
  onModeChange,
  onClose,
  onCreated,
  onCloseAutoFocus,
}: {
  mode: NewSkillMode | null;
  projects: { id: string; name: string }[];
  onModeChange: (mode: NewSkillMode) => void;
  onClose: () => void;
  onCreated: (id: string) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const places = useMemo(() => skillPlaces(projects), [projects]);
  const [place, setPlace] = useState('personal:claude');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [keepOut, setKeepOut] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chosen = places.find((item) => item.key === place) ?? places[0];
  const slug = skillSlug(name);
  const project = chosen.target.scope === 'project';
  const ready = mode === 'import' || (slug.length > 0 && description.trim().length > 0);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const id =
        mode === 'import'
          ? await importSkill(chosen.target, keepOut)
          : await createSkill(chosen.target, slug, description.trim(), keepOut);
      if (id) {
        onCreated(id);
        setName('');
        setDescription('');
      }
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root open={mode !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="skill-new" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogCloseButton label="Close new skill" disabled={busy} />
        <DialogHeader
          title="New skill"
          description="Agents read skills from these folders. Personal skills apply in every project."
        />
        <form
          className="skill-new-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !busy) void submit();
          }}
        >
          <SegmentedControl<NewSkillMode>
            label="Start from"
            value={mode ?? 'template'}
            onChange={onModeChange}
            items={[
              { id: 'template', label: 'Template' },
              { id: 'import', label: 'Import a file' },
            ]}
          />
          <FormField label="Folder">
            <Select value={chosen.key} onValueChange={setPlace} aria-label="Folder">
              {places.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {item.label}
                </SelectItem>
              ))}
            </Select>
          </FormField>
          {mode !== 'import' && (
            <>
              <FormField
                label="Name"
                description={
                  slug ? `Saved as ${targetFolder(chosen.target)}/${slug}/SKILL.md` : undefined
                }
              >
                <Input
                  value={name}
                  maxLength={64}
                  placeholder="release-notes"
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                />
              </FormField>
              <FormField
                label="When to use it"
                description="Agents read this line to decide when the skill applies."
              >
                <Input
                  value={description}
                  maxLength={1024}
                  placeholder="Use when writing release notes for this product."
                  onChange={(event) => setDescription(event.target.value)}
                />
              </FormField>
            </>
          )}
          {mode === 'import' && (
            <p className="skill-new-hint">
              Choose a Markdown file. A <code>SKILL.md</code> keeps its folder’s name; other files
              are named from their front matter or file name.
            </p>
          )}
          {project && (
            <label className="ui-choice">
              <Checkbox checked={keepOut} onChange={(event) => setKeepOut(event.target.checked)} />
              <span className="ui-choice-body">
                <span className="ui-choice-title">Keep out of commits</span>
                <span className="ui-choice-description">
                  Adds the folder to this repository’s local exclude file, which is never committed.
                </span>
              </span>
            </label>
          )}
          <ActionError error={error} />
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!ready}
              loading={busy}
              loadingLabel={mode === 'import' ? 'Importing…' : 'Creating…'}
            >
              {mode === 'import' ? 'Choose file…' : 'Create skill'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
}
