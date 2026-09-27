import { Checkbox } from '@jackalope/ui';
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
