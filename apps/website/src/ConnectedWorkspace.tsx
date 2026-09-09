import { ArrowRight, GitBranch, MessagesSquare, Search, Waypoints } from 'lucide-react';
import { BrandMark } from './BrandMark';
import './connected-workspace.css';

const strengths = [
  {
    icon: GitBranch,
    title: 'Multiple agents. Work and personal accounts.',
    description:
      'Build a different lineup for every project. Choose allowed agents and default accounts, with managed profiles for Codex, Claude Code, Grok, and OpenCode.',
    href: '/blog/work-and-personal-accounts/',
    link: 'Explore account profiles',
  },
  {
    icon: Search,
    title: 'Route the work. Keep the momentum.',
    description:
      'Let your default agent choose an agent, model, and account from your project’s allowed lineup. Routing considers reported capacity; quota-aware handoffs preserve the work when an eligible fallback is available. Prefer a specific setup? Assign it yourself.',
    href: '#routing-question',
    link: 'How routing works today',
  },
  {
    icon: Waypoints,
    title: 'MCP, browser, and native desktop tools.',
    description:
      'Discover MCP tools and connect them to your projects. Give agents built-in browser actions, screenshots, and local checks. On Windows, explicitly grant a desktop window for accessibility snapshots, clicks, typing, and scrolling.',
    href: '#tools-question',
    link: 'See tool support and boundaries',
  },
  {
    icon: MessagesSquare,
    title: 'Cross-agent communication, built in.',
    description:
      'Give agents a shared view of active project work, ownership, scopes, and dependencies. They can send direct messages or project broadcasts; relevant updates arrive at launch, continuation, and Jackalope tool checkpoints.',
    href: '#coordination-question',
    link: 'How agents stay informed',
  },
];

export function ConnectedWorkspace() {
  return (
    <section
      className="landing-width connected-workspace"
      id="connected"
      aria-labelledby="connected-title"
      data-reveal=""
    >
      <div className="connected-heading">
        <h2 id="connected-title">
          Bring your
          <br />
          <span>whole setup.</span>
        </h2>
        <p>
          Your work accounts. Your personal projects. Your preferred agents and tools. Give them a
          shared place to work, with you in control.
        </p>
      </div>
      <figure className="connection-map">
        <div className="connection-map-layout" aria-hidden="true">
          <div className="connection-accounts">
            <div>
              <span>Work accounts</span>
              <strong>
                Codex <i>+</i> Claude Code
              </strong>
            </div>
            <div>
              <span>Personal accounts</span>
              <strong>
                Grok <i>+</i> OpenCode
              </strong>
            </div>
          </div>
          <span className="connection-link">
            <ArrowRight size={22} />
          </span>
          <div className="connection-project">
            <BrandMark />
            <strong>Your project</strong>
            <span>Your agent lineup</span>
          </div>
          <span className="connection-link">
            <ArrowRight size={22} />
          </span>
          <div className="connection-resources">
            <div>
              <Waypoints size={22} />
              <span>
                <strong>Tools to act</strong>
                <small>MCP · Browser · Windows desktop</small>
              </span>
            </div>
            <div>
              <MessagesSquare size={22} />
              <span>
                <strong>Context to coordinate</strong>
                <small>Project briefings · Agent messages</small>
              </span>
            </div>
          </div>
        </div>
      </figure>
      <div className="connected-strengths">
        {strengths.map(({ icon: Icon, title, description, href, link }) => (
          <article key={title}>
            <Icon className="connected-icon" size={24} aria-hidden="true" />
            <h3>{title}</h3>
            <p>{description}</p>
            <a
              href={href}
              onClick={() => {
                if (!href.startsWith('#')) return;
                const question = document.getElementById(href.slice(1));
                if (question instanceof HTMLDetailsElement) question.open = true;
              }}
            >
              {link}
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
