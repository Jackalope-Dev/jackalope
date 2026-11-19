import { Button, SettingBody, SettingGroup, SettingRow, Switch } from '@jackalope/ui';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { ThemeEditor } from '../theme/ThemeEditor';

/**
 * App appearance, plus an inline override for one project (the one a project link asked
 * for, else the active project). Overriding starts from the app theme; "Use app theme"
 * clears the project's saved theme so it inherits again.
 */
export function AppearancePreferences({ overrideProjectId }: { overrideProjectId?: string }) {
  const { appTheme, setAppTheme } = useThemeStore(
    useShallow((s) => ({ appTheme: s.appTheme, setAppTheme: s.setAppTheme })),
  );
  const showThemePicker = useSettingsStore((state) => state.showThemePickerInToolbar);
  const mascotReactions = useSettingsStore((state) => state.mascotReactions);
  const frostedWindow = useSettingsStore((state) => state.frostedWindow);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const { projects, activeProjectId, updateProjectPreferences } = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      activeProjectId: s.activeProjectId,
      updateProjectPreferences: s.updateProjectPreferences,
    })),
  );
  const project = projects.find((item) => item.id === (overrideProjectId ?? activeProjectId));
  const override = project?.preferences?.theme;
  // A project link lands with its override open; otherwise it opens on request.
  const [editing, setEditing] = useState(Boolean(overrideProjectId && override));
  return (
    <>
      <SettingGroup
        title="Theme"
        description="Light or dark mode, accent colors and atmosphere for the whole app."
      >
        <SettingBody>
          <div className="appearance-theme-editor">
            <ThemeEditor value={appTheme} onChange={setAppTheme} />
          </div>
        </SettingBody>
      </SettingGroup>
      {project && (
        <SettingGroup
          title={`Override for ${project.name}`}
          description={
            override
              ? `${project.name} uses its own theme, ${override.name}.`
              : `${project.name} uses the app theme.`
          }
        >
          <SettingRow title={override ? 'Project theme' : 'Use a different theme here'}>
            {override ? (
              <>
                <Button variant="outline" onClick={() => setEditing((open) => !open)}>
                  {editing ? 'Done' : 'Edit override'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    updateProjectPreferences(project.id, { theme: undefined });
                    setEditing(false);
                  }}
                >
                  Use app theme
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  updateProjectPreferences(project.id, { theme: { ...appTheme } });
                  setEditing(true);
                }}
              >
                Override for {project.name}
              </Button>
            )}
          </SettingRow>
          {override && editing && (
            <SettingBody>
              <div className="appearance-theme-editor">
                <ThemeEditor
                  value={override}
                  onChange={(theme) => updateProjectPreferences(project.id, { theme })}
                />
              </div>
            </SettingBody>
          )}
        </SettingGroup>
      )}
      <SettingGroup title="Interface">
        <SettingRow
          title="Frosted window"
          description="Show your desktop softly through the window on Windows 11 and macOS."
        >
          <Switch
            label="Frosted window"
            checked={frostedWindow}
            onCheckedChange={(next) => updateSettings({ frostedWindow: next })}
          />
        </SettingRow>
        <SettingRow
          title="Companion animations"
          description="Let the jackalope react to your work. Reduced motion keeps it still."
        >
          <Switch
            label="Companion animations"
            checked={mascotReactions}
            onCheckedChange={(next) => updateSettings({ mascotReactions: next })}
          />
        </SettingRow>
        <SettingRow title="Show theme picker in top bar">
          <Switch
            label="Show theme picker in top bar"
            checked={showThemePicker}
            onCheckedChange={(showThemePickerInToolbar) =>
              updateSettings({ showThemePickerInToolbar })
            }
          />
        </SettingRow>
      </SettingGroup>
    </>
  );
}
