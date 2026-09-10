import { EchoMark, EchoWordmark } from '@jackalope/brand/echo';
import { PRESET_THEMES } from '@jackalope/brand/theme';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  GitBranch,
  GitMerge,
  Moon,
  Play,
  Plus,
  ScanSearch,
  Sun,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { AgentSupport } from './AgentSupport';
import { BrandMark } from './BrandMark';
import type { EditorialCover } from './blog-types';
import { ConnectedWorkspace } from './ConnectedWorkspace';
import { tour } from './content';
import { EditorialArt } from './EditorialArt';
import { WorkspaceClip } from './WorkspaceClip';

function HeroMark() {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (root.current) observer.observe(root.current.closest('.landing-hero') ?? root.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} className="echo-art" aria-hidden="true">
      <EchoMark animated={visible} />
    </div>
  );
}

const scenes = [
  {
    id: 'tasks',
    label: 'Tasks & ideas',
    title: 'Track tasks across your projects.',
    description:
      'Capture a thought. Start a task in a local project. See what is running, what needs an answer, and what is ready for review.',
    walkthrough: 'Switch between the board and list, then draft a brief for a new task.',
  },
  {
    id: 'review',
    label: 'Changes & review',
    title: 'Review the patch and its checks.',
    description:
      'Read the patch alongside the task and its checks. Ask for another iteration, or choose what to integrate into your project.',
    walkthrough:
      'Open a completed task, inspect its changes, and expand the patch to review the code.',
  },
  {
    id: 'agents',
    label: 'Agents & accounts',
    title: 'Choose an agent for each task.',
    description:
      'Use installed Codex, Claude Code, Grok, OpenCode, Kimi Code, and Antigravity CLIs with your existing accounts. Choose the right agent for each task.',
    walkthrough:
      'Explore installed agents, then open account profiles to see the sign-ins available for your projects.',
  },
  {
    id: 'context',
    label: 'Project context',
    title: 'Give the next task a head start.',
    description:
      'Keep project guidance, reusable workflows, and editable lessons together. Inspect the context that carries into new tasks.',
    walkthrough: 'Open project context, read a saved lesson, and browse reusable workflows.',
  },
  {
    id: 'recurring',
    label: 'Recurring tasks',
    title: 'Make time for the work that repeats.',
    description:
      'Schedule regular checks, or watch a local branch for changes. Review each run in its own history while Jackalope is open and your computer is awake.',
    walkthrough:
      'Browse two paused sample schedules and open a schedule to inspect its prompt and timing. No tasks are launched.',
  },
];
const examples = [
  {
    id: 'feature',
    label: 'Build a feature',
    index: '01',
    prompt: 'Add keyboard search and polish the settings.',
    tasks: ['Build keyboard search', 'Polish the settings'],
    agents: ['Codex', 'Claude Code'],
    context: 'Project instructions + selected tools',
    file: 'Search.tsx',
    diff: '+ onKeyDown={navigate}\n+ onClose={returnFocus}',
  },
  {
    id: 'bug',
    label: 'Find a stubborn bug',
    index: '02',
    prompt: 'Find why drafts disappear. Check for related regressions.',
    tasks: ['Investigate lost drafts', 'Check draft recovery'],
    agents: ['Claude Code', 'Codex'],
    context: 'Bug report + project lessons',
    file: 'TaskComposer.tsx',
    diff: '+ const draft = useSavedDraft()\n+ restoreOnOpen(draft)',
  },
  {
    id: 'idea',
    label: 'Explore a new direction',
    index: '03',
    prompt: 'Try a simpler navigation and a new settings layout.',
    tasks: ['Explore navigation', 'Rethink settings'],
    agents: ['OpenCode', 'Grok'],
    context: 'Design brief + project instructions',
    diff: '+ <ProjectNavigation />\n+ <QuickActions />',
  },
];

function UseCaseVisual({ item }: { item: (typeof examples)[number] }) {
  if (item.id === 'feature') {
    return (
      <div className="case-stage case-stage-feature">
        <div className="case-copy">
          <p>“{item.prompt}”</p>
          <span>{item.context}</span>
        </div>
        <div className="feature-art">
          <svg viewBox="0 0 720 360" preserveAspectRatio="none" aria-hidden="true">
            <path
              className="route route-orange"
              pathLength="1"
              d="M0 76 H170 C240 76 220 180 310 180 H720"
            />
            <path
              className="route route-indigo"
              pathLength="1"
              d="M0 282 H150 C235 282 232 190 310 190 H720"
            />
          </svg>
          <div className="agent-node agent-node-one">
            <GitBranch size={18} />
            <span>
              <b>{item.tasks[0]}</b>
              <small>{item.agents[0]} · Worktree 01</small>
            </span>
          </div>
          <div className="agent-node agent-node-two">
            <GitBranch size={18} />
            <span>
              <b>{item.tasks[1]}</b>
              <small>{item.agents[1]} · Worktree 02</small>
            </span>
          </div>
          <div className="merge-node">
            <GitMerge size={22} />
          </div>
          <div className="result-poster">
            <span>{item.file}</span>
            <pre>{item.diff}</pre>
            <strong>
              <Check size={15} /> Combined review
            </strong>
          </div>
        </div>
      </div>
    );
  }

  if (item.id === 'bug') {
    return (
      <div className="case-stage case-stage-bug">
        <div className="case-copy">
          <p>“{item.prompt}”</p>
          <span>{item.context}</span>
        </div>
        <div className="bug-art">
          <div className="trace-window">
            <span className="scan-line" aria-hidden="true" />
            <div className="trace-heading">
              <ScanSearch size={20} />
              <span>Draft lifecycle</span>
            </div>
            <div className="trace-code">
              <span>01&nbsp;&nbsp;compose draft</span>
              <span>02&nbsp;&nbsp;persist locally</span>
              <span className="trace-hit">03&nbsp;&nbsp;close composer</span>
              <span>04&nbsp;&nbsp;restore on open</span>
            </div>
            <span className="trace-target" aria-hidden="true" />
          </div>
          <div className="finding-card">
            <small>CAUSE ISOLATED</small>
            <b>{item.tasks[0]}</b>
            <span>{item.file}</span>
            <pre>{item.diff}</pre>
            <strong>
              <Check size={14} /> {item.tasks[1]}
            </strong>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="case-stage case-stage-idea">
      <div className="case-copy">
        <p>“{item.prompt}”</p>
        <span>{item.context}</span>
      </div>
      <div className="idea-art">
        <div className="idea-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="layout-study layout-study-one">
          <small>{item.agents[0]} / A</small>
          <b>{item.tasks[0]}</b>
          <div className="layout-frame layout-frame-sidebar">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="layout-study layout-study-two">
          <small>{item.agents[1]} / B</small>
          <b>{item.tasks[1]}</b>
          <div className="layout-frame layout-frame-dock">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}

const features = [
  {
    cover: {
      kind: 'map',
      tone: 'indigo',
      label: 'Follow the connections',
    } satisfies EditorialCover,
    title: 'See how the code connects.',
    description: 'Explore your project and trace the reach of a change.',
    detail:
      'Browse the interactive codebase map, follow resolved file dependencies, and inspect related files during review. Use the map to choose what to check next; it does not replace tests.',
    href: '/features/project-context-for-coding-agents/#section-2',
    link: 'Explore the codebase map',
  },
  {
    cover: { kind: 'parallel', tone: 'mint', label: 'Space to explore' } satisfies EditorialCover,
    title: 'Give every agent room to work.',
    description: 'Run independent tasks side by side in separate Git worktrees.',
    detail:
      'Assign Codex, Claude Code, Grok, OpenCode, Kimi Code, or Antigravity to each task. Set dependencies when one change needs another, and follow progress without checking a pile of terminals.',
    href: '/parallel-coding-agents/',
    link: 'Explore parallel work',
  },
  {
    cover: {
      kind: 'context',
      tone: 'honey',
      label: 'Context that carries forward',
    } satisfies EditorialCover,
    title: 'Brief once. Build on it.',
    description: 'Carry project instructions and lessons into the next task.',
    detail:
      'Save project guidance once. New tasks match relevant guidelines to your prompt and inherit project defaults. Adjust the selection when needed and inspect what the agent received.',
    href: '/features/project-context-for-coding-agents/',
    link: 'Explore project context',
  },
  {
    cover: {
      kind: 'review',
      tone: 'indigo',
      label: 'The decision stays yours',
    } satisfies EditorialCover,
    title: 'Your project. Your final say.',
    description: 'Review the changes and checks together before you merge.',
    detail:
      'Read each result beside its original brief. Combine related patches for review, ask for another pass, and decide what enters your project. Checks stay tied to the code they tested.',
    href: '/guides/review-ai-generated-code/',
    link: 'Explore code review',
  },
  {
    cover: { kind: 'accounts', tone: 'rose', label: 'Separate accounts' } satisfies EditorialCover,
    title: 'Work and personal, sorted.',
    description: 'Use the right agent account for every project.',
    detail:
      'Create named sign-in profiles and choose project defaults. Track reported task usage by project and account. Profiles organize sign-ins; your provider policies and local file permissions still apply.',
    href: '/blog/work-and-personal-accounts/',
    link: 'Explore accounts and usage',
  },
  {
    cover: { kind: 'browser', tone: 'mint', label: 'Tools for the task' } satisfies EditorialCover,
    title: 'Computer use & agent browser.',
    description: 'Let agents browse the web and use a Windows app you approve.',
    detail:
      'Built-in agent-browser lets agents navigate pages, fill forms, capture screenshots, and check accessibility in a separate browser session for each task. On Windows, choose an app window for clicks, typing, and scrolling. A visible status bar lets you pause or cancel control; moving your mouse or typing pauses it, and Escape cancels access. Add project tools through MCP connections.',
    href: '/knowledge/mcp-and-browser-automation/',
    link: 'Explore browser and computer use',
  },
  {
    cover: {
      kind: 'schedule',
      tone: 'honey',
      label: 'Make room for what is next',
    } satisfies EditorialCover,
    title: 'Put repeat work on repeat.',
    description: 'Schedule checks and chores, with a result for every run.',
    detail:
      'Run on a schedule, or check a local branch and launch only when committed code changes. Change checks use no model calls. Review each run in its own history; Jackalope must be open and your computer awake.',
    href: '/features/recurring-coding-agent-tasks/',
    link: 'Explore recurring tasks',
  },
];

function Workbench() {
  return (
    <section
      className="landing-section landing-width workflow-story"
      id="workflow"
      aria-labelledby="workflow-title"
      data-reveal=""
    >
      <div className="section-lead">
        <h2 id="workflow-title">
          One idea.
          <br />
          <span>More ways forward.</span>
        </h2>
        <p>
          Build the feature. Chase the bug. Explore another direction. Give independent tasks their
          own agents and worktrees, then decide what comes together.
        </p>
      </div>
      <Tabs.Root defaultValue="feature" className="workbench">
        <Tabs.List aria-label="Explore a use case" className="case-tabs">
          {examples.map((item) => (
            <Tabs.Trigger key={item.id} value={item.id}>
              <span className="case-tab-index" aria-hidden="true">
                {item.index}
              </span>
              <strong className="case-tab-title">{item.label}</strong>
              <ArrowRight size={16} />
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {examples.map((item) => (
          <Tabs.Content key={item.id} value={item.id}>
            <UseCaseVisual item={item} />
            <p className="example-note">Illustrated workflow</p>
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </section>
  );
}

export function LandingPage({
  action,
  downloadAction,
  dark,
  setDark,
  palette,
  setPalette,
  onPlay,
  faqs,
  available,
  releaseVersion,
}: {
  action: ReactNode;
  downloadAction: ReactNode;
  dark: boolean;
  setDark: (value: boolean) => void;
  palette: number;
  setPalette: (value: number) => void;
  onPlay: () => void;
  faqs: string[][];
  available: boolean;
  releaseVersion?: string;
}) {
  const landing = useRef<HTMLElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.entered = 'true';
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12 },
    );
    for (const section of landing.current?.querySelectorAll('[data-reveal]') ?? []) {
      observer.observe(section);
    }
    return () => observer.disconnect();
  }, []);
  return (
    <main id="main" className="landing landing-story" ref={landing}>
      <section className="landing-hero" aria-labelledby="hero-title">
        <HeroMark />
        <div className="landing-width landing-hero-grid">
          <div className="hero-copy">
            <div className="hero-poster">
              <h1 id="hero-title">
                <span>More agents.</span> <span>Less juggling.</span>
              </h1>
            </div>
            <p className="hero-description">
              Run <strong>Codex, Claude Code, Grok, OpenCode, Kimi Code, and Antigravity</strong>{' '}
              side by side. One desktop workspace for your projects, parallel tasks, and code
              review.
            </p>
            <div className="hero-conversion">
              <div className="hero-actions">
                {action}
                <button type="button" onClick={onPlay} className="landing-text-button">
                  <Play size={15} fill="currentColor" />
                  Watch the {tour.durationSeconds}-second tour
                </button>
              </div>
              {available && (
                <span className="availability">
                  Windows x64 · {releaseVersion ?? 'Available now'}
                </span>
              )}
            </div>
          </div>
          <div className="hero-visual">
            <button
              type="button"
              className="hero-window"
              onClick={onPlay}
              aria-label={`Play the ${tour.durationSeconds}-second Jackalope app tour`}
            >
              <span className="hero-window-meta">
                <span>More room to build.</span>
              </span>
              <img
                src={tour.poster}
                width="1920"
                height="1080"
                alt="Jackalope product tour featuring the updated task workspace"
              />
              <span className="hero-film-cue">
                <span>
                  <Play size={18} fill="currentColor" /> See the workspace in action
                </span>
                <span>
                  {tour.durationSeconds} sec <ArrowUpRight size={16} />
                </span>
              </span>
            </button>
          </div>
        </div>
      </section>

      <section
        className="feature-section"
        id="features"
        aria-labelledby="features-title"
        data-reveal=""
      >
        <div className="landing-width">
          <div className="feature-heading">
            <h2 id="features-title">
              A lot going on.
              <br />
              All in one place.
            </h2>
          </div>
          <div className="feature-grid">
            {features.map((feature) => (
              <article className="feature-card" key={feature.title}>
                <EditorialArt {...feature.cover} />
                <div className="feature-card-copy">
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                  <details className="feature-card-details">
                    <summary aria-label={`How it works: ${feature.title}`}>
                      How it works <Plus size={16} aria-hidden="true" />
                    </summary>
                    <p>{feature.detail}</p>
                  </details>
                  <a className="feature-card-link" href={feature.href}>
                    {feature.link} <ArrowUpRight size={17} aria-hidden="true" />
                  </a>
                </div>
              </article>
            ))}
          </div>
          <div className="feature-next">
            {action}
            <a href="#workflow">
              See how it comes together <ArrowDown size={17} />
            </a>
          </div>
        </div>
      </section>

      <ConnectedWorkspace />

      <Workbench />

      <section
        className="workspace-section section-echo"
        id="inside"
        aria-labelledby="inside-title"
        data-reveal=""
      >
        <EchoMark animated={false} className="section-echo-mark" />
        <div className="landing-width">
          <div className="workspace-heading">
            <h2 id="inside-title">Meet your new workspace.</h2>
          </div>
          <Tabs.Root defaultValue="tasks" className="product-explorer">
            <Tabs.List aria-label="Explore the workspace" className="product-tabs">
              {scenes.map((scene) => (
                <Tabs.Trigger key={scene.id} value={scene.id}>
                  {scene.label}
                  <ArrowRight size={17} />
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            {scenes.map((scene) => (
              <Tabs.Content value={scene.id} key={scene.id}>
                <div className="product-caption">
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
        className="atmosphere-section section-echo"
        id="atmosphere"
        aria-labelledby="atmosphere-title"
        data-reveal=""
      >
        <EchoMark animated={false} className="section-echo-mark" />
        <div className="landing-width atmosphere-layout">
          <div>
            <h2 id="atmosphere-title">
              Make room.
              <br />
              Make it yours.
            </h2>
            <p>
              Try a palette. The whole page comes along.
              <br />
              Pick your kind of light or dark.
            </p>
            <fieldset className="landing-palettes" aria-label="Try a color palette">
              {PRESET_THEMES.slice(0, 4).map((theme, index) => (
                <button
                  key={theme.id}
                  type="button"
                  style={{ '--swatch': theme.accentHex } as CSSProperties}
                  aria-label={theme.name}
                  aria-pressed={palette === index}
                  onClick={() => setPalette(index)}
                >
                  {palette === index && <Check size={18} />}
                </button>
              ))}
            </fieldset>
            <span className="palette-name">{PRESET_THEMES[palette].name}</span>
            <fieldset className="landing-appearance" aria-label="Try an appearance">
              <button type="button" aria-pressed={!dark} onClick={() => setDark(false)}>
                <Sun size={16} />
                Light
              </button>
              <button type="button" aria-pressed={dark} onClick={() => setDark(true)}>
                <Moon size={16} />
                Dark
              </button>
            </fieldset>
          </div>
          <div className="atmosphere-window" aria-hidden="true">
            <div>
              <BrandMark />
              <span>Your workspace</span>
              <span>− &nbsp; □ &nbsp; ×</span>
            </div>
            <div className="atmosphere-canvas">
              <BrandMark />
              <span>Tasks</span>
              <span className="atmosphere-sample-action">
                New task <Plus size={16} />
              </span>
            </div>
          </div>
        </div>
      </section>

      <section
        className="landing-width landing-questions"
        id="questions"
        aria-labelledby="questions-title"
      >
        <div>
          <h2 id="questions-title">Questions</h2>
        </div>
        <div className="faq-list">
          {faqs.map(([question, answer, id]) => (
            <details key={question} id={id}>
              <summary>
                {question}
                <Plus size={18} />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>
      <div className="landing-width support-disclosure">
        <p className="landing-further">
          <a href="/compare/">
            Compare workspaces <ArrowUpRight size={16} />
          </a>
          <a href="/roadmap/">
            Explore the roadmap <ArrowUpRight size={16} />
          </a>
        </p>
        <details>
          <summary>
            Agent support & compatibility
            <Plus size={20} />
          </summary>
          <AgentSupport />
        </details>
      </div>

      <section className="landing-finale" id="download" aria-labelledby="download-title">
        <div className="landing-width">
          <div className="finale-top" id="newsletter">
            <div>
              <h2 id="download-title">{available ? 'Download Jackalope.' : 'Get early access.'}</h2>
              <p>
                {available
                  ? 'Install Jackalope for Windows and connect your coding agents.'
                  : 'We’ll email you when access opens.'}
              </p>
              {downloadAction}
              {available && (
                <p className="availability">Windows x64 · {releaseVersion ?? 'Available now'}</p>
              )}
            </div>
            <BrandMark className="finale-mark" />
          </div>
          <EchoWordmark className="finale-wordmark" />
        </div>
      </section>
    </main>
  );
}
