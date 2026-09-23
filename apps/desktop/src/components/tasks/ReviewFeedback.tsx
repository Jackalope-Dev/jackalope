import { Button, FormField, Input, Select, SelectItem, Textarea } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { MessageSquarePlus } from 'lucide-react';
import { createContext, type ReactNode, useContext, useRef, useState } from 'react';
import { type ReviewAnchor, type ReviewComment, reviewFeedback } from '../../lib/review-feedback';
import { useReviewFeedbackStore } from '../../stores/reviewFeedbackStore';
import { DialogCloseButton, DialogContent, DialogFooter, DialogHeader } from '../ui/Dialog';
import { InlineNotice } from '../ui/InlineNotice';
import './review-feedback.css';

const FeedbackContext = createContext<{
  comments: ReviewComment[];
  revision: string;
  add?: (anchor: ReviewAnchor) => void;
  edit: (comment: ReviewComment) => void;
} | null>(null);
export const useReviewFeedback = () => useContext(FeedbackContext);
const empty: ReviewComment[] = [];

export function ReviewFeedback({
  taskId,
  revision,
  files,
  onFeedback,
  children,
}: {
  taskId: string;
  revision: string;
  files: string[];
  onFeedback?: (text: string) => void | Promise<void>;
  children: ReactNode;
}) {
  const comments = useReviewFeedbackStore((state) => state.threads[taskId] ?? empty);
  const { save, remove, error: storageError } = useReviewFeedbackStore();
  const [editing, setEditing] = useState<ReviewComment | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [notice, setNotice] = useState('');
  const returnFocus = useRef<HTMLElement | null>(null);
  const edit = (comment: ReviewComment) => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditing(comment);
  };
  const add = (anchor: ReviewAnchor) =>
    edit({ ...anchor, id: crypto.randomUUID(), revision, text: '', resolved: false });
  const pending = comments.filter((comment) => !comment.resolved);
  const displayed = showResolved ? comments : pending;
  return (
    <FeedbackContext.Provider
      value={{ comments, revision, add: onFeedback ? add : undefined, edit }}
    >
      <div className="review-feedback-toolbar">
        {onFeedback && (
          <Button
            variant="outline"
            disabled={!files.length}
            onClick={() => add({ file: files[0], line: 1, side: 'additions' })}
          >
            <MessageSquarePlus size={16} aria-hidden="true" /> Add comment
          </Button>
        )}
        {onFeedback && pending.length > 0 && (
          <Button
            variant="outline"
            loading={busy}
            loadingLabel="Adding…"
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError('');
              setNotice('');
              try {
                await onFeedback(reviewFeedback(comments, revision));
                setNotice('Comments added to your follow-up.');
              } catch (cause) {
                setError(String(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            Add {pending.length} {pending.length === 1 ? 'comment' : 'comments'} to follow-up
          </Button>
        )}
        {comments.some((comment) => comment.resolved) && (
          <Button
            variant="ghost"
            aria-pressed={showResolved}
            onClick={() => setShowResolved(!showResolved)}
          >
            {showResolved ? 'Hide resolved' : 'Show resolved'}
          </Button>
        )}
      </div>
      {(error || storageError) && <InlineNotice tone="error">{error || storageError}</InlineNotice>}
      {notice && (
        <p role="status" className="task-muted">
          {notice}
        </p>
      )}
      {children}
      {displayed.length > 0 && (
        <section className="review-comments" aria-label="Review comments">
          {displayed.map((comment) => (
            <article key={comment.id} className="review-comment">
              <div className="review-comment-heading">
                <strong>
                  {comment.file}:{comment.line}
                </strong>
                <span className="task-muted">
                  {comment.resolved
                    ? 'Resolved'
                    : comment.revision !== revision
                      ? 'Earlier patch'
                      : comment.side === 'deletions'
                        ? 'Original code'
                        : 'Updated code'}
                </span>
              </div>
              {comment.excerpt && <code>{comment.excerpt}</code>}
              <p className="whitespace-pre-wrap">{comment.text}</p>
              <div className="review-feedback-toolbar">
                <Button variant="ghost" onClick={() => edit(comment)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    try {
                      save(taskId, { ...comment, resolved: !comment.resolved });
                      setError('');
                    } catch (cause) {
                      setError(String(cause));
                    }
                  }}
                >
                  {comment.resolved ? 'Reopen' : 'Resolve'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    try {
                      remove(taskId, comment.id);
                      setError('');
                    } catch (cause) {
                      setError(String(cause));
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}
      <Dialog.Root
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
          aria-describedby={undefined}
        >
          <DialogCloseButton />
          <DialogHeader title="Review comment" />
          {editing && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!editing.text.trim() || !Number.isSafeInteger(editing.line) || editing.line < 1)
                  return;
                try {
                  save(taskId, { ...editing, text: editing.text.trim() });
                  setEditing(null);
                  setError('');
                } catch (cause) {
                  setError(`Could not save this comment: ${String(cause)}`);
                }
              }}
            >
              {error && <InlineNotice tone="error">{error}</InlineNotice>}
              <div className="review-comment-location">
                <FormField label="File">
                  <Select
                    value={editing.file}
                    onValueChange={(file) =>
                      setEditing({ ...editing, file, excerpt: undefined, revision })
                    }
                  >
                    {[...new Set([...files, editing.file])].map((file) => (
                      <SelectItem key={file} value={file}>
                        {file}
                      </SelectItem>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Line">
                  <Input
                    type="number"
                    min={1}
                    max={10000000}
                    required
                    value={editing.line || ''}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        line: Number(event.target.value),
                        excerpt: undefined,
                        revision,
                      })
                    }
                  />
                </FormField>
                <FormField label="Code">
                  <Select
                    value={editing.side}
                    onValueChange={(side) =>
                      setEditing({
                        ...editing,
                        side: side as ReviewAnchor['side'],
                        excerpt: undefined,
                        revision,
                      })
                    }
                  >
                    <SelectItem value="additions">Updated</SelectItem>
                    <SelectItem value="deletions">Original</SelectItem>
                  </Select>
                </FormField>
              </div>
              <FormField label="Comment">
                <Textarea
                  autoFocus
                  required
                  rows={4}
                  maxLength={2000}
                  value={editing.text}
                  onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                  placeholder="What should change?"
                />
              </FormField>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!editing.text.trim()}>
                  Save comment
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog.Root>
    </FeedbackContext.Provider>
  );
}
