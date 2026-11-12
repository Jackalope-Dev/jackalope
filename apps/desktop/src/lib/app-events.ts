import { useEffect, useRef } from 'react';
import { type DevicesTab, useViewTabStore } from '../stores/viewTabStore.ts';
import type { ActiveTab } from './navigation';
import type { AppSettingsCategory, ProjectSettingsCategory } from './settings-categories';

interface ProjectSettingsDestination {
  projectId: string;
  category: ProjectSettingsCategory;
}

/**
 * Requests one part of the window makes of another, by event name and detail. Events go
 * out on `window` as `jackalope:<name>` CustomEvents, which browser verification
 * scripts dispatch and observe too.
 */
interface AppEvents {
  navigate: ActiveTab;
  'open-settings': AppSettingsCategory | ProjectSettingsDestination;
  /** Opens the Agents page at app or project scope. */
  'open-agents': 'app' | 'project';
  'open-cloud-resources': string;
  /** Opens the composer on a draft another surface prepared under this key. */
  'helper-draft': string;
  'configure-agent': string;
  'open-shortcuts': undefined;
  /** Opens the feedback dialog the status bar holds. */
  'open-feedback': undefined;
  /** Adds attachment lines to the open new-work composer. */
  'attach-to-composer': string[];
  /** Working-tree changes were committed or discarded. */
  'changes-updated': undefined;
  /** Feedback was saved for a task. */
  'work-feedback': undefined;
}
type AppEvent = keyof AppEvents;

export function emitAppEvent<K extends AppEvent>(
  ...[name, detail]: AppEvents[K] extends undefined ? [K] : [K, AppEvents[K]]
) {
  window.dispatchEvent(new CustomEvent(`jackalope:${name}`, { detail }));
}

/** Calls the latest `handler` whenever `name` is emitted while the component is mounted. */
export function useAppEvent<K extends AppEvent>(name: K, handler: (detail: AppEvents[K]) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const handle = (event: Event) => latest.current((event as CustomEvent<AppEvents[K]>).detail);
    window.addEventListener(`jackalope:${name}`, handle);
    return () => window.removeEventListener(`jackalope:${name}`, handle);
  }, [name]);
}

export const navigateWorkspace = (tab: ActiveTab) => emitAppEvent('navigate', tab);

/** Opens Devices on one of its tabs (this is where Hosts and Remote access now live). */
export function openDevices(tab: DevicesTab) {
  useViewTabStore.getState().setDevices(tab);
  navigateWorkspace('remote-hosts');
}

export const openSettings = (category: AppSettingsCategory) =>
  emitAppEvent('open-settings', category);

export function openProjectSettings(
  projectId: string,
  category: ProjectSettingsCategory = 'Project',
) {
  emitAppEvent('open-settings', { projectId, category });
}

export const openAgents = (scope: 'app' | 'project') => emitAppEvent('open-agents', scope);

export const openCloudResources = (projectId: string) =>
  emitAppEvent('open-cloud-resources', projectId);

export const openHelperDraft = (key: string) => emitAppEvent('helper-draft', key);

export const openAgentConfiguration = (agentId: string) => emitAppEvent('configure-agent', agentId);

export const openShortcuts = () => emitAppEvent('open-shortcuts');

export const openFeedback = () => emitAppEvent('open-feedback');
