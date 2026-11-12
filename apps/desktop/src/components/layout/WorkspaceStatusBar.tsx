import { describeError } from '@jackalope/contracts/errors';
import { isActive } from '@jackalope/contracts/runs';
import { DiscordIcon, Tooltip } from '@jackalope/ui';
import {
  ListTodo,
  Megaphone,
  Monitor,
  MonitorSmartphone,
  PauseCircle,
  SquareTerminal,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { navigateWorkspace, useAppEvent } from '../../lib/app-events';
import { setWakeUpsPaused, useBotHubStore } from '../../lib/bot-hub';
import { openCliTerminal } from '../../lib/cli-terminal';
import { DISCORD_URL } from '../../lib/community';
import { openExternalUrl } from '../../lib/native/env';
import { selectWork, useWorkspaceWork } from '../../lib/work-selection';
import { useExecutionStore } from '../../stores/executionStore';
import { useHostContextStore } from '../../stores/hostContextStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { Companion } from '../mascot/Companion';
import { FeedbackDialog } from '../settings/FeedbackDialog';
import { BranchIndicator, useFocusedWork } from './BranchIndicator';
import { StatusBarChanges } from './StatusBarChanges';
import { StatusBarUsage } from './StatusBarUsage';

export function WorkspaceStatusBar({
  onSearch,
  onSettings,
}: {
  onSearch: () => void;
  onSettings: () => void;
}) {
  const host = useHostContextStore((state) => state.host);
  const wakeUpsPaused = useBotHubStore((state) => state.paused);
  const [terminalError, setTerminalError] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const feedbackButton = useRef<HTMLButtonElement>(null);
  // The Help menu and command search open feedback through this event.
  useAppEvent('open-feedback', () => setFeedbackOpen(true));
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
            void openCliTerminal(checkout).catch((cause) => setTerminalError(describeError(cause)));
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
      {!host && (
        <button type="button" onClick={() => navigateWorkspace('remote-hosts')}>
          <MonitorSmartphone size={15} aria-hidden="true" />
          <span className="statusbar-label">Devices</span>
        </button>
      )}
      <Tooltip side="top" content="Community and help on Discord">
        <button
          type="button"
          className="statusbar-icon"
          aria-label="Join the Jackalope Discord"
          onClick={() => void openExternalUrl(DISCORD_URL)}
        >
          <DiscordIcon size={15} aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip side="top" content="Send feedback">
        <button
          ref={feedbackButton}
          type="button"
          className="statusbar-icon"
          aria-label="Send feedback"
          onClick={() => setFeedbackOpen(true)}
        >
          <Megaphone size={15} aria-hidden="true" />
        </button>
      </Tooltip>
      <FeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          feedbackButton.current?.focus();
        }}
      />
      <Companion compact onSearch={onSearch} onSettings={onSettings} />
    </section>
  );
}
