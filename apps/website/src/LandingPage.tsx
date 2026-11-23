import { PROVIDER_MARKS } from '@jackalope/brand/provider-marks';
import { Disclosure, DisclosureSummary, GitHubIcon } from '@jackalope/ui';
import { ArrowDownToLine, ArrowRight } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react';
import { GITHUB_URL } from './community';
import { landingPanes, moreFeatures, providers, roster } from './landing-content';
import { createLanes, type Lanes } from './landing-lanes';
import { clamp, hexToRgb, type LaneField, laneX, type Rgb, scrollEnergy } from './landing-motion';
import { TerminalDemo } from './TerminalDemo';
import './landing.css';

const REDUCED = '(prefers-reduced-motion: reduce)';
/** At this width and below the hero stacks and the panes stop scrolling sideways; matches the CSS. */
const NARROW = 1000;
/** The merged line, in the brand violet. */
const TRUNK = '#8b5cf6';
/** One lane per agent, in that agent's color. */
const laneColors = roster.map((agent) => PROVIDER_MARKS[agent.id]?.color ?? TRUNK);

/** Where the lanes sit while a section is on screen, as fractions of the viewport width. */
interface Look {
  center: number;
  spread: number;
  /** How strongly the lanes show, 0 to 1. Sections with text over the lanes keep it low. */
  intensity: number;
}

/** Sections that set no look: lanes across the page, faint enough to read over. */
const REST: Look = { center: 0, spread: 0.92, intensity: 0.22 };

function parseLook(value: string | undefined): Look | undefined {
  const [center, spread, intensity] = (value ?? '').split(' ').map(Number);
  if (center === undefined || spread === undefined || intensity === undefined) return undefined;
  return { center, spread, intensity };
}

/** Seconds the lanes take to grow down the first screen once they can be drawn. */
const REVEAL_SECONDS = 1.6;
/** How many times faster work moves along the lanes at full scroll energy. */
const SCROLL_SPEED_UP = 6;
/** Page height (viewport heights) the merged line runs on before its end ring; the shader's 0.12. */
const TAIL = 0.12;

/**
 * Wires the lanes to the page: one animation frame loop reads the scroll position, places
 * the agent marks on their lanes, moves the panes sideways and draws the canvas, with the
 * math in ./landing-motion. Nothing here is needed to read the page. Without scripts the
 * marks sit in a row and the panes wrap; with reduced motion the lanes hold still.
 *
 * @returns a function that stops the loop and restores the static page
 */
function startChoreography(main: HTMLElement, animate: boolean): () => void {
  // The component renders every one of these, so a missing element is a programming error.
  const find = <T extends HTMLElement>(selector: string) => {
    const element = main.querySelector<T>(selector);
    if (!element) throw new Error(`Missing landing element: ${selector}`);
    return element;
  };
  const actions = find('[data-hero-actions]');
  const beadRow = find('[data-beads]');
  const beads = [...beadRow.querySelectorAll<HTMLElement>('[data-bead]')];
  const lines = [...main.querySelectorAll<HTMLElement>('[data-line]')];
  const panes = find('[data-panes]');
  const track = find('[data-track]');
  const merge = find('[data-merge]');
  const canvas = find<HTMLCanvasElement>('[data-lanes-canvas]');
  const scenes = [...main.querySelectorAll<HTMLElement>('[data-lanes]')].map((element) => {
    const wide = parseLook(element.dataset.lanes) ?? REST;
    return { element, wide, narrow: parseLook(element.dataset.lanesNarrow) ?? wide };
  });
  const colors = laneColors.map(hexToRgb);
  const trunk = hexToRgb(TRUNK);

  let lanes: Lanes | null = null;
  let scheme = '';
  let background: Rgb = [1, 1, 1];
  let look: Look | undefined;
  let pinned = false;
  let revealStart = 0;
  let lastFrame = 0;
  let lastScrollY = window.scrollY;
  let lastDrawn = '';
  let energy = 0;
  let time = 0;
  let frameId = 0;
  let idleId = 0;
  let stopped = false;

  /** The theme sets `color-scheme` on the root; the canvas takes the page's own background. */
  function readScheme() {
    const next = document.documentElement.style.colorScheme === 'dark' ? 'dark' : 'light';
    if (next === scheme) return;
    scheme = next;
    const channels = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g);
    if (channels && channels.length >= 3) {
      background = channels.slice(0, 3).map((channel) => Number(channel) / 255) as Rgb;
    }
  }

  /** The look of the last section with one whose body is in the middle of the screen. */
  function targetLook(viewportHeight: number, narrow: boolean): Look {
    let active = REST;
    for (const scene of scenes) {
      const rect = scene.element.getBoundingClientRect();
      if (rect.top < viewportHeight * 0.55 && rect.bottom > viewportHeight * 0.2) {
        active = narrow ? scene.narrow : scene.wide;
      }
    }
    return active;
  }

  /** On wide screens the panes pin and scroll sideways; the section's height is that travel. */
  function updatePanes(viewportWidth: number, viewportHeight: number) {
    const shouldPin = animate && viewportWidth > NARROW;
    if (shouldPin !== pinned) {
      pinned = shouldPin;
      if (pinned) main.dataset.pinned = '';
      else {
        delete main.dataset.pinned;
        panes.style.height = '';
        track.style.transform = '';
      }
    }
    if (!pinned) return;
    const travel = Math.max(0, track.offsetWidth - viewportWidth);
    const height = `${Math.round(viewportHeight + travel)}px`;
    if (panes.style.height !== height) panes.style.height = height;
    const rect = panes.getBoundingClientRect();
    const progress = clamp(-rect.top / Math.max(1, rect.height - viewportHeight));
    track.style.transform = `translate3d(${(-progress * travel).toFixed(1)}px, 0, 0)`;
  }

  /** Each sentence of the statement lights up as it comes up the screen, and stays lit. */
  function updateLines(viewportHeight: number) {
    for (const line of lines) {
      line.classList.toggle('is-lit', line.getBoundingClientRect().top < viewportHeight * 0.62);
    }
  }

  function frame(now: number) {
    if (stopped) return;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const narrow = viewportWidth <= NARROW;
    const scrollY = window.scrollY;
    const pageY = (clientY: number) => (clientY + scrollY) / viewportHeight;
    readScheme();
    updatePanes(viewportWidth, viewportHeight);
    if (animate) {
      updateLines(viewportHeight);
      const elapsed = lastFrame ? Math.min(now - lastFrame, 100) / 1000 : 0;
      energy = scrollEnergy(energy, (scrollY - lastScrollY) / viewportHeight);
      time += elapsed * (1 + energy * SCROLL_SPEED_UP);
    }
    lastFrame = now;
    lastScrollY = scrollY;

    // A still page jumps straight to the section's look; a moving one eases toward it.
    const target = targetLook(viewportHeight, narrow);
    const from = animate && look ? look : target;
    look = {
      center: from.center + (target.center - from.center) * 0.07,
      spread: from.spread + (target.spread - from.spread) * 0.07,
      intensity: from.intensity + (target.intensity - from.intensity) * 0.07,
    };

    const aspect = viewportWidth / viewportHeight;
    const beadBox = beadRow.getBoundingClientRect();
    const mergeEnd = pageY(merge.getBoundingClientRect().top) - TAIL;
    const field: LaneField = {
      center: look.center * aspect,
      spread: look.spread * aspect,
      // The line starts under the header, or under the buttons where the hero stacks.
      rootY: narrow ? pageY(actions.getBoundingClientRect().bottom + 28) : 116 / viewportHeight,
      forkEnd: pageY(beadBox.top + beadBox.height / 2),
      mergeStart: mergeEnd - 0.55,
      mergeEnd,
    };

    // Each agent's mark rides its own lane where the fork finishes.
    if (beadBox.bottom > 0 && beadBox.top < viewportHeight) {
      for (const [index, bead] of beads.entries()) {
        const x = laneX(index, beads.length, field.forkEnd, time, field);
        const center = beadBox.left + bead.offsetLeft + bead.offsetWidth / 2;
        const left = viewportWidth / 2 + x * viewportHeight - center;
        bead.style.transform = `translate3d(${left.toFixed(1)}px, 0, 0)`;
      }
    }

    if (lanes) {
      const flowing = animate && lanes.canAnimate;
      const grown = animate ? clamp((now - revealStart) / (REVEAL_SECONDS * 1000)) : 1;
      const reveal = grown < 1 ? field.rootY + (1 - (1 - grown) ** 3) * 1.4 : 1e6;
      // A device that cannot animate redraws only when what is on screen has changed.
      const drawn = flowing
        ? ''
        : JSON.stringify([scrollY, viewportWidth, viewportHeight, scheme, field, look, reveal]);
      if (flowing || drawn !== lastDrawn) {
        lastDrawn = drawn;
        lanes.draw({
          ...field,
          scroll: scrollY / viewportHeight,
          time,
          reveal,
          intensity: look.intensity,
          glow: scheme === 'dark' ? 1 : 0,
          background,
          trunk,
        });
      }
    }
    if (!document.hidden) frameId = requestAnimationFrame(frame);
  }

  const onResize = () => {
    lanes?.resize();
    lastDrawn = '';
  };
  const onVisibility = () => {
    if (document.hidden) return;
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(frame);
  };
  // The page is already readable. Start the canvas once the page is settled.
  const createWhenIdle = () => {
    const create = () => {
      if (stopped) return;
      lanes = createLanes(canvas, colors);
      revealStart = performance.now();
      if (lanes) main.dataset.lanesReady = '';
    };
    if ('requestIdleCallback' in window) idleId = requestIdleCallback(create, { timeout: 2000 });
    else idleId = setTimeout(create, 200) as unknown as number;
  };

  main.dataset.js = '';
  if (animate) main.dataset.motion = '';
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  frameId = requestAnimationFrame(frame);
  if (document.readyState === 'complete') createWhenIdle();
  else window.addEventListener('load', createWhenIdle, { once: true });

  return () => {
    stopped = true;
    cancelAnimationFrame(frameId);
    if ('cancelIdleCallback' in window) cancelIdleCallback(idleId);
    clearTimeout(idleId);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('load', createWhenIdle);
    document.removeEventListener('visibilitychange', onVisibility);
    for (const name of ['js', 'motion', 'pinned']) delete main.dataset[name];
    for (const element of [panes, track, ...beads]) element.removeAttribute('style');
    for (const line of lines) line.classList.remove('is-lit');
  };
}

function ProviderMark({ id }: { id: string }) {
  const mark = PROVIDER_MARKS[id];
  if (!mark) return null;
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

const statement = [
  'Jackalope runs coding agents side by side.',
  'Each task gets its own Git worktree.',
  'Nothing merges until you approve it.',
];

export function LandingPage({
  signup,
  faqs,
  platforms,
}: {
  signup: ReactNode;
  faqs: string[][];
  platforms: string;
}) {
  const landing = useRef<HTMLElement>(null);
  useEffect(() => {
    const main = landing.current;
    if (!main) return;
    // Motion preferences can change while the page is open; restart in the new mode.
    const reduced = window.matchMedia(REDUCED);
    let stop = startChoreography(main, !reduced.matches);
    const restart = () => {
      stop();
      stop = startChoreography(main, !reduced.matches);
    };
    reduced.addEventListener('change', restart);
    return () => {
      reduced.removeEventListener('change', restart);
      stop();
    };
  }, []);

  return (
    <main id="main" className="lp" ref={landing}>
      {/* The lanes: one fixed canvas behind the whole page, drawn in page coordinates. */}
      <div className="lp-backdrop" aria-hidden="true">
        <canvas data-lanes-canvas="" />
      </div>

      <section
        className="lp-hero"
        data-lanes="0.24 0.4 1"
        data-lanes-narrow="0 0.78 1"
        aria-labelledby="hero-title"
      >
        <div className="lp-hero-copy">
          <h1 id="hero-title">
            Run your agents <span>side by side.</span>
          </h1>
          <p className="lp-lede">
            Jackalope is a desktop workspace for Codex, Claude Code, Gemini CLI and more. Every task
            runs in its own Git worktree, and nothing lands until you approve it.
          </p>
          <div className="lp-actions" data-hero-actions="">
            <a className="lp-download" href="/download/">
              <ArrowDownToLine size={20} aria-hidden="true" />
              Download Jackalope
            </a>
            <a className="lp-source" href={GITHUB_URL}>
              <GitHubIcon size={18} />
              View source
            </a>
          </div>
        </div>
        <ul className="lp-beads" data-beads="" aria-label="Agents it runs">
          {roster.map((agent) => (
            <li className="lp-bead" key={agent.id} data-bead="" title={agent.name}>
              <ProviderMark id={agent.id} />
              <span className="lp-sr">{agent.name}</span>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="lp-statement"
        id="how-it-works"
        data-lanes="0.36 0.2 0.9"
        data-lanes-narrow="0 0.8 0.2"
      >
        <h2 className="lp-sentences">
          {statement.map((sentence) => (
            <span className="lp-line" data-line="" key={sentence}>
              {sentence}{' '}
            </span>
          ))}
        </h2>
        <p className="lp-proof">
          Open source under Apache 2.0. <a href={GITHUB_URL}>Read the code on GitHub</a>.
        </p>
      </section>

      <section
        className="lp-panes"
        id="inside"
        data-panes=""
        data-lanes="0 0.92 0.6"
        aria-labelledby="panes-title"
      >
        <div className="lp-panes-sticky">
          <h2 id="panes-title" className="lp-sr">
            What Jackalope does
          </h2>
          <ol className="lp-track" data-track="">
            {landingPanes(platforms).map((pane, index) => (
              <li
                className="lp-pane"
                key={pane.name}
                style={{ '--lane': laneColors[index % laneColors.length] } as CSSProperties}
              >
                <div className="lp-pane-top">
                  <p className="lp-pane-kind">{pane.kind}</p>
                  <ul className="lp-tags">
                    {pane.tags.map((tag) => (
                      <li key={tag}>{tag}</li>
                    ))}
                  </ul>
                </div>
                <h3 className="lp-pane-title">
                  <a href={pane.href}>{pane.name}</a>
                </h3>
                <p className="lp-pane-summary">{pane.summary}</p>
                <ul className="lp-facts">
                  {pane.facts.map((fact) => (
                    <li key={fact.label}>
                      <strong>{fact.value}</strong>
                      <span>{fact.label}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lp-more-section" id="features" aria-labelledby="more-title">
        <h2 id="more-title" className="lp-sr">
          More in the app
        </h2>
        <ul className="lp-more">
          {moreFeatures.map((feature) => (
            <li key={feature.title}>
              <a href={feature.href}>
                {feature.title}{' '}
                <ArrowRight className="lp-more-arrow" size={16} aria-hidden="true" />
              </a>
              <span>{feature.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp-cli" aria-labelledby="cli-title">
        <div className="lp-width">
          <h2 id="cli-title" className="lp-center">
            Or never leave the terminal.
          </h2>
          <p className="lp-center lp-detail">
            Type <code>jackalope</code> in any repository. It picks an agent, shows what it is doing
            and asks when it needs you.
          </p>
          <TerminalDemo />
        </div>
      </section>

      <section className="lp-agents" aria-labelledby="agents-title">
        <div className="lp-width">
          <h2 id="agents-title" className="lp-center">
            Bring the agents you already pay for.
          </h2>
          <ul className="lp-roster">
            {roster.map((agent) => (
              <li key={agent.id}>
                <ProviderMark id={agent.id} />
                {agent.name}
              </li>
            ))}
          </ul>
          <div className="lp-providers">
            <p>Or connect models directly, including local ones</p>
            <ul>
              {providers.map((provider) => (
                <li key={provider.id}>
                  <ProviderMark id={provider.id} />
                  {provider.name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="lp-faq" id="questions" aria-labelledby="questions-title">
        <div className="lp-width lp-faq-grid">
          <div>
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

      <section
        className="lp-final"
        id="download"
        data-lanes="0 0.5 0.9"
        data-lanes-narrow="0 0.78 0.9"
        aria-labelledby="final-title"
      >
        {/* The lanes merge into one line that ends here, above the heading. */}
        <div className="lp-merge" data-merge="" aria-hidden="true" />
        <div className="lp-width lp-final-body">
          <h2 id="final-title" className="lp-center">
            Start your first parallel task.
          </h2>
          <p className="lp-center lp-detail">
            Free account, ready as soon as you confirm your email. Bring your own agents.
          </p>
          <div className="lp-final-form" id="newsletter">
            {signup}
            <a className="lp-final-download" href="/download/">
              <ArrowDownToLine size={16} aria-hidden="true" />
              <span className="lp-final-download-label">
                Already have an account? <strong>Download for {platforms}</strong>
              </span>
              <ArrowRight size={15} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
