import { useProjectStore } from '../../stores/projectStore';
import { useThemeStore } from '../../stores/themeStore';
import { ThemeEditor } from '../theme/ThemeEditor';
import { Switch } from '../ui/Switch';
import { Setting } from './Setting';
export function AppearancePreferences({ projectId }: { projectId?: string }) {
  const { appTheme, setAppTheme } = useThemeStore();
  const { projects, updateProjectPreferences } = useProjectStore();
  const project = projects.find((item) => item.id === projectId);
  const override = project?.preferences?.theme;
  return <div className="appearance-preferences">
    {project && <Setting title="Use app theme" description="Turn this off to give this project its own appearance."><Switch label="Use app theme" checked={!override} onCheckedChange={(inherit) => updateProjectPreferences(project.id, { theme: inherit ? undefined : { ...appTheme } })} /></Setting>}
    {(!project || override) && <ThemeEditor value={override ?? appTheme} onChange={(theme) => project ? updateProjectPreferences(project.id, { theme }) : setAppTheme(theme)} />}
  </div>;
}
