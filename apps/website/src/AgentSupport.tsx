import { ArrowRight, Check, Code2 } from 'lucide-react';

const agents = [
  {
    name: 'Codex',
    mark: '</>',
    url: 'https://learn.chatgpt.com/docs/codex/cli',
    note: 'Your OpenAI coding agent, with project connections and reported usage.',
    connections: 'stdio · HTTP',
    signIn: 'CLI status check',
  },
  {
    name: 'Claude Code',
    mark: '✳',
    url: 'https://code.claude.com/docs/en/overview',
    note: 'Use Claude Code with connected tools and answer its questions in Jackalope.',
    connections: 'stdio · HTTP · SSE',
    signIn: 'CLI status check',
  },
  {
    name: 'Grok',
    mark: '↗',
    url: 'https://docs.x.ai/build/overview',
    note: 'Bring your Grok CLI sessions into the same task and review workflow.',
    signIn: 'CLI account and model check',
    connections: 'On-demand discovery',
  },
  {
    name: 'OpenCode',
    mark: '[ ]',
    url: 'https://opencode.ai/docs/',
    note: 'Choose your OpenCode provider and model, including available free or local options.',
    connections: 'stdio · HTTP · SSE',
  },
  {
    name: 'Kimi Code',
    mark: 'K',
    url: 'https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html',
    note: 'Use Kimi for tasks and routing, with separate accounts, model choices, and task approvals.',
    connections: 'stdio · HTTP · SSE',
    signIn: 'CLI authentication; model access checked on launch',
    guide: '/agents/kimi-code/',
  },
  {
    name: 'Antigravity',
    mark: '↑',
    url: 'https://antigravity.google/docs/cli/install/',
    note: 'Run agy as a worker. Named accounts use Gemini API keys; subscription login is shared.',
    connections: 'On-demand discovery',
  },
];

export function AgentSupport() {
  return (
    <section
      id="agents"
      className="agent-support section-space page-width"
      aria-labelledby="agent-support-title"
    >
      <div className="agent-support-heading">
        <div>
          <h2 id="agent-support-title">Supported agents</h2>
        </div>
        <p>
          Choose the right agent for each project. Keep the brief, attempts, changes, and review
          together when your tools change.
        </p>
      </div>
      <div className="agent-support-list">
        {agents.map((agent) => (
          <div className="agent-support-row" key={agent.name}>
            <span className="agent-support-mark" aria-hidden="true">
              {agent.mark}
            </span>
            <h3>{agent.name}</h3>
            <p>{agent.note}</p>
            <a
              href={agent.guide ?? agent.url}
              target={agent.guide ? undefined : '_blank'}
              rel={agent.guide ? undefined : 'noreferrer'}
              aria-label={`Set up ${agent.name}`}
            >
              {agent.guide ? 'Setup guide' : 'Get the CLI'} <ArrowRight size={15} />
            </a>
          </div>
        ))}
      </div>
      <div className="agent-support-common">
        <Check size={17} /> Tasks & review <span>·</span> Session continuation <span>·</span> Usage
        when reported
      </div>
      <details className="agent-support-details">
        <summary>
          <Code2 size={17} /> Which features work with which agents?
        </summary>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users can scroll the comparison on narrow screens. */}
        <section className="agent-support-table" aria-label="Agent connection support" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Project connections</th>
                <th>Sign-in checks</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.name}>
                  <th scope="row">{agent.name}</th>
                  <td>{agent.connections}</td>
                  <td>{agent.signIn ?? 'Provider checks on launch'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <p>
          Jackalope uses each agent’s installed CLI and permission rules. Connections configured
          inside a CLI remain subject to that CLI’s settings. Codex, Claude Code, OpenCode, and Kimi
          Code support direct project connections; all six support on-demand discovery. Kimi reports
          task token totals and membership quota. Antigravity reports subscription pools through
          read-only CLI commands. Usage coverage varies by account and CLI version. Profiles
          organize sign-ins; they are not a security sandbox.
        </p>
        <p>
          Named profiles are available for supported agents. Antigravity profiles use Gemini API
          billing, separate from a Google subscription; multiple subscription logins are not
          isolated. Antigravity runs worker tasks; a verified tool-free interface is still needed
          for automatic routing and Ask Jackalope. Kimi supports both. Gemini CLI, Aider, and Goose
          have account setup only; task execution is still in development.
        </p>
        <p>
          Model access and subscription requirements depend on your provider. See the{' '}
          <a href="/roadmap/">roadmap</a> for upcoming agent support.
        </p>
      </details>
    </section>
  );
}
