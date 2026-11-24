import { describeError } from '@jackalope/contracts/errors';
import {
  Badge,
  Button,
  Checkbox,
  CopyButton,
  DefinitionList,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  InlineNotice,
  Input,
  LoadingState,
  useDialogFocus,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import {
  cancelTestflightUpload,
  setTestflightBuild,
  startTestflightUpload,
  testflightInfo,
  testflightStatus,
} from '../../lib/app-store-connect';
import type { TaskRun } from '../../lib/run-types';
import {
  BUILD_PATTERN,
  isUploading,
  needsNewBuild,
  PHASE_LABELS,
  type TestflightInfo,
  type UploadPhase,
  type UploadState,
  uploadLabel,
} from '../../lib/testflight';
import { ActionError } from '../ui/ActionError';
import './testflight-upload.css';

const POLL_MS = 1500;

const PHASE_TONES: Record<UploadPhase, 'default' | 'success' | 'warning' | 'danger'> = {
  archiving: 'default',
  exporting: 'default',
  processing: 'default',
  done: 'success',
  failed: 'danger',
  canceled: 'warning',
};

/** A task's TestFlight upload, read again every moment while it runs. */
export function useTestflightUpload(runId: string) {
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [error, setError] = useState('');
  const active = isUploading(upload);
  useEffect(() => {
    if (!active) return;
    let current = true;
    const timer = window.setInterval(() => {
      void testflightStatus(runId)
        .then((next) => {
          if (!current) return;
          setError('');
          setUpload(next);
        })
        .catch((cause) => current && setError(describeError(cause)));
    }, POLL_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [runId, active]);
  return { upload, setUpload, error };
}

export function uploadSummary(upload: UploadState) {
  return `${PHASE_LABELS[upload.phase]} · ${upload.appName} ${upload.version} (${upload.build})`;
}

/**
 * Archives the task's app, signs it with the project's App Store Connect key and uploads it,
 * only after the person confirms the exact app, version and build. Closing the dialog leaves
 * a running upload going.
 */
export function TestflightUpload({
  run,
  open,
  onOpenChange,
  upload,
  onUpload,
  pollError,
}: {
  run: TaskRun;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  upload: UploadState | null;
  onUpload: (upload: UploadState | null) => void;
  pollError?: string;
}) {
  const focus = useDialogFocus();
  const [info, setInfo] = useState<TestflightInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [build, setBuild] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<'' | 'build' | 'upload' | 'cancel'>('');
  const [error, setError] = useState('');
  const showingUpload = !!upload;

  const read = async () => {
    setLoading(true);
    setError('');
    setInfo(null);
    try {
      apply(await testflightInfo(run.id));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  };

  const apply = (next: TestflightInfo) => {
    setInfo(next);
    setBuild(needsNewBuild(next) ? next.suggestedBuild : next.build);
    setConfirmed(false);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: read once per opening, not per render.
  useEffect(() => {
    if (open && !showingUpload) void read();
  }, [open, showingUpload, run.id]);

  const setBuildNumber = async () => {
    setBusy('build');
    setError('');
    try {
      apply(await setTestflightBuild(run.id, build.trim()));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy('');
    }
  };

  const start = async () => {
    if (!info) return;
    setBusy('upload');
    setError('');
    try {
      onUpload(
        await startTestflightUpload(run.id, {
          bundleId: info.bundleId,
          version: info.version,
          build: info.build,
        }),
      );
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy('');
    }
  };

  const cancel = async () => {
    setBusy('cancel');
    setError('');
    try {
      onUpload(await cancelTestflightUpload(run.id));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy('');
    }
  };

  const buildValid = BUILD_PATTERN.test(build.trim());
  const changedBuild = !!info && build.trim() !== info.build;
  const canUpload = !!info && !info.blocked && confirmed && !changedBuild && !busy;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent {...focus} className="testflight-dialog">
        <DialogCloseButton label="Close TestFlight upload" />
        <DialogHeader
          title="Upload to TestFlight"
          description="Archives a Release build in this task's workspace, signs it with the project's App Store Connect key and uploads it to Apple."
        />
        {upload ? (
          <UploadProgress upload={upload} />
        ) : loading ? (
          <LoadingState compact label="Reading the Xcode project…" />
        ) : info ? (
          <div className="testflight-body">
            <DefinitionList
              items={[
                { label: 'App', value: info.appName },
                { label: 'Bundle ID', value: <code>{info.bundleId}</code> },
                { label: 'Version', value: info.version },
                { label: 'Build', value: info.build },
                { label: 'Scheme', value: info.scheme },
                { label: 'Project', value: <code>{info.container}</code> },
                {
                  label: 'App Store Connect',
                  value: info.latestUploaded
                    ? `Latest build ${info.latestUploaded}`
                    : (info.remoteNote ?? 'No builds uploaded yet'),
                },
              ]}
            />
            {info.blocked && <InlineNotice tone="warning">{info.blocked}</InlineNotice>}
            {needsNewBuild(info) && (
              <InlineNotice tone="warning">
                App Store Connect already has build {info.latestUploaded}. Set a higher build number
                before uploading.
              </InlineNotice>
            )}
            <div className="testflight-build">
              <FormField
                label="Build number"
                description="Changes the project in this task's workspace; it appears in review and is not committed."
                error={
                  build.trim() && !buildValid
                    ? 'Use up to three numbers separated by dots.'
                    : undefined
                }
              >
                <Input
                  id="testflight-build"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={32}
                  value={build}
                  disabled={!!busy}
                  onChange={(event) => setBuild(event.target.value)}
                />
              </FormField>
              <Button
                variant="outline"
                loading={busy === 'build'}
                loadingLabel="Setting…"
                disabled={!!busy || !buildValid || !changedBuild}
                onClick={() => void setBuildNumber()}
              >
                Set build number
              </Button>
            </div>
            {!info.blocked && (
              <label className="testflight-confirm">
                <Checkbox
                  checked={confirmed}
                  disabled={!!busy || changedBuild}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  {uploadLabel(info)}. Testers in your TestFlight groups can install it once Apple
                  finishes processing.
                </span>
              </label>
            )}
          </div>
        ) : null}
        <ActionError error={error || pollError || ''} />
        <DialogFooter>
          {upload ? (
            isUploading(upload) ? (
              <Button
                variant="outline"
                loading={busy === 'cancel'}
                loadingLabel="Stopping…"
                disabled={!!busy}
                onClick={() => void cancel()}
              >
                {upload.phase === 'processing' ? 'Stop checking' : 'Cancel upload'}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => onUpload(null)}>
                Upload another build
              </Button>
            )
          ) : (
            <>
              {!info && !loading && (
                <Button variant="outline" onClick={() => void read()}>
                  Read the project again
                </Button>
              )}
              <Dialog.Close asChild>
                <Button variant="outline" disabled={busy === 'upload'}>
                  Cancel
                </Button>
              </Dialog.Close>
              {info && !info.blocked && (
                <Button
                  loading={busy === 'upload'}
                  loadingLabel="Starting…"
                  disabled={!canUpload}
                  onClick={() => void start()}
                >
                  {uploadLabel(info)}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}

function UploadProgress({ upload }: { upload: UploadState }) {
  const log = useRef<HTMLElement>(null);
  const lines = upload.log.join('\n');
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the newest output.
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);
  return (
    <div className="testflight-body">
      <p className="testflight-status" role="status">
        <Badge variant={PHASE_TONES[upload.phase]}>{PHASE_LABELS[upload.phase]}</Badge>
        <span>
          {upload.appName} {upload.version} ({upload.build})
        </span>
      </p>
      {upload.processing && <p className="testflight-muted">{upload.processing}</p>}
      {upload.error && <InlineNotice tone="error">{upload.error}</InlineNotice>}
      {lines && (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Long output needs keyboard scrolling.
        <section ref={log} className="testflight-log" tabIndex={0} aria-label="Upload output">
          <pre>{lines}</pre>
        </section>
      )}
      <p className="testflight-muted testflight-log-path">
        Full log: <code>{upload.logPath}</code>
        <CopyButton text={upload.logPath} label="Copy path" />
      </p>
    </div>
  );
}
