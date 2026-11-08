import {
  Button,
  Checkbox,
  ConfirmDialog,
  CopyButton,
  DropdownMenu,
  FormField,
  IconButton,
  InlineNotice,
  Input,
  LinkButton,
  LoadingState,
  Stepper,
  type StepperStep,
  Textarea,
} from '@jackalope/ui';
import { Cloud, MoreHorizontal } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { openProjectSettings, openSettings } from '../../lib/app-events';
import {
  CLOUD_RESOURCES,
  type CloudResourceKind,
  DEFAULT_KINDS,
  isProvisioned,
  orderedKinds,
  parseDomains,
  requiredPermissions,
  resourceOption,
  resourcePrefix,
  validPrefix,
} from '../../lib/cloud-resources-plan';
import {
  ARTIFACTS_TOKEN_URL,
  cancelCloudflareSignIn,
  reauthorizeCloudflare,
} from '../../lib/cloudflare-artifacts';
import {
  type CloudResource,
  type CloudResourceStep,
  type CloudResourcesFailure,
  type CloudResourcesStatus,
  cloudResourcesStatus,
  deleteCloudResource,
  forgetCloudResource,
  onCloudResourcesProgress,
  provisionCloudResources,
  turnstileSecret,
} from '../../lib/cloudflare-resources';
import { isTauriEnvironment, openExternalUrl } from '../../lib/native/env';
import { type CloudResourcesDraft, useCloudResourcesStore } from '../../stores/cloudResourcesStore';
import { useActiveProject } from '../../stores/projectStore';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import './cloud-resources.css';
import { describeError, errorCode } from '../../lib/errors';
import { useCloudflareSignIn } from '../../lib/useCloudflareSignIn';

interface Run {
  kinds: CloudResourceKind[];
  prefix: string;
  current: CloudResourceStep;
  /** Waiting for the person to allow access in their browser. */
  signingIn?: boolean;
  failure?: CloudResourcesFailure;
}

const signInFailure = (cause: unknown): CloudResourcesFailure => {
  const token = errorCode(cause) === 'apiToken';
  return {
    step: 'account',
    message: describeError(cause),
    recovery: token ? 'token' : null,
    link: token ? ARTIFACTS_TOKEN_URL : null,
    scopes: [],
    permissions: [],
  };
};

function runSteps(run: Run): StepperStep[] {
  const ids: CloudResourceStep[] = ['account', ...run.kinds, 'manifest'];
  const at = ids.indexOf(run.current);
  return ids.map((id, index) => ({
    id,
    label:
      id === 'account'
        ? run.signingIn
          ? 'Allow access in your browser'
          : 'Check your Cloudflare connection'
        : id === 'manifest'
          ? 'Save .jackalope/cloudflare.json'
          : resourceOption(id).step(run.prefix),
    state: index < at ? 'done' : index > at ? 'waiting' : run.failure ? 'failed' : 'running',
  }));
}

/**
 * Sets up Cloudflare resources for the open project: choose what the app needs, watch
 * each one get found or created, then copy names, IDs and wrangler bindings. Choices
 * are kept across Back, retry and reload until setup succeeds.
 */
export function CloudResources() {
  const project = useActiveProject();
  const savedDraft = useCloudResourcesStore((state) =>
    project ? state.drafts[project.id] : undefined,
  );
  const { saveDraft, clearDraft } = useCloudResourcesStore.getState();
  const [status, setStatus] = useState<CloudResourcesStatus>();
  const [view, setView] = useState<'choose' | 'run' | 'result'>();
  const [postgresUrl, setPostgresUrl] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cloudflareSignIn = useCloudflareSignIn();
  const projectPath = project?.path;

  const draft: CloudResourcesDraft = savedDraft ?? {
    kinds: status?.manifest
      ? orderedKinds(status.manifest.resources.map((resource) => resource.kind))
      : DEFAULT_KINDS,
    prefix: status?.manifest?.prefix ?? resourcePrefix(project?.name ?? ''),
    domains: '',
  };
  const update = (patch: Partial<CloudResourcesDraft>) =>
    project && saveDraft(project.id, { ...draft, ...patch });

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    const next = await cloudResourcesStatus(projectPath);
    setStatus(next);
    return next;
  }, [projectPath]);
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    void refresh()
      .then((next) => {
        const drafted = project?.id && useCloudResourcesStore.getState().drafts[project.id];
        setView((current) => current ?? (next?.manifest && !drafted ? 'result' : 'choose'));
      })
      .catch((cause) => setError(describeError(cause)));
  }, [refresh, project?.id]);

  if (!project) {
    return (
      <WorkspacePage>
        <WorkspaceHeading title="Cloud resources" />
        <InlineNotice>Open a project to set up its cloud resources.</InlineNotice>
      </WorkspacePage>
    );
  }
  const projectId = project.id;
  const open = (link: string) =>
    void openExternalUrl(link).catch((cause) => setError(describeError(cause)));

  const kinds = orderedKinds(draft.kinds);
  const needsPostgres =
    kinds.includes('hyperdrive') &&
    !status?.postgresSaved &&
    !status?.manifest?.resources.some((resource) => resource.kind === 'hyperdrive');
  const domains = parseDomains(draft.domains);
  const ready =
    kinds.length > 0 &&
    validPrefix(draft.prefix) &&
    (!needsPostgres || postgresUrl.trim().length > 0) &&
    (!kinds.includes('turnstile') || domains.length > 0);
  const permissions = requiredPermissions(kinds);

  const toggle = (kind: CloudResourceKind, on: boolean) =>
    update({ kinds: on ? [...draft.kinds, kind] : draft.kinds.filter((item) => item !== kind) });

  /** Connect Cloudflare again for the same account, asking for `scopes` as well. False when canceled. */
  const allow = async (scopes: string[]) => {
    if (!(await cloudflareSignIn({ scopes }))) return false;
    await reauthorizeCloudflare();
    return true;
  };

  const start = async (allowFirst?: string[]) => {
    setBusy(true);
    setError('');
    let state: Run = { kinds, prefix: draft.prefix, current: 'account' };
    const show = (next: Run) => {
      state = next;
      setRun(next);
    };
    show(state);
    setView('run');
    const stop = await onCloudResourcesProgress((progress) => {
      if (progress.projectPath === project.path)
        show({ ...state, current: progress.step, signingIn: false, failure: undefined });
    }).catch(() => undefined);
    try {
      let scopes = allowFirst;
      let asked = Boolean(allowFirst);
      for (;;) {
        if (scopes) {
          show({ ...state, current: 'account', signingIn: true, failure: undefined });
          try {
            if (!(await allow(scopes))) {
              setRun(null);
              setView('choose');
              return;
            }
          } catch (cause) {
            show({ ...state, signingIn: false, failure: signInFailure(cause) });
            return;
          }
          scopes = undefined;
          show({ ...state, signingIn: false });
        }
        const result = await provisionCloudResources(project.path, {
          prefix: draft.prefix,
          kinds,
          postgresUrl: postgresUrl.trim() || undefined,
          turnstileDomains: domains,
        });
        if (result.ok) {
          clearDraft(projectId);
          setPostgresUrl('');
          await refresh();
          setRun(null);
          setView('result');
          return;
        }
        // One automatic sign-in per attempt when Cloudflare needs more access.
        if (result.failure.recovery === 'reauthorize' && !asked) {
          asked = true;
          scopes = result.failure.scopes;
          continue;
        }
        show({ ...state, current: result.failure.step, failure: result.failure });
        await refresh().catch(() => {});
        return;
      }
    } catch (cause) {
      setError(describeError(cause));
      setRun(null);
      setView('choose');
    } finally {
      stop?.();
      setBusy(false);
    }
  };

  const act = async (work: () => Promise<unknown>) => {
    setError('');
    try {
      await work();
      const next = await refresh();
      if (!next?.manifest) setView('choose');
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const manifest = status?.manifest;
  const tokenConnection = !permissions.length
    ? ''
    : `Creating these needs ${permissions.join(', ')} on your Cloudflare connection.`;
  const failure = run?.failure;

  return (
    <WorkspacePage className="cloud-resources-page">
      <WorkspaceHeading
        title="Cloud resources"
        description={`Storage, databases and more for ${project.name} in your Cloudflare account.`}
        action={
          <Button variant="outline" onClick={() => openProjectSettings(projectId)}>
            Project settings
          </Button>
        }
      />
      {!isTauriEnvironment() && (
        <InlineNotice>Cloud resources are available in the desktop app.</InlineNotice>
      )}
      {error && (
        <InlineNotice
          tone="error"
          action={
            <Button variant="ghost" onClick={() => setError('')}>
              Close
            </Button>
          }
        >
          <span className="cloud-resources-wrap">{error}</span>
        </InlineNotice>
      )}
      {isTauriEnvironment() && !status && !error && (
        <LoadingState compact label="Reading cloud resources…" />
      )}
      {status && !status.accountId && !manifest && (
        <section className="cloud-resources-pane cloud-resources-connect">
          <Cloud size={24} aria-hidden="true" />
          <div>
            <h2>Connect Cloudflare first</h2>
            <p>Resources are created in the Cloudflare account connected in Settings.</p>
          </div>
          <Button onClick={() => openSettings('Cloudflare')}>Connect Cloudflare</Button>
        </section>
      )}

      {status?.accountId && view === 'choose' && (
        <form
          className="cloud-resources-pane"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !busy) void start();
          }}
        >
          <p className="cloud-resources-intro">
            Choose what this project needs. Each resource is named from the prefix and reused if it
            already exists, so running this again never creates duplicates.
          </p>
          <FormField
            label="Name prefix"
            description={
              validPrefix(draft.prefix)
                ? `For example ${draft.prefix}-assets and ${draft.prefix}-db.`
                : 'Up to 40 lowercase letters, digits and single hyphens.'
            }
          >
            <Input
              value={draft.prefix}
              spellCheck={false}
              maxLength={40}
              aria-invalid={!validPrefix(draft.prefix)}
              onChange={(event) => update({ prefix: event.target.value.toLowerCase() })}
            />
          </FormField>
          <fieldset className="cloud-resources-choices">
            <legend>Resources</legend>
            <div className="ui-choice-list">
              {CLOUD_RESOURCES.map((option) => {
                const checked = draft.kinds.includes(option.kind);
                return (
                  <div key={option.kind} className="cloud-resources-choice">
                    <label className="ui-choice">
                      <Checkbox
                        checked={checked}
                        onChange={(event) => toggle(option.kind, event.target.checked)}
                      />
                      <span className="ui-choice-body">
                        <span className="ui-choice-title">{option.title}</span>
                        <span className="ui-choice-description">{option.description}</span>
                      </span>
                    </label>
                    {checked && option.needs === 'postgres' && (
                      <FormField
                        className="cloud-resources-input"
                        label="Postgres connection string"
                        description="Kept in this computer’s protected storage and sent only to Cloudflare."
                      >
                        <Input
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          value={postgresUrl}
                          placeholder={
                            needsPostgres
                              ? 'postgres://user:password@host:5432/database'
                              : 'Saved. Leave empty to keep it.'
                          }
                          onChange={(event) => setPostgresUrl(event.target.value)}
                        />
                      </FormField>
                    )}
                    {checked && option.needs === 'domains' && (
                      <FormField
                        className="cloud-resources-input"
                        label="Domains"
                        description="Where the widget runs, one per line. Up to 10."
                      >
                        <Textarea
                          rows={2}
                          spellCheck={false}
                          placeholder="example.com"
                          value={draft.domains}
                          onChange={(event) => update({ domains: event.target.value })}
                        />
                      </FormField>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
          <div className="cloud-resources-footer">
            <p className="cloud-resources-permission">
              {tokenConnection ||
                'Durable Objects and Workers are created when your Worker deploys.'}
            </p>
            <div className="cloud-resources-actions">
              {manifest && (
                <Button type="button" variant="outline" onClick={() => setView('result')}>
                  Back
                </Button>
              )}
              <Button type="submit" disabled={!ready || busy}>
                {kinds.length === 1 ? 'Create 1 resource' : `Create ${kinds.length} resources`}
              </Button>
            </div>
          </div>
        </form>
      )}

      {view === 'run' && run && (
        <section className="cloud-resources-pane" aria-live="polite">
          <Stepper label="Cloud resource setup" steps={runSteps(run)} />
          {failure && (
            <InlineNotice tone="error">
              <span className="cloud-resources-failure">
                {failure.message}
                {failure.permissions.length > 0 && failure.recovery === 'token' && (
                  <span className="cloud-resources-permissions">
                    Missing: {failure.permissions.join(', ')}
                  </span>
                )}
                <span className="cloud-resources-actions">
                  {failure.recovery === 'reauthorize' ? (
                    <Button size="sm" disabled={busy} onClick={() => void start(failure.scopes)}>
                      Allow in Cloudflare
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busy} onClick={() => void start()}>
                      Retry
                    </Button>
                  )}
                  {failure.link && (
                    <LinkButton external onClick={() => failure.link && open(failure.link)}>
                      {failure.recovery === 'token' ? 'Open API tokens' : 'Open Cloudflare'}
                    </LinkButton>
                  )}
                  <LinkButton
                    disabled={busy}
                    onClick={() => {
                      setRun(null);
                      setView('choose');
                    }}
                  >
                    Change choices
                  </LinkButton>
                </span>
              </span>
            </InlineNotice>
          )}
          {busy && run.signingIn && (
            <div className="cloud-resources-actions">
              <span className="cloud-resources-permission">Finish in your browser.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void cancelCloudflareSignIn().catch(() => {})}
              >
                Cancel
              </Button>
            </div>
          )}
        </section>
      )}

      {view === 'result' && manifest && (
        <section className="cloud-resources-pane" aria-labelledby="cloud-resources-result">
          <div className="cloud-resources-result-heading">
            <h2 id="cloud-resources-result">Ready in Cloudflare</h2>
            <div className="cloud-resources-actions">
              <CopyButton text={manifest.wrangler} label="Copy bindings" variant="outline" />
              <LinkButton external onClick={() => open(manifest.dashboard)}>
                Open Cloudflare dashboard
              </LinkButton>
            </div>
          </div>
          <ul className="cloud-resources-list">
            {manifest.resources.map((resource) => (
              <ResourceRow
                key={resource.kind}
                resource={resource}
                projectPath={project.path}
                onForget={() => act(() => forgetCloudResource(project.path, resource.kind))}
                onDelete={() =>
                  deleteCloudResource(project.path, resource.kind).then(async () => {
                    const next = await refresh();
                    if (!next?.manifest) setView('choose');
                  })
                }
              />
            ))}
          </ul>
          <pre className="cloud-resources-snippet">{manifest.wrangler}</pre>
          <div className="cloud-resources-footer">
            <p className="cloud-resources-permission">
              Agents get these details and .jackalope/cloudflare.json in every task automatically.
            </p>
            <div className="cloud-resources-actions">
              <Button
                variant="outline"
                onClick={() => {
                  update({});
                  setView('choose');
                }}
              >
                Add resources
              </Button>
            </div>
          </div>
        </section>
      )}
    </WorkspacePage>
  );
}

function ResourceRow({
  resource,
  projectPath,
  onForget,
  onDelete,
}: {
  resource: CloudResource;
  projectPath: string;
  onForget: () => void;
  onDelete: () => Promise<void>;
}) {
  const option = resourceOption(resource.kind);
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const value = resource.id ?? resource.name;
  return (
    <li className="cloud-resources-row">
      <span className="cloud-resources-row-text">
        <strong>{option.title}</strong>
        <code title={resource.name}>{resource.name}</code>
        {resource.id && resource.id !== resource.name && (
          <code className="cloud-resources-id" title={resource.id}>
            {resource.id}
          </code>
        )}
      </span>
      <span className="cloud-resources-actions">
        {resource.kind === 'turnstile' && (
          <CopyButton
            text={`${projectPath}:turnstile`}
            label="Copy secret key"
            copy={async () => navigator.clipboard.writeText(await turnstileSecret(projectPath))}
          />
        )}
        {isProvisioned(resource.kind) && (
          <CopyButton
            text={value}
            label={resource.id && resource.id !== resource.name ? 'Copy ID' : 'Copy name'}
          />
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton label={`${option.title} options`}>
              <MoreHorizontal size={16} aria-hidden="true" />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item onSelect={onForget}>Remove from Jackalope</DropdownMenu.Item>
              {isProvisioned(resource.kind) && (
                <DropdownMenu.Item
                  onSelect={() => {
                    setAcknowledged(false);
                    setConfirming(true);
                  }}
                >
                  Delete from Cloudflare…
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </span>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${resource.name} from Cloudflare?`}
        description={
          resource.kind === 'r2'
            ? 'Cloudflare deletes only empty buckets. This cannot be undone.'
            : 'Its data is deleted for every app that uses it. This cannot be undone.'
        }
        label="Delete"
        busyLabel="Deleting…"
        disabled={!acknowledged}
        onConfirm={onDelete}
      >
        <label className="cloud-resources-acknowledge">
          <Checkbox
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>I understand {resource.name} and its data will be deleted.</span>
        </label>
      </ConfirmDialog>
    </li>
  );
}
