import { EchoMark } from '@jackalope/brand/echo';
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
  Sparkles,
  Sun,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { AgentSupport } from './AgentSupport';
import { BrandMark } from './BrandMark';
import { ConnectedWorkspace } from './ConnectedWorkspace';

function HeroMark() {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (root.current) observer.observe(root.current);
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
    detail: 'Tasks & ideas',
    image: 'tasks',
  },
  {
    id: 'review',
    label: 'Changes & review',
    title: 'Review the patch and its checks.',
    description:
      'Read the patch alongside the task and its checks. Ask for another iteration, or choose what to integrate into your project.',
    detail: 'Changes & review',
    image: 'review',
  },
  {
    id: 'agents',
    label: 'Agents & accounts',
    title: 'Choose an agent for each task.',
    description:
      'Use installed Codex, Claude Code, Grok, and OpenCode CLIs with your existing accounts. Choose the right agent for each task.',
    detail: 'Agents & accounts',
    image: 'agents',
  },
];
const examples = [
  {
    id: 'feature',
    label: 'Build a feature',
    index: '01',
    kicker: 'Ship a feature',
    prompt: 'Add keyboard search and polish the settings.',
    tasks: ['Build keyboard search', 'Polish the settings'],
    agents: ['Codex', 'Claude Code'],
    outcome: 'Review both changes before bringing them together.',
    context: 'Project instructions + selected tools',
    file: 'Search.tsx',
    diff: '+ onKeyDown={navigate}\n+ onClose={returnFocus}',
  },
  {
    id: 'bug',
    label: 'Find a stubborn bug',
    index: '02',
    kicker: 'Trace a regression',
    prompt: 'Find why drafts disappear. Check for related regressions.',
    tasks: ['Investigate lost drafts', 'Check draft recovery'],
    agents: ['Claude Code', 'Codex'],
    outcome: 'Inspect the fix and the regression checks together.',
    context: 'Bug report + project lessons',
    file: 'TaskComposer.tsx',
    diff: '+ const draft = useSavedDraft()\n+ restoreOnOpen(draft)',
  },
  {
    id: 'idea',
    label: 'Explore a new direction',
    index: '03',
    kicker: 'Explore two directions',
    prompt: 'Try a simpler navigation and a new settings layout.',
    tasks: ['Explore navigation', 'Rethink settings'],
    agents: ['OpenCode', 'Grok'],
    outcome: 'Keep what works. Iterate on the rest.',
    context: 'Design brief + project instructions',
    file: 'Navigation.tsx',
    diff: '+ <ProjectNavigation />\n+ <QuickActions />',
  },
];

function UseCaseVisual({ item }: { item: (typeof examples)[number] }) {
  if (item.id === 'feature') {
    return (
      <div className="case-stage case-stage-feature">
        <div className="case-copy">
          <small>{item.kicker}</small>
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
        <p className="case-outcome">{item.outcome}</p>
      </div>
    );
  }

  if (item.id === 'bug') {
    return (
      <div className="case-stage case-stage-bug">
        <div className="case-copy">
          <small>{item.kicker}</small>
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
        <p className="case-outcome">{item.outcome}</p>
      </div>
    );
  }

  return (
    <div className="case-stage case-stage-idea">
      <div className="case-copy">
        <small>{item.kicker}</small>
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
        <div className="idea-verdict">
          <Sparkles size={17} />
          <span>
            <small>COMPARE</small>
            <b>{item.file}</b>
          </span>
        </div>
      </div>
      <p className="case-outcome">{item.outcome}</p>
    </div>
  );
}

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
            <p className="example-note">
              Illustrated workflow · No agents are running in this demo
            </p>
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
                <span>Your agents.</span> <span>Side by side.</span> <span>Your final say.</span>
              </h1>
            </div>
            <p className="hero-description">
              The desktop workspace for <strong>Codex, Claude Code, Grok, and OpenCode</strong>.
              Bring your work and personal accounts. Run tasks in parallel with shared tools,
              project context, and cross-agent coordination.
            </p>
            <p className="hero-launch">One workspace. Planned for macOS, Windows, and Linux.</p>
            <div className="hero-conversion">
              <div className="hero-actions">
                {action}
                <button type="button" onClick={onPlay} className="landing-text-button">
                  <Play size={15} fill="currentColor" />
                  Watch the app
                </button>
              </div>
              <span className="availability">
                {available
                  ? `Windows x64 · ${releaseVersion ?? 'Available now'}`
                  : 'In development · No payment to join'}
              </span>
            </div>
          </div>
          <div className="hero-visual">
            <button
              type="button"
              className="hero-window"
              onClick={onPlay}
              aria-label="Play the 32-second Jackalope app tour"
            >
              <span className="hero-window-meta">
                <span>JACKALOPE / TASKS</span>
                <span>ATLAS SAMPLE PROJECT</span>
              </span>
              <img
                src={`/media/tasks${dark ? '' : '-light'}.png`}
                width="1440"
                height="840"
                alt="Jackalope task board with separate project work ready, running, and under review"
              />
              <span className="hero-film-cue">
                <span>
                  <Play size={18} fill="currentColor" /> See the workspace in action
                </span>
                <span>
                  32 sec <ArrowUpRight size={16} />
                </span>
              </span>
            </button>
            <div className="hero-review-note">
              <GitMerge size={21} />
              <span>
                <strong>Separate worktrees. One clear review.</strong>
                <small>You choose what makes it into your project.</small>
              </span>
            </div>
          </div>
          <div className="agent-line">
            <p>
              Codex <i>/</i> Claude Code <i>/</i> Grok <i>/</i> OpenCode
            </p>
            <a href="#inside" aria-label="Explore inside the app">
              <ArrowDown size={20} />
            </a>
          </div>
        </div>
      </section>

      <section className="landing-width journey-rail" aria-label="From idea to reviewed work">
        {[
          [
            'Brief with context.',
            'Your project knowledge and tools, ready for the next task.',
            '#features',
          ],
          ['Work in parallel.', 'Independent agents, each with room to work.', '#workflow'],
          ['Review together.', 'The patch, checks, and final decision in one place.', '#inside'],
        ].map(([label, description, href]) => (
          <a key={label} href={href}>
            <strong>
              {label}
              <ArrowRight size={20} />
            </strong>
            <span>{description}</span>
          </a>
        ))}
      </section>

      <ConnectedWorkspace />

      <Workbench />

      <section
        className="workspace-section"
        id="inside"
        aria-labelledby="inside-title"
        data-reveal=""
      >
        <div className="landing-width">
          <div className="workspace-heading">
            <h2 id="inside-title">
              Less window juggling.
              <br />
              More forward motion.
            </h2>
            <p>
              Your tasks, agents, and changes share one workspace.
              <br />
              Take a look inside the actual app.
            </p>
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
                <button
                  type="button"
                  className="product-capture"
                  aria-label={`Play the Jackalope product walkthrough from ${scene.detail}`}
                  onClick={onPlay}
                >
                  <img
                    src={`/media/${scene.image}${dark ? '' : '-light'}.png`}
                    width="1440"
                    height="840"
                    loading="lazy"
                    alt={`Actual Jackalope ${scene.detail.toLowerCase()} interface with Atlas sample project data`}
                  />
                  <span className="capture-play">
                    <Play size={15} fill="currentColor" />
                    See it in motion
                  </span>
                </button>
                <p className="capture-caption">
                  <span>{scene.detail}</span>
                  <span>Actual app · Atlas sample project</span>
                </p>
              </Tabs.Content>
            ))}
          </Tabs.Root>
        </div>
      </section>

      <section className="landing-width early-access-story" aria-labelledby="early-access-title">
        <div>
          <h2 id="early-access-title">Build the next chapter with us.</h2>
          <p>
            We’re shaping a workspace for people who already build with coding agents. Join early,
            tell us what gets in your way, and help decide what comes next.
          </p>
          <a href="/#newsletter" className="button button-primary">
            Join the waitlist <ArrowRight size={17} />
          </a>
        </div>
        <ol>
          <li>
            <strong>Tell us what you use.</strong>
            <p>
              Email first. Then optional platform, agent, and workflow preferences to guide our
              plans.
            </p>
          </li>
          <li>
            <strong>Get an invitation.</strong>
            <p>
              We’ll email when your access is ready. A direct invitation skips the waitlist after
              email verification.
            </p>
          </li>
          <li>
            <strong>Bring your people.</strong>
            <p>
              Once approved, you get five Instant Access Passes to share. Each person who joins can
              invite five more.
            </p>
          </li>
        </ol>
      </section>
      <section className="landing-width comparison-teaser">
        <h2>Find your way to work.</h2>
        <p>
          Comparing agent workspaces? Start with the workflow you need: local review, shared
          sessions, remote hosts, or a complete editor.
        </p>
        <a href="/compare/">
          Compare Jackalope and other workspaces <ArrowRight size={17} />
        </a>
      </section>

      <section
        className="landing-section landing-width capabilities"
        id="features"
        aria-labelledby="features-title"
        data-reveal=""
      >
        <div className="section-lead">
          <h2 id="features-title">Keep context across tasks.</h2>
        </div>
        <div className="capability-row">
          <div className="capability-art context-stack" aria-hidden="true">
            <span>INSTRUCTIONS</span>
            <span>LESSONS</span>
            <span>WORKFLOWS</span>
            <b>
              Next task <ArrowRight size={25} />
            </b>
          </div>
          <div>
            <h3>Project knowledge & tools</h3>
            <p>
              Save project instructions, lessons, and reusable workflows. Manage connections
              centrally, then choose the knowledge and tools each task needs. Inspect the context an
              agent received.
            </p>
            <small>Connected tool support varies by agent.</small>
          </div>
        </div>
        <div className="capability-row">
          <div className="capability-art account-ledger" aria-hidden="true">
            <div>
              <span>CLIENT WORK</span>
              <b>Studio / Codex</b>
            </div>
            <div>
              <span>SIDE PROJECT</span>
              <b>Personal / Claude Code</b>
            </div>
          </div>
          <div>
            <h3>Accounts & usage</h3>
            <p>
              Choose agent accounts and allowed runners per project. Follow tasks and reported usage
              across client work and personal projects, with the right setup attached to each.
            </p>
            <a href="/blog/work-and-personal-accounts/" className="landing-link">
              How account profiles work <ArrowRight size={16} />
            </a>
          </div>
        </div>
        <div className="capability-row">
          <div className="capability-art calendar-art" aria-hidden="true">
            <div>
              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((day, index) => (
                <span key={day} className={index === 2 ? 'calendar-selected' : ''}>
                  {day[0]}
                </span>
              ))}
            </div>
            <span>Weekly schedule</span>
          </div>
          <div>
            <h3>Recurring tasks</h3>
            <p>
              Schedule recurring tasks with their project context intact. Each run keeps its own
              result and history, ready for you to inspect.
            </p>
            <small>Runs while Jackalope and your computer are awake.</small>
          </div>
        </div>
      </section>

      <section
        className="atmosphere-section"
        id="atmosphere"
        aria-labelledby="atmosphere-title"
        data-reveal=""
      >
        <div className="landing-width atmosphere-layout">
          <div>
            <h2 id="atmosphere-title">
              Serious work.
              <br />
              Your kind of space.
            </h2>
            <p>
              Try a palette. The whole page comes along.
              <br />
              Preview the desktop themes in light or dark.
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
          <div className="finale-top">
            <div>
              <h2 id="download-title">{available ? 'Download Jackalope.' : 'Get early access.'}</h2>
              <p>
                {available
                  ? 'Install Jackalope for Windows and connect your coding agents.'
                  : 'Join the waitlist. We’ll email you when access opens.'}
              </p>
              {downloadAction}
              <p className="availability">
                {available
                  ? `Windows x64 · ${releaseVersion ?? 'Available now'}`
                  : 'Coming soon · No payment to join'}
              </p>
            </div>
            <BrandMark className="finale-mark" />
          </div>
          <div className="finale-wordmark" aria-hidden="true">
            jackalope<span>↗</span>
          </div>
        </div>
      </section>
    </main>
  );
}
