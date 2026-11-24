import { Button, Disclosure, DisclosureBody, DisclosureSummary, InlineNotice } from '@jackalope/ui';
import { ChevronDown, X } from 'lucide-react';
import { useId, useReducer, useState } from 'react';
import {
  type DispatchPaused,
  describeDispatchPaused,
  describeSeveralPaused,
  parseDispatchPaused,
  pathLabel,
  samePath,
} from '../../lib/dispatch-paused';
import { projectNameHints } from '../../lib/project-name-hints';
import { useProjectStore } from '../../stores/projectStore';
import './dispatch-paused.css';

/** Messages dismissed this session; a different pause (a new message) shows again. */
const dismissed = new Set<string>();

/**
 * A paused dispatch named by project, with the native message kept under Details.
 * Renders nothing for other errors, so callers fall back to their own error notice.
 */
export function DispatchPausedNotice({
  error,
  onShowProject,
}: {
  error: string | null;
  /** Omitted where the notice already sits with that project's work. */
  onShowProject?: (projectId: string) => void;
}) {
  const projects = useProjectStore((state) => state.projects);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const paused = parseDispatchPaused(error);
  if (!error || !paused || dismissed.has(error)) return null;
  const project = projects.find((entry) => samePath(entry.path, paused.projectPath));
  const hint = project && projectNameHints(projects).get(project.id);
  const label = project
    ? `${project.name}${hint ? ` (${hint})` : ''}`
    : pathLabel(paused.projectPath);
  const { title, body } = describeDispatchPaused(paused, label);
  return (
    <InlineNotice
      tone="warning"
      className="dispatch-paused"
      action={
        <div className="dispatch-paused-actions">
          {project && onShowProject && (
            <Button size="sm" variant="secondary" onClick={() => onShowProject(project.id)}>
              Show affected work
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              dismissed.add(error);
              rerender();
            }}
          >
            Dismiss
          </Button>
        </div>
      }
    >
      <p className="dispatch-paused-title">{title}</p>
      <p>{body}</p>
      <Disclosure>
        <DisclosureSummary>Details</DisclosureSummary>
        <DisclosureBody>
          <code className="dispatch-paused-raw">{error}</code>
        </DisclosureBody>
      </Disclosure>
    </InlineNotice>
  );
}

/**
 * Every paused dispatch on a page as one notice: a single pause reads as above, while
 * several collapse into a stack (one card with the others' edges peeking out). Opening it
 * lists each project as a quiet row: the row shows that project's work, and × dismisses it.
 */
export function DispatchPausedNotices({
  messages,
  onShowProject,
}: {
  messages: readonly string[];
  onShowProject?: (projectId: string) => void;
}) {
  const projects = useProjectStore((state) => state.projects);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const visible = messages
    .filter((message) => !dismissed.has(message))
    .map((message) => ({ message, paused: parseDispatchPaused(message) }))
    .filter((entry): entry is { message: string; paused: DispatchPaused } => !!entry.paused);
  if (visible.length === 1)
    return <DispatchPausedNotice error={visible[0].message} onShowProject={onShowProject} />;
  if (!visible.length) return null;
  const hints = projectNameHints(projects);
  const dismiss = (...items: string[]) => {
    for (const item of items) dismissed.add(item);
    rerender();
  };
  const { title, body, fix } = describeSeveralPaused(visible.length);
  return (
    <div className="dispatch-paused-stack" data-open={open || undefined}>
      <InlineNotice tone="warning" className="dispatch-paused">
        <p className="dispatch-paused-title">{title}</p>
        <p>{body}</p>
        <div className="dispatch-paused-toggles">
          <button
            type="button"
            className="dispatch-paused-toggle"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Hide projects' : `Show ${visible.length} projects`}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="dispatch-paused-toggle"
            onClick={() => dismiss(...visible.map((entry) => entry.message))}
          >
            Dismiss all
          </button>
        </div>
        {open && <p className="dispatch-paused-fix">{fix}</p>}
        {open && (
          <ul id={listId} className="dispatch-paused-list">
            {visible.map(({ message, paused }) => {
              const project = projects.find((entry) => samePath(entry.path, paused.projectPath));
              const hint = project && hints.get(project.id);
              const name = project
                ? `${project.name}${hint ? ` (${hint})` : ''}`
                : pathLabel(paused.projectPath);
              const where = [paused.branch, paused.commit && `commit ${paused.commit}`]
                .filter(Boolean)
                .join(' · ');
              const label = (
                <>
                  <span className="dispatch-paused-name">{name}</span>
                  <span className="dispatch-paused-where">{where}</span>
                </>
              );
              return (
                <li key={message}>
                  {project && onShowProject ? (
                    <button
                      type="button"
                      className="dispatch-paused-row"
                      title={`Show work in ${name}`}
                      onClick={() => onShowProject(project.id)}
                    >
                      {label}
                    </button>
                  ) : (
                    <span className="dispatch-paused-row">{label}</span>
                  )}
                  <button
                    type="button"
                    className="dispatch-paused-dismiss"
                    aria-label={`Dismiss ${name}`}
                    title="Dismiss"
                    onClick={() => dismiss(message)}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {open && (
          <Disclosure>
            <DisclosureSummary>Details</DisclosureSummary>
            <DisclosureBody>
              {visible.map(({ message }) => (
                <code key={message} className="dispatch-paused-raw">
                  {message}
                </code>
              ))}
            </DisclosureBody>
          </Disclosure>
        )}
      </InlineNotice>
    </div>
  );
}
