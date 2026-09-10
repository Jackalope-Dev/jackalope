import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { ThemeEditor } from '../theme/ThemeEditor';
import { Switch } from '../ui/Switch';
import { Setting } from './Setting';
export function AppearancePreferences({ projectId }: { projectId?: string }) {
  const { appTheme, setAppTheme } = useThemeStore();
  const showThemePicker = useSettingsStore((state) => state.showThemePickerInToolbar);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const { projects, updateProjectPreferences } = useProjectStore();
  const project = projects.find((item) => item.id === projectId);
  const override = project?.preferences?.theme;
  return (
    <div className="appearance-preferences">
      {project && (
        <Setting
          title="Use app theme"
          description="Turn this off to give this project its own appearance."
        >
          <Switch
            label="Use app theme"
            checked={!override}
            onCheckedChange={(inherit) =>
              updateProjectPreferences(project.id, { theme: inherit ? undefined : { ...appTheme } })
            }
          />
        </Setting>
      )}
      {(!project || override) && (
        <div className="appearance-theme-editor">
          <ThemeEditor
            value={override ?? appTheme}
            onChange={(theme) =>
              project ? updateProjectPreferences(project.id, { theme }) : setAppTheme(theme)
            }
          />
        </div>
      )}
      {!projectId && (
        <label className="appearance-toolbar-toggle">
          <input
            type="checkbox"
            checked={showThemePicker}
            onChange={(event) =>
              updateSettings({ showThemePickerInToolbar: event.currentTarget.checked })
            }
          />
          <span>Show theme picker in top bar</span>
        </label>
      )}
    </div>
  );
}
