import { AsciiMark } from '@jackalope/brand/ascii-mark';
import { PROVIDER_MARKS } from '@jackalope/brand/provider-marks';
import { Disclosure, DisclosureSummary, GitHubIcon } from '@jackalope/ui';
import { ArrowDownToLine, ArrowRight, ChevronDown } from 'lucide-react';
import { type CSSProperties, Fragment, type ReactNode, useEffect, useRef } from 'react';
import { GITHUB_URL } from './community';
import {
  heroPalette,
  landingCards,
  moreFeatures,
  type Palette,
  providers,
  roster,
} from './landing-content';
import { createFluid, type Fluid } from './landing-fluid';
import {
  approach,
  clamp,
  heroState,
  hexToRgb,
  progressThrough,
  READING_WASH,
  type Rgb,
  scrollEnergy,
} from './landing-motion';
import { TerminalDemo } from './TerminalDemo';
import '@jackalope/brand/fonts-display.css';
import './landing.css';

const REDUCED = '(prefers-reduced-motion: reduce)';

type Colors = [Rgb, Rgb, Rgb];

/** A section that sets the look of the background field while it is on screen. */
interface Scene {
  element: HTMLElement;
  colors: Colors;
  /** A fixed wash for sections that paint their own surface; text on the field uses the reading wash. */
  wash?: number;
}

/** Seconds of flow already "elapsed" at load, chosen because the field looks good there. */
const TIME_OFFSET = 12;
/** On devices that cannot animate the field, redraw it at most this often (ms) while scrolling. */
const STILL_REDRAW_INTERVAL = 250;
/** Field turbulence at rest, and how much scrolling adds to it. */
const BASE_WARP = 3.4;
const SCROLL_WARP = 1.6;
/** How many times faster the field flows at full scroll energy. */
const SCROLL_SPEED_UP = 5;
/** The page colors the field fades toward under text. */
const WASH_COLOR: Record<'dark' | 'light', Rgb> = {
  dark: [0.03, 0.025, 0.045],
  light: [0.985, 0.98, 1],
};

const toColors = (palette: Palette) => palette.map(hexToRgb) as Colors;

/**
 * Wires the scroll choreography to the page: one animation frame loop reads the scroll
 * position and writes styles, with the math in ./landing-motion. Nothing here is needed
 * to read the page. Without scripts, or with reduced motion, the hero is an ordinary
 * full-height section and every word is visible.
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
  const hero = find('[data-hero]');
  const heroMask = find('[data-hero-mask]');
  const heroName = find('[data-hero-name]');
  const heroMeta = find('[data-hero-meta]');
  const zoomTarget = find('[data-zoom-target]');
  const statement = find('[data-statement]');
  const canvas = find<HTMLCanvasElement>('[data-fluid]');
  const words = [...statement.querySelectorAll<HTMLElement>('[data-word]')];
  const cards = [...main.querySelectorAll<HTMLElement>('[data-card]')];
  const heroColors = toColors(heroPalette);
  const scenes: Scene[] = [...main.querySelectorAll<HTMLElement>('[data-palette]')].map(
    (element) => ({
      element,
      colors: toColors((element.dataset.palette ?? '').split(',') as Palette),
      wash: element.dataset.wash ? Number(element.dataset.wash) : undefined,
    }),
  );

  let fluid: Fluid | null = null;
  let scheme: 'dark' | 'light' = 'light';
  let colors = heroColors;
  let wash = 0;
  let washColor = WASH_COLOR.light;
  let pointer: [number, number] = [0, 0];
  let pointerTarget: [number, number] = [0, 0];
  let lastStillDraw = 0;
  let lastFrame = 0;
  let lastScrollY = window.scrollY;
  let energy = 0;
  let flowTime = TIME_OFFSET;
  let frameId = 0;
  let idleId = 0;
  let stopped = false;

  /** The theme sets `color-scheme` on the root; the hero's blend mode and the wash follow it. */
  function readScheme() {
    const next = document.documentElement.style.colorScheme === 'dark' ? 'dark' : 'light';
    if (next === scheme && main.dataset.scheme) return;
    scheme = next;
    main.dataset.scheme = next;
    lastStillDraw = 0;
  }

  /** Zoom toward the stem of one letter, so the camera ends up inside the letter. */
  function aimZoom() {
    const name = heroName.getBoundingClientRect();
    const target = zoomTarget.getBoundingClientRect();
    const scale = name.width / heroName.offsetWidth || 1;
    const x = (target.left + target.width * 0.22 - name.left) / scale;
    const y = (target.top + target.height * 0.45 - name.top) / scale;
    heroName.style.transformOrigin = `${x}px ${y}px`;
  }

  /** The last section with a palette whose body is in the middle of the screen, if any. */
  function activeScene(viewportHeight: number): Scene | undefined {
    let active: Scene | undefined;
    for (const scene of scenes) {
      const rect = scene.element.getBoundingClientRect();
      if (rect.top < viewportHeight * 0.55 && rect.bottom > viewportHeight * 0.2) active = scene;
    }
    return active;
  }

  /** Moves the hero and returns the wash it wants: none inside the name, the reading wash after. */
  function updateHero(viewportHeight: number): number {
    const rect = hero.getBoundingClientRect();
    const reading = READING_WASH[scheme];
    if (!animate) return rect.bottom > viewportHeight / 2 ? 0 : reading;
    const state = heroState(progressThrough(-rect.top, 0, rect.height - viewportHeight), reading);
    heroName.style.transform = `scale(${state.scale})`;
    heroMask.style.opacity = String(state.maskOpacity);
    heroMeta.style.opacity = String(state.metaOpacity);
    heroMeta.style.visibility = state.metaOpacity < 0.01 ? 'hidden' : 'visible';
    return state.wash;
  }

  function updateStatement(viewportHeight: number) {
    const rect = statement.getBoundingClientRect();
    const lit = progressThrough(
      viewportHeight * 0.8 - rect.top,
      0,
      rect.height + viewportHeight * 0.25,
    );
    for (const [i, word] of words.entries()) {
      word.classList.toggle('is-lit', i / words.length < lit);
    }
  }

  /** Each card shrinks and darkens as the next one slides over it. */
  function updateCards(viewportHeight: number) {
    for (const [i, card] of cards.entries()) {
      const rect = card.getBoundingClientRect();
      card.classList.toggle('is-active', rect.top < viewportHeight * 0.6);
      const next = cards[i + 1]?.getBoundingClientRect();
      const covered = next ? clamp(1 - (next.top - rect.top) / rect.height) : 0;
      card.style.setProperty('--covered', covered.toFixed(3));
    }
  }

  /** Scrolling stirs the field: it flows faster and folds harder, then settles. */
  function updateFlow(now: number, viewportHeight: number) {
    const elapsed = lastFrame ? Math.min(now - lastFrame, 100) / 1000 : 0;
    lastFrame = now;
    energy = scrollEnergy(energy, (window.scrollY - lastScrollY) / viewportHeight);
    lastScrollY = window.scrollY;
    flowTime += elapsed * (1 + energy * SCROLL_SPEED_UP);
  }

  function drawFluid(now: number, heroWash: number, viewportHeight: number) {
    if (!fluid) return;
    const flowing = animate && fluid.canAnimate;
    if (!flowing && now - lastStillDraw < STILL_REDRAW_INTERVAL) return;
    lastStillDraw = now;

    const scene = activeScene(viewportHeight);
    const targetColors = scene?.colors ?? heroColors;
    const targetWash = scene ? (scene.wash ?? READING_WASH[scheme]) : heroWash;
    // A still frame jumps straight to the section's look; a flowing one eases toward it.
    if (flowing) {
      colors = colors.map((color, i) => approach(color, targetColors[i] ?? color, 0.05)) as Colors;
      wash += (targetWash - wash) * 0.08;
      washColor = approach(washColor, WASH_COLOR[scheme], 0.12);
      pointer = [
        pointer[0] + (pointerTarget[0] - pointer[0]) * 0.06,
        pointer[1] + (pointerTarget[1] - pointer[1]) * 0.06,
      ];
    } else {
      colors = targetColors;
      wash = targetWash;
      washColor = WASH_COLOR[scheme];
    }

    fluid.draw({
      time: flowing ? flowTime : TIME_OFFSET,
      pointer: flowing ? pointer : [0, 0],
      warp: flowing ? BASE_WARP + energy * SCROLL_WARP : BASE_WARP,
      wash,
      washColor,
      colors,
    });
  }

  function frame(now: number) {
    if (stopped) return;
    const viewportHeight = window.innerHeight;
    readScheme();
    const heroWash = updateHero(viewportHeight);
    if (animate) {
      updateStatement(viewportHeight);
      updateCards(viewportHeight);
      updateFlow(now, viewportHeight);
    }
    drawFluid(now, heroWash, viewportHeight);
    if (!document.hidden) frameId = requestAnimationFrame(frame);
  }

  const onPointerMove = (event: PointerEvent) => {
    pointerTarget = [
      (event.clientX - window.innerWidth / 2) / window.innerHeight,
      -(event.clientY - window.innerHeight / 2) / window.innerHeight,
    ];
  };
  const onResize = () => {
    fluid?.resize();
    lastStillDraw = 0;
    aimZoom();
  };
  const onVisibility = () => {
    if (document.hidden) return;
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(frame);
  };
  // The CSS gradient is already on screen. Swap in the shader once the page is settled.
  const createWhenIdle = () => {
    const create = () => {
      if (stopped) return;
      fluid = createFluid(canvas);
      if (fluid) main.dataset.fluid = '';
    };
    if ('requestIdleCallback' in window) idleId = requestIdleCallback(create, { timeout: 2000 });
    else idleId = setTimeout(create, 200) as unknown as number;
  };

  if (animate) main.dataset.motion = '';
  readScheme();
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  document.fonts.ready.then(() => {
    if (!stopped) aimZoom();
  });
  aimZoom();
  frameId = requestAnimationFrame(frame);
  if (document.readyState === 'complete') createWhenIdle();
  else window.addEventListener('load', createWhenIdle, { once: true });

  return () => {
    stopped = true;
    cancelAnimationFrame(frameId);
    if ('cancelIdleCallback' in window) cancelIdleCallback(idleId);
    clearTimeout(idleId);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('load', createWhenIdle);
    document.removeEventListener('visibilitychange', onVisibility);
    delete main.dataset.motion;
    for (const element of [heroName, heroMask, heroMeta]) element.removeAttribute('style');
    for (const word of words) word.classList.remove('is-lit');
    for (const card of cards) {
      card.classList.remove('is-active');
      card.style.removeProperty('--covered');
    }
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

  const statement = `Jackalope runs ${roster.length} coding agents side by side. Each task gets its own Git worktree. Nothing merges until you approve it.`;
  const cards = landingCards(platforms);

  return (
    <main id="main" className="lp" ref={landing}>
      {/* The background: a CSS gradient paints first, and the canvas fades in over it. */}
      <div className="lp-backdrop" aria-hidden="true">
        <canvas data-fluid="" />
      </div>

      <section className="lp-hero" data-hero="" aria-labelledby="hero-title">
        {/* A solid layer blended with the page: the letters become windows onto the canvas. */}
        <div className="lp-mask" data-hero-mask="" aria-hidden="true">
          <p className="lp-display lp-name" data-hero-name="">
            <span>Jack</span>
            <span>
              a<span data-zoom-target="">l</span>ope
            </span>
          </p>
        </div>
        <div className="lp-meta" data-hero-meta="">
          <div className="lp-grain" aria-hidden="true" />
          <div className="lp-intro">
            <h1 id="hero-title">Run your agents side by side.</h1>
            <p className="lp-lede">
              Jackalope is a desktop workspace for Codex, Claude Code, Gemini CLI and more. Every
              task runs in its own Git worktree, and nothing lands until you approve it.
            </p>
          </div>
          <a className="lp-cue" href="#intro">
            <span className="lp-sr">Scroll to content</span>
            <ChevronDown size={28} aria-hidden="true" />
          </a>
          <div className="lp-actions">
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
      </section>

      <section className="lp-statement" id="intro" tabIndex={-1}>
        {/* Each word lights up as the section scrolls past. Screen readers get the plain sentence. */}
        <h2 className="lp-sentence" data-statement="">
          <span className="lp-sr">{statement}</span>
          <span aria-hidden="true">
            {statement.split(' ').map((word, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: words repeat and never reorder.
              <Fragment key={index}>
                <span className="lp-word" data-word="">
                  {word}
                </span>{' '}
              </Fragment>
            ))}
          </span>
        </h2>
        <p className="lp-proof">
          Open source under Apache 2.0. <a href={GITHUB_URL}>Read the code on GitHub</a>.
        </p>
      </section>

      <section className="lp-work" id="inside" aria-labelledby="work-title">
        <h2 id="work-title" className="lp-sr">
          What Jackalope does
        </h2>
        {cards.map((card) => (
          <article
            className="lp-card"
            key={card.name}
            data-card=""
            data-palette={card.palette.join(',')}
            data-wash="0.1"
            style={
              {
                '--surface': card.surface,
                '--ink': card.ink,
                '--letters': card.name.length,
              } as CSSProperties
            }
          >
            <div className="lp-card-top">
              <p className="lp-card-kind">{card.kind}</p>
              <ul className="lp-tags">
                {card.tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            </div>
            <h3 className="lp-display lp-card-title">
              <a href={card.href}>{card.name}</a>
            </h3>
            <div className="lp-card-details">
              <p className="lp-card-summary">{card.summary}</p>
              <ul className="lp-facts">
                {card.facts.map((fact) => (
                  <li key={fact.label}>
                    <strong>{fact.value}</strong>
                    <span>{fact.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}

        <ul className="lp-more" id="features">
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

      <section
        className="lp-cli"
        aria-labelledby="cli-title"
        data-palette="#6366f1,#22d3ee,#1e1b4b"
      >
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

      <section className="lp-final" id="download" aria-labelledby="final-title">
        <div className="lp-final-mark">
          <AsciiMark echoes={4} />
        </div>
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
