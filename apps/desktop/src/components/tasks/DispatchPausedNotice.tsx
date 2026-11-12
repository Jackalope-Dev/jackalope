import { Button, Disclosure, DisclosureBody, DisclosureSummary, InlineNotice } from '@jackalope/ui';
import { useReducer } from 'react';
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
 * several stack into one summary with a compact row per project, so they never fill the page.
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
  const { title, body } = describeSeveralPaused(visible.length);
  return (
    <InlineNotice
      tone="warning"
      className="dispatch-paused"
      action={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => dismiss(...visible.map((entry) => entry.message))}
        >
          Dismiss all
        </Button>
      }
    >
      <p className="dispatch-paused-title">{title}</p>
      <p>{body}</p>
      <ul className="dispatch-paused-list">
        {visible.map(({ message, paused }) => {
          const project = projects.find((entry) => samePath(entry.path, paused.projectPath));
          const hint = project && hints.get(project.id);
          const name = project
            ? `${project.name}${hint ? ` (${hint})` : ''}`
            : pathLabel(paused.projectPath);
          return (
            <li key={message}>
              <span className="dispatch-paused-name">{name}</span>
              <span className="dispatch-paused-where">
                {[paused.branch, paused.commit && `commit ${paused.commit}`]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {project && onShowProject && (
                <Button size="sm" variant="ghost" onClick={() => onShowProject(project.id)}>
                  Show work
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Dismiss ${name}`}
                onClick={() => dismiss(message)}
              >
                Dismiss
              </Button>
            </li>
          );
        })}
      </ul>
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
    </InlineNotice>
  );
}
