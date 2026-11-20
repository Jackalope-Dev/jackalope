import {
  BookText,
  Bug,
  Compass,
  FlaskConical,
  GitBranch,
  type LucideIcon,
  Palette,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { navigateWorkspace, openProjectSettings } from '../../lib/app-events';
import { type ActiveTab, WORKSPACE_VIEWS, workspaceView } from '../../lib/navigation';
import { STARTER_PROMPTS } from '../../lib/starter-prompts';
import { useContextMemoryStore } from '../../stores/contextMemoryStore';
import type { Project } from '../../stores/projectStore';
import { ProjectMark } from '../projects/ProjectMark';
import './project-launchpad.css';

const STARTER_LOOK: Record<string, { icon: LucideIcon; hint: string }> = {
  'Tour this codebase': { icon: Compass, hint: 'Get oriented and spot quick wins' },
  'Find and fix a bug': { icon: Bug, hint: 'One real bug, fixed with a test' },
  'Improve tests': { icon: FlaskConical, hint: 'Cover the riskiest untested code' },
  'Refresh the README': { icon: BookText, hint: 'Setup steps that actually work' },
};

interface Place {
  key: string;
  icon: LucideIcon;
  label: string;
  hint: string;
  open: () => void;
}

/** Each tile staggers its entrance by its position; reduced motion skips the animation. */
const order = (index: number) => ({ '--launchpad-index': index }) as CSSProperties;

/**
 * A project with no work yet: starting points that fill in the composer, and the
 * project's pages, in place of an empty list.
 */
export function ProjectLaunchpad({
  project,
  onStart,
}: {
  project: Project;
  /** Puts a starter request in the composer for editing; nothing runs until it is sent. */
  onStart: (prompt: string) => void;
}) {
  const todos = useContextMemoryStore(
    (state) =>
      state.memories[project.id]?.openTasks.filter((task) => task.status === 'open').length,
  );
  const view = (id: ActiveTab, hint: string): Place => {
    const entry = workspaceView(id);
    return {
      key: id,
      icon: entry.icon,
      label: entry.label,
      hint,
      open: () => navigateWorkspace(id),
    };
  };
  const library = WORKSPACE_VIEWS.find((entry) => (entry.id as string) === 'library');
  const places: Place[] = [
    view('repo-todos', todos ? `${todos} open in the repository` : 'Turn TODOs into tasks'),
    ...(project.plainFolder ? [] : [view('changes', 'Review and commit')]),
    view('topology', 'How the code fits together'),
    view('project-knowledge', 'What agents know'),
    ...(library ? [view(library.id, 'Images and files from work')] : []),
    view('schedules', 'Run work on a schedule'),
    {
      key: 'appearance',
      icon: Palette,
      label: 'Appearance',
      hint: 'Give it its own colors',
      open: () => openProjectSettings(project.id, 'Appearance'),
    },
  ];
  const branch = !project.plainFolder && project.gitBranch;
  return (
    <section className="launchpad" aria-labelledby="launchpad-title">
      <header className="launchpad-hero">
        <span className="launchpad-mark">
          <ProjectMark project={project} />
        </span>
        <div className="launchpad-intro">
          <h2 id="launchpad-title">What’s next for {project.name}?</h2>
          <p>
            Pick a starting point to fill in the request above, then edit it before you send.
            {branch && (
              <span className="launchpad-branch">
                <GitBranch size={13} aria-hidden="true" />
                {branch}
              </span>
            )}
          </p>
        </div>
      </header>
      <ul className="launchpad-starts" aria-label="Starting points">
        {STARTER_PROMPTS.map((starter, index) => {
          const look = STARTER_LOOK[starter.label] ?? { icon: Compass, hint: '' };
          const Icon = look.icon;
          return (
            <li key={starter.label} style={order(index)}>
              <button
                type="button"
                className="launchpad-tile launchpad-start"
                onClick={() => onStart(starter.prompt)}
              >
                <span className="launchpad-icon">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <span className="launchpad-label">{starter.label}</span>
                {look.hint && <span className="launchpad-hint">{look.hint}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <h3 className="launchpad-heading">Explore {project.name}</h3>
      <ul className="launchpad-places" aria-label={`Explore ${project.name}`}>
        {places.map((place, index) => {
          const Icon = place.icon;
          return (
            <li key={place.key} style={order(index + STARTER_PROMPTS.length)}>
              <button type="button" className="launchpad-tile launchpad-place" onClick={place.open}>
                <span className="launchpad-icon">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span className="launchpad-label">{place.label}</span>
                <span className="launchpad-hint">{place.hint}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
