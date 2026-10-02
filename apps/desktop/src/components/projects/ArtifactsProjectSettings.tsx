import { CopyButton, FormField, Input, Select, SelectItem } from '@jackalope/ui';
import { useCallback, useEffect, useState } from 'react';
import {
  type ArtifactsProjectLink,
  type ArtifactsReviewShare,
  type ArtifactsStatus,
  artifactsProject,
  artifactsStatus,
  convertToArtifacts,
  pushToArtifacts,
  shareArtifactsReview,
  suggestRepoName,
  validRepoName,
} from '../../lib/cloudflare-artifacts';
import { openSettings } from '../layout/navigation';
import { ArtifactsTitle } from '../settings/ArtifactsConnection';
import { Setting, SettingBody, SettingGroup } from '../settings/Setting';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

type Busy = '' | 'convert' | 'push' | 'share';

export function ArtifactsProjectSettings({
  projectPath,
  projectName,
}: {
  projectPath: string;
  projectName: string;
}) {
  const [status, setStatus] = useState<ArtifactsStatus>();
  const [link, setLink] = useState<ArtifactsProjectLink>();
  const [repoName, setRepoName] = useState(() => suggestRepoName(projectName));
  const [hours, setHours] = useState<1 | 24 | 168>(24);
  const [share, setShare] = useState<ArtifactsReviewShare>();
  const [busy, setBusy] = useState<Busy>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    const [nextStatus, nextLink] = await Promise.all([
      artifactsStatus(),
      artifactsProject(projectPath),
    ]);
    setStatus(nextStatus);
    setLink(nextLink);
  }, [projectPath]);
  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause)));
  }, [refresh]);
  const run = async (kind: Busy, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
      await refresh().catch(() => {});
    } finally {
      setBusy('');
    }
  };
  const linked = !!link?.remote;
  return (
    <SettingGroup title={<ArtifactsTitle />}>
      {status && !status.connected && (
        <Setting
          title="Connect Cloudflare"
          description="Connect your own Cloudflare account before moving projects to Artifacts."
        >
          <Button variant="outline" onClick={() => openSettings('Connected work')}>
            Connect account
          </Button>
        </Setting>
      )}
      {status?.connected && link && !link.repository && (
        <SettingBody>
          <InlineNotice>
            Artifacts needs this project to be a Git repository with at least one commit.
          </InlineNotice>
        </SettingBody>
      )}
      {status?.connected && link?.repository && !linked && (
        <form
          className="settings-block"
          onSubmit={(event) => {
            event.preventDefault();
            void run('convert', async () => {
              const result = await convertToArtifacts(projectPath, repoName, projectName);
              setNotice(`${result.summary} Repository ${result.repo} is ready.`);
              await refresh();
            });
          }}
        >
          <FormField
            label="Artifacts repository"
            description={`Created in the ${status.namespace} namespace. Pushes your branches and tags to a new remote named “artifacts”; existing remotes stay unchanged and Jackalope task branches stay local.`}
          >
            <Input
              value={repoName}
              spellCheck={false}
              maxLength={100}
              aria-invalid={!!repoName && !validRepoName(repoName)}
              disabled={!!busy}
              onChange={(event) => setRepoName(event.target.value)}
            />
          </FormField>
          <div>
            <Button
              type="submit"
              loading={busy === 'convert'}
              loadingLabel="Moving to Artifacts…"
              disabled={!!busy || !validRepoName(repoName)}
            >
              Move to Artifacts
            </Button>
          </div>
        </form>
      )}
      {linked && link && (
        <>
          <Setting title={`Repository ${link.repo}`} description={link.remote ?? undefined}>
            <CopyButton text={link.remote ?? ''} label="Copy remote" variant="outline" />
          </Setting>
          {link.foreign ? (
            <SettingBody>
              <InlineNotice tone="warning">
                This remote belongs to a different Cloudflare account or namespace than the one
                connected in Settings. Connect that account to push or share.
              </InlineNotice>
            </SettingBody>
          ) : (
            <>
              <Setting
                title="Push branches and tags"
                description="Sends local branches, tags and notes with a 15-minute token. Changes that are not fast-forwards are refused."
              >
                <Button
                  variant="outline"
                  loading={busy === 'push'}
                  loadingLabel="Pushing…"
                  disabled={!!busy || !status?.connected}
                  onClick={() =>
                    void run('push', async () => {
                      setNotice((await pushToArtifacts(projectPath)).summary);
                    })
                  }
                >
                  Push to Artifacts
                </Button>
              </Setting>
              <Setting
                title="Share a review snapshot"
                description="Creates a read-only copy of what was last pushed and a clone link that expires. Anyone with the link can read the snapshot."
              >
                <div className="flex flex-wrap gap-2">
                  <Select
                    aria-label="Link lifetime"
                    value={String(hours)}
                    disabled={!!busy}
                    onValueChange={(value) => setHours(Number(value) as 1 | 24 | 168)}
                  >
                    <SelectItem value="1">1 hour</SelectItem>
                    <SelectItem value="24">1 day</SelectItem>
                    <SelectItem value="168">7 days</SelectItem>
                  </Select>
                  <Button
                    variant="outline"
                    loading={busy === 'share'}
                    loadingLabel="Creating snapshot…"
                    disabled={!!busy || !status?.connected}
                    onClick={() =>
                      void run('share', async () => {
                        setShare(await shareArtifactsReview(projectPath, hours));
                      })
                    }
                  >
                    Create link
                  </Button>
                </div>
              </Setting>
            </>
          )}
        </>
      )}
      {(share || notice || error) && (
        <SettingBody>
          {share && (
            <InlineNotice
              tone="success"
              action={
                <>
                  <CopyButton text={share.cloneCommand} label="Copy clone command" />
                  <Button variant="ghost" onClick={() => setShare(undefined)}>
                    Close
                  </Button>
                </>
              }
            >
              Snapshot {share.repo} expires {new Date(share.expiresAt).toLocaleString()}. The clone
              command contains a read token and is shown only now.
            </InlineNotice>
          )}
          {notice && (
            <InlineNotice
              tone="success"
              action={
                <Button variant="ghost" onClick={() => setNotice('')}>
                  Close
                </Button>
              }
            >
              {notice}
            </InlineNotice>
          )}
          {error && (
            <InlineNotice tone="error">
              <span className="whitespace-pre-wrap">{error}</span>
            </InlineNotice>
          )}
        </SettingBody>
      )}
    </SettingGroup>
  );
}
