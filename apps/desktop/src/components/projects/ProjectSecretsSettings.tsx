import {
  Badge,
  Button,
  Choice,
  FormField,
  InlineNotice,
  Input,
  SegmentedControl,
  SettingBody,
  SettingGroup,
  SettingRow,
} from '@jackalope/ui';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { type FormEvent, useEffect, useState } from 'react';
import { isTauriEnvironment } from '../../lib/native/env';
import {
  type ProjectSecret,
  projectSecrets,
  removeProjectSecret,
  SECRET_NAME_PATTERN,
  SECRET_VALUE_MAX_CHARS,
  type SecretAvailability,
  type SecretKind,
  setProjectSecret,
} from '../../lib/project-secrets';
import { fileSecretError, type SecretFileValue } from '../../lib/secret-file';
import './project-secrets.css';
import { describeError } from '@jackalope/contracts/errors';
import { SecretFileInput } from './SecretFileInput';

const KINDS = [
  { id: 'variable', label: 'Value' },
  { id: 'file', label: 'File' },
] as const;

const FILE_NOTE =
  'Agents on this device receive the path to a private copy, removed when the attempt ends. File secrets are never sent to computers.';

const AVAILABILITY: { value: SecretAvailability; title: string; description: string }[] = [
  { value: 'both', title: 'All agents', description: 'On this device and on computers.' },
  { value: 'local', title: 'Agents on this device', description: 'Not sent to computers.' },
  {
    value: 'computers',
    title: 'Agents on computers',
    description: 'Not given to agents on this device.',
  },
];

const availabilityLabel = (value: SecretAvailability) =>
  AVAILABILITY.find((option) => option.value === value)?.title ?? 'All agents';

/** Reads a shared `--motion-*` duration so row motion matches the rest of the app. */
function motionSeconds(token: string, fallbackMs: number) {
  if (typeof window === 'undefined') return fallbackMs / 1000;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const ms = raw.endsWith('ms') ? Number.parseFloat(raw) : Number.parseFloat(raw) * 1000;
  return (Number.isFinite(ms) ? ms : fallbackMs) / 1000;
}

const ROW_MOTION = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' },
  exit: { opacity: 0, height: 0 },
};

function nameError(name: string) {
  if (!name) return '';
  return SECRET_NAME_PATTERN.test(name)
    ? ''
    : 'Use capital letters, digits and underscores, starting with a letter or underscore.';
}

/** Normalizes typing toward an environment variable name: capitals, underscores for gaps. */
const toName = (value: string) => value.toUpperCase().replace(/[\s-]+/g, '_');

function AvailabilityChoices({
  value,
  onChange,
  label,
  disabled,
}: {
  value: SecretAvailability;
  onChange: (value: SecretAvailability) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <fieldset className="project-secret-availability">
      <legend className="project-secret-legend">{label}</legend>
      {AVAILABILITY.map((option) => (
        <Choice
          key={option.value}
          selected={value === option.value}
          title={option.title}
          description={option.description}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        />
      ))}
    </fieldset>
  );
}

/** Environment variables for this project's task agents. Saved values never return to the app. */
export function ProjectSecretsSettings({ projectId }: { projectId: string }) {
  const [secrets, setSecrets] = useState<ProjectSecret[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [availableTo, setAvailableTo] = useState<SecretAvailability>('both');
  const [editing, setEditing] = useState('');
  const [replacement, setReplacement] = useState('');
  const [editAvailability, setEditAvailability] = useState<SecretAvailability>('both');
  const [kind, setKind] = useState<SecretKind>('variable');
  const [file, setFile] = useState<SecretFileValue | null>(null);
  const [replacementFile, setReplacementFile] = useState<SecretFileValue | null>(null);
  /** Saved secrets come first; the add form opens on request, or straight away when empty. */
  const [adding, setAdding] = useState(false);
  const duration = motionSeconds('--motion-base', 180);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let current = true;
    setError('');
    void projectSecrets(projectId)
      .then((value) => current && setSecrets(value))
      .catch((cause) => current && setError(describeError(cause)));
    return () => {
      current = false;
    };
  }, [projectId]);

  const run = async (key: string, operation: () => Promise<ProjectSecret[]>) => {
    setBusy(key);
    setError('');
    try {
      setSecrets(await operation());
      return true;
    } catch (cause) {
      setError(describeError(cause));
      return false;
    } finally {
      setBusy('');
    }
  };

  const existing = secrets.some((secret) => secret.name === name);
  const invalidName = nameError(name);
  const hasValue = kind === 'file' ? !!file && !fileSecretError(file.text) : !!value.trim();
  const canAdd = !!name && !invalidName && hasValue && !busy;

  const resetAdd = () => {
    setName('');
    setValue('');
    setFile(null);
    setKind('variable');
    setAvailableTo('both');
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!canAdd) return;
    const saved = await run('add', () =>
      kind === 'file' && file
        ? setProjectSecret(projectId, name, file.text, 'local', { fileName: file.fileName })
        : setProjectSecret(projectId, name, value, availableTo),
    );
    if (saved) {
      resetAdd();
      setAdding(false);
    }
  };

  const startEditing = (secret: ProjectSecret) => {
    setEditing(secret.name);
    setReplacement('');
    setReplacementFile(null);
    setEditAvailability(secret.availableTo);
  };

  const saveEdit = async (event: FormEvent, secret: ProjectSecret) => {
    event.preventDefault();
    const saved = await run(secret.name, () =>
      secret.kind === 'file'
        ? setProjectSecret(projectId, secret.name, replacementFile?.text ?? null, 'local', {
            fileName: replacementFile?.fileName ?? null,
          })
        : setProjectSecret(
            projectId,
            secret.name,
            replacement.trim() ? replacement : null,
            editAvailability,
          ),
    );
    if (saved) {
      setEditing('');
      setReplacement('');
      setReplacementFile(null);
    }
  };

  return (
    <SettingGroup
      title="Secrets"
      description="Agents in this project can read these as environment variables, or as files for keys such as .p8 and .pem. Anything an agent can read it can use or leak; use keys with spending limits."
    >
      {error && (
        <SettingBody>
          <InlineNotice tone="error">{error}</InlineNotice>
        </SettingBody>
      )}
      <MotionConfig reducedMotion="user">
        <AnimatePresence initial={false}>
          {secrets.map((secret) => (
            <motion.div
              key={secret.name}
              className="project-secret-row"
              {...ROW_MOTION}
              transition={{ duration, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <SettingRow
                title={
                  <span className="inline-flex items-center gap-2">
                    <code className="project-secret-name">{secret.name}</code>
                    <Badge variant="accent">Saved</Badge>
                    {secret.kind === 'file' && <Badge>File</Badge>}
                  </span>
                }
                description={`${secret.kind === 'file' ? `${secret.fileName ?? 'Pasted file'} · ` : ''}${availabilityLabel(secret.availableTo)} · saved ${new Date(
                  secret.updatedAt,
                ).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`}
              >
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!!busy}
                    aria-expanded={editing === secret.name}
                    aria-label={`Change ${secret.name}`}
                    onClick={() =>
                      editing === secret.name ? setEditing('') : startEditing(secret)
                    }
                  >
                    {editing === secret.name ? 'Cancel' : 'Change'}
                  </Button>
                  <Button
                    variant="outline"
                    loading={busy === `remove:${secret.name}`}
                    loadingLabel="Removing…"
                    disabled={!!busy}
                    aria-label={`Remove ${secret.name}`}
                    onClick={() =>
                      void run(`remove:${secret.name}`, () =>
                        removeProjectSecret(projectId, secret.name),
                      ).then((removed) => removed && editing === secret.name && setEditing(''))
                    }
                  >
                    Remove
                  </Button>
                </div>
              </SettingRow>
              {editing === secret.name && (
                <SettingBody>
                  <form
                    className="project-secret-form"
                    onSubmit={(event) => void saveEdit(event, secret)}
                  >
                    {secret.kind === 'file' ? (
                      <SecretFileInput
                        label="New file"
                        description="Choose the replacement file, or paste its contents."
                        value={replacementFile}
                        onChange={setReplacementFile}
                        disabled={!!busy}
                      />
                    ) : (
                      <>
                        <FormField
                          label="New value"
                          description="Leave empty to keep the saved value."
                        >
                          <Input
                            id={`project-secret-replace-${secret.name}`}
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            maxLength={SECRET_VALUE_MAX_CHARS}
                            className="project-setting-input"
                            value={replacement}
                            onChange={(event) => setReplacement(event.target.value)}
                          />
                        </FormField>
                        <AvailabilityChoices
                          label={`${secret.name} is available to`}
                          value={editAvailability}
                          onChange={setEditAvailability}
                          disabled={!!busy}
                        />
                      </>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        variant="outline"
                        loading={busy === secret.name}
                        loadingLabel="Saving…"
                        disabled={
                          !!busy ||
                          (secret.kind === 'file'
                            ? !replacementFile || !!fileSecretError(replacementFile.text)
                            : !replacement.trim() && editAvailability === secret.availableTo)
                        }
                      >
                        Save
                      </Button>
                    </div>
                  </form>
                </SettingBody>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </MotionConfig>
      {secrets.length > 0 && !adding ? (
        <SettingBody>
          <Button variant="outline" size="sm" disabled={!!busy} onClick={() => setAdding(true)}>
            Add secret
          </Button>
        </SettingBody>
      ) : (
        <SettingBody>
          <form className="project-secret-form" onSubmit={(event) => void add(event)}>
            <SegmentedControl
              label="Secret type"
              items={KINDS}
              value={kind}
              onChange={(next) => setKind(next)}
            />
            <div className="project-secret-fields">
              <FormField
                label="Name"
                error={invalidName || undefined}
                description={existing ? 'Saving replaces the saved value.' : undefined}
              >
                <Input
                  id="project-secret-name"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={128}
                  placeholder="HIGGSFIELD_API_KEY"
                  value={name}
                  onChange={(event) => setName(toName(event.target.value))}
                />
              </FormField>
              {kind === 'variable' && (
                <FormField label="Value">
                  <Input
                    id="project-secret-value"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={SECRET_VALUE_MAX_CHARS}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </FormField>
              )}
            </div>
            {kind === 'file' ? (
              <>
                <SecretFileInput label="File" value={file} onChange={setFile} disabled={!!busy} />
                <p className="project-secret-note">{FILE_NOTE}</p>
              </>
            ) : (
              <AvailabilityChoices
                label="Available to"
                value={availableTo}
                onChange={setAvailableTo}
                disabled={!!busy}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="outline"
                loading={busy === 'add'}
                loadingLabel="Saving…"
                disabled={!canAdd}
              >
                {existing ? 'Replace secret' : 'Add secret'}
              </Button>
              {secrets.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy === 'add'}
                  onClick={() => {
                    setAdding(false);
                    resetAdd();
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </SettingBody>
      )}
    </SettingGroup>
  );
}
