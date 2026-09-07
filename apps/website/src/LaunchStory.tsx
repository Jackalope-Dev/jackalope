import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowDown,
  ArrowRight,
  Check,
  Code2,
  FileCode2,
  GitBranch,
  Layers3,
  Play,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { BrandMark } from './BrandMark';

const chapters = [
  {
    id: 'intent',
    label: 'Your idea',
    title: 'Start with what you want to build.',
    description: 'Choose a project, bring its context, and give your agent a clear outcome.',
  },
  {
    id: 'parallel',
    label: 'Their focus',
    title: 'A little more room. A lot more possibility.',
    description:
      'Assign independent tasks to agents in separate Git worktrees. Keep progress, questions, and dependencies together.',
  },
  {
    id: 'review',
    label: 'Your final say',
    title: 'Everything comes back to you.',
    description:
      'Inspect each result, its patch, and its checks. Ask for another pass or explicitly integrate the work.',
  },
];

export function LaunchHero({
  action,
  releaseNote,
  onPlay,
}: {
  action: ReactNode;
  releaseNote: string;
  onPlay: () => void;
}) {
  const [chapter, setChapter] = useState('parallel');
  return (
    <section className="launch-hero" aria-labelledby="hero-title">
      <div className="page-width launch-opening">
        <div>
          <p className="launch-category">A desktop workspace for your coding agents</p>
          <h1 id="hero-title">
            One idea.
            <br />
            <span>Many possibilities.</span>
          </h1>
        </div>
        <div className="launch-promise">
          <p>
            Put your agents to work. <br />
            Keep the whole picture.
          </p>
          <p>
            Bring Codex, Claude Code, Grok, or OpenCode together. Run tasks in parallel, carry your
            project context forward, and review what lands.
          </p>
          <div className="launch-actions">
            {action}
            <a className="text-link" href="#playground">
              Try it first <ArrowDown size={16} />
            </a>
          </div>
          <small>{releaseNote}</small>
        </div>
      </div>

      <Tabs.Root value={chapter} onValueChange={setChapter} className="launch-theater page-width">
        <div className="theater-heading">
          <span>
            <BrandMark /> An idea, given room to run.
          </span>
          <span>ILLUSTRATED WORKFLOW</span>
        </div>
        <div className="theater-canvas" data-chapter={chapter}>
          <div className="theater-word" aria-hidden="true">
            {chapter === 'intent'
              ? 'imagine.'
              : chapter === 'parallel'
                ? 'branch out.'
                : 'make it yours.'}
          </div>
          <div className="theater-origin">
            <GitBranch size={16} />
            <span>Atlas project</span>
            <code>main</code>
          </div>
          <div className="theater-branches" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="theater-work">
            <div className="work-slip work-slip-context">
              <span className="slip-label">
                <Layers3 size={15} /> YOUR CONTEXT
              </span>
              <h3>
                A head start.
                <br />
                Every time.
              </h3>
              <ul>
                <li>
                  <Check size={13} /> Project instructions
                </li>
                <li>
                  <Check size={13} /> Selected tools
                </li>
                <li>
                  <Check size={13} /> Lessons & workflows
                </li>
              </ul>
              <span className="slip-foot">Brought into the task</span>
            </div>
            <div className="work-slip work-slip-primary" key={chapter}>
              <span className="slip-label">
                <Code2 size={16} />{' '}
                {chapter === 'intent'
                  ? 'YOUR BRIEF'
                  : chapter === 'parallel'
                    ? 'CODEX / SEARCH'
                    : 'BACK TO YOU / REVIEW'}
              </span>
              <h3>
                {chapter === 'intent'
                  ? '“Make search feel effortless.”'
                  : chapter === 'parallel'
                    ? 'Build the keyboard flow.'
                    : 'The change. The checks. The choice.'}
              </h3>
              {chapter === 'intent' ? (
                <p>Arrow keys to explore. Enter to open. Escape to get back to work.</p>
              ) : chapter === 'parallel' ? (
                <div className="slip-code">
                  <code>Search.tsx</code>
                  <span>+ onKeyDown</span>
                  <span>+ activeIndex</span>
                  <span>+ returnFocus</span>
                </div>
              ) : (
                <div className="slip-review">
                  <span>
                    <FileCode2 size={15} /> Search.tsx <b>+24 −8</b>
                  </span>
                  <span>
                    <Check size={15} /> Keyboard & focus checks
                  </span>
                  <span>
                    <Check size={15} /> Project build
                  </span>
                </div>
              )}
              <span className="slip-foot">
                {chapter === 'intent'
                  ? 'Your project. Your preferred agent.'
                  : chapter === 'parallel'
                    ? 'Isolated worktree / feature/search'
                    : 'Inspect → iterate → integrate'}
              </span>
            </div>
            <div className="work-slip work-slip-secondary">
              <span className="slip-label">
                <span aria-hidden="true">✳</span> CLAUDE CODE / SETTINGS
              </span>
              <h3>
                Polish the <br />
                little things.
              </h3>
              <div className="slip-swatches" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </div>
              <p>Refine settings controls across light and dark themes.</p>
              <span className="slip-foot">Isolated worktree / polish/settings</span>
            </div>
          </div>
          <div className="theater-destination">
            <span />
            <span>
              <Check size={16} /> You decide what lands.
            </span>
            <span />
          </div>
        </div>
        <div className="theater-controls">
          <Tabs.List aria-label="Explore the product story" className="story-tabs">
            {chapters.map((item) => (
              <Tabs.Trigger key={item.id} value={item.id}>
                {item.label}
                <ArrowRight size={15} />
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {chapters.map((item) => (
            <Tabs.Content className="story-caption" key={item.id} value={item.id}>
              <h2>{item.title}</h2>
              <p>{item.description}</p>
            </Tabs.Content>
          ))}
        </div>
        <div className="theater-footnote">
          <span>Sample tasks, shown to explain the workflow.</span>
          <button type="button" className="text-link" onClick={onPlay}>
            <Play size={14} /> Watch the actual app
          </button>
        </div>
      </Tabs.Root>
    </section>
  );
}

const features = [
  {
    id: 'context',
    label: 'Context that carries',
    title: 'Stop starting from scratch.',
    description:
      'Keep project instructions, lessons, and reusable workflows close. Choose what goes into a task, then inspect the context it received.',
    rows: [
      ['Project instructions', 'How this codebase works'],
      ['Lessons', 'What you learned last time'],
      ['Reusable workflows', 'Your way of getting it done'],
    ],
    foot: 'A better starting point for the next task.',
  },
  {
    id: 'connections',
    label: 'Tools within reach',
    title: 'Connect once. Choose per task.',
    description:
      'Manage project connections in one place and give each task the capabilities it needs. Tool delivery and discovery support varies by agent.',
    rows: [
      ['Project connections', 'Managed in one place'],
      ['Task tools', 'Selected for this job'],
      ['Agent support', 'Visible before you run'],
    ],
    foot: 'Your environment stays with the project.',
  },
  {
    id: 'accounts',
    label: 'Space for every project',
    title: 'Work. Personal. All in view.',
    description:
      'Choose account profiles and allowed agents per project. Continuations keep the account they started with, while you follow tasks across your workspace.',
    rows: [
      ['Client project', 'Work account / Codex'],
      ['Side project', 'Personal account / Claude Code'],
      ['Usage', 'Reported by project and account'],
    ],
    foot: 'Separate sign-in profiles. One place to follow the work.',
  },
  {
    id: 'recurring',
    label: 'A rhythm for repeat work',
    title: 'Give the routine a routine.',
    description:
      'Schedule repeat tasks with their project context intact. Jackalope runs them while the app and your computer are awake, with results ready for review.',
    rows: [
      ['Task', 'Review repository changes'],
      ['Schedule', 'Every weekday'],
      ['Result', 'A new attempt to inspect'],
    ],
    foot: 'Example schedule. Your computer needs to be awake.',
  },
];

export function FeatureStory() {
  return (
    <section
      id="features"
      className="feature-story section-space page-width"
      aria-labelledby="features-title"
    >
      <div className="section-intro">
        <h2 id="features-title">
          The work moves on.
          <br />
          <span>The context stays.</span>
        </h2>
        <p>
          The task is only the beginning. Jackalope keeps the instructions, connections, accounts,
          and routines around it together.
        </p>
      </div>
      <Tabs.Root defaultValue="context" className="feature-explorer">
        <Tabs.List aria-label="Explore Jackalope features" className="feature-tabs">
          {features.map((item) => (
            <Tabs.Trigger key={item.id} value={item.id}>
              {item.label}
              <ArrowRight size={18} />
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {features.map((item) => (
          <Tabs.Content key={item.id} value={item.id} className="feature-panel">
            <div className="feature-panel-copy">
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              {item.id === 'accounts' && (
                <a className="text-link" href="/blog/work-and-personal-accounts/">
                  Explore account setup <ArrowRight size={16} />
                </a>
              )}
            </div>
            <div className="feature-receipt">
              <span className="slip-label">
                <BrandMark /> INSIDE YOUR WORKSPACE
              </span>
              <dl>
                {item.rows.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p>{item.foot}</p>
              <small>Illustrative configuration</small>
            </div>
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </section>
  );
}
