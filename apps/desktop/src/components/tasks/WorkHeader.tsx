import { DropdownMenu as Menu } from '@jackalope/ui';
import { Check, ChevronDown } from 'lucide-react';
import { useMemo } from 'react';
import { projectNameHints } from '../../lib/project-name-hints';
import { type Project, useProjectStore } from '../../stores/projectStore';
import { ProjectMark } from '../projects/ProjectMark';
import './work-header.css';

/**
 * The Work page's title row: the heading doubles as the project switcher.
 */
export function WorkHeader({
  scope,
  project,
  onScopeChange,
}: {
  scope: 'all' | 'project';
  project: Project | undefined;
  onScopeChange: (scope: 'all' | 'project') => void;
}) {
  const projects = useProjectStore((state) => state.projects);
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
    </div>
  );
}
