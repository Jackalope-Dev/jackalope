import { type Project, useProjectStore } from '../stores/projectStore.ts';
import { isTauriEnvironment } from './native/env.ts';
import { invokeNative } from './native/transport.ts';

/**
 * The icon each project shows in the sidebar, keyed by project id, for paired phones. A fetched
 * site icon travels as its data URL; the host keeps only the shared projects' valid icons.
 */
function projectIconPayload(projects: Pick<Project, 'id' | 'icon' | 'iconImage'>[]) {
  const icons: Record<string, { icon: string; image?: string }> = {};
  for (const project of projects) {
    if (!project.icon) continue;
    icons[project.id] =
      project.icon === 'website' && project.iconImage
        ? { icon: project.icon, image: project.iconImage }
        : { icon: project.icon };
  }
  return icons;
}

let sent = '';

/**
 * Tells the host this computer's project icons when they change. `force` resends after the
 * shared projects change, since the host drops icons for projects it doesn't share.
 */
export function syncProjectIcons(force = false) {
  if (!isTauriEnvironment()) return;
  const icons = projectIconPayload(useProjectStore.getState().projects);
  const key = JSON.stringify(icons);
  if (!force && key === sent) return;
  sent = key;
  invokeNative('remote_project_icons', { icons }).catch(() => {
    // Remote access may be unavailable; try again on the next change.
    sent = '';
  });
}

let started = false;

/** Starts syncing once per window: now, and on every project list change. */
export function startProjectIconSync() {
  if (started || !isTauriEnvironment()) return;
  started = true;
  syncProjectIcons();
  useProjectStore.subscribe(() => syncProjectIcons());
}
