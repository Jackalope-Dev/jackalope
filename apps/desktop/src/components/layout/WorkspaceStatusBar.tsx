import { DropdownMenu as Menu } from '@jackalope/ui';
import { Ellipsis, ListTodo, Megaphone, Monitor, PauseCircle, SquareTerminal } from 'lucide-react';
import { useRef, useState } from 'react';
import { setWakeUpsPaused, useBotHubStore } from '../../lib/bot-hub';
import { openCliTerminal } from '../../lib/cli-terminal';
import { isActive } from '../../lib/task-runtime';
import { selectWork } from '../../lib/work-selection';
import { useExecutionStore } from '../../stores/executionStore';
import { useHostContextStore } from '../../stores/hostContextStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { Companion } from '../mascot/Companion';
import { FeedbackDialog } from '../settings/FeedbackDialog';
import { BranchIndicator, useFocusedWork } from './BranchIndicator';
import { InvitationsMenuItem } from './InvitationsMenuItem';
import { navigateWorkspace } from './navigation';
import { StatusBarChanges } from './StatusBarChanges';
import { StatusBarUsage } from './StatusBarUsage';
import { useWorkspaceWork } from './WorkSidebar';

export function WorkspaceStatusBar({
  onSearch,
  onSettings,
  onInvitations,
}: {
  onSearch: () => void;
  onSettings: () => void;
  onInvitations?: () => void;
}) {
  const host = useHostContextStore((state) => state.host);
  const wakeUpsPaused = useBotHubStore((state) => state.paused);
  const [terminalError, setTerminalError] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const navCollapsed = useWorkViewStore((state) => state.navCollapsed);
  const runs = useExecutionStore((state) => state.runs);
  const sessionRuns = useLiveSessionStore((state) => state.runs);
  const { project, checkout } = useFocusedWork();
  const items = useWorkspaceWork();
  const attention = items.filter((item) => ['attention', 'review'].includes(item.stage)).length;
  const active = [
    ...new Map([...runs, ...sessionRuns].map((item) => [item.id, item])).values(),
  ].filter(isActive).length;
  const activity = () => {
    selectWork();
    // The counts cover every project, so the list they open does too.
    useWorkViewStore.getState().setScope('all');
    useWorkViewStore.getState().openList(attention ? 'attention' : 'working');
    navigateWorkspace('kanban');
  };
  return (
    <section className="workspace-statusbar" aria-label="Workspace status">
      {host && (
        <button type="button" onClick={() => navigateWorkspace('remote-hosts')}>
          <Monitor size={15} aria-hidden="true" />
          {`${host.wsl ? 'WSL · ' : ''}${host.name}`}
        </button>
      )}
      {project && !host && (
        <span className="statusbar-project" title={project.path}>
          {project.name}
        </span>
      )}
      <BranchIndicator />
      {project && !host && <StatusBarChanges projectPath={project.path} checkout={checkout} />}
      {/* The open sidebar already lists this work; the count stands in while it is collapsed. */}
      {(navCollapsed || host) && (active > 0 || attention > 0) && (
        <button type="button" onClick={activity} title="Work across all projects">
          <ListTodo size={15} aria-hidden="true" />
          {host ? 'This computer: ' : ''}
          {active} running
          {attention ? ` · ${attention} ${attention === 1 ? 'needs' : 'need'} you` : ''}
        </button>
      )}
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
          <span className="statusbar-label">Terminal</span>
        </button>
      )}
      {terminalError && (
        <span id="statusbar-terminal-error" role="alert" className="statusbar-error">
          {terminalError}
        </span>
      )}
      {wakeUpsPaused && !host && (
        <span className="statusbar-paused" role="status">
          <button type="button" onClick={() => navigateWorkspace('bots')}>
            <PauseCircle size={15} aria-hidden="true" />
            Bot wake-ups paused
          </button>
          <button
            type="button"
            className="statusbar-resume"
            onClick={() => void setWakeUpsPaused(false)}
          >
            Resume
          </button>
        </span>
      )}
      <StatusBarUsage remote={Boolean(host)} />
      <Menu.Root>
        <Menu.Trigger asChild>
          <button ref={moreButton} type="button" aria-label="More" title="More">
            <Ellipsis size={15} aria-hidden="true" />
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="workspace-menu min-w-56" side="top" align="end">
            {!host && (
              <Menu.Item
                className="workspace-menu-item"
                onSelect={() => navigateWorkspace('remote-hosts')}
              >
                <Monitor size={16} aria-hidden="true" />
                Hosts
              </Menu.Item>
            )}
            {onInvitations && <InvitationsMenuItem onSelect={onInvitations} />}
            <Menu.Item className="workspace-menu-item" onSelect={() => setFeedbackOpen(true)}>
              <Megaphone size={16} aria-hidden="true" />
              Send feedback
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <FeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          moreButton.current?.focus();
        }}
      />
      <Companion compact onSearch={onSearch} onSettings={onSettings} />
    </section>
  );
}
