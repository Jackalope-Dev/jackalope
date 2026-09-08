export interface AgentMetadata {
  id: string;
  name: string;
  vendor: string;
  description: string;
  strengths: readonly string[];
  installCommand?: string;
  installUrl: string;
  defaultBinary: string;
  accountEnvVar?: string;
  loginCommand?: string;
}

export const builtinAgents = [
  {
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI',
    description:
      'Specialized in fast, precise code generation, Python, systems, and deep codebase changes.',
    strengths: ['backend', 'systems', 'python', 'refactoring', 'fast-edits'],
    installCommand: 'npm install -g @openai/codex',
    installUrl: 'https://learn.chatgpt.com/docs/app-server',
    defaultBinary: 'codex',
    accountEnvVar: 'CODEX_HOME',
    loginCommand: 'codex login',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    vendor: 'Anthropic',
    description:
      'Exceptional for complex architecture, deep reasoning, frontend/UI, documentation, and multi-file refactoring.',
    strengths: ['frontend', 'architecture', 'react', 'css', 'documentation', 'reasoning'],
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    installUrl: 'https://code.claude.com/docs/en/overview',
    defaultBinary: 'claude',
    accountEnvVar: 'CLAUDE_CONFIG_DIR',
    loginCommand: 'claude auth login',
  },
  {
    id: 'grok',
    name: 'Grok',
    vendor: 'xAI',
    description:
      'High-speed reasoning, fast multi-step iteration, web-augmented research, and code verification.',
    strengths: ['reasoning', 'verification', 'testing', 'search', 'algorithms'],
    installCommand: 'npm install -g @xai/grok-cli',
    installUrl: 'https://docs.x.ai',
    defaultBinary: 'grok',
    accountEnvVar: 'GROK_HOME',
    loginCommand: 'grok login',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    vendor: 'OpenCode AI',
    description:
      'Open-source agent supporting local, offline, and customizable multi-provider models.',
    strengths: ['local-models', 'offline', 'custom-providers', 'budget-conscious'],
    installCommand: 'npm install -g opencode-ai',
    installUrl: 'https://opencode.ai/docs/',
    defaultBinary: 'opencode',
    accountEnvVar: 'XDG_DATA_HOME',
    loginCommand: 'opencode auth login',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    vendor: 'Google DeepMind',
    description:
      'Advanced agentic coding with high-level planning, subagent orchestration, and native tools.',
    strengths: ['planning', 'orchestration', 'subagents', 'complex-workflows'],
    installCommand: 'curl -fsSL https://antigravity.google/install.sh | bash',
    installUrl: 'https://antigravity.google/docs/cli/',
    defaultBinary: 'agy',
    loginCommand: 'agy auth login',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    vendor: 'Google',
    description:
      'Powered by Gemini models for rapid code generation, large context inspection, and multimodal tasks.',
    strengths: ['large-context', 'multimodal', 'documentation', 'fast-prototyping'],
    installCommand: 'npm install -g @google/gemini-cli',
    installUrl: 'https://github.com/google-gemini/gemini-cli',
    defaultBinary: 'gemini',
    accountEnvVar: 'GEMINI_CLI_HOME',
    loginCommand: 'gemini login',
  },
  {
    id: 'aider',
    name: 'Aider',
    vendor: 'Paul Gauthier',
    description:
      'Git-integrated command-line pair programming for fast, tight interactive coding loops.',
    strengths: ['git-workflow', 'targeted-fixes', 'pair-programming', 'diff-oriented'],
    installCommand: 'pipx install aider-chat',
    installUrl: 'https://aider.chat/docs/install.html',
    defaultBinary: 'aider',
    accountEnvVar: 'AIDER_HOME',
  },
  {
    id: 'goose',
    name: 'Goose',
    vendor: 'Block',
    description:
      'Extensible open-source on-machine developer agent with tool integration and automation.',
    strengths: ['automation', 'scripting', 'extensibility', 'developer-tools'],
    installCommand:
      'curl -fsSL https://github.com/block/goose/releases/latest/download/download.sh | bash',
    installUrl: 'https://block.github.io/goose/',
    defaultBinary: 'goose',
    accountEnvVar: 'GOOSE_HOME',
  },
] as const;

export type BuiltinAgentId = (typeof builtinAgents)[number]['id'];

export function getAgentMetadata(id: string): AgentMetadata | undefined {
  return (builtinAgents as readonly AgentMetadata[]).find((agent) => agent.id === id);
}
