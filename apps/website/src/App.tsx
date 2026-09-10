import { applyThemeTokens, PRESET_THEMES, type ThemePalette } from '@jackalope/brand/theme';
import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ArrowDownToLine, ArrowRight, Menu as MenuIcon, Moon, Sun, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AccessPage } from './Access';
import { BrandMark } from './BrandMark';
import { tour } from './content';
import { FeedbackPage } from './Feedback';
import { Footer } from './Footer';
import { JournalPage } from './Journal';
import { KnowledgebasePage } from './Knowledgebase';
import { LandingPage } from './LandingPage';
import { LegalPage } from './Legal';
import { MarketingPage } from './MarketingPage';
import { marketingPages } from './marketing-content';
import { RoadmapPage } from './Roadmap';
import { waitlistReferral } from './referral';
import { Newsletter, Signup, WaitlistButton } from './Signup';
import { DEFAULT_WEBSITE_THEME, readWebsiteTheme, saveWebsiteTheme } from './theme';
import { WaitlistPage } from './Waitlist';
import './knowledge.css';

const downloadUrl = import.meta.env.VITE_WINDOWS_DOWNLOAD_URL?.trim();
const version = import.meta.env.VITE_RELEASE_VERSION?.trim();

function DownloadButton({ compact = false }: { compact?: boolean }) {
  if (!downloadUrl) return <WaitlistButton compact={compact} />;
  return (
    <a
      className={`button button-primary button-download ${compact ? 'button-compact' : ''}`}
      href="/#download"
    >
      <span>Get Jackalope</span>
      <ArrowDownToLine size={16} />
    </a>
  );
}

const faqs = [
  [
    'What is Jackalope?',
    'A desktop workspace for Codex, Claude Code, Grok, OpenCode, Kimi Code, and Antigravity. Run tasks in parallel, keep their project context together, and review the changes in one place.',
  ],
  [
    'Why use it instead of more terminal tabs?',
    'Each task keeps its brief, agent, account, worktree, questions, and result together. You can see what needs attention and review related changes as one combined patch.',
  ],
  [
    'Do I need an AI subscription?',
    'Bring a supported agent CLI and its provider account. Jackalope does not include model access. Subscription requirements, usage limits, and charges depend on your provider.',
  ],
  [
    'Does my code stay on my computer?',
    'Repositories and task workspaces live on your computer. Agents may send code and context to their providers under your account settings. Connected tools have their own data policies.',
  ],
  [
    'Can I keep work and personal accounts separate?',
    'Yes. Create named account profiles and choose project defaults. Continuations retain their selected profile. Antigravity profiles use Gemini API keys; its existing subscription login is shared. Profiles do not isolate local file access.',
  ],
  [
    'What happens after I join?',
    'Verify your email to confirm your place and get your referral link. Each verified new signup through your link earns one day of priority. Approved members receive five Instant Access Passes to share. No payment is needed to join.',
  ],
  [
    'Can Jackalope choose an agent, model, and account?',
    'Automatic tasks ask your configured default agent to choose an allowed agent, configured model, and permitted account. Jackalope validates project restrictions and tool compatibility, considers available capacity reports, and can hand off recognized quota failures to an eligible alternative while preserving the work. Explicit assignments remain available. Routing depends on your configured agents and available usage reports.',
    'routing-question',
  ],
  [
    'Which tools does Jackalope give agents?',
    'Browse the MCP directory and choose project connections. Selected stdio and HTTP tools support on-demand discovery; direct connection support varies by agent. Built-in tools cover browser interaction, screenshots, accessibility audits, questions, and local verification. Windows desktop control adds accessibility snapshots, window captures, focus, clicks, typing, and scrolling after you select a window for that attempt. A theme-colored glow and status bar show when control is active. Escape or Stop revokes access; mouse or keyboard activity pauses it until you Resume. It operates your live desktop under existing OS permissions; macOS and Linux X11 window control is in native validation; Wayland remains unsupported.',
    'tools-question',
  ],
  [
    'How do different agents communicate and stay up to date?',
    'Tasks share a project inventory with ownership, scopes, dependencies, and messages. Agents can send direct task messages or project broadcasts. Jackalope supplies a bounded briefing at launch and continuation, then attaches relevant updates to its own tool responses. Agents can check the durable inbox between those checkpoints. Delivery does not guarantee that an agent has read or acted on an update, and messages do not automatically wake agents, approve changes, or merge work.',
    'coordination-question',
  ],
  [
    'Can I download Jackalope now?',
    downloadUrl
      ? 'The Windows release is available below. Bring a local Git project and a supported, signed-in coding agent.'
      : 'Public downloads are not open yet. Join the waitlist and we’ll email you when access is ready.',
  ],
  [
    'Does an invitation include a download?',
    'A valid direct invitation skips the waitlist after you verify your email, while the inviter has capacity. Your account shows downloads when a build is available.',
  ],
];

export function App({ path = '/' }: { path?: string }) {
  useEffect(() => {
    waitlistReferral();
  }, []);
  const home = path === '/';
  const marketingPage = marketingPages.find((page) => page.path === path);
  const [theme, setTheme] = useState<ThemePalette>(DEFAULT_WEBSITE_THEME);
  const dark = theme.isDark;
  const palette = PRESET_THEMES.findIndex((preset) => preset.id === theme.id);
  const updateTheme = (next: ThemePalette) => {
    applyThemeTokens(next);
    saveWebsiteTheme(next);
    setTheme(next);
  };
  const setDark = (isDark: boolean) => updateTheme({ ...theme, isDark });
  const setPalette = (index: number) =>
    updateTheme({ ...PRESET_THEMES[index], isDark: dark, atmosphere: 18 });
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const videoTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    setTheme(readWebsiteTheme());
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={`site-header${home ? ' landing-header' : ''}`}>
        <div className="header-inner">
          <a href="/" className="wordmark" aria-label="Jackalope home">
            <BrandMark />
            Jackalope
          </a>
          <nav className="desktop-nav" aria-label="Main navigation">
            <a href={home ? '#inside' : '/#inside'}>Product</a>
            <a href="/compare/">Compare</a>
            <a href="/agents/" aria-current={path.startsWith('/agents/') ? 'page' : undefined}>
              Agents
            </a>
            <a href="/knowledge/" aria-current={path.startsWith('/knowledge') ? 'page' : undefined}>
              Knowledgebase
            </a>
            <a href="/blog/" aria-current={path.startsWith('/blog/') ? 'page' : undefined}>
              Field notes
            </a>
          </nav>
          <div className="header-actions">
            {path !== '/access/' && (
              <a className="member-entry" href="/access/">
                Member access
              </a>
            )}
            <button
              className="icon-button appearance-toggle"
              type="button"
              aria-label={`Switch to ${dark ? 'light' : 'dark'} appearance`}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {path === '/access/' || path === '/feedback/' ? (
              <a className="text-link" href="/tour/">
                Take a look around <ArrowRight size={15} />
              </a>
            ) : (
              <DownloadButton compact />
            )}
            <Menu.Root>
              <Menu.Trigger asChild>
                <button
                  type="button"
                  className="icon-button mobile-menu"
                  aria-label="Open navigation"
                >
                  <MenuIcon size={22} />
                </button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content
                  className="nav-menu"
                  align="end"
                  sideOffset={12}
                  collisionPadding={16}
                >
                  <Menu.Item onSelect={() => setDark(!dark)}>
                    Switch to {dark ? 'light' : 'dark'} appearance
                  </Menu.Item>
                  {[
                    ['Your waitlist place', '/waitlist/'],
                    ['Member access', '/access/'],
                    ['Compare workflows', '/compare/'],
                    ['Product tour', '/#inside'],
                    ['Knowledgebase & Guides', '/knowledge/'],
                    ['Parallel coding agents', '/parallel-coding-agents/'],
                    ['Git worktrees for agents', '/git-worktrees-for-ai-agents/'],
                    ['Supported agents', '/agents/'],
                    ['Review AI-generated code', '/guides/review-ai-generated-code/'],
                    ['Make it yours', '/#atmosphere'],
                    ['Questions', '/#questions'],
                    ['Changelog', '/changelog/'],
                    ['Roadmap', '/roadmap/'],
                    ['Field notes', '/blog/'],
                  ].map(([label, href]) => (
                    <Menu.Item key={href} asChild>
                      <a href={href}>{label}</a>
                    </Menu.Item>
                  ))}
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          </div>
        </div>
      </header>

      {home ? (
        <LandingPage
          available={Boolean(downloadUrl)}
          releaseVersion={version}
          action={<DownloadButton />}
          downloadAction={
            downloadUrl ? (
              <a className="button button-primary button-download" href={downloadUrl}>
                Download for Windows <ArrowDownToLine size={18} />
              </a>
            ) : (
              <Signup />
            )
          }
          dark={dark}
          setDark={setDark}
          palette={palette}
          setPalette={setPalette}
          onPlay={() => {
            videoTrigger.current = document.activeElement as HTMLElement;
            setVideoError(false);
            setVideoOpen(true);
          }}
          faqs={faqs}
        />
      ) : path === '/feedback/' ? (
        <FeedbackPage />
      ) : path === '/waitlist/' ? (
        <WaitlistPage />
      ) : path === '/access/' ? (
        <AccessPage />
      ) : path.startsWith('/knowledge/') ? (
        <KnowledgebasePage path={path} dark={dark} />
      ) : path === '/privacy/' || path === '/terms/' ? (
        <LegalPage kind={path === '/privacy/' ? 'privacy' : 'terms'} />
      ) : path === '/roadmap/' ? (
        <RoadmapPage />
      ) : marketingPage ? (
        <MarketingPage page={marketingPage} dark={dark} />
      ) : (
        <JournalPage path={path} />
      )}

      {!['/', '/privacy/', '/terms/', '/access/', '/waitlist/', '/feedback/', '/roadmap/'].includes(
        path,
      ) && <Newsletter />}

      <Footer home={home} path={path} />

      <Dialog.Root open={videoOpen} onOpenChange={setVideoOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="video-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              videoTrigger.current?.focus({ preventScroll: true });
            }}
          >
            <div className="video-heading">
              <div>
                <Dialog.Title>Jackalope walkthrough</Dialog.Title>
                <Dialog.Description className="sr-only">
                  Explore the Jackalope workspace.
                </Dialog.Description>
              </div>
              <Dialog.Close className="icon-button" aria-label="Close walkthrough">
                <X size={22} />
              </Dialog.Close>
            </div>
            {videoError ? (
              <div className="video-error">
                <p>The walkthrough couldn’t load. You can still explore the app screenshots.</p>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => {
                    setVideoOpen(false);
                    document.getElementById('inside')?.scrollIntoView();
                  }}
                >
                  Explore the workspace
                  <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <video
                controls
                playsInline
                preload="metadata"
                poster={tour.poster}
                aria-label="Jackalope launch film"
                onError={() => setVideoError(true)}
              >
                <source src={tour.video} type="video/mp4" onError={() => setVideoError(true)} />
                <track
                  kind="captions"
                  src={tour.captions}
                  srcLang="en"
                  label="English descriptions"
                />
              </video>
            )}
            <p className="video-transcript">{tour.transcript}</p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
