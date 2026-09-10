import { EchoMark } from '@jackalope/brand/echo';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  GitBranch,
  Map as MapIcon,
  Play,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { tour } from './content';
import { Signup, WaitlistButton } from './Signup';
import { setInitialVideoVolume } from './video-volume';
import { WorkspaceClip } from './WorkspaceClip';
import './tour.css';

const chapters = [
  { time: 0, label: 'Meet Jackalope' },
  { time: 6, label: 'Make it yours' },
  { time: 25, label: 'Start a task' },
  { time: 34, label: 'Tools & evidence' },
  { time: 45, label: 'Your agents' },
  { time: 53, label: 'Explore your code' },
];

const workflow = [
  {
    id: 'context',
    label: 'Set the direction',
    title: 'A little context. A better starting point.',
    description:
      'Give each project its own guidance, reusable workflows, and editable lessons. Keep the decisions worth remembering close to the next task.',
    takeaway: 'Your project knowledge carries forward, and stays yours to edit.',
    walkthrough: 'Open project context, read a saved lesson, and browse reusable workflows.',
    href: '/features/project-context-for-coding-agents/',
    link: 'Explore project context',
  },
  {
    id: 'tasks',
    label: 'Put agents to work',
    title: 'More than one idea in motion.',
    description:
      'Run independent tasks with different coding agents in separate Git worktrees. Follow what is running, answer questions, and see what is ready for your attention.',
    takeaway: 'Each task keeps its brief, agent, workspace, and result together.',
    walkthrough: 'Switch between the task board and list, then draft a brief for a new task.',
    href: '/parallel-coding-agents/',
    link: 'Explore parallel work',
  },
  {
    id: 'review',
    label: 'Make the call',
    title: 'The agents do the work. You shape the result.',
    description:
      'Read the patch alongside the task and its checks. Ask for another iteration, inspect related changes together, and decide what belongs in your project.',
    takeaway: 'Review the evidence before choosing what to integrate.',
    walkthrough: 'Open a completed task, inspect its changes, and expand the code patch.',
    href: '/guides/review-ai-generated-code/',
    link: 'Explore the review workflow',
  },
];

const resources = [
  {
    icon: MapIcon,
    title: 'Roadmap',
    label: 'See where we’re headed',
    description: 'What’s built, what’s in progress, and what comes next.',
    href: '/roadmap/',
  },
  {
    icon: GitBranch,
    title: 'Changelog',
    label: 'Follow the details',
    description: 'A closer look at the improvements taking shape.',
    href: '/changelog/',
  },
  {
    icon: BookOpen,
    title: 'Knowledgebase',
    label: 'Get a head start',
    description: 'Practical guides to setup, agents, and your first task.',
    href: '/knowledge/',
  },
];

function TourFilm() {
  const player = useRef<HTMLVideoElement>(null);
  const startTime = useRef(0);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);

  const playChapter = (time: number) => {
    startTime.current = time;
    setActive(time);
    setStarted(true);
    if (player.current) {
      player.current.currentTime = time;
      player.current.focus({ preventScroll: true });
      void player.current.play().catch(() => {});
    }
  };

  return (
    <section className="tour-film page-width" id="film" aria-labelledby="film-title">
      <div className="tour-section-heading">
        <h2 id="film-title">Meet your next workspace.</h2>
        <span>{tour.durationSeconds} seconds · Sound on, if you like</span>
      </div>
      <div className="tour-film-screen">
        {started ? (
          <video
            ref={player}
            controls
            autoPlay
            playsInline
            preload="none"
            poster={tour.poster}
            src={tour.video}
            tabIndex={0}
            aria-label="Jackalope desktop app tour"
            aria-describedby="tour-media-note"
            onLoadedMetadata={(event) => {
              setInitialVideoVolume(event);
              event.currentTarget.currentTime = startTime.current;
              event.currentTarget.focus({ preventScroll: true });
            }}
            onTimeUpdate={(event) => {
              const time = event.currentTarget.currentTime;
              setActive(chapters.filter((chapter) => chapter.time <= time).at(-1)?.time ?? 0);
            }}
            onError={() => setFailed(true)}
          >
            <track kind="captions" src={tour.captions} srcLang="en" label="English descriptions" />
          </video>
        ) : (
          <button
            className="tour-film-poster"
            type="button"
            onClick={() => playChapter(0)}
            aria-label={`Play the ${tour.durationSeconds}-second product tour`}
          >
            <img
              src={tour.poster}
              width={1280}
              height={720}
              alt="Jackalope task workspace, framed by the signature indigo Jackalope artwork"
              fetchPriority="high"
            />
            <span className="tour-play">
              <Play size={22} fill="currentColor" aria-hidden="true" /> Play the film{' '}
              <span>1:04</span>
            </span>
          </button>
        )}
        {failed && (
          <div className="tour-film-error" role="status">
            The film couldn’t load. <a href={tour.video}>Open the video directly</a>, or read the
            transcript below.
          </div>
        )}
      </div>
      <fieldset className="tour-chapters" aria-label="Jump to a film chapter">
        {chapters.map((chapter) => (
          <button
            type="button"
            key={chapter.time}
            aria-pressed={started && active === chapter.time}
            onClick={() => playChapter(chapter.time)}
          >
            <span>0:{String(chapter.time).padStart(2, '0')}</span>
            {chapter.label}
          </button>
        ))}
      </fieldset>
      <div className="tour-film-notes">
        <p id="tour-media-note">
          Recorded with fictional Atlas project data. Browser interactions are scripted; no native
          agent task is launched.
        </p>
        <details>
          <summary>Read the film transcript</summary>
          <p>{tour.transcript}</p>
          <a href={tour.video}>
            Open video directly <ArrowUpRight size={14} />
          </a>
        </details>
      </div>
    </section>
  );
}

export function TourPage({ dark, available }: { dark: boolean; available: boolean }) {
  return (
    <main id="main" className="product-tour">
      <section className="tour-intro">
        <div className="page-width">
          <div className="tour-hero-grid">
            <div>
              <h1>
                More room
                <br />
                to <em>build.</em>
              </h1>
              <p className="tour-lede">
                Your coding agents. Your projects. One place to bring it all together.
              </p>
              <p className="tour-description">
                Jackalope is a desktop workspace for running agents in parallel, keeping context
                close, and reviewing what comes back.
              </p>
              <div className="tour-actions">
                <WaitlistButton />
                <a className="tour-text-link" href="#film">
                  Watch the tour <ArrowDown size={16} />
                </a>
              </div>
              <p className="tour-availability">
                {available ? (
                  <a href="/#download">
                    Explore available downloads <ArrowRight size={14} />
                  </a>
                ) : (
                  'Coming soon. Join the waitlist for early access.'
                )}
              </p>
            </div>
            <div className="tour-hero-art" aria-hidden="true">
              <span className="tour-art-orbit" />
              <EchoMark animated={false} />
              <span className="tour-art-caption">
                A little structure.
                <br />A lot of possibility.
              </span>
            </div>
          </div>
        </div>
      </section>

      <TourFilm />

      <section className="tour-agents page-width" aria-label="Supported coding agents">
        <p>Bring the agents you already use.</p>
        <div>
          {[
            ['Codex', 'codex'],
            ['Claude Code', 'claude-code'],
            ['Grok', 'grok'],
            ['OpenCode', 'opencode'],
            ['Kimi Code', 'kimi-code'],
            ['Antigravity', 'antigravity'],
          ].map(([name, slug]) => (
            <a key={slug} href={slug === 'antigravity' ? '/agents/' : `/agents/${slug}/`}>
              {name}
            </a>
          ))}
        </div>
        <a className="tour-text-link" href="/agents/">
          Your accounts and model access. See agent compatibility <ArrowRight size={14} />
        </a>
      </section>

      <section className="tour-workflow page-width" id="workspace" aria-labelledby="workflow-title">
        <div className="tour-section-heading">
          <div>
            <span className="tour-eyebrow">From a first thought to a considered change</span>
            <h2 id="workflow-title">Find your flow.</h2>
          </div>
          <p>
            Take a closer look at the workspace.
            <br />
            Choose a step, then play its demo.
          </p>
        </div>
        <Tabs.Root defaultValue="context">
          <Tabs.List className="tour-workflow-tabs" aria-label="Explore the task workflow">
            {workflow.map((scene, index) => (
              <Tabs.Trigger key={scene.id} value={scene.id}>
                <span>0{index + 1}</span>
                {scene.label}
                <ArrowRight size={16} aria-hidden="true" />
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {workflow.map((scene) => (
            <Tabs.Content key={scene.id} value={scene.id} className="tour-workflow-panel">
              <div className="tour-workflow-copy">
                <h3>{scene.title}</h3>
                <p>{scene.description}</p>
                <p className="tour-takeaway">{scene.takeaway}</p>
                <a className="tour-text-link" href={scene.href}>
                  {scene.link}
                  <ArrowUpRight size={16} />
                </a>
              </div>
              <WorkspaceClip key={`${scene.id}-${dark}`} scene={scene} dark={dark} />
            </Tabs.Content>
          ))}
        </Tabs.Root>
        <p className="tour-sample-note">
          Interactive recordings of the interface with sample data.
        </p>
      </section>

      <section className="tour-essentials page-width" aria-labelledby="essentials-title">
        <div>
          <span className="tour-eyebrow">A few things to know</span>
          <h2 id="essentials-title">
            Your setup.
            <br />
            More connected.
          </h2>
          <a className="tour-text-link" href="/#questions">
            More questions, answered <ArrowUpRight size={16} />
          </a>
        </div>
        <div className="tour-answers">
          <details open>
            <summary>What do I bring?</summary>
            <p>
              A local Git project and a supported coding agent with its provider account. Jackalope
              brings the workspace; model access and any subscription costs stay with your provider.
            </p>
          </details>
          <details>
            <summary>Where does my work live?</summary>
            <p>
              Repositories and task workspaces stay on your computer. Agents may send code and
              context to their providers according to your account settings. Separate worktrees keep
              Git changes apart; they do not sandbox agent processes.
            </p>
          </details>
          <details>
            <summary>What happens after I join the waitlist?</summary>
            <p>
              Verify your email to confirm your place. We’ll email you when access is ready. Joining
              is free, and a waitlist place does not yet grant desktop access.
            </p>
          </details>
        </div>
      </section>

      <section className="tour-next page-width" aria-labelledby="tour-next-title">
        <div className="tour-section-heading">
          <h2 id="tour-next-title">There’s more around the corner.</h2>
          <span>Built in the open. Follow along.</span>
        </div>
        <div className="tour-resources">
          {resources.map(({ icon: Icon, ...resource }) => (
            <a href={resource.href} key={resource.href}>
              <div>
                <Icon size={24} aria-hidden="true" />
                <ArrowUpRight size={20} aria-hidden="true" />
              </div>
              <span className="tour-eyebrow">{resource.label}</span>
              <h3>{resource.title}</h3>
              <p>{resource.description}</p>
            </a>
          ))}
        </div>
      </section>

      <section
        className="tour-signup page-width"
        id="newsletter"
        aria-labelledby="tour-signup-title"
      >
        <div>
          <h2 id="tour-signup-title">
            Come build
            <br />
            with Jackalope.
          </h2>
          <p>Join the waitlist. We’ll let you know when your workspace is ready.</p>
        </div>
        <div>
          <Signup />
          <a className="tour-member-link" href="/waitlist/">
            Already on the list? Check your place <ArrowRight size={14} />
          </a>
        </div>
      </section>
    </main>
  );
}
