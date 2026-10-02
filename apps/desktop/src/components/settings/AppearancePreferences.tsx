import { useShallow } from 'zustand/react/shallow';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { ThemeEditor } from '../theme/ThemeEditor';
import { Switch } from '../ui/Switch';
import { Setting, SettingBody, SettingGroup } from './Setting';
export function AppearancePreferences({ projectId }: { projectId?: string }) {
  const { appTheme, setAppTheme } = useThemeStore(
    useShallow((s) => ({ appTheme: s.appTheme, setAppTheme: s.setAppTheme })),
  );
  const showThemePicker = useSettingsStore((state) => state.showThemePickerInToolbar);
  const mascotReactions = useSettingsStore((state) => state.mascotReactions);
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
          <Setting
            title="Companion animations"
            description="Let the jackalope react to your work. Reduced motion keeps it still."
          >
            <Switch
              label="Companion animations"
              checked={mascotReactions}
              onCheckedChange={(next) => updateSettings({ mascotReactions: next })}
            />
          </Setting>
          <Setting title="Show theme picker in top bar">
            <Switch
              label="Show theme picker in top bar"
              checked={showThemePicker}
              onCheckedChange={(showThemePickerInToolbar) =>
                updateSettings({ showThemePickerInToolbar })
              }
            />
          </Setting>
        </SettingGroup>
      )}
    </>
  );
}
