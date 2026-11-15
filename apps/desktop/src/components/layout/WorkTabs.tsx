import { X } from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useRef } from 'react';
import { navigateWorkspace } from '../../lib/app-events';
import { matchesShortcut, resolveShortcuts } from '../../lib/shortcuts';
import { workPresence } from '../../lib/task-collection';
import { openWork, useWorkspaceWork, workProjectId } from '../../lib/work-selection';
import { useExecutionStore } from '../../stores/executionStore';
import { useOpenWorkStore } from '../../stores/openWorkStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { AgentStack } from '../agents/AgentAvatar';
import { ProjectMark } from '../projects/ProjectMark';
import { isUnread, signalKey, useOpenSignalKey, useWorkSignals } from '../tasks/WorkSignals';
import './work-tabs.css';

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

/**
 * Tabs for recently opened tasks, chats and plans. Mod+1–9 jumps to a tab and
 * Ctrl+Tab cycles through them; closing a tab never stops or archives work.
 */
export function WorkTabs() {
  const keys = useOpenWorkStore((state) => state.keys);
  const work = useWorkspaceWork();
  const loading = useExecutionStore((state) => state.loading);
  const openKey = useOpenSignalKey();
  const signals = useWorkSignals();
  const shortcuts = useSettingsStore((state) => state.shortcuts);
  const projects = useProjectStore((state) => state.projects);
  const strip = useRef<HTMLElement>(null);
  const byKey = useMemo(() => new Map(work.map((item) => [signalKey(item), item])), [work]);
  const tabs = keys.flatMap((key) => {
    const item = byKey.get(key);
    return item ? [{ key, item }] : [];
  });
  useEffect(() => {
    // Drop tabs whose work was deleted, once history has loaded.
    if (!loading) useOpenWorkStore.getState().retain(new Set(byKey.keys()));
  }, [byKey, loading]);
  useEffect(() => {
    // The strip has no scrollbar, so keep the current tab in view when it changes.
    if (openKey)
      strip.current
        ?.querySelector('[data-current]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [openKey]);
  useEffect(() => {
    if (tabs.length < 2) return;
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const bindings = Object.values(resolveShortcuts(shortcuts));
      if (bindings.some((binding) => matchesShortcut(event, binding))) return;
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      let target = -1;
      if (modifier && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key))
        target = Math.min(Number(event.key), tabs.length) - 1;
      else if (event.ctrlKey && event.key === 'Tab') {
        const current = tabs.findIndex((tab) => tab.key === openKey);
        target = (current + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length;
      }
      if (target < 0) return;
      event.preventDefault();
      openWork(tabs[target].item);
      navigateWorkspace('kanban');
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [tabs, openKey, shortcuts]);
  if (tabs.length < 2) return null;
  return (
    <nav ref={strip} className="work-tabs" aria-label="Open work">
      {tabs.map(({ key, item }, index) => {
        const presence = workPresence(item);
        const current = key === openKey;
        const unread = isUnread(item, signals, openKey);
        const projectId = workProjectId(item);
        const project = projectId ? projects.find((entry) => entry.id === projectId) : undefined;
        const projectAccent = project?.preferences?.theme?.accentHex;
        const label = project ? `${project.name} · ${item.title}` : item.title;
        return (
          <div key={key} className="work-tab" data-current={current || undefined}>
            <button
              type="button"
              className="work-tab-open"
              aria-current={current ? 'page' : undefined}
              title={`${label}${index < 9 ? ` (${isMac ? '⌘' : 'Ctrl+'}${index + 1})` : ''}`}
              onClick={() => {
                openWork(item);
                navigateWorkspace('kanban');
              }}
            >
              {project ? (
                <span
                  className="work-tab-marks"
                  data-themed={projectAccent ? true : undefined}
                  style={
                    projectAccent
                      ? ({ '--project-accent': projectAccent } as CSSProperties)
                      : undefined
                  }
                >
                  <ProjectMark project={project} />
                  <span className="work-tab-agent">
                    <AgentStack agents={presence.agents} state={presence.state} size="xs" />
                  </span>
                  <span className="ui-sr-only">{project.name}: </span>
                </span>
              ) : (
                <AgentStack agents={presence.agents} state={presence.state} size="xs" />
              )}
              <span className="work-tab-title">{item.title}</span>
              {unread && (
                <span className="work-signal-unread" role="img" aria-label="Unread">
                  <span aria-hidden="true" />
                </span>
              )}
            </button>
            <button
              type="button"
              className="work-tab-close"
              aria-label={`Close tab ${label}`}
              onClick={() => useOpenWorkStore.getState().close(key)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </nav>
  );
}
