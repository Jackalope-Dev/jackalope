import { Checkbox, Disclosure, DisclosureSummary, Input, SearchField } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useState } from 'react';
import { type LiveSession, type SessionTopic, sessionCommand } from '../../lib/live-session';
import { suggestTopics, topicDraft } from '../../lib/session-topics';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useProjectStore } from '../../stores/projectStore';
import { CaptureTask } from '../tasks/CaptureTask';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogFooter, DialogHeader } from '../ui/Dialog';
import { InlineNotice } from '../ui/InlineNotice';

export function SessionTopics({ session }: { session: LiveSession }) {
  const [editing, setEditing] = useState<{ topics: SessionTopic[]; revision: number } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draftKey, setDraftKey] = useState<string>();
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<string>();
  const [activeId, setActiveId] = useState<string>();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(100);
  const topics = editing?.topics ?? session.topics ?? [];
  const active = topics.find((topic) => topic.id === activeId) ?? topics[0];
  const messages = useMemo(
    () => (open ? session.messages.filter((message) => !message.canceled) : []),
    [open, session.messages],
  );
  const matches = useMemo(
    () =>
      messages.filter((message) =>
        message.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
    [messages, query],
  );
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const sourceIds = useMemo(() => new Set(active?.messageIds), [active]);
  const sourceMessages = useMemo(
    () => (open ? session.messages.filter((message) => sourceIds.has(message.id)) : []),
    [open, session.messages, sourceIds],
  );
  const update = (topics: SessionTopic[]) =>
    setEditing({ topics, revision: editing?.revision ?? session.topicsRevision ?? 0 });
  const resetPicker = () => {
    setChoosing(false);
    setSelected([]);
    setTitle('');
    setEditingTopicId(undefined);
    setQuery('');
    setLimit(100);
  };
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      await sessionCommand('topics', {
        id: session.id,
        revision: editing.revision,
        topics: editing.topics,
      });
      await useLiveSessionStore.getState().refresh(session.id);
      setEditing(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const prepare = (topic: SessionTopic) => {
    try {
      const key = `topic:${session.id}:${topic.id}`;
      const store = useExecutionStore.getState();
      if (!store.drafts[key]?.prompt)
        store.draft(key, {
          prompt: topicDraft(session, topic),
          title: topic.title,
          projectId: session.request.projectId,
          agent: session.request.agent,
          isolated: true,
        });
      useProjectStore.getState().selectProject(session.request.projectId);
      setOpen(false);
      setDraftKey(key);
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <Button variant="ghost" aria-label="Topics">
            Topics{topics.length ? ` · ${topics.length}` : ''}
            {editing ? ' · Unsaved' : ''}
          </Button>
        </Dialog.Trigger>
        <DialogContent className="work-topics-dialog">
          <DialogCloseButton />
          <DialogHeader
            title="Topics"
            description="Group messages into separate task drafts. The original conversation stays intact."
          />
          <div className="work-topics-actions">
            <Button
              variant="outline"
              disabled={busy || choosing || !messages.length || topics.length >= 100}
              onClick={() => {
                const used = new Set(topics.flatMap((topic) => topic.messageIds));
                const suggestions = suggestTopics(
                  messages.filter((message) => !used.has(message.id)),
                  () => crypto.randomUUID(),
                );
                update([...topics, ...suggestions].slice(0, 100));
              }}
            >
              Suggest topics
            </Button>
            <Button
              variant="outline"
              disabled={busy || choosing || topics.length >= 100}
              onClick={() => {
                resetPicker();
                setChoosing(true);
              }}
            >
              New topic
            </Button>
            <p className="task-muted">Suggestions use message headings and opening lines.</p>
          </div>
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
          <div className="work-topics-layout">
            <nav className="work-topic-list" aria-label="Saved and suggested topics">
              {topics.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  disabled={busy || choosing}
                  aria-pressed={active?.id === topic.id && !choosing}
                  onClick={() => {
                    setActiveId(topic.id);
                    resetPicker();
                  }}
                >
                  <strong>{topic.title || 'Untitled topic'}</strong>
                  <span>
                    {topic.messageIds.length}{' '}
                    {topic.messageIds.length === 1 ? 'message' : 'messages'}
                  </span>
                </button>
              ))}
              {!topics.length && (
                <p className="task-muted">
                  No topics yet. Suggest topics or select messages for a new one.
                </p>
              )}
            </nav>
            <div className="work-topic-editor">
              {choosing ? (
                <>
                  <label>
                    Topic name
                    <Input
                      aria-label="New topic title"
                      placeholder="Topic name"
                      maxLength={80}
                      value={title}
                      disabled={busy}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                  <SearchField
                    aria-label="Find topic messages"
                    placeholder="Find a message…"
                    value={query}
                    onValueChange={(value) => {
                      setQuery(value);
                      setLimit(100);
                    }}
                  />
                  <p className="task-muted">
                    {selected.length} selected · Choose up to 500 messages.
                  </p>
                  <div className="topic-message-picker">
                    {matches.slice(0, limit).map((message) => (
                      <label key={message.id}>
                        <Checkbox
                          checked={selectedIds.has(message.id)}
                          disabled={
                            busy || (selected.length >= 500 && !selectedIds.has(message.id))
                          }
                          onChange={(event) =>
                            setSelected((ids) =>
                              event.target.checked
                                ? [...ids, message.id]
                                : ids.filter((id) => id !== message.id),
                            )
                          }
                        />
                        <span>{message.text}</span>
                      </label>
                    ))}
                    {!matches.length && <p className="task-muted">No matching messages.</p>}
                    {matches.length > limit && (
                      <Button variant="ghost" onClick={() => setLimit((value) => value + 100)}>
                        Show more messages
                      </Button>
                    )}
                  </div>
                  <div className="work-topics-actions">
                    <Button
                      disabled={busy || !title.trim() || !selected.length}
                      onClick={() => {
                        const topic = {
                          id: editingTopicId ?? crypto.randomUUID(),
                          title: title.trim(),
                          messageIds: selected,
                        };
                        update(
                          editingTopicId
                            ? topics.map((item) => (item.id === editingTopicId ? topic : item))
                            : [...topics, topic],
                        );
                        setActiveId(topic.id);
                        resetPicker();
                      }}
                    >
                      {editingTopicId ? 'Update topic' : 'Add topic'}
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={resetPicker}>
                      Cancel message selection
                    </Button>
                  </div>
                </>
              ) : active ? (
                <>
                  <label>
                    Topic name
                    <Input
                      aria-label="Topic title"
                      maxLength={80}
                      value={active.title}
                      disabled={busy}
                      onChange={(event) =>
                        update(
                          topics.map((item) =>
                            item.id === active.id ? { ...item, title: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <div className="work-topics-actions">
                    <Button disabled={busy || !!editing} onClick={() => prepare(active)}>
                      Prepare task draft
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        resetPicker();
                        setSelected(
                          messages
                            .filter((message) => sourceIds.has(message.id))
                            .map((message) => message.id),
                        );
                        setTitle(active.title);
                        setEditingTopicId(active.id);
                        setChoosing(true);
                      }}
                    >
                      Change messages
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => update(topics.filter((item) => item.id !== active.id))}
                    >
                      Ungroup
                    </Button>
                  </div>
                  <Disclosure key={active.id}>
                    <DisclosureSummary>
                      Source messages · {active.messageIds.length}
                    </DisclosureSummary>
                    <div className="work-topic-sources">
                      {sourceMessages.map((message) => (
                        <p key={message.id} className="topic-source">
                          {message.text}
                          {message.canceled && <small> · Canceled</small>}
                        </p>
                      ))}
                    </div>
                  </Disclosure>
                </>
              ) : (
                <p className="task-muted">
                  Choose a topic to review its messages and prepare a draft.
                </p>
              )}
            </div>
          </div>
          {editing && (
            <DialogFooter>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setError('');
                  resetPicker();
                }}
              >
                Discard grouping changes
              </Button>
              <Button
                disabled={busy || choosing || topics.some((topic) => !topic.title.trim())}
                onClick={() => void save()}
              >
                Save grouping
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog.Root>
      {draftKey && (
        <CaptureTask
          draftKey={draftKey}
          onClose={() => {
            setDraftKey(undefined);
            setOpen(true);
          }}
          onStarted={() => setDraftKey(undefined)}
        />
      )}
    </>
  );
}
