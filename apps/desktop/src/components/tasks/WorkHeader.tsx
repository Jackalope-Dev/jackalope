import { DropdownMenu as Menu } from '@jackalope/ui';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { projectNameHints } from '../../lib/project-name-hints';
import { type Project, useProjectStore } from '../../stores/projectStore';
import { ProviderMark } from '../agents/ProviderMark';
import { ProjectMark } from '../projects/ProjectMark';
import { useComposerAgents } from '../sessions/ComposerAgentPicker';
import './work-header.css';

/** The agent a new message would go to: the draft's saved single choice, else the project default. */
function useDraftAgent(project: Project | undefined) {
  const agents = useComposerAgents(project);
  let saved: unknown = null;
  try {
    saved = JSON.parse(
      localStorage.getItem(`jackalope-live-start:${project?.id ?? 'none'}:agents`) ?? 'null',
    );
  } catch {}
  const preferred = project?.preferences?.preferredRunner;
  const ids = Array.isArray(saved)
    ? saved.filter((id): id is string => typeof id === 'string')
    : preferred && preferred !== 'auto'
      ? [preferred]
      : [];
  const chosen = ids
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent) => !!agent);
  if (chosen.length > 1) return { label: `Compare ${chosen.length} agents`, adapter: null };
  if (chosen.length === 1) return { label: chosen[0].name, adapter: chosen[0].adapter };
  return { label: 'Automatic', adapter: null };
}

/**
 * The Work page's title row: the heading doubles as the project switcher, and while work is
 * listed a one-line composer opens the full one. Typing carries the first keystrokes over.
 */
export function WorkHeader({
  scope,
  project,
  onScopeChange,
  onCompose,
}: {
  scope: 'all' | 'project';
  project: Project | undefined;
  onScopeChange: (scope: 'all' | 'project') => void;
  /** Opens the full composer with any text typed into the bar; absent while it is open. */
  onCompose?: (text: string) => void;
}) {
  const projects = useProjectStore((state) => state.projects);
  const hints = useMemo(() => projectNameHints(projects), [projects]);
  const agent = useDraftAgent(project);
  const showProject = scope === 'project' && project;
  const value = scope === 'all' ? 'all' : (project?.id ?? 'all');
  return (
    <div className="work-header">
      <h1 className="work-header-title">
        <Menu.Root>
          <Menu.Trigger
            className="work-header-switch"
            title={showProject ? `${project.name} · Switch project` : 'Switch project'}
          >
            {showProject && <ProjectMark project={project} />}
            <span className="work-header-name">{showProject ? project.name : 'Work'}</span>
            {showProject && hints.get(project.id) && (
              <span className="work-header-hint">{hints.get(project.id)}</span>
            )}
            <ChevronDown size={16} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="workspace-menu work-header-menu" align="start" sideOffset={6}>
              <Menu.RadioGroup
                value={value}
                onValueChange={(next) => {
                  if (next === 'all') return onScopeChange('all');
                  useProjectStore.getState().selectProject(next);
                  onScopeChange('project');
                }}
              >
                <Menu.RadioItem className="workspace-menu-item" value="all">
                  <span className="work-header-option">All projects</span>
                  <Menu.ItemIndicator className="work-header-check">
                    <Check size={14} aria-hidden="true" />
                  </Menu.ItemIndicator>
                </Menu.RadioItem>
                <Menu.Separator className="menu-separator" />
                {projects.map((item) => (
                  <Menu.RadioItem key={item.id} className="workspace-menu-item" value={item.id}>
                    <ProjectMark project={item} />
                    <span className="work-header-option">{item.name}</span>
                    {hints.get(item.id) && (
                      <span className="work-header-hint">{hints.get(item.id)}</span>
                    )}
                    <Menu.ItemIndicator className="work-header-check">
                      <Check size={14} aria-hidden="true" />
                    </Menu.ItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </h1>
      {onCompose && (
        <label
          className="work-compose-bar"
          onMouseDown={(event) => {
            event.preventDefault();
            onCompose('');
          }}
        >
          <input
            type="text"
            value=""
            placeholder="Build, fix, or explore…"
            aria-label="New work: describe a task"
            onChange={(event) => onCompose(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onCompose('');
              }
            }}
          />
          <span className="work-compose-agent" aria-hidden="true">
            {agent.adapter ? (
              <ProviderMark provider={agent.adapter} size={14} />
            ) : (
              <Sparkles size={14} />
            )}
            {agent.label}
          </span>
        </label>
      )}
    </div>
  );
}
