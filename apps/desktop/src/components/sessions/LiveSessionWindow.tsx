import { applyThemeTokens, startThemeClock } from '@jackalope/brand/theme';
import { MotionConfig } from 'motion/react';
import { useEffect } from 'react';
import { observeLiveSessions, useLiveSessionStore } from '../../stores/liveSessionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { ResizeHandles } from '../layout/ResizeHandles';
import { LiveSessionView } from './LiveSessionView';
import { SessionRecovery } from './SessionRecovery';
import '../ui/experience.css';

export default function LiveSessionWindow({ id }: { id: string }) {
  useSettingsStore();
  useEffect(startThemeClock, []);
  useEffect(() => observeLiveSessions(id), [id]);
  const { sessions, runs, loading } = useLiveSessionStore();
  const session = sessions.find((s) => s.id === id);
  const appTheme = useThemeStore((state) => state.appTheme);
  const projectTheme = useProjectStore(
    (state) =>
      state.projects.find((project) => project.id === session?.request.projectId)?.preferences
        ?.theme,
  );
  useEffect(() => {
    applyThemeTokens(projectTheme ?? appTheme);
  }, [projectTheme, appTheme]);
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === 'jackalope-theme') void useThemeStore.persist.rehydrate();
      if (event.key === 'jackalope-projects') void useProjectStore.persist.rehydrate();
      if (event.key === 'jackalope-settings') void useSettingsStore.persist.rehydrate();
    };
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <main className="live-window">
        <ResizeHandles />
        {!session && <SessionRecovery />}
        {session ? (
          <LiveSessionView session={session} runs={runs} detached />
        ) : (
          <p role="status">{loading ? 'Loading session…' : 'Session unavailable.'}</p>
        )}
      </main>
    </MotionConfig>
  );
}
