import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  DefinitionList,
  FormField,
  InlineNotice,
  Input,
  SettingActions,
  SettingBody,
  SettingGroup,
} from '@jackalope/ui';
import { type FormEvent, useEffect, useState } from 'react';
import {
  type AppStoreConnection,
  appStoreConnection,
  removeAppStoreConnection,
  saveAppStoreConnection,
  validateAppStoreConnection,
} from '../../lib/app-store-connect';
import { isTauriEnvironment } from '../../lib/native/env';
import { fileSecretError, keyIdFromFileName, type SecretFileValue } from '../../lib/secret-file';
import { SecretFileInput } from './SecretFileInput';
import './project-secrets.css';

interface Draft {
  issuerId: string;
  keyId: string;
  developmentTeam: string;
  bundleId: string;
  scheme: string;
}

const EMPTY: Draft = { issuerId: '', keyId: '', developmentTeam: '', bundleId: '', scheme: '' };

const fromConnection = (connection: AppStoreConnection | null): Draft =>
  connection
    ? {
        issuerId: connection.issuerId,
        keyId: connection.keyId,
        developmentTeam: connection.developmentTeam,
        bundleId: connection.bundleId ?? '',
        scheme: connection.scheme ?? '',
      }
    : EMPTY;

const when = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The App Store Connect API key Jackalope uses to sign and upload a task's iOS app to
 * TestFlight. The key is kept in protected storage and never given to agents.
 */
export function AppStoreConnectSettings({ projectId }: { projectId: string }) {
  const [connection, setConnection] = useState<AppStoreConnection | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [key, setKey] = useState<SecretFileValue | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let current = true;
    void appStoreConnection(projectId)
      .then((value) => current && setConnection(value))
      .catch((cause) => current && setError(describeError(cause)));
    return () => {
      current = false;
    };
  }, [projectId]);

  const field = (name: keyof Draft) => ({
    value: draft[name],
    disabled: !!busy,
    autoComplete: 'off',
    spellCheck: false,
    onChange: (event: { target: { value: string } }) =>
      setDraft((value) => ({ ...value, [name]: event.target.value })),
  });

  const validate = async () => {
    setBusy('validate');
    setError('');
    setSummary('');
    try {
      const result = await validateAppStoreConnection(projectId);
      setConnection(result.connection);
      setSummary(result.summary);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy('');
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('save');
    setError('');
    setSummary('');
    let saved = false;
    try {
      const optional = (value: string) => value.trim() || null;
      setConnection(
        await saveAppStoreConnection(projectId, {
          issuerId: draft.issuerId.trim(),
          keyId: draft.keyId.trim().toUpperCase(),
          key: key?.text ?? null,
          keyFileName: key ? key.fileName : (connection?.keyFileName ?? null),
          developmentTeam: draft.developmentTeam.trim().toUpperCase(),
          bundleId: optional(draft.bundleId),
          scheme: optional(draft.scheme),
          exportMethod: connection?.exportMethod ?? null,
        }),
      );
      saved = true;
      setEditing(false);
      setKey(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy('');
    }
    if (saved) await validate();
  };

  const remove = async () => {
    setBusy('remove');
    setError('');
    setSummary('');
    try {
      await removeAppStoreConnection(projectId);
      setConnection(null);
      setDraft(EMPTY);
      setEditing(false);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy('');
    }
  };

  const startEditing = () => {
    setDraft(fromConnection(connection));
    setKey(null);
    setSummary('');
    setError('');
    setEditing(true);
  };

  const keyProblem = key ? fileSecretError(key.text) : connection ? '' : 'Add the API key.';
  const canSave =
    !busy &&
    !!draft.issuerId.trim() &&
    !!draft.keyId.trim() &&
    !!draft.developmentTeam.trim() &&
    !keyProblem;

  return (
    <SettingGroup
      title="App Store Connect"
      description="Upload this project's iOS app from a finished task to TestFlight. Jackalope signs and uploads with this key itself; agents never receive it."
      action={
        !connection && !editing ? (
          <Button variant="outline" disabled={!!busy} onClick={startEditing}>
            Set up
          </Button>
        ) : undefined
      }
    >
      {connection && !editing && (
        <>
          <SettingBody>
            <DefinitionList
              items={[
                { label: 'Key ID', value: <code>{connection.keyId}</code> },
                { label: 'Issuer ID', value: <code>{connection.issuerId}</code> },
                { label: 'Team ID', value: <code>{connection.developmentTeam}</code> },
                ...(connection.bundleId
                  ? [{ label: 'Bundle ID', value: <code>{connection.bundleId}</code> }]
                  : []),
                ...(connection.scheme ? [{ label: 'Scheme', value: connection.scheme }] : []),
                {
                  label: 'Checked',
                  value: connection.validatedAt ? when(connection.validatedAt) : 'Not yet',
                },
              ]}
            />
          </SettingBody>
          <SettingActions>
            <Button
              variant="outline"
              loading={busy === 'validate'}
              loadingLabel="Checking…"
              disabled={!!busy}
              onClick={() => void validate()}
            >
              Check key
            </Button>
            <Button variant="outline" disabled={!!busy} onClick={startEditing}>
              Change
            </Button>
            <Button
              variant="outline"
              loading={busy === 'remove'}
              loadingLabel="Removing…"
              disabled={!!busy}
              onClick={() => void remove()}
            >
              Remove
            </Button>
          </SettingActions>
        </>
      )}
      {editing && (
        <SettingBody>
          <form className="project-secret-form" onSubmit={(event) => void save(event)}>
            <div className="project-secret-fields">
              <FormField
                label="Issuer ID"
                description="Users and Access → Integrations in App Store Connect."
              >
                <Input id="asc-issuer" placeholder="69a6de70-…" {...field('issuerId')} />
              </FormField>
              <FormField label="Key ID">
                <Input
                  id="asc-key-id"
                  maxLength={10}
                  placeholder="ABC123XYZ9"
                  {...field('keyId')}
                />
              </FormField>
              <FormField
                label="Team ID"
                description="Membership details on the Apple Developer site."
              >
                <Input
                  id="asc-team"
                  maxLength={10}
                  placeholder="A1B2C3D4E5"
                  {...field('developmentTeam')}
                />
              </FormField>
              <FormField
                label="Bundle ID (optional)"
                description="Uploads are refused when the project builds another app."
              >
                <Input id="asc-bundle" placeholder="com.example.app" {...field('bundleId')} />
              </FormField>
              <FormField label="Scheme (optional)" description="Found from the project when empty.">
                <Input id="asc-scheme" {...field('scheme')} />
              </FormField>
            </div>
            <SecretFileInput
              label={connection ? 'API key (leave empty to keep the saved key)' : 'API key (.p8)'}
              description="Choose the AuthKey_….p8 file you downloaded, or paste its contents."
              accept=".p8"
              value={key}
              disabled={!!busy}
              onChange={(value) => {
                setKey(value);
                const keyId = keyIdFromFileName(value?.fileName);
                if (keyId && !draft.keyId.trim()) setDraft((current) => ({ ...current, keyId }));
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="outline"
                loading={busy === 'save'}
                loadingLabel="Saving…"
                disabled={!canSave}
              >
                Save and check
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy === 'save'}
                onClick={() => {
                  setEditing(false);
                  setKey(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </SettingBody>
      )}
      {(error || summary) && (
        <SettingBody>
          {error ? (
            <InlineNotice tone="error">{error}</InlineNotice>
          ) : (
            <InlineNotice tone="success">{summary}</InlineNotice>
          )}
        </SettingBody>
      )}
    </SettingGroup>
  );
}
