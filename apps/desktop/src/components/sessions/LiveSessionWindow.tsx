import { MotionConfig } from 'motion/react';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { observeLiveSessions, useLiveSessionStore } from '../../stores/liveSessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { bootstrapWindow, useWindowTheme } from '../../window-bootstrap';
import { ResizeHandles } from '../layout/ResizeHandles';
import { LiveSessionView } from './LiveSessionView';
import { SessionRecovery } from './SessionRecovery';
import '../ui/experience.css';

export default function LiveSessionWindow({ id }: { id: string }) {
  useSettingsStore();
  useEffect(bootstrapWindow, []);
  useEffect(() => observeLiveSessions(id), [id]);
  const { sessions, runs, loading } = useLiveSessionStore(
    useShallow((s) => ({ sessions: s.sessions, runs: s.runs, loading: s.loading })),
  );
  const session = sessions.find((s) => s.id === id);
  useWindowTheme(session?.request.projectId);
  return (
    <MotionConfig reducedMotion="user">
      <main className="live-window">
        <ResizeHandles />
        {!session && <SessionRecovery />}
        {session ? (
          <LiveSessionView session={session} runs={runs} detached />
        ) : (
          <p role="status">{loading ? 'Loading conversation…' : 'Conversation unavailable.'}</p>
        )}
      </main>
    </MotionConfig>
  );
}
