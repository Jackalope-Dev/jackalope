import { describeError } from '@jackalope/contracts/errors';
import { Button, InlineNotice, Select, SelectItem, SettingGroup, SettingRow } from '@jackalope/ui';
import { useId, useState } from 'react';
import { forgetProjectHosts, readProjectHost, useProjectHost } from '../../hooks/useProjectHost';
import { openSettings } from '../../lib/app-events';
import { invokeNative } from '../../lib/native/transport';
import { type HostKind, hostTerms, type ProjectHost } from '../../lib/source-control';
import { ActionError } from '../ui/ActionError';

function describe(host: ProjectHost) {
  const where = host.repository ? `${host.host}/${host.repository}` : host.host;
  if (!host.host) return 'No Git remote found. Pull requests need a remote to publish to.';
  if (!host.recognized)
    return `${where} is not a host Jackalope recognizes, so the GitHub CLI is used. Choose GitLab if it is a self-managed GitLab.`;
  return `${hostTerms(host.kind).host} · ${where}`;
}

/**
 * Which code host this project's remote is on. Detection covers github.com, gitlab.com,
 * bitbucket.org and the self-managed hosts named in Settings; a project can say its
 * remote is GitHub Enterprise or a self-managed GitLab instead.
 */
export function ProjectCodeHost({ projectPath }: { projectPath: string }) {
  const id = useId();
  const { data: host, error, setData } = useProjectHost(projectPath);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const choose = async (value: string) => {
    setBusy(true);
    setFailure('');
    try {
      await invokeNative('source_control_project_host', {
        projectPath,
        kind: value === 'detect' ? null : (value as HostKind),
      });
      forgetProjectHosts();
      setData(await readProjectHost(projectPath, true));
    } catch (cause) {
      setFailure(describeError(cause));
    } finally {
      setBusy(false);
    }
  };
  const access =
    host && host.kind !== 'github' && host.access.state !== 'ready' ? host.access : null;
  return (
    <SettingGroup title="Code host">
      <SettingRow
        title="Pull requests and merge requests"
        description={host ? describe(host) : error || 'Reading the remote…'}
        controlId={`${id}-host`}
      >
        <Select
          id={`${id}-host`}
          value={host?.chosen ?? 'detect'}
          disabled={!host || busy}
          onValueChange={(value) => void choose(value)}
        >
          <SelectItem value="detect">Detect from the remote</SelectItem>
          <SelectItem value="github">GitHub or GitHub Enterprise</SelectItem>
          <SelectItem value="gitlab">GitLab</SelectItem>
        </Select>
      </SettingRow>
      {access && (
        <InlineNotice
          tone="warning"
          action={
            host?.kind === 'bitbucket' ? (
              <Button variant="outline" onClick={() => openSettings('Connected work')}>
                Connection settings
              </Button>
            ) : undefined
          }
        >
          {access.message}
        </InlineNotice>
      )}
      <ActionError error={failure} />
    </SettingGroup>
  );
}
