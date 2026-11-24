import { describeError } from '@jackalope/contracts/errors';
import {
  Badge,
  Button,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  InlineNotice,
  LoadingState,
  SegmentedControl,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';
import { isTauriEnvironment } from '../../lib/native/env';
import {
  blockedReason,
  lineDiff,
  ROOT_LABELS,
  readSkill,
  type SkillCard,
  type SkillContent,
  STATUS_LABELS,
} from '../../lib/skill-sync';
import { ActionError } from '../ui/ActionError';

type View = 'here' | 'account' | 'compare';

const fileText = (list: SkillContent['files'] | null, path: string) =>
  list?.find((item) => item.path === path)?.content ?? '';

const TRACKING: Record<string, string> = {
  outside: 'Outside any repository',
  untracked: 'Not committed or ignored',
  ignored: 'Ignored by Git',
  tracked: 'Committed to the repository',
  mixed: 'Partly committed',
};

/** A skill's files, and for a conflict both copies side by side with a choice. */
export function SkillDetailDialog({
  card,
  onClose,
  onResolve,
  onKeepOut,
  onCloseAutoFocus,
}: {
  card: SkillCard | null;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  onResolve: (card: SkillCard, keep: 'local' | 'account') => Promise<void>;
  onKeepOut: (card: SkillCard) => Promise<void>;
}) {
  const [content, setContent] = useState<SkillContent | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('here');
  const [file, setFile] = useState('SKILL.md');
  const [busy, setBusy] = useState<'local' | 'account' | 'keep' | null>(null);
  const id = card?.id;
  const conflict = card?.status === 'conflict';
  useEffect(() => {
    setContent(null);
    setError('');
    setFile('SKILL.md');
    if (!id || !isTauriEnvironment()) return;
    let current = true;
    readSkill(id)
      .then((next) => {
        if (!current) return;
        setContent(next);
        setView(next.files.length ? (conflict ? 'compare' : 'here') : 'account');
      })
      .catch((cause) => current && setError(describeError(cause)));
    return () => {
      current = false;
    };
  }, [id, conflict]);
  const files = view === 'account' ? (content?.account ?? []) : (content?.files ?? []);
  const names = useMemo(() => {
    const all = new Set([
      ...(content?.files ?? []).map((item) => item.path),
      ...(content?.account ?? []).map((item) => item.path),
    ]);
    return [...all].sort((a, b) =>
      a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b),
    );
  }, [content]);
  const diff = useMemo(
    () =>
      view === 'compare' && content
        ? lineDiff(fileText(content.files, file), fileText(content.account, file))
        : [],
    [view, content, file],
  );
  const act = async (kind: 'local' | 'account' | 'keep') => {
    if (!card) return;
    setBusy(kind);
    setError('');
    try {
      if (kind === 'keep') await onKeepOut(card);
      else await onResolve(card, kind);
      if (kind !== 'keep') onClose();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  };
  const status = card ? STATUS_LABELS[card.status] : null;
  return (
    <Dialog.Root open={card !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent contained className="skill-detail" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogCloseButton label="Close skill" />
        <DialogHeader
          title={card?.name ?? 'Skill'}
          description={card?.description || 'No description.'}
        />
        {card && (
          <div className="skill-detail-body">
            <dl className="skill-detail-facts">
              <div>
                <dt>Status</dt>
                <dd>{status && <Badge variant={status.tone}>{status.label}</Badge>}</dd>
              </div>
              <div>
                <dt>Agent</dt>
                <dd>{ROOT_LABELS[card.root]}</dd>
              </div>
              <div>
                <dt>Belongs to</dt>
                <dd>
                  {card.scope === 'personal'
                    ? 'You, in every project'
                    : (card.project?.name ?? 'A project not on this computer')}
                </dd>
              </div>
              {card.tracking && (
                <div>
                  <dt>Git</dt>
                  <dd>{TRACKING[card.tracking]}</dd>
                </div>
              )}
              {card.path && (
                <div className="skill-detail-path">
                  <dt>Folder</dt>
                  <dd>
                    <code>{card.path}</code>
                  </dd>
                </div>
              )}
            </dl>
            {card.blocked && (
              <InlineNotice tone="warning">{blockedReason(card.blocked)}</InlineNotice>
            )}
            {card.scope === 'project' && card.tracking === 'untracked' && (
              <InlineNotice
                tone="warning"
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busy === 'keep'}
                    loadingLabel="Updating…"
                    onClick={() => void act('keep')}
                  >
                    Keep out of commits
                  </Button>
                }
              >
                A commit could include this skill. Keeping it out adds the folder to this
                repository’s local exclude file, which is never committed.
              </InlineNotice>
            )}
            {conflict && (
              <InlineNotice tone="warning">
                This skill changed here and on another computer since they last matched. Compare
                them, then keep one; the other copy is replaced everywhere.
              </InlineNotice>
            )}
            <ActionError error={error || card.error} />
            {!content && !error && isTauriEnvironment() && (
              <LoadingState compact label="Reading skill…" />
            )}
            {content && (
              <>
                <div className="skill-detail-toolbar">
                  {content.account && content.files.length > 0 && (
                    <SegmentedControl<View>
                      label="Copy"
                      value={view}
                      onChange={setView}
                      items={[
                        { id: 'here', label: 'This computer' },
                        { id: 'account', label: 'Account copy' },
                        { id: 'compare', label: 'Compare' },
                      ]}
                    />
                  )}
                  {names.length > 1 && (
                    <SegmentedControl<string>
                      label="File"
                      value={file}
                      onChange={setFile}
                      items={names.slice(0, 8).map((name) => ({ id: name, label: name }))}
                    />
                  )}
                </div>
                {view === 'compare' ? (
                  <ol
                    className="skill-diff"
                    aria-label={`Changes in ${file} from this computer to the account copy`}
                  >
                    {diff.map((line, index) => (
                      <li
                        // biome-ignore lint/suspicious/noArrayIndexKey: lines repeat; their order is their identity
                        key={index}
                        data-kind={line.kind}
                      >
                        <span className="skill-diff-mark" aria-hidden="true">
                          {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                        </span>
                        <span className="ui-sr-only">
                          {line.kind === 'added'
                            ? 'Account copy only: '
                            : line.kind === 'removed'
                              ? 'This computer only: '
                              : ''}
                        </span>
                        {line.text || ' '}
                      </li>
                    ))}
                  </ol>
                ) : (
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll long skill files.
                  <section className="skill-source" tabIndex={0} aria-label={`${file} contents`}>
                    <pre>
                      {files.find((item) => item.path === file)?.content ??
                        'This copy has no such file.'}
                    </pre>
                  </section>
                )}
              </>
            )}
          </div>
        )}
        {conflict && card && (
          <DialogFooter>
            <Button
              variant="outline"
              loading={busy === 'account'}
              loadingLabel="Applying…"
              disabled={busy !== null}
              onClick={() => void act('account')}
            >
              Use the account copy
            </Button>
            <Button
              loading={busy === 'local'}
              loadingLabel="Uploading…"
              disabled={busy !== null}
              onClick={() => void act('local')}
            >
              Keep this computer’s copy
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog.Root>
  );
}
