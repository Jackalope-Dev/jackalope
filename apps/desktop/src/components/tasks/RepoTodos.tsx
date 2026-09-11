import * as Dialog from '@radix-ui/react-dialog';
import {
  Check,
  Circle,
  FileText,
  ListTodo,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  appendRepoTodo,
  parseRepoTodos,
  type RepoTodoDocument,
  type RepoTodoItem,
  TODO_FILES,
  updateRepoTodo,
} from '../../lib/repo-todos';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useContextMemoryStore } from '../../stores/contextMemoryStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { todoDraftKey, useRepoTodoStore } from '../../stores/repoTodoStore';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { Input } from '../ui/input';
import { LoadingState } from '../ui/LoadingState';
import { Select, SelectItem } from '../ui/Select';
import { Tooltip } from '../ui/Tooltip';
import { useDialogFocus } from '../ui/useDialogFocus';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { FilterGroup, WorkspaceToolbar } from '../ui/WorkspaceToolbar';
import './repo-todos.css';

export function RepoTodos({
  onOpenProject,
  onCapture,
}: {
  onOpenProject: () => void;
  onCapture: (draftKey: string) => void;
}) {
  const { projects, activeProjectId } = useProjectStore();
  const project = projects.find((item) => item.id === activeProjectId);
  const [documents, setDocuments] = useState<RepoTodoDocument[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('open');
  const [source, setSource] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [editing, setEditing] = useState<RepoTodoItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCompleted, setEditCompleted] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createPath, setCreatePath] = useState('TODO.md');
  const request = useRef(0);
  const addInput = useRef<HTMLInputElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);
  const dialogFocus = useDialogFocus();
  const { drafts, setDraft, saving: savingFiles, setSaving, revision } = useRepoTodoStore();
  const key = todoDraftKey(project?.path ?? '', selected);
  const saving = savingFiles[key] ?? false;
  const draft = drafts[key];
  const document = documents.find((item) => item.path === selected);
  const content = draft?.content ?? document?.content ?? '';
  const items = parseRepoTodos(content);
  const open = items.filter((item) => !item.completed).length;
  const dirty = !!draft;
  const available = isTauriEnvironment();

  const projectPath = project?.path;
  const savedRevision = useRef(revision);
  const load = useCallback(async () => {
    if (!projectPath || !available) {
      setLoading(false);
      return;
    }
    const version = ++request.current;
    setLoading(true);
    setError('');
    try {
      const files = await nativeTask<RepoTodoDocument[]>('repo_todos_read', {
        projectPath,
      });
      if (version !== request.current) return;
      setDocuments(files);
      setSelected(
        (current) =>
          current ||
          TODO_FILES.find(
            (path) => useRepoTodoStore.getState().drafts[todoDraftKey(projectPath, path)],
          ) ||
          files.find((file) => file.content !== null)?.path ||
          '',
      );
    } catch (cause) {
      if (version === request.current) setError(String(cause));
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [projectPath, available]);
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  useEffect(() => {
    if (savedRevision.current !== revision) {
      savedRevision.current = revision;
      void load();
    }
  }, [revision, load]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (Object.keys(useRepoTodoStore.getState().drafts).length) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const update = (next: string) => {
    const base = draft ? draft.base : (document?.content ?? null);
    setDraft(key, next === base ? null : { base, content: next });
    setNotice('');
  };
  const save = async () => {
    if (!project || !draft || useRepoTodoStore.getState().saving[key]) return;
    setSaving(key, true);
    setError('');
    try {
      await nativeTask('repo_todos_save', {
        projectPath: project.path,
        relativePath: selected,
        expectedContent: draft.base,
        content: draft.content,
      });
      setDocuments((current) =>
        current.map((file) =>
          file.path === selected ? { ...file, content: draft.content, error: null } : file,
        ),
      );
      setDraft(key, null);
      setSaving(key, false, true);
      setNotice(`Saved to ${selected}.`);
      setSource(false);
      useContextMemoryStore.getState().removeMemory(project.id);
      void useContextMemoryStore
        .getState()
        .refreshMemory(project, { silent: true })
        .catch(() => {});
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(key, false);
    }
  };
  const files = TODO_FILES.filter(
    (path) =>
      documents.some((file) => file.path === path && (file.content !== null || file.error)) ||
      drafts[todoDraftKey(project?.path ?? '', path)],
  );
  const creatable = TODO_FILES.filter((path) => !files.includes(path));
  const visible = items.filter(
    (item) =>
      (filter === 'all' || (filter === 'done') === item.completed) &&
      `${item.title} ${item.section}`.toLowerCase().includes(query.toLowerCase()),
  );
  const groups = [...new Set(visible.map((item) => item.sectionLine))];

  return (
    <WorkspacePage className="repo-todos">
      <WorkspaceHeading
        title="Repo TODOs"
        action={
          project && available && !loading && !error && creatable.length > 0 ? (
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setCreatePath(creatable[0]);
                setCreating(true);
              }}
            >
              <Plus size={16} />
              Create a list
            </Button>
          ) : undefined
        }
      />
      {!project ? (
        <EmptyState
          icon={ListTodo}
          title="Start with a project"
          description="Open a repository to see its TODOs and roadmap, or create its first list."
          action={<Button onClick={onOpenProject}>Open a project</Button>}
        />
      ) : !available ? (
        <EmptyState
          icon={FileText}
          title="Your repository, in the desktop app"
          description="Open Jackalope on your computer to read and edit repository task lists."
        />
      ) : (
        <>
          {error && (
            <div className="repo-todo-error" role="alert">
              <p>{error}</p>
              <Button variant="ghost" disabled={loading || saving} onClick={() => void load()}>
                Retry reading files
              </Button>
            </div>
          )}
          {loading ? (
            <LoadingState label="Reading repository lists…" />
          ) : (
            <div className="repo-todo-layout">
              <aside className="repo-todo-files" aria-label="Repository task files">
                <p className="repo-todo-label">IN THIS REPOSITORY</p>
                {files.map((path) => {
                  const file = documents.find((item) => item.path === path);
                  const pending = drafts[todoDraftKey(project.path, path)];
                  const remaining = parseRepoTodos(pending?.content ?? file?.content ?? '').filter(
                    (item) => !item.completed,
                  ).length;
                  return (
                    <button
                      type="button"
                      className="repo-todo-file"
                      key={path}
                      aria-current={selected === path ? 'page' : undefined}
                      disabled={saving}
                      onClick={() => {
                        setSelected(path);
                        setSource(false);
                        setQuery('');
                        setNewTitle('');
                        setNotice('');
                      }}
                    >
                      <FileText size={17} aria-hidden="true" />
                      <span>
                        <strong>{path}</strong>
                        <small>
                          {file?.error
                            ? 'Could not read'
                            : pending
                              ? 'Unsaved changes'
                              : `${remaining} open`}
                        </small>
                      </span>
                    </button>
                  );
                })}
                <Button variant="ghost" disabled={saving} onClick={() => void load()}>
                  <RefreshCw size={15} />
                  Refresh files
                </Button>
                <p className="repo-todo-hint">
                  TODO, TASKS and ROADMAP files in the project root or docs folder.
                </p>
              </aside>
              <div className="repo-todo-main">
                {!selected || (!document?.content && !draft && document?.content !== '') ? (
                  document?.error ? (
                    <EmptyState
                      icon={FileText}
                      title="This file needs attention"
                      description={document.error}
                    />
                  ) : (
                    <EmptyState
                      icon={ListTodo}
                      title="Make room for what’s next"
                      description="Capture a first idea, a small fix, or a longer-term plan. Your list lives alongside your code."
                      action={
                        !error && (
                          <Button
                            onClick={() => {
                              setCreatePath(creatable[0] ?? 'TODO.md');
                              setCreating(true);
                            }}
                          >
                            <Plus size={16} />
                            Create a TODO list
                          </Button>
                        )
                      }
                    />
                  )
                ) : (
                  <>
                    <header className="repo-todo-document-heading">
                      <div>
                        <h2>{selected}</h2>
                        <p>
                          {open} open<span aria-hidden="true"> · </span>
                          {items.length - open} completed
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {!source && (
                          <Button variant="ghost" disabled={saving} onClick={() => setSource(true)}>
                            <Pencil size={16} />
                            Edit document
                          </Button>
                        )}
                        {(source || dirty) && (
                          <Button
                            variant="ghost"
                            disabled={saving}
                            onClick={() => (dirty ? setDiscarding(true) : setSource(false))}
                          >
                            <X size={16} />
                            {dirty ? 'Discard changes' : 'Cancel'}
                          </Button>
                        )}
                      </div>
                    </header>
                    {source ? (
                      <div className="repo-todo-source">
                        <label htmlFor="todo-source">Full document</label>
                        <p className="task-muted">
                          Edit headings, notes and checklist items together. Use - [ ] for an open
                          TODO.
                        </p>
                        <textarea
                          id="todo-source"
                          spellCheck={false}
                          disabled={saving}
                          value={content}
                          onChange={(event) => update(event.target.value)}
                        />
                      </div>
                    ) : (
                      <>
                        <WorkspaceToolbar className="repo-todo-toolbar">
                          <FilterGroup
                            label="Filter TODOs"
                            value={filter}
                            onChange={setFilter}
                            activeRef={filterButton}
                            items={[
                              { id: 'open', label: 'Open' },
                              { id: 'done', label: 'Completed' },
                              { id: 'all', label: 'All' },
                            ]}
                          />
                          <div className="repo-todo-search">
                            <Search size={16} aria-hidden="true" />
                            <Input
                              aria-label="Search TODOs"
                              placeholder="Find a TODO…"
                              value={query}
                              onChange={(event) => setQuery(event.target.value)}
                            />
                          </div>
                        </WorkspaceToolbar>
                        {groups.map((sectionLine) => {
                          const group = visible.filter((item) => item.sectionLine === sectionLine);
                          return (
                            <section className="repo-todo-group" key={sectionLine}>
                              <h3>
                                {group[0].section}
                                <span>{group.length}</span>
                              </h3>
                              <ul>
                                {group.map((item) => (
                                  <li
                                    key={item.line}
                                    className={item.completed ? 'is-completed' : undefined}
                                  >
                                    <span className="repo-todo-status">
                                      {item.completed ? (
                                        <Check size={18} aria-hidden="true" />
                                      ) : (
                                        <Circle size={17} aria-hidden="true" />
                                      )}
                                      <span className="sr-only">
                                        {item.completed ? 'Completed' : 'Open'}
                                      </span>
                                    </span>
                                    <div className="repo-todo-title">
                                      {item.depth > 0 && (
                                        <span className="repo-todo-nested" aria-hidden="true">
                                          ↳{' '}
                                        </span>
                                      )}
                                      <span>
                                        <ReactMarkdown
                                          allowedElements={['strong', 'em', 'code', 'del']}
                                          unwrapDisallowed
                                        >
                                          {item.title}
                                        </ReactMarkdown>
                                      </span>
                                    </div>
                                    <div className="repo-todo-actions">
                                      <Button
                                        variant="primary"
                                        disabled={saving}
                                        onClick={() => {
                                          const draftKey = `repo-todo:${JSON.stringify([project.id, selected, item.line, item.title])}`;
                                          const store = useExecutionStore.getState();
                                          if (!store.drafts[draftKey])
                                            store.draft(draftKey, {
                                              projectId: project.id,
                                              title: item.title,
                                              prompt: `${item.title}\n\nRepository TODO: ${selected}, line ${item.line + 1} (${item.section}).\nRead the current repository document for context before working on this item.`,
                                              isolated:
                                                project.preferences?.isolatedByDefault ?? true,
                                            });
                                          onCapture(draftKey);
                                        }}
                                      >
                                        <Play size={14} aria-hidden="true" />
                                        Start task
                                      </Button>
                                      <Tooltip content="Edit TODO">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          aria-label={`Edit ${item.title}`}
                                          disabled={saving}
                                          onClick={() => {
                                            setEditing(item);
                                            setEditTitle(item.title);
                                            setEditCompleted(item.completed);
                                          }}
                                        >
                                          <Pencil size={15} aria-hidden="true" />
                                        </Button>
                                      </Tooltip>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </section>
                          );
                        })}
                        {!visible.length && (
                          <div className="repo-todo-empty">
                            <h3>
                              {query
                                ? 'No matching TODOs'
                                : items.length === 0
                                  ? 'Your next step starts here'
                                  : filter === 'open'
                                    ? 'Everything on this list is checked off'
                                    : 'No TODOs in this view'}
                            </h3>
                            <p>
                              {query
                                ? 'Try another phrase or a different filter.'
                                : items.length === 0
                                  ? 'Add a TODO below, or edit the document to organize your plan.'
                                  : 'Add another idea or switch views to see the rest of your list.'}
                            </p>
                          </div>
                        )}
                        <form
                          className="repo-todo-add"
                          onSubmit={(event) => {
                            event.preventDefault();
                            try {
                              update(appendRepoTodo(content, newTitle));
                              setNewTitle('');
                              setFilter('open');
                              setQuery('');
                              addInput.current?.focus();
                            } catch (cause) {
                              setError(String(cause));
                            }
                          }}
                        >
                          <Input
                            ref={addInput}
                            aria-label="New TODO"
                            placeholder="What else needs doing?"
                            value={newTitle}
                            onChange={(event) => setNewTitle(event.target.value)}
                            disabled={saving}
                          />
                          <Button
                            variant="secondary"
                            type="submit"
                            disabled={saving || !newTitle.trim()}
                          >
                            <Plus size={16} />
                            Add TODO
                          </Button>
                        </form>
                        {items.length === 0 && content.trim() && (
                          <details className="repo-todo-notes">
                            <summary>Read existing document</summary>
                            <div className="repo-todo-markdown">
                              <ReactMarkdown>{content}</ReactMarkdown>
                            </div>
                          </details>
                        )}
                      </>
                    )}
                    <footer className="repo-todo-save" data-dirty={dirty}>
                      <div>
                        <strong>
                          {saving
                            ? 'Saving…'
                            : dirty
                              ? 'Unsaved changes'
                              : 'Saved in your repository'}
                        </strong>
                        <p>
                          {dirty
                            ? 'Draft kept while you navigate. Save before closing the app.'
                            : 'Changes are saved to this file for you to review in Git.'}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          disabled={!dirty || saving}
                          onClick={() => setDiscarding(true)}
                        >
                          Discard
                        </Button>
                        <Button disabled={!dirty || saving} onClick={() => void save()}>
                          Save changes
                        </Button>
                      </div>
                    </footer>
                    <p role="status" className="repo-todo-notice">
                      {notice}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
      <Dialog.Root
        open={!!editing || discarding || creating}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setDiscarding(false);
            setCreating(false);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="task-dialog-overlay" />
          <Dialog.Content {...dialogFocus} className="task-dialog repo-todo-dialog">
            <div className="flex justify-between gap-4">
              <Dialog.Title>
                {editing
                  ? 'Edit TODO'
                  : discarding
                    ? 'Discard this draft?'
                    : 'Start a repository list'}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close dialog">
                  <X size={18} />
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description>
              {editing
                ? 'Keep the next step clear and specific. Other document content is preserved.'
                : discarding
                  ? 'Your unsaved changes to this file will be removed. The latest saved file will be reloaded.'
                  : 'Choose where the list belongs. It will be created when you save your changes.'}
            </Dialog.Description>
            {editing ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  update(
                    updateRepoTodo(content, editing.line, {
                      title: editTitle.trim(),
                      completed: editCompleted,
                    }),
                  );
                  setEditing(null);
                }}
              >
                <label htmlFor="todo-title">TODO</label>
                <Input
                  id="todo-title"
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                />
                <label className="repo-todo-completion">
                  <input
                    type="checkbox"
                    checked={editCompleted}
                    onChange={(event) => setEditCompleted(event.target.checked)}
                  />
                  Mark as completed
                </label>
                <div className="repo-todo-dialog-actions">
                  <Dialog.Close asChild>
                    <Button variant="ghost">Cancel</Button>
                  </Dialog.Close>
                  <Button type="submit" disabled={!editTitle.trim()}>
                    Update TODO
                  </Button>
                </div>
              </form>
            ) : discarding ? (
              <div className="repo-todo-dialog-actions">
                <Dialog.Close asChild>
                  <Button variant="ghost">Keep editing</Button>
                </Dialog.Close>
                <Button
                  variant="danger"
                  onClick={() => {
                    setDraft(key, null);
                    setDiscarding(false);
                    setSource(false);
                    setNotice('');
                    setSelected('');
                    void load();
                  }}
                >
                  Discard and reload
                </Button>
              </div>
            ) : (
              <>
                <label htmlFor="todo-create-path">File location</label>
                <Select id="todo-create-path" value={createPath} onValueChange={setCreatePath}>
                  {creatable.map((path) => (
                    <SelectItem key={path} value={path}>
                      {path}
                    </SelectItem>
                  ))}
                </Select>
                <p className="task-muted">
                  Root files work in any repository. The docs folder must already exist to save a
                  list there.
                </p>
                <div className="repo-todo-dialog-actions">
                  <Dialog.Close asChild>
                    <Button variant="ghost">Cancel</Button>
                  </Dialog.Close>
                  <Button
                    onClick={() => {
                      if (!project) return;
                      setDraft(todoDraftKey(project.path, createPath), {
                        base: null,
                        content: '# TODO\n\n',
                      });
                      setSelected(createPath);
                      setSource(false);
                      setFilter('open');
                      setCreating(false);
                      setQuery('');
                      setNotice('');
                    }}
                  >
                    Create draft
                  </Button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </WorkspacePage>
  );
}
