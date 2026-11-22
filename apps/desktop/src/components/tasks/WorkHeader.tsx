import { describeError } from '@jackalope/contracts/errors';
import { DropdownMenu as Menu } from '@jackalope/ui';
import { Check, ChevronDown } from 'lucide-react';
import { useMemo } from 'react';
import { openGeneralProject } from '../../lib/general-project';
import { projectNameHints } from '../../lib/project-name-hints';
import { GENERAL_PROJECT_ID, type Project, useProjectStore } from '../../stores/projectStore';
import { ProjectMark } from '../projects/ProjectMark';
import './work-header.css';

/**
 * The Work page's title row: the heading doubles as the project switcher. General, for
 * work without a project, is offered until it exists and then lists like any project.
 */
export function WorkHeader({
  scope,
  project,
  onScopeChange,
  onError,
}: {
  scope: 'all' | 'project';
  project: Project | undefined;
  onScopeChange: (scope: 'all' | 'project') => void;
  onError?: (message: string) => void;
}) {
  const projects = useProjectStore((state) => state.projects);
  const hasGeneral = projects.some((item) => item.id === GENERAL_PROJECT_ID);
  const hints = useMemo(() => projectNameHints(projects), [projects]);
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
                  if (next === GENERAL_PROJECT_ID && !hasGeneral) {
                    void openGeneralProject()
                      .then(() => onScopeChange('project'))
                      .catch((cause) => onError?.(describeError(cause)));
                    return;
                  }
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
                {!hasGeneral && (
                  <Menu.RadioItem className="workspace-menu-item" value={GENERAL_PROJECT_ID}>
                    <ProjectMark project={{ id: GENERAL_PROJECT_ID, name: 'General' }} />
                    <span className="work-header-option">General</span>
                    <span className="work-header-hint">No project</span>
                  </Menu.RadioItem>
                )}
              </Menu.RadioGroup>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </h1>
    </div>
  );
}
