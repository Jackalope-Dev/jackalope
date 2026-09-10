import { BrandMark } from './BrandMark';
import './footer.css';

const groups = [
  {
    title: 'Product',
    links: [
      ['App tour', '/tour/'],
      ['Compare workflows', '/compare/'],
      ['Parallel agents', '/parallel-coding-agents/'],
      ['Git worktrees', '/git-worktrees-for-ai-agents/'],
      ['Project context', '/features/project-context-for-coding-agents/'],
      ['Browser automation', '/features/browser-automation-for-coding-agents/'],
      ['Recurring tasks', '/features/recurring-coding-agent-tasks/'],
    ],
  },
  {
    title: 'Resources',
    links: [
      ['Knowledgebase', '/knowledge/'],
      ['Run agents together', '/guides/run-codex-and-claude-code-in-parallel/'],
      ['Review AI-generated code', '/guides/review-ai-generated-code/'],
      ['Field notes', '/blog/'],
      ['Changelog', '/changelog/'],
      ['Roadmap', '/roadmap/'],
    ],
  },
  {
    title: 'Agents',
    links: [
      ['Supported agents', '/agents/'],
      ['Codex', '/agents/codex/'],
      ['Claude Code', '/agents/claude-code/'],
      ['Grok', '/agents/grok/'],
      ['OpenCode', '/agents/opencode/'],
    ],
  },
  {
    title: 'Connect',
    links: [
      ['Your waitlist place', '/waitlist/'],
      ['Your access & passes', '/access/'],
      ['Questions', '/#questions'],
      ['Follow on X', 'https://x.com/JackalopeDotDev'],
      ['Join us on Reddit', 'https://www.reddit.com/r/JackalopeDev/'],
    ],
  },
];

export function Footer({ home, path }: { home: boolean; path: string }) {
  return (
    <footer className={`site-footer ${home ? 'landing-footer' : 'page-width'}`}>
      {!home && (
        <a href="/" className="wordmark" aria-label="Jackalope home">
          <BrandMark />
          Jackalope
        </a>
      )}
      <nav className="footer-navigation" aria-label="Footer navigation">
        {groups.map((group) => (
          <div className="footer-group" key={group.title}>
            <h2>{group.title}</h2>
            <ul>
              {group.links.map(([label, href]) => (
                <li key={href}>
                  <a
                    href={href}
                    aria-current={href === path ? 'page' : undefined}
                    rel={href === 'https://x.com/JackalopeDotDev' ? 'me' : undefined}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="footer-bottom">
        <p>
          A product of <a href="https://jackalope.digital">Jackalope Digital LLC</a>.
        </p>
        <nav className="footer-legal" aria-label="Legal and site information">
          <a href="/privacy/" aria-current={path === '/privacy/' ? 'page' : undefined}>
            Privacy
          </a>
          <a href="/terms/" aria-current={path === '/terms/' ? 'page' : undefined}>
            Terms
          </a>
          <a href="/sitemap.xml">Sitemap</a>
        </nav>
      </div>
    </footer>
  );
}
