import { Badge, Choice, Input } from '@jackalope/ui';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { type FormEvent, useEffect, useState } from 'react';
import {
  type ProjectSecret,
  projectSecrets,
  removeProjectSecret,
  SECRET_NAME_PATTERN,
  SECRET_VALUE_MAX_CHARS,
  type SecretAvailability,
  setProjectSecret,
} from '../../lib/project-secrets';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Setting, SettingBody, SettingGroup } from '../settings/Setting';
import { Button } from '../ui/button';
import { FormField } from '../ui/FormField';
import { InlineNotice } from '../ui/InlineNotice';
import './project-secrets.css';

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
  const duration = motionSeconds('--motion-base', 180);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let current = true;
    setError('');
    void projectSecrets(projectId)
      .then((value) => current && setSecrets(value))
      .catch((cause) => current && setError(String(cause)));
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
      setError(String(cause));
      return false;
    } finally {
      setBusy('');
    }
  };

  const existing = secrets.some((secret) => secret.name === name);
  const invalidName = nameError(name);
  const canAdd = !!name && !invalidName && !!value.trim() && !busy;

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!canAdd) return;
    if (await run('add', () => setProjectSecret(projectId, name, value, availableTo))) {
      setName('');
      setValue('');
      setAvailableTo('both');
    }
  };

  const startEditing = (secret: ProjectSecret) => {
    setEditing(secret.name);
    setReplacement('');
    setEditAvailability(secret.availableTo);
  };

  const saveEdit = async (event: FormEvent, secret: ProjectSecret) => {
    event.preventDefault();
    const saved = await run(secret.name, () =>
      setProjectSecret(
        projectId,
        secret.name,
        replacement.trim() ? replacement : null,
        editAvailability,
      ),
    );
    if (saved) {
      setEditing('');
      setReplacement('');
    }
  };

  return (
    <SettingGroup
      title="Secrets"
      description="Agents in this project can read these as environment variables. Anything an agent can read it can use or leak; use keys with spending limits."
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
              <Setting
                title={
                  <span className="inline-flex items-center gap-2">
                    <code className="project-secret-name">{secret.name}</code>
                    <Badge variant="accent">Saved</Badge>
                  </span>
                }
                description={`${availabilityLabel(secret.availableTo)} · saved ${new Date(
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
              </Setting>
              {editing === secret.name && (
                <SettingBody>
                  <form
                    className="project-secret-form"
                    onSubmit={(event) => void saveEdit(event, secret)}
                  >
                    <FormField label="New value" description="Leave empty to keep the saved value.">
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
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        variant="outline"
                        loading={busy === secret.name}
                        loadingLabel="Saving…"
                        disabled={
                          !!busy || (!replacement.trim() && editAvailability === secret.availableTo)
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
      <SettingBody>
        <form className="project-secret-form" onSubmit={(event) => void add(event)}>
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
          </div>
          <AvailabilityChoices
            label="Available to"
            value={availableTo}
            onChange={setAvailableTo}
            disabled={!!busy}
          />
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
          </div>
        </form>
      </SettingBody>
    </SettingGroup>
  );
}
