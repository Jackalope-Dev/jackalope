import { SettingBody, SettingGroup, SettingRow, Switch } from '@jackalope/ui';
import { useShallow } from 'zustand/react/shallow';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { ThemeEditor } from '../theme/ThemeEditor';
export function AppearancePreferences({ projectId }: { projectId?: string }) {
  const { appTheme, setAppTheme } = useThemeStore(
    useShallow((s) => ({ appTheme: s.appTheme, setAppTheme: s.setAppTheme })),
  );
  const showThemePicker = useSettingsStore((state) => state.showThemePickerInToolbar);
  const mascotReactions = useSettingsStore((state) => state.mascotReactions);
  const frostedWindow = useSettingsStore((state) => state.frostedWindow);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const { projects, updateProjectPreferences } = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      updateProjectPreferences: s.updateProjectPreferences,
    })),
  );
  const project = projects.find((item) => item.id === projectId);
  const override = project?.preferences?.theme;
  return (
    <>
      <SettingGroup
        title="Theme"
        description={
          project
            ? `Overrides the app theme for ${project.name}.`
            : 'Light or dark mode, accent colors and atmosphere for the whole app.'
        }
      >
        <SettingBody>
          <div className="appearance-theme-editor">
            <ThemeEditor
              value={override ?? appTheme}
              onChange={(theme) =>
                project ? updateProjectPreferences(project.id, { theme }) : setAppTheme(theme)
              }
            />
          </div>
        </SettingBody>
      </SettingGroup>
      {!projectId && (
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
      )}
    </>
  );
}
