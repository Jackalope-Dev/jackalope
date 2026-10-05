import { AgentCharacter } from '@jackalope/brand/agent-character';
import { EchoMark } from '@jackalope/brand/echo';
import { PROVIDER_MARKS } from '@jackalope/brand/provider-marks';
import { Disclosure, DisclosureSummary, GitHubIcon, Tabs } from '@jackalope/ui';
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  CalendarClock,
  Check,
  Code2,
  GitMerge,
  KeyRound,
  Laptop,
  Monitor,
  MousePointer2,
  Play,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { BrandMark } from './BrandMark';
import { GITHUB_URL } from './community';
import { tour } from './content';
import { WorkspaceClip } from './WorkspaceClip';
import './landing.css';

const agents = [
  { id: 'codex', name: 'Codex' },
  { id: 'claude', name: 'Claude Code' },
  { id: 'gemini', name: 'Gemini CLI' },
  { id: 'grok', name: 'Grok' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'kimi', name: 'Kimi Code' },
  { id: 'antigravity', name: 'Antigravity' },
];

function AgentMark({ id }: { id: string }) {
  const mark = PROVIDER_MARKS[id];
  return (
    <svg
      viewBox="0 0 24 24"
      fill={mark.color ?? 'currentColor'}
      fillRule="evenodd"
      aria-hidden="true"
      focusable="false"
    >
      {mark.paths.map((d) => (
        <path key={d} d={d} clipRule="evenodd" />
      ))}
    </svg>
  );
}

/** Plays while on screen; reduced motion and server output show the finished state. */
function useLoop(steps: number, interval: number) {
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(steps - 1);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: number | undefined;
    let visible = false;
    const sync = () => {
      window.clearInterval(timer);
      if (!visible || motion.matches) {
        setStep(steps - 1);
        return;
      }
      timer = window.setInterval(() => setStep((current) => (current + 1) % steps), interval);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(element);
    motion.addEventListener('change', sync);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', sync);
      window.clearInterval(timer);
    };
  }, [steps, interval]);
  return [root, step] as const;
}

const lanes = [
  {
    agent: 'codex',
    name: 'Codex',
    task: 'Build keyboard search',
    branch: 'search',
    diff: ['+128', '−12'],
    duration: '2.4s',
    color: 'var(--lp-lane-1)',
  },
  {
    agent: 'claude',
    name: 'Claude Code',
    task: 'Fix disappearing drafts',
    branch: 'drafts',
    diff: ['+46', '−9'],
    duration: '1.9s',
    color: 'var(--lp-lane-2)',
  },
  {
    agent: 'gemini',
    name: 'Gemini CLI',
    task: 'Try a simpler navigation',
    branch: 'navigation',
    diff: ['+212', '−87'],
    duration: '2.7s',
    color: 'var(--lp-lane-3)',
  },
];

/** Steps: 0 brief, 1 dispatched, 2 working, 3 finished, 4 in review (held twice as long). */
function ParallelVisual() {
  const [root, raw] = useLoop(7, 1300);
  const step = Math.min(raw, 4);
  return (
    <div ref={root} className="lp-flow" data-step={step} aria-hidden="true">
      <div className="lp-flow-brief">
        <BrandMark />
        <span className="lp-flow-prompt">
          Add keyboard search, fix the lost drafts, and try a simpler nav.
        </span>
        <span className="lp-flow-send">
          <ArrowRight size={14} />
        </span>
      </div>
      <svg
        className="lp-flow-wires"
        viewBox="0 0 300 40"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path pathLength="1" d="M150 0 C150 22 50 18 50 40" />
        <path pathLength="1" d="M150 0 V40" />
        <path pathLength="1" d="M150 0 C150 22 250 18 250 40" />
      </svg>
      <div className="lp-flow-lanes">
        {lanes.map((lane, index) => (
          <div
            className="lp-lane"
            key={lane.agent}
            style={{ '--lane': lane.color, '--i': index, '--dur': lane.duration } as CSSProperties}
          >
            <span className="lp-lane-head">
              <span className="lp-lane-character">
                <AgentCharacter provider={lane.agent} state={step === 2 ? 'working' : 'idle'} />
              </span>
              <span className="lp-lane-agent">{lane.name}</span>
            </span>
            <strong>{lane.task}</strong>
            <span className="lp-lane-branch">worktree/{lane.branch}</span>
            <span className="lp-lane-progress">
              <span className="lp-lane-fill" />
            </span>
            <span className="lp-lane-result">
              <Check size={13} strokeWidth={3} />
              <span className="lp-add">{lane.diff[0]}</span>
              <span className="lp-del">{lane.diff[1]}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="lp-flow-review">
        <span className="lp-flow-review-icon">
          <GitMerge size={18} />
        </span>
        <span>
          <strong>3 changes ready for review</strong>
          <small>Checks passed · Nothing merged yet</small>
        </span>
        <span className="lp-flow-review-action">Review</span>
      </div>
    </div>
  );
}

const steps = [
  {
    title: 'Describe the outcome',
    detail:
      'Write a brief in plain language. Jackalope brings in your project guidance, saved lessons and selected tools.',
  },
  {
    title: 'Agents work side by side',
    detail:
      'Each task gets its own agent and Git worktree, so parallel changes never trip over each other.',
  },
  {
    title: 'Review, then merge',
    detail:
      'Read every diff beside its brief and checks. Ask for another pass, or merge what you want to keep.',
  },
];

const workers = [
  { agent: 'codex', name: 'Codex', branch: 'drafts-fix', color: 'var(--lp-lane-1)', fill: 0.7 },
  {
    agent: 'claude',
    name: 'Claude Code',
    branch: 'drafts-tests',
    color: 'var(--lp-lane-2)',
    fill: 0.45,
  },
  {
    agent: 'opencode',
    name: 'OpenCode',
    branch: 'drafts-docs',
    color: 'var(--lp-lane-3)',
    fill: 0.85,
  },
];

function StepArt({ index }: { index: number }) {
  if (index === 0)
    return (
      <div className="lp-step-art lp-step-brief" aria-hidden="true">
        <span className="lp-type">Find why drafts disappear</span>
        <span className="lp-chips">
          <span>Project guidance</span>
          <span>Lessons</span>
          <span>Browser</span>
        </span>
      </div>
    );
  if (index === 1)
    return (
      <div className="lp-step-art lp-step-agents" aria-hidden="true">
        {workers.map((worker, index) => (
          <span
            className="lp-mini-lane"
            key={worker.agent}
            style={{ '--lane': worker.color, '--i': index, '--fill': worker.fill } as CSSProperties}
          >
            <span className="lp-mini-character">
              <AgentCharacter provider={worker.agent} state="working" />
            </span>
            <span className="lp-mini-text">
              <b>{worker.name}</b>
              <small>worktree/{worker.branch}</small>
            </span>
            <span className="lp-mini-bar">
              <span className="lp-mini-fill" />
            </span>
          </span>
        ))}
      </div>
    );
  return (
    <div className="lp-step-art lp-step-diff" aria-hidden="true">
      <span className="lp-diff-line lp-diff-del">− const draft = null</span>
      <span className="lp-diff-line lp-diff-add">+ const draft = useSavedDraft()</span>
      <span className="lp-diff-line lp-diff-add">+ restoreOnOpen(draft)</span>
      <span className="lp-diff-checks">
        <Check size={13} strokeWidth={3} /> 24 checks passed
      </span>
    </div>
  );
}

const scenes = [
  {
    id: 'tasks',
    label: 'Tasks',
    title: 'See every task at a glance.',
    description:
      'What is running, what needs an answer and what is ready for review, across projects.',
    walkthrough: 'Switch between the board and list, then draft a brief for a new task.',
  },
  {
    id: 'review',
    label: 'Review',
    title: 'Review the patch and its checks.',
    description: 'Read changes beside the task and its checks, then ask for another pass or merge.',
    walkthrough:
      'Open a completed task, inspect its changes, and expand the patch to review the code.',
  },
  {
    id: 'agents',
    label: 'Agents',
    title: 'Pick the right agent for each task.',
    description: 'Use the agent CLIs you already have, with separate work and personal accounts.',
    walkthrough:
      'Explore installed agents, then open account profiles to see the sign-ins available for your projects.',
  },
  {
    id: 'context',
    label: 'Context',
    title: 'Give the next task a head start.',
    description: 'Project guidance, reusable workflows and editable lessons carry into new tasks.',
    walkthrough: 'Open project context, read a saved lesson, and browse reusable workflows.',
  },
  {
    id: 'recurring',
    label: 'Schedules',
    title: 'Put repeat work on repeat.',
    description:
      'Run checks on a schedule or when a branch changes, with a history for every run. Jackalope must be open.',
    walkthrough:
      'Browse two paused sample schedules and open a schedule to inspect its prompt and timing. No tasks are launched.',
  },
];

const terminalLines = [
  ['lp-term-prompt', '~/storefront $ jackalope'],
  ['lp-term-user', '› Add a dark mode toggle to settings'],
  ['lp-term-meta', 'routing · Claude Code · strongest recent UI results'],
  ['', '• Editing src/theme/useTheme.ts and 2 more'],
  ['lp-term-ask', '? Remember the choice per device or per account?'],
];

const bots = [
  { name: 'Reviewer', shape: 'shield', color: '#4c86f0' },
  { name: 'Fixer', shape: 'cat', color: '#f2665c' },
  { name: 'Tester', shape: 'gem', color: '#1fa7bd' },
  { name: 'Polisher', shape: 'heart', color: '#e05297' },
];

const features = [
  {
    icon: BookOpen,
    title: 'Context that carries forward',
    detail: 'Save guidance once. New tasks pick up the relevant instructions and lessons.',
    href: '/features/project-context-for-coding-agents/',
    link: 'Explore project context',
  },
  {
    icon: KeyRound,
    title: 'Work and personal accounts',
    detail: 'Named sign-in profiles per agent, with project defaults and usage by account.',
    href: '/blog/work-and-personal-accounts/',
    link: 'Set up accounts',
  },
  {
    icon: MousePointer2,
    title: 'Browser and computer use',
    detail:
      'Agents browse, screenshot and audit pages. On Windows, they can use an app you select.',
    href: '/knowledge/mcp-and-browser-automation/',
    link: 'Explore agent tools',
  },
  {
    icon: CalendarClock,
    title: 'Recurring tasks',
    detail: 'Schedule chores or watch a branch. Change checks use no model calls.',
    href: '/features/recurring-coding-agent-tasks/',
    link: 'Explore recurring tasks',
  },
];

const trust = [
  {
    icon: Laptop,
    title: 'Runs on your computer',
    detail: 'Native on Windows, macOS and Linux. Repositories and worktrees stay local.',
  },
  {
    icon: KeyRound,
    title: 'Your accounts',
    detail: 'Bring your existing agent sign-ins. Credentials stay on your device.',
  },
  {
    icon: GitMerge,
    title: 'You decide what lands',
    detail: 'Read the diff and checks first. Integration happens when you choose.',
  },
  {
    icon: Code2,
    title: 'Open source',
    detail: 'Apache-2.0 licensed. Read the code, file issues and contribute on GitHub.',
  },
];

export function LandingPage({
  waitlistAction,
  signup,
  dark,
  onPlay,
  faqs,
  platforms,
}: {
  waitlistAction: ReactNode;
  signup: ReactNode;
  dark: boolean;
  onPlay: () => void;
  faqs: string[][];
  platforms: string;
}) {
  const landing = useRef<HTMLElement>(null);
  useEffect(() => {
    // Sections start hidden only once this runs, so prerendered pages stay readable without it.
    const root = landing.current;
    root?.classList.add('lp-js');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.entered = 'true';
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.15 },
    );
    for (const section of root?.querySelectorAll('[data-reveal]') ?? []) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <main id="main" className="lp" ref={landing}>
      <section className="lp-hero" aria-labelledby="hero-title">
        <EchoMark animated={false} className="lp-hero-echo" />
        <div className="lp-width lp-hero-grid">
          <div className="lp-hero-copy">
            <h1 id="hero-title">
              <span>More agents.</span> <span className="lp-accent-text">Less juggling.</span>
            </h1>
            <p className="lp-lede">
              Jackalope is the desktop workspace for running AI coding agents in parallel. Hand
              tasks to Codex, Claude Code, Gemini CLI and more. Each works in its own Git worktree,
              and you review every change before it lands.
            </p>
            <div className="lp-actions">
              {waitlistAction}
              <a className="button lp-button-secondary" href="/download/">
                <ArrowDownToLine size={16} /> Download
              </a>
            </div>
            <ul className="lp-meta">
              <li>
                <Monitor size={16} aria-hidden="true" />
                {platforms.replace(', ', ' · ').replace(' and ', ' · ')}
              </li>
              <li>
                <a href={GITHUB_URL}>
                  <GitHubIcon size={16} />
                  Open source · Apache-2.0
                </a>
              </li>
            </ul>
            <p className="lp-fineprint">Sign in once your waitlist spot is approved.</p>
          </div>
          <div className="lp-hero-visual">
            <ParallelVisual />
          </div>
        </div>
      </section>

      <section className="lp-agents" aria-labelledby="agents-title">
        <div className="lp-width">
          <h2 id="agents-title">Works with the coding agents you already use</h2>
          <ul>
            {agents.map((agent) => (
              <li key={agent.id}>
                <AgentMark id={agent.id} />
                {agent.name}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-section lp-tour" aria-labelledby="tour-title" data-reveal="">
        <div className="lp-width">
          <div className="lp-heading lp-heading-center">
            <h2 id="tour-title">
              One workspace for <span className="lp-accent-text">every agent.</span>
            </h2>
            <p>
              Stop juggling terminal tabs. Every task keeps its brief, agent, account, worktree and
              result together, so you can see what needs you at a glance.
            </p>
          </div>
          <button type="button" className="lp-film" onClick={onPlay}>
            <img src={tour.poster} width="1920" height="1080" loading="lazy" alt="" />
            <span className="lp-film-play">
              <Play size={18} fill="currentColor" />
              Watch the {tour.durationSeconds}-second tour
            </span>
          </button>
        </div>
      </section>

      <section
        className="lp-section lp-how"
        id="how-it-works"
        aria-labelledby="how-title"
        data-reveal=""
      >
        <div className="lp-width">
          <div className="lp-heading">
            <h2 id="how-title">
              Run coding agents in parallel.{' '}
              <span className="lp-accent-text">Stay in control.</span>
            </h2>
          </div>
          <ol className="lp-steps">
            {steps.map((step, index) => (
              <li key={step.title} style={{ '--i': index } as CSSProperties}>
                <StepArt index={index} />
                <span className="lp-step-number">0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lp-section lp-inside" id="inside" aria-labelledby="inside-title">
        <div className="lp-width">
          <div className="lp-heading lp-heading-center">
            <h2 id="inside-title">
              See it <span className="lp-accent-text">in motion.</span>
            </h2>
          </div>
          <Tabs.Root defaultValue="tasks" className="lp-explorer">
            <Tabs.List aria-label="Explore the workspace" className="lp-explorer-tabs">
              {scenes.map((scene) => (
                <Tabs.Trigger key={scene.id} value={scene.id}>
                  {scene.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            {scenes.map((scene) => (
              <Tabs.Content value={scene.id} key={scene.id} className="lp-explorer-panel">
                <div className="lp-explorer-caption">
                  <h3>{scene.title}</h3>
                  <p>{scene.description}</p>
                </div>
                <WorkspaceClip key={`${scene.id}-${dark}`} scene={scene} dark={dark} />
              </Tabs.Content>
            ))}
          </Tabs.Root>
        </div>
      </section>

      <section
        className="lp-section lp-features"
        id="features"
        aria-labelledby="features-title"
        data-reveal=""
      >
        <div className="lp-width">
          <div className="lp-heading">
            <h2 id="features-title">
              Everything around <span className="lp-accent-text">the agents.</span>
            </h2>
          </div>
          <div className="lp-bento">
            <a
              className="lp-tile lp-tile-wide lp-tile-terminal"
              href="/knowledge/terminal-command/"
            >
              <div className="lp-terminal" aria-hidden="true">
                {terminalLines.map(([className, text], index) => (
                  <span key={text} className={className} style={{ '--i': index } as CSSProperties}>
                    {text}
                  </span>
                ))}
              </div>
              <h3>Prefer the terminal? Just say what you need.</h3>
              <p>
                Type <code>jackalope</code> in any repository. It routes the conversation to an
                agent, shows what it is doing and asks when it needs you.
              </p>
              <span className="lp-tile-link">
                Meet the command <ArrowRight size={15} />
              </span>
            </a>
            <a className="lp-tile lp-tile-wide lp-tile-bots" href="/knowledge/bots/">
              <ul className="lp-bots" aria-hidden="true">
                {bots.map((bot, index) => (
                  <li
                    key={bot.name}
                    style={{ '--agent-color': bot.color, '--i': index } as CSSProperties}
                  >
                    <span>
                      <AgentCharacter provider={bot.shape} />
                    </span>
                    {bot.name}
                  </li>
                ))}
              </ul>
              <h3>Bots that know their job.</h3>
              <p>
                Give a bot a role, an agent and the tools it may use. Ask it anything, or let it run
                on a schedule.
              </p>
              <span className="lp-tile-link">
                Meet the bots <ArrowRight size={15} />
              </span>
            </a>
            {features.map(({ icon: Icon, title, detail, href, link }) => (
              <a className="lp-tile" href={href} key={title}>
                <span className="lp-tile-icon">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <h3>{title}</h3>
                <p>{detail}</p>
                <span className="lp-tile-link">
                  {link} <ArrowRight size={15} />
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-trust" aria-labelledby="trust-title" data-reveal="">
        <div className="lp-width lp-trust-grid">
          <div>
            <h2 id="trust-title">
              Your machine. <span className="lp-accent-text">Your call.</span>
            </h2>
            <p>
              Jackalope runs the agents you already use, on your own computer. It organizes the
              work; you decide what lands. Agents still send code to their providers under your
              account settings.
            </p>
          </div>
          <ul>
            {trust.map(({ icon: Icon, title, detail }) => (
              <li key={title}>
                <Icon size={20} aria-hidden="true" />
                <strong>{title}</strong>
                <span>{detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-section lp-faq" id="questions" aria-labelledby="questions-title">
        <div className="lp-width lp-faq-grid">
          <div className="lp-heading">
            <h2 id="questions-title">Questions</h2>
            <p>
              More in the <a href="/knowledge/">knowledgebase</a>, or{' '}
              <a href="/compare/">compare workflows</a>.
            </p>
          </div>
          <div className="lp-faq-list">
            {faqs.map(([question, answer, id]) => (
              <Disclosure key={question} id={id}>
                <DisclosureSummary>{question}</DisclosureSummary>
                <p>{answer}</p>
              </Disclosure>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-final" id="download" aria-labelledby="final-title">
        <div className="lp-width lp-final-card">
          <EchoMark animated={false} className="lp-final-echo" />
          <div className="lp-final-grid">
            <div>
              <h2 id="final-title">Make room for more agents.</h2>
              <p>
                Join the waitlist and verify your email. We are approving new members quickly, and
                you will get an email the moment you are in.
              </p>
              <ol className="lp-final-steps">
                <li>Join the waitlist</li>
                <li>Get approved by email</li>
                <li>Download and sign in</li>
              </ol>
            </div>
            <div className="lp-final-form" id="newsletter">
              {signup}
              <a className="lp-final-download" href="/download/">
                <ArrowDownToLine size={16} />
                <span className="lp-final-download-label">
                  Already approved? <strong>Download for {platforms}</strong>
                </span>
                <ArrowRight size={15} />
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
