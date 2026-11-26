import type { SettingName } from '@jackalope/contracts/telemetry';
import { telemetry } from './telemetry-client.ts';

/** Preferences counted when they change, by name. Paths, addresses and model names are left out. */
const COUNTED: Record<string, SettingName> = {
  mascotReactions: 'mascot_reactions',
  frostedWindow: 'frosted_window',
  showThemePickerInToolbar: 'theme_picker_in_toolbar',
  notifications: 'notifications',
  osNotifications: 'os_notifications',
  interfaceZoom: 'interface_zoom',
  terminalFontSize: 'terminal_font_size',
  terminalShell: 'terminal_shell',
  preferredEditor: 'preferred_editor',
  terminalLinks: 'terminal_links',
  retainTerminalOutput: 'retain_terminal_output',
  shortcuts: 'shortcuts',
  voiceModel: 'voice_model',
  defaultRunner: 'default_runner',
  concurrencyLimit: 'concurrency_limit',
  taskTimeoutMinutes: 'task_timeout',
  useMcpMarketplace: 'mcp_marketplace',
};

/** Counts each listed preference whose value changed; the value itself is never sent. */
export function trackSettingChanges(before: object, partial: object, track = telemetry.track) {
  const previous = before as Record<string, unknown>;
  for (const [key, value] of Object.entries(partial)) {
    const setting = COUNTED[key];
    if (setting && !Object.is(previous[key], value)) track({ name: 'setting_changed', setting });
  }
}
