import { ListTodo, Monitor, SquareTerminal } from 'lucide-react';
import { useState } from 'react';

import { openCliTerminal } from '../../lib/cli-terminal';
import { isActive } from '../../lib/task-runtime';

import { useExecutionStore } from '../../stores/executionStore';
import { useHostContextStore } from '../../stores/hostContextStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { Companion } from '../mascot/Companion';

import { useFocusedWork } from './BranchIndicator';
import { navigateWorkspace } from './navigation';
import { StatusBarChanges } from './StatusBarChanges';
import { StatusBarUsage } from './StatusBarUsage';
import { useWorkspaceWork } from './WorkSidebar';

export function WorkspaceStatusBar({
  onSearch,
  onSettings,
}: {
  onSearch: () => void;
  onSettings: () => void;
}) {
  const host = useHostContextStore((state) => state.host);
  const [terminalError, setTerminalError] = useState('');
  const runs = useExecutionStore((state) => state.runs);
  const sessionRuns = useLiveSessionStore((state) => state.runs);
  const { project, checkout } = useFocusedWork();
  const items = useWorkspaceWork();
  const attention = items.filter((item) => ['attention', 'review'].includes(item.stage)).length;
  const active = [
    ...new Map([...runs, ...sessionRuns].map((item) => [item.id, item])).values(),
  ].filter(isActive).length;
  const activity = () => {
    useExecutionStore.getState().select(null);
    useLiveSessionStore.getState().select(null);
    useManagedTaskStore.getState().select(null);
    useWorkViewStore.getState().openList(attention ? 'attention' : 'working');
    navigateWorkspace('kanban');
  };
  return (
    <section className="workspace-statusbar" aria-label="Workspace status">
      <button type="button" onClick={() => navigateWorkspace('remote-hosts')}>
        <Monitor size={15} />
        {host ? `${host.wsl ? 'WSL · ' : ''}${host.name}` : 'This computer'}
      </button>
      {project && !host && <StatusBarChanges projectPath={project.path} checkout={checkout} />}
      <button type="button" onClick={activity}>
        <ListTodo size={15} />
        {host ? 'This computer: ' : ''}
        {active} running{attention ? ` · ${attention} needs you` : ''}
      </button>
      {project && !host && (
        <button
          type="button"
          onClick={() => {
            setTerminalError('');
            void openCliTerminal(project.path).catch((cause) =>
              setTerminalError(typeof cause === 'string' ? cause : String(cause)),
            );
          }}
          aria-describedby={terminalError ? 'statusbar-terminal-error' : undefined}
        >
          <SquareTerminal size={15} aria-hidden="true" />
          Terminal
        </button>
      )}
      {terminalError && (
        <span id="statusbar-terminal-error" role="alert" className="statusbar-error">
          {terminalError}
        </span>
      )}
      <StatusBarUsage remote={Boolean(host)} />
      <Companion compact onSearch={onSearch} onSettings={onSettings} />
    </section>
  );
}
