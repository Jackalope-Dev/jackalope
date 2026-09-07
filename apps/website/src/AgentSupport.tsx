import { ArrowRight, Check, Code2 } from 'lucide-react';

const agents = [
  {
    name: 'Codex',
    mark: '</>',
    url: 'https://developers.openai.com/codex/cli/',
    note: 'Your OpenAI coding agent, with project connections and reported usage.',
    connections: 'stdio · HTTP',
  },
  {
    name: 'Claude Code',
    mark: '✳',
    url: 'https://code.claude.com/docs/en/overview',
    note: 'Your Claude workflow, with connected tools and in-app questions through the task bridge.',
    connections: 'stdio · HTTP · SSE',
  },
  {
    name: 'Grok',
    mark: '↗',
    url: 'https://docs.x.ai/build/overview',
    note: 'Bring your Grok CLI sessions into the same task and review workflow.',
    connections: 'On-demand discovery',
  },
  {
    name: 'OpenCode',
    mark: '[ ]',
    url: 'https://opencode.ai/docs/',
    note: 'Choose your OpenCode provider and model, including available free or local options.',
    connections: 'CLI configuration only',
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
              href={agent.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Set up ${agent.name}`}
            >
              Get the CLI <ArrowRight size={15} />
            </a>
          </div>
        ))}
      </div>
      <div className="agent-support-common">
        <Check size={17} /> Tasks & review <span>·</span> Session continuation <span>·</span>{' '}
        Account profiles <span>·</span> Reported task usage
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
              {agents.map((agent, index) => (
                <tr key={agent.name}>
                  <th scope="row">{agent.name}</th>
                  <td>{agent.connections}</td>
                  <td>{index < 2 ? 'CLI status check' : 'Provider checks on launch'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <p>
          Jackalope is in prerelease. These adapters use each agent’s installed CLI and permission
          rules. Connections configured inside a CLI remain subject to that CLI’s settings; project
          connections support Codex and Claude Code, with on-demand discovery for Grok. Usage shows
          what an agent reports, not complete provider billing. Profiles organize sign-ins; they are
          not a security sandbox.
        </p>
        <p>
          Gemini CLI is being evaluated. We’ll list further agents here as their integrations are
          verified. Model access, subscription requirements, and availability belong to the
          provider.
        </p>
      </details>
    </section>
  );
}
