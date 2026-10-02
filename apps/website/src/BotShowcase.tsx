import { AgentCharacter, type AgentGaze } from '@jackalope/brand/agent-character';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import './bot-showcase.css';

/**
 * Marketing copy of the desktop bot templates. The website does not import desktop
 * modules, so keep these names, shapes and colours in step with lib/bot-templates.ts.
 */
const bots = [
  {
    name: 'Reviewer',
    shape: 'shield',
    color: '#4c86f0',
    role: 'Reviews changes before they merge',
    use: 'Every weekday · Review new commits',
  },
  {
    name: 'Researcher',
    shape: 'moon',
    color: '#8b6cf6',
    role: 'Answers questions about the codebase',
    use: '“How is routing decided?”',
  },
  {
    name: 'Fixer',
    shape: 'cat',
    color: '#f2665c',
    role: 'Reproduces and fixes bugs',
    use: '“The login test fails on CI”',
  },
  {
    name: 'Tester',
    shape: 'gem',
    color: '#1fa7bd',
    role: 'Adds tests where coverage is thin',
    use: 'Weekly · Cover this week’s changes',
  },
  {
    name: 'Polisher',
    shape: 'heart',
    color: '#e05297',
    role: 'Checks the interface in a real browser',
    use: '“Check the settings page on mobile”',
  },
  {
    name: 'Sentinel',
    shape: 'ghost',
    color: 'var(--color-text-primary)',
    role: 'Looks for security problems',
    use: 'Weekly · Security review',
  },
  {
    name: 'Docs keeper',
    shape: 'cloud',
    color: '#4c86f0',
    role: 'Keeps documentation in step with the code',
    use: 'Weekly · Fix outdated docs',
  },
  {
    name: 'Scout',
    shape: 'antigravity',
    color: '#2fb37f',
    role: 'Keeps dependencies and CI healthy',
    use: 'Weekly · Safe dependency updates',
  },
] as const;

export function BotShowcase() {
  const section = useRef<HTMLElement>(null);
  const [gaze, setGaze] = useState<AgentGaze>();
  const [active, setActive] = useState<string | null>(null);
  const [still, setStill] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setStill(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return (
    <section
      ref={section}
      className="workspace-section bot-showcase"
      id="bots"
      aria-labelledby="bots-title"
      data-reveal=""
      onPointerMove={(event) => {
        if (still || !section.current) return;
        const rect = section.current.getBoundingClientRect();
        setGaze({
          x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
          y: ((event.clientY - rect.top) / rect.height) * 2 - 1,
        });
      }}
      onPointerLeave={() => setGaze(undefined)}
    >
      <div className="landing-width">
        <div className="workspace-heading bot-showcase-heading">
          <h2 id="bots-title" className="titled">
            Bots that know their <span className="title-accent">job.</span>
          </h2>
          <p>
            Give a bot a role, an agent and the tools it may use. Ask it a question any time, or let
            it run on a schedule. Each one keeps its own look.
          </p>
        </div>
        <ul className="bot-showcase-grid">
          {bots.map((bot, index) => (
            <li
              key={bot.name}
              className="bot-showcase-card"
              style={
                { '--bot-color': bot.color, '--bob-delay': `${index * -0.45}s` } as CSSProperties
              }
              onPointerEnter={() => setActive(bot.name)}
              onPointerLeave={() => setActive(null)}
            >
              <span className="bot-showcase-character" aria-hidden="true">
                <AgentCharacter
                  provider={bot.shape}
                  state={active === bot.name && !still ? 'working' : 'idle'}
                  gaze={still ? undefined : gaze}
                />
              </span>
              <strong>{bot.name}</strong>
              <span className="bot-showcase-role">{bot.role}</span>
              <span className="bot-showcase-use">{bot.use}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
