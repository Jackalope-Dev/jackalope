import { AgentCharacter } from '@jackalope/brand/agent-character';
import { Textarea } from '@jackalope/ui';
import { FolderOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { sessionCommand } from '../../lib/live-session';
import type { RunRequest } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { syncAgentConfig } from '../../stores/agentConfigStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { agentAccountFor, type Project } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

export function SessionStart({
  project,
  onOpenProject,
}: {
  project?: Project;
  onOpenProject: () => void;
}) {
  const draftKey = `jackalope-live-start:${project?.id ?? 'none'}`;
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(text);
  const mounted = useRef(true);
  const pending = useRef<{ id: string; messageId: string; text: string } | null>(null);
  const sending = useRef(false);
  latest.current = text;
  useEffect(() => {
    mounted.current = true;
    input.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      if (text) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    } catch {
      setError('This draft could not be saved. Keep this page open until sending succeeds.');
    }
  }, [draftKey, text]);
  const send = async () => {
    const value = text.trim();
    if (!project || !value || sending.current) return;
    if (!pending.current || pending.current.text !== value)
      pending.current = { id: crypto.randomUUID(), messageId: crypto.randomUUID(), text: value };
    const attempt = pending.current;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      await syncAgentConfig();
      const agent = project.preferences?.preferredRunner || 'auto';
      const request: RunRequest = {
        id: attempt.id,
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        agent,
        agentProfileId: agentAccountFor(project, agent),
        prompt: value,
        isolated: true,
        targetBranch: project.preferences?.baseBranch || project.gitBranch,
        verifyCommand: project.preferences?.verifyCommand,
        prepareCommand: project.preferences?.prepareCommand,
        autoVerify: project.preferences?.autoVerify ?? true,
      };
      await sessionCommand('create', {
        id: attempt.id,
        request,
        firstMessage: { id: attempt.messageId, text: value },
      });
      const next = latest.current.trim() === value ? '' : latest.current;
      if (next) localStorage.setItem(`jackalope-live-draft:main:${attempt.id}`, next);
      localStorage.removeItem(draftKey);
      await useLiveSessionStore.getState().refresh(attempt.id);
      if (mounted.current) useLiveSessionStore.getState().select(attempt.id);
    } catch (cause) {
      if (mounted.current) setError(String(cause));
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className="live-start">
      <div className="live-start-mark" aria-hidden="true">
        <AgentCharacter provider={project?.preferences?.preferredRunner || 'auto'} />
      </div>
      <span className="live-start-label">New session</span>
      <h2>{project?.name ?? 'Choose a project'}</h2>
      {project ? (
        <form
          className="live-start-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Textarea
            ref={input}
            aria-label="Message"
            placeholder="Build, fix, or explore…"
            rows={4}
            maxLength={12000}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
          <div className="live-start-actions">
            <Button
              type="submit"
              disabled={!text.trim() || busy || !isTauriEnvironment()}
              loading={busy}
              loadingLabel="Starting…"
            >
              Send
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" onClick={onOpenProject}>
          <FolderOpen size={16} />
          Open project
        </Button>
      )}
    </div>
  );
}
