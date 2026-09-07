import { characterPaths } from '@jackalope/brand/character';
import { PRESET_THEMES } from '@jackalope/brand/theme';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowDown, ArrowRight, Check, GitBranch, Moon, Play, Plus, Sun } from 'lucide-react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { type CSSProperties, type ReactNode, useRef, useState } from 'react';
import { AgentSupport } from './AgentSupport';
import { BrandMark } from './BrandMark';

const head = [
  characterPaths.farEar,
  characterPaths.nearEar,
  characterPaths.antler,
  characterPaths.head,
].join(' ');

function EchoMark() {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: root, offset: ['start start', 'end start'] });
  const spread = useTransform(scrollYProgress, [0, 1], [1, 0.25]);
  return (
    <motion.div
      ref={root}
      className="echo-art"
      style={{ '--spread': reduced ? 1 : spread } as CSSProperties}
    >
      <svg viewBox="0 0 520 470" fill="none" aria-hidden="true">
        <g transform="translate(-58 24) scale(3.3)">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((echo) => (
            <path
              key={echo}
              d={head}
              className="echo-line"
              style={{ '--echo': echo } as CSSProperties}
            />
          ))}
          <path d={head} fill="currentColor" />
        </g>
      </svg>
      <span className="echo-caption">Independent minds. Shared direction.</span>
    </motion.div>
  );
}

const scenes = [
  {
    id: 'tasks',
    label: 'Keep the whole picture',
    title: 'Ideas, active work, and the next decision.',
    description:
      'Capture a thought. Start a task in a local project. See what is running, what needs an answer, and what is ready for review.',
    detail: 'Tasks & ideas',
    image: 'tasks',
  },
  {
    id: 'review',
    label: 'See what actually changed',
    title: 'An answer is only part of the result.',
    description:
      'Read the patch alongside the task and its checks. Ask for another iteration, or choose what to integrate into your project.',
    detail: 'Changes & review',
    image: 'review',
  },
  {
    id: 'agents',
    label: 'Bring your favorite agents',
    title: 'Different agents. A familiar place to work.',
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
    prompt: 'Try a simpler navigation and a new settings layout.',
    tasks: ['Explore navigation', 'Rethink settings'],
    agents: ['OpenCode', 'Grok'],
    outcome: 'Keep what works. Iterate on the rest.',
    context: 'Design brief + project instructions',
    file: 'Navigation.tsx',
    diff: '+ <ProjectNavigation />\n+ <QuickActions />',
  },
];

function Workbench() {
  const [selected, setSelected] = useState(0);
  const example = examples[selected];
  return (
    <section
      className="landing-section landing-width"
      id="workflow"
      aria-labelledby="workflow-title"
    >
      <div className="section-lead">
        <span className="landing-kicker">02 / FROM INTENT TO RESULT</span>
        <h2 id="workflow-title">
          One idea can go
          <br />a few ways at once.
        </h2>
        <p>
          Give independent tasks their own space to run. Keep the context, progress, and review in
          one place.
        </p>
      </div>
      <Tabs.Root
        value={example.id}
        onValueChange={(value) => setSelected(examples.findIndex((item) => item.id === value))}
        className="workbench"
      >
        <Tabs.List aria-label="Explore a use case" className="case-tabs">
          {examples.map((item) => (
            <Tabs.Trigger key={item.id} value={item.id}>
              {item.label}
              <ArrowRight size={16} />
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {examples.map((item) => (
          <Tabs.Content key={item.id} value={item.id}>
            <div className="example-brief">
              <span className="landing-kicker">YOUR BRIEF</span>
              <p>“{item.prompt}”</p>
              <span>{item.context}</span>
            </div>
            <div className="example-flow">
              <div className="example-step">
                <span className="step-label">01 / WORK IN PARALLEL</span>
                <div className="branch-tracks">
                  {item.tasks.map((task, index) => (
                    <div key={task}>
                      <GitBranch size={18} />
                      <span>
                        <b>{task}</b>
                        <small>{item.agents[index]} · Separate worktree</small>
                      </span>
                    </div>
                  ))}
                </div>
                <p>
                  Separate Git worktrees give independent tasks room to move without sharing the
                  same checkout.
                </p>
              </div>
              <ArrowRight className="flow-arrow" size={26} aria-hidden="true" />
              <div className="example-step">
                <span className="step-label">02 / REVIEW THE RESULT</span>
                <div className="example-patch">
                  <span>
                    {item.file}
                    <span>EXAMPLE PATCH</span>
                  </span>
                  <pre>{item.diff}</pre>
                </div>
                <p>{item.outcome} Integration stays an explicit decision.</p>
              </div>
            </div>
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
  return (
    <main id="main" className="landing">
      <section className="landing-hero landing-width" aria-labelledby="hero-title">
        <div className="hero-topline">
          <span className="landing-kicker">JACKALOPE / A DESKTOP WORKSPACE FOR CODING AGENTS</span>
          <span className="hero-edition">BUILT FOR MAKING THINGS</span>
        </div>
        <div className="hero-poster">
          <div className="poster-type">
            <h1 id="hero-title">
              Many agents.
              <br />
              One workspace.
            </h1>
            <p>
              Put your coding agents to work.
              <br />
              Keep the whole thing in view.
            </p>
          </div>
          <EchoMark />
        </div>
        <div className="hero-bottom">
          <p>
            Run tasks in parallel, carry your project context forward, and review what comes back.
            All in a desktop app that feels like yours.
          </p>
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
                : 'Windows first · macOS & Linux planned'}
            </span>
          </div>
        </div>
        <div className="agent-line">
          <span>YOUR AGENTS. YOUR ACCOUNTS.</span>
          <p>
            Codex <i> / </i> Claude Code <i> / </i> Grok <i> / </i> OpenCode
          </p>
          <a href="#inside" aria-label="Explore inside the app">
            <ArrowDown size={20} />
          </a>
        </div>
      </section>

      <section className="workspace-section" id="inside" aria-labelledby="inside-title">
        <div className="landing-width">
          <div className="workspace-heading">
            <span className="landing-kicker">01 / INSIDE JACKALOPE</span>
            <h2 id="inside-title">
              Less window juggling.
              <br />
              More forward motion.
            </h2>
          </div>
          <Tabs.Root defaultValue="tasks" className="product-explorer">
            <Tabs.List aria-label="Explore the workspace" className="product-tabs">
              {scenes.map((scene, index) => (
                <Tabs.Trigger key={scene.id} value={scene.id}>
                  <span>0{index + 1}</span>
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

      <Workbench />

      <section
        className="landing-section landing-width capabilities"
        id="features"
        aria-labelledby="features-title"
      >
        <div className="section-lead">
          <span className="landing-kicker">03 / A WORKSPACE THAT CARRIES THE CONTEXT</span>
          <h2 id="features-title">
            Start the next task.
            <br />
            Keep the head start.
          </h2>
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
            <span className="landing-kicker">PROJECT KNOWLEDGE & TOOLS</span>
            <h3>
              Less explaining yourself.
              <br />
              More building on what works.
            </h3>
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
            <span className="ledger-rule" />
          </div>
          <div>
            <span className="landing-kicker">PROJECTS, ACCOUNTS & USAGE</span>
            <h3>
              Different hats.
              <br />
              Same clear view.
            </h3>
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
                <span key={day[0]} className={index === 2 ? 'calendar-selected' : ''}>
                  {day[0]}
                </span>
              ))}
            </div>
            <span>Same context. A fresh run.</span>
          </div>
          <div>
            <span className="landing-kicker">RECURRING TASKS</span>
            <h3>
              Give repeat work
              <br />a place in the week.
            </h3>
            <p>
              Schedule recurring tasks with their project context intact. Each run keeps its own
              result and history, ready for you to inspect.
            </p>
            <small>Runs while Jackalope and your computer are awake.</small>
          </div>
        </div>
      </section>

      <section className="atmosphere-section" id="atmosphere" aria-labelledby="atmosphere-title">
        <div className="landing-width atmosphere-layout">
          <div>
            <span className="landing-kicker">04 / MAKE YOURSELF AT HOME</span>
            <h2 id="atmosphere-title">
              Serious work.
              <br />
              Personal atmosphere.
            </h2>
            <p>
              The same palettes as the desktop app.
              <br />
              Try one. Feel the whole page change.
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
              <span>— &nbsp; □ &nbsp; ×</span>
            </div>
            <div className="atmosphere-canvas">
              <BrandMark />
              <span>A little more you.</span>
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
          <span className="landing-kicker">A FEW PRACTICAL DETAILS</span>
          <h2 id="questions-title">Good questions.</h2>
          <p>
            Bring your own agents and accounts.
            <br />
            Jackalope gives them a place to work.
          </p>
        </div>
        <div className="faq-list">
          {faqs.map(([question, answer]) => (
            <details key={question}>
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
              <span className="landing-kicker">THE NEXT THING STARTS HERE</span>
              <h2 id="download-title">
                Make something
                <br />
                only you would.
              </h2>
              <p>
                {available
                  ? 'Your Windows workspace is ready.'
                  : 'Get on the list. Be part of what comes next.'}
              </p>
              {downloadAction}
              <p className="availability">
                {available
                  ? `Windows x64 · ${releaseVersion ?? 'Available now'}`
                  : 'Early access · No payment to join'}
                <br />
                macOS & Linux planned
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
