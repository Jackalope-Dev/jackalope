import { startThemeClock } from '@jackalope/brand/theme';
import { MotionConfig } from 'motion/react';
import { useEffect } from 'react';
import { observeLiveSessions, useLiveSessionStore } from '../../stores/liveSessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import '../../stores/themeStore';
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
