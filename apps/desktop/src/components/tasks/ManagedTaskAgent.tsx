import { AgentCharacter } from '@jackalope/brand/agent-character';
import { Bot } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getAgentMetadata } from '../../lib/agent-catalog';
import { isActive, type TaskRun } from '../../lib/task-runtime';

export function ManagedTaskAgent({ provider, run }: { provider: string; run?: TaskRun }) {
  const element = useRef<HTMLSpanElement>(null);
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    let visible = false;
    const update = () => setAnimated(visible && document.hasFocus() && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    if (element.current) observer.observe(element.current);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const active = run && isActive(run);
  const state = active
    ? run.status === 'stopping' ||
      (!run.finishing && run.prompts?.some((prompt) => prompt.status === 'pending'))
      ? 'waiting'
      : 'working'
    : 'idle';
  return (
    <span
      ref={element}
      className="managed-agent"
      data-animated={animated || undefined}
      aria-hidden="true"
    >
      {getAgentMetadata(provider) ? (
        <AgentCharacter provider={provider} state={state} />
      ) : (
        <Bot size={28} />
      )}
    </span>
  );
}
