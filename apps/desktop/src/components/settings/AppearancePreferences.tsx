import { Checkbox } from '@jackalope/ui';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { ThemeEditor } from '../theme/ThemeEditor';
export function AppearancePreferences({ projectId }: { projectId?: string }) {
  const { appTheme, setAppTheme } = useThemeStore();
  const showThemePicker = useSettingsStore((state) => state.showThemePickerInToolbar);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const { projects, updateProjectPreferences } = useProjectStore();
  const project = projects.find((item) => item.id === projectId);
  const override = project?.preferences?.theme;
  return (
    <div className="appearance-preferences">
      <div className="appearance-theme-editor">
        <ThemeEditor
          value={override ?? appTheme}
          onChange={(theme) =>
            project ? updateProjectPreferences(project.id, { theme }) : setAppTheme(theme)
          }
        />
      </div>
      {!projectId && (
        <label className="appearance-toolbar-toggle">
          <Checkbox
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
