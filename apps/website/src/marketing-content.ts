import { comparisonPages } from './comparison-content.ts';
import { growthPages } from './growth-content.ts';

export type MarketingPage = {
  path: string;
  kind: string;
  title: string;
  description: string;
  headline: string;
  lede: string;
  image: 'tasks' | 'review' | 'agents';
  signals: string[];
  comparison?: {
    name: string;
    reviewed: string;
    overview: {
      jackalope: string;
      competitor: string;
      shared: string[];
    };
    rows: Array<{ topic: string; jackalope: string; competitor: string }>;
    sources: Array<{ href: string; label: string }>;
    faqs: Array<{ question: string; answer: string }>;
  };
  sections: Array<{
    title: string;
    paragraphs: string[];
    bullets?: string[];
    links?: Array<{ href: string; label: string }>;
    table?: { columns: string[]; rows: string[][] };
  }>;
  related: Array<{ href: string; label: string }>;
};

export const marketingPages: MarketingPage[] = [
  ...growthPages,
  ...comparisonPages,
  {
    path: '/parallel-coding-agents/',
    kind: 'Product guide',
    title: 'Parallel coding agents with one review workflow | Jackalope',
    description:
      'Run Codex, Claude Code, Grok, OpenCode, Kimi Code, and Antigravity in parallel worktrees with shared project context and review in Jackalope.',
    headline: 'Run coding agents in parallel. Keep the work coherent.',
    lede: 'Jackalope is a desktop workspace for assigning focused tasks to Codex, Claude Code, Grok, OpenCode, Kimi Code, and Antigravity, following their progress, and reviewing the combined result before integration.',
    image: 'tasks',
    signals: [
      'Multiple agents',
      'Isolated worktrees',
      'Shared project context',
      'Review before merge',
    ],
    sections: [
      {
        title: 'Parallel work needs more than extra terminals.',
        paragraphs: [
          'Opening several coding-agent sessions is easy. Keeping their briefs, dependencies, questions, changes, and decisions aligned is the harder part. Jackalope turns each outcome into a task and keeps related work visible at the project level.',
          'A parallel plan can define focused tasks, file scopes, dependencies, assigned agents, and a concurrency limit. Independent tasks can run at the same time; dependent work waits for the changes it needs to be explicitly integrated.',
        ],
      },
      {
        title: 'Separate the files. Coordinate the decisions.',
        paragraphs: [
          'Each parallel task can receive its own Git worktree and branch, preventing two agents from editing the same checkout. Project instructions and relevant updates keep each agent informed about related work.',
        ],
        bullets: [
          'Choose Codex, Claude Code, Grok, OpenCode, Kimi Code, or Antigravity per task.',
          'Keep task questions and follow-up attempts attached to the original outcome.',
          'Pause new tasks while active tasks continue.',
          'Inspect each result and the combined patch before changing the target branch.',
        ],
      },
      {
        title: 'Return to one review queue.',
        paragraphs: [
          'A finished response is not the finish line. Jackalope keeps the result, patch, reported checks, evidence, and attempt history together. When several tasks belong together, review preparation checks their current source state and produces a combined result without silently modifying your main checkout.',
        ],
      },
      {
        title: 'Split by independent outcomes.',
        paragraphs: [
          'For a search feature, one task can investigate a ranking regression while another updates help text that does not depend on the fix. If a third task changes the API consumed by the interface, decide the contract first and make the interface task depend on that integration.',
          'Give each task a file scope, an expected behavior, and a check it can run. Start with two workers and increase concurrency only when their scopes remain understandable. Shared files, database migrations, generated outputs, and fixed development-server ports can create dependencies even when the prompts sound independent.',
        ],
        links: [
          {
            href: '/guides/run-codex-and-claude-code-in-parallel/',
            label: 'Work through a two-agent plan',
          },
        ],
      },
      {
        title: 'When sequential work is the better fit.',
        paragraphs: [
          'Keep a task sequential when the next step depends on a decision you have not made, or when every proposed worker would edit the same module. A separate worktree prevents checkout collisions but cannot supply an unresolved product requirement.',
          'If a prerequisite fails, inspect and correct that task before starting its dependents. If it succeeds, review and integrate the prerequisite first so downstream work starts from the accepted code. Completion messages alone do not release dependencies.',
        ],
        links: [
          {
            href: '/knowledge/git-worktrees/',
            label: 'Dependency and integration safeguards',
          },
        ],
      },
    ],
    related: [
      { href: '/git-worktrees-for-ai-agents/', label: 'Git worktrees for AI agents' },
      {
        href: '/guides/run-codex-and-claude-code-in-parallel/',
        label: 'Run Codex and Claude Code together',
      },
      { href: '/guides/review-ai-generated-code/', label: 'Review agent-generated code' },
    ],
  },
  {
    path: '/git-worktrees-for-ai-agents/',
    kind: 'Workflow guide',
    title: 'Git worktrees for AI coding agents | Jackalope',
    description:
      'Learn how Jackalope uses isolated Git worktrees to run AI coding agents in parallel and guards review, integration, recovery, and cleanup.',
    headline: 'Give every coding-agent task its own Git worktree.',
    lede: 'Worktrees let several coding agents work on one repository without sharing a working directory. Jackalope keeps each worktree connected to its task, history, and review.',
    image: 'review',
    signals: [
      'One task per checkout',
      'Target-branch checks',
      'Combined patch review',
      'Recoverable cleanup',
    ],
    sections: [
      {
        title: 'Why worktrees matter for coding agents.',
        paragraphs: [
          'Two agents in one checkout can overwrite files, change the active branch, or make a clean review difficult. A Git worktree gives each task a separate working directory and branch while sharing the repository’s object database.',
          'Isolation does not eliminate semantic conflicts. Two locally correct patches can still disagree about an API or shared assumption. That is why Jackalope treats the combined review as a separate decision.',
        ],
      },
      {
        title: 'Keep the worktree and its task together.',
        paragraphs: [
          'Jackalope creates each task worktree from your chosen branch. Return to its history, review its changes, and keep active or interrupted work safe from cleanup. Before merging, Jackalope checks that the source files and target branch still match your review.',
        ],
        bullets: [
          'Dependent tasks wait until the changes they need have been merged.',
          'Review the combined patch before updating your target branch.',
          'If the branch has changed, resolve the difference before merging. Your unrelated edits stay intact.',
          'Archive work you want to keep before removing its worktree.',
        ],
      },
      {
        title: 'Know what a worktree separates.',
        paragraphs: [
          'Worktrees separate working directories. They do not restrict an agent’s access to other local files. Your agent permissions still apply; review the code and run project checks before merging.',
        ],
      },
      {
        title: 'Prepare more than the branch.',
        paragraphs: [
          'A worktree contains checked-in files, but it may not contain installed packages, ignored environment files, or a running database. Record the setup commands in project guidance and establish the same build in the new checkout before asking an agent to diagnose application behavior.',
          'Give local servers distinct ports and check whether tools write to shared caches or external services. Worktrees share Git repository data; they do not create separate operating-system accounts or automatically isolate services.',
        ],
        links: [
          {
            href: 'https://git-scm.com/docs/git-worktree',
            label: 'Git’s worktree reference',
          },
        ],
      },
      {
        title: 'Review cleanup as carefully as creation.',
        paragraphs: [
          'After integration, confirm which branch contains the accepted change and inspect remaining uncommitted and untracked work. A branch being merged does not establish that every file in its working directory was included. Keep active or interrupted tasks until their state is understood.',
          'If a worktree is locked, identify the process using it before attempting cleanup. Stop the process you own, preserve any needed output, and retry. A lock error is a recovery problem, not a reason to discard task history or force removal.',
        ],
        links: [
          {
            href: '/knowledge/resolving-git-worktree-locks/',
            label: 'Diagnose worktree locks',
          },
          {
            href: '/knowledge/git-worktrees/',
            label: 'Jackalope integration and cleanup rules',
          },
        ],
      },
    ],
    related: [
      { href: '/parallel-coding-agents/', label: 'Parallel coding agents' },
      { href: '/guides/review-ai-generated-code/', label: 'A practical review workflow' },
      {
        href: '/features/project-context-for-coding-agents/',
        label: 'Project context for every task',
      },
    ],
  },
  {
    path: '/agents/',
    kind: 'Agent compatibility',
    title: 'Supported AI coding agents | Jackalope',
    description:
      'Compare Codex, Claude Code, Grok, OpenCode, Kimi Code, and Antigravity support for tasks, tools, accounts, and usage in Jackalope.',
    headline: 'Bring the coding agents you already use.',
    lede: 'Jackalope works around installed agent CLIs and their provider accounts. Choose an agent per task while keeping the brief, progress, changes, and review in one project workflow.',
    image: 'agents',
    signals: ['Codex', 'Claude Code', 'Grok', 'OpenCode', 'Kimi Code', 'Antigravity'],
    sections: [
      {
        title: 'Choose by the connection your task needs.',
        paragraphs: [
          'Jackalope runs installed coding-agent CLIs. Start with your required provider, account, model, and tools, then check the adapter below. An agent logo or successful account setup does not establish that Jackalope can execute tasks with it.',
          'All six native adapters implement tasks, continuation, and review. Usage reporting varies by CLI and account. Kimi exposes task token totals and membership limits; Antigravity subscription quota requires a CLI with read-only command output. The tool and account differences are important when moving a working CLI setup into a project.',
        ],
      },
      {
        title: 'Current agent compatibility',
        paragraphs: [
          'These are implemented capabilities. Jackalope is coming soon; validate your installed CLI version, sign-in, and required tool flow when you receive access.',
        ],
        table: {
          columns: ['Agent', 'Project tools', 'Account behavior'],
          rows: [
            [
              'Codex',
              'Direct stdio and HTTP connections.',
              'Named sign-ins; CLI status check; reported capacity windows.',
            ],
            [
              'Claude Code',
              'Direct stdio, HTTP, and SSE connections.',
              'Named sign-ins; CLI status check; continuations retain their account.',
            ],
            [
              'Grok Build',
              'On-demand discovery through the HTTP bridge; no direct injection.',
              'Named profiles; account identity and models read through ACP; access checked at launch.',
            ],
            [
              'OpenCode',
              'Direct stdio, HTTP, and SSE connections, plus on-demand discovery.',
              'Named profiles separate configuration and data; access checked at launch.',
            ],
            [
              'Kimi Code',
              'Direct stdio, HTTP, and SSE; tool approvals and structured questions.',
              'Named sign-ins; account model choices; task tokens and membership quota.',
            ],
            [
              'Antigravity',
              'On-demand discovery; worker tasks, not automatic routing coordination.',
              'Named profiles use Gemini API keys. Shared subscription login has reported quota windows.',
            ],
          ],
        },
        links: [
          {
            href: '/agents/codex/',
            label: 'Codex setup',
          },
          {
            href: '/agents/claude-code/',
            label: 'Claude Code setup',
          },
          {
            href: '/agents/grok/',
            label: 'Grok Build setup',
          },
          {
            href: '/agents/opencode/',
            label: 'OpenCode setup',
          },
          { href: '/agents/kimi-code/', label: 'Kimi Code setup and limits' },
        ],
      },
      {
        title: 'Worker agents and setup-only candidates.',
        paragraphs: [
          'Kimi Code uses the kimi CLI for tasks, automatic routing, and Ask Jackalope, with account profiles, model selection, continuation, and in-task permission choices. Authenticated installed-app acceptance remains open.',
          'Antigravity uses the agy CLI for worker tasks. Its named profiles use Gemini API keys with separate API billing; they do not create isolated subscription sign-ins. Use its existing subscription login only with that shared-login limitation in mind.',
          'Gemini CLI, Aider, and Goose offer account setup in the catalog but do not have native task execution adapters. Hermes and other unlisted agents are not supported task runners. Use the roadmap to follow planned support rather than assuming a configured executable can run as another agent.',
        ],
        links: [
          {
            href: 'https://antigravity.google/docs/cli/install/',
            label: 'Antigravity installation and authentication',
          },
          {
            href: '/roadmap/',
            label: 'Planned agent support',
          },
        ],
      },
      {
        title: 'Check a new setup in three steps.',
        paragraphs: [
          'First, confirm the CLI and chosen account work on the host. Next, launch a small task against a project with passing baseline checks. Finally, continue the task with one correction and verify that the account and history remain attached to the original attempt.',
          'If the task needs a connected service, include a harmless read from that service. Test that exact agent and connection instead of relying on the connection’s saved state. A missing tool, an expired sign-in, and a failing repository build need different fixes.',
        ],
        links: [
          {
            href: '/knowledge/multi-account-and-agents/',
            label: 'Accounts and credential boundaries',
          },
          {
            href: '/knowledge/connecting-custom-mcp-servers/',
            label: 'Project connection setup',
          },
        ],
      },
      {
        title: 'Keep model access and workspace access distinct.',
        paragraphs: [
          'Jackalope does not include a model subscription. Your provider determines available models, permissions, and charges. Task usage shows reported activity from Jackalope attempts; account capacity can include other clients and is not a complete billing statement.',
          'Choose the account deliberately for each project. Changing a default affects future tasks, while a continuation retains its original account. Profiles organize sign-ins and settings; they do not restrict an agent’s access to local files.',
        ],
        links: [
          {
            href: '/knowledge/task-routing-and-quotas/',
            label: 'Capacity, routing, and explicit assignments',
          },
        ],
      },
    ],
    related: [
      { href: '/agents/codex/', label: 'Use Codex with Jackalope' },
      { href: '/agents/claude-code/', label: 'Use Claude Code with Jackalope' },
      {
        href: '/guides/run-codex-and-claude-code-in-parallel/',
        label: 'Run Codex and Claude Code in parallel',
      },
    ],
  },
  {
    path: '/agents/codex/',
    kind: 'Agent integration',
    title: 'Run Codex in a desktop project workspace | Jackalope',
    description:
      'Run Codex tasks in isolated Git worktrees with project context, MCP connections, account profiles, reported usage, and review in Jackalope.',
    headline: 'Give Codex a project-aware place to work.',
    lede: 'Use your installed Codex CLI and OpenAI account while Jackalope keeps each task connected to its project, selected tools, worktree, result, and review.',
    image: 'agents',
    signals: ['Installed Codex CLI', 'Project MCP', 'Account profiles', 'Usage windows'],
    sections: [
      {
        title: 'Connect the Codex CLI you already use.',
        paragraphs: [
          'Jackalope launches your installed Codex CLI. An OpenAI account in a browser is not enough: the executable and the account selected for the task must be usable on the machine running Jackalope. Start with the official CLI installation and sign-in instructions, then check Codex in Agents → Configuration.',
          'Choose a local Git project whose normal build already works. Add the build command and project conventions to its instructions. Your first task should have one observable result, such as fixing a failing parser test, so you can separate setup problems from implementation problems.',
        ],
        links: [
          {
            href: 'https://learn.chatgpt.com/docs/codex/cli',
            label: 'Install and sign in to Codex CLI',
          },
          {
            href: '/knowledge/fixing-cli-path-on-windows/',
            label: 'Fix a CLI that Jackalope cannot find',
          },
        ],
      },
      {
        title: 'Pin the account before starting client work.',
        paragraphs: [
          'Named Codex profiles let you organize work and personal sign-ins separately. Choose the project’s Codex account in Project → Settings. Changing the active account affects new tasks; continuing an existing task retains the profile that started it.',
          'If a task reports an authentication problem, inspect the selected profile instead of assuming the normal terminal login is the one being used. Account labels are names you assign, not verification of the provider identity. Check the identity during sign-in before sending project context.',
        ],
        links: [
          {
            href: '/knowledge/multi-account-and-agents/',
            label: 'Configure accounts and understand profile boundaries',
          },
        ],
      },
      {
        title: 'Bring the tools the task needs.',
        paragraphs: [
          'Codex supports Jackalope project connections over stdio and HTTP. Select the connection for the project and task, then start with a read operation that confirms the expected service is available. Tools already configured in Codex remain subject to its own configuration and permissions.',
          'A useful first brief is: “Find the parser case that rejects a valid empty list, add a regression test, and fix it without changing the public API. Run the parser tests and show the changed files.” Add the relevant project guidance; avoid attaching unrelated tools just because they are available.',
        ],
        links: [
          {
            href: '/knowledge/connecting-custom-mcp-servers/',
            label: 'Set up and select project MCP connections',
          },
        ],
      },
      {
        title: 'Read capacity and task usage separately.',
        paragraphs: [
          'Jackalope can show Codex account usage windows when the CLI reports them, alongside usage recorded for Jackalope attempts. Account limits can include activity outside Jackalope; a task’s token total describes that attempt. Neither is a complete invoice or a promise of remaining model access.',
          'When capacity is unavailable, keep it unknown. Check the account’s reported reset information and whether the task has an explicit agent assignment before expecting automatic routing to use another worker.',
        ],
        links: [
          {
            href: '/knowledge/task-routing-and-quotas/',
            label: 'Understand usage windows and routing',
          },
        ],
      },
      {
        title: 'Continue, check, and review the change.',
        paragraphs: [
          'Ask for a correction under the same task to retain its account and history. Inspect the patch and the parser test output, then try a nearby edge case. For work alongside Claude Code, give each task a separate scope and make dependent changes wait for integration.',
          'Jackalope is coming soon. These are implemented adapter capabilities; your installed CLI version, account, model, and tool combination still need a real task check. Jackalope does not include an OpenAI subscription or remove Codex permission requirements.',
        ],
        links: [
          {
            href: '/guides/run-codex-and-claude-code-in-parallel/',
            label: 'Plan a feature across Codex and Claude Code',
          },
        ],
      },
    ],
    related: [
      { href: '/agents/claude-code/', label: 'Claude Code integration' },
      { href: '/features/project-context-for-coding-agents/', label: 'Project context and tools' },
      {
        href: '/guides/run-codex-and-claude-code-in-parallel/',
        label: 'Codex and Claude Code together',
      },
    ],
  },
  {
    path: '/agents/claude-code/',
    kind: 'Agent integration',
    title: 'Run Claude Code in a desktop project workspace | Jackalope',
    description:
      'Run Claude Code tasks with isolated Git worktrees, project MCP connections, in-app questions, account profiles, usage reporting, and review.',
    headline: 'Keep Claude Code connected to the whole task.',
    lede: 'Use your installed Claude Code CLI and Anthropic account while Jackalope keeps the brief, questions, project tools, worktree, result, and review together.',
    image: 'agents',
    signals: ['Installed Claude Code', 'Project MCP', 'In-app questions', 'Account profiles'],
    sections: [
      {
        title: 'Start with a working Claude Code sign-in.',
        paragraphs: [
          'Install Claude Code from Anthropic’s documentation and complete its own sign-in flow. In Jackalope, open Agents → Configuration and check the detected CLI. Choose an existing login or create a named account profile, then select that account for the project.',
          'Use a project that builds before the agent edits it. Put its setup and test commands in project guidance. If Claude Code is not found after installation, check the executable path and restart Jackalope so it receives the updated environment.',
        ],
        links: [
          {
            href: 'https://code.claude.com/docs/en/overview',
            label: 'Claude Code installation and getting started',
          },
          {
            href: '/knowledge/fixing-cli-path-on-windows/',
            label: 'Resolve CLI detection problems',
          },
        ],
      },
      {
        title: 'Keep questions attached to the requested change.',
        paragraphs: [
          'Claude Code can surface task questions in Jackalope. This is useful when a change has a product decision inside it: for example, whether an expired invitation should offer a resend action or send someone back to sign-in. Answer in the task so the decision stays with the resulting patch.',
          'Start with a concrete request: “Improve the expired-invitation screen. Preserve the existing token validation, explain the recovery action, and test an expired token and a valid token. Ask before changing the resend policy.” A second pass should refine that same task instead of losing the original constraint in a new conversation.',
        ],
      },
      {
        title: 'Choose the right MCP connection and scope.',
        paragraphs: [
          'The Claude Code adapter supports project-selected stdio, HTTP, and SSE connections. Select only the services needed for this task. Check which tools come from Jackalope and which are already configured in Claude Code, particularly when the same server appears in several configuration scopes.',
          'Begin with a small read request and confirm the service and account it reaches. A saved connection does not prove that authentication succeeded or that a particular tool is permitted. If access fails, fix that connection before asking the agent to rely on its output.',
        ],
        links: [
          {
            href: 'https://code.claude.com/docs/en/mcp',
            label: 'Claude Code MCP transports and configuration scopes',
          },
          {
            href: '/knowledge/connecting-custom-mcp-servers/',
            label: 'Select MCP tools in Jackalope',
          },
        ],
      },
      {
        title: 'Keep follow-ups on the original account.',
        paragraphs: [
          'Work and personal profiles use separate Claude configuration directories. Pin a profile in Project → Settings when a project requires a specific account. Continuing an existing task retains its original profile even if you change the active account for new work.',
          'Task usage reflects what Claude Code reports. Model access, organizational restrictions, and billing remain with your provider setup. A profile organizes credentials and settings; it does not restrict the local files a permitted tool can read.',
        ],
        links: [
          {
            href: '/knowledge/multi-account-and-agents/',
            label: 'Account selection and continuation',
          },
        ],
      },
      {
        title: 'Use a second agent where the work is independent.',
        paragraphs: [
          'While Claude Code fixes the invitation screen, another agent can update unrelated documentation in its own worktree. If the documentation depends on a new resend contract, make it wait until that change is accepted. Review both outputs together and exercise the invitation flow before integration.',
          'Jackalope is coming soon. Its Claude Code adapter implements tasks, questions, continuation, and review; installed-version and account acceptance remain separate from the sample interface tour.',
        ],
        links: [
          {
            href: '/guides/review-ai-generated-code/',
            label: 'Review behavior and evidence together',
          },
        ],
      },
    ],
    related: [
      { href: '/agents/codex/', label: 'Codex integration' },
      { href: '/parallel-coding-agents/', label: 'Parallel coding agents' },
      { href: '/guides/review-ai-generated-code/', label: 'Review agent-generated code' },
    ],
  },
  {
    path: '/agents/grok/',
    kind: 'Agent integration',
    title: 'Run Grok in isolated Git worktrees | Jackalope',
    description:
      'Run Grok coding-agent tasks in isolated Git worktrees with project context, on-demand HTTP tool discovery, task history, and review in Jackalope.',
    headline: 'Give Grok focused work without losing the project around it.',
    lede: 'Use your installed Grok CLI and xAI access while Jackalope keeps the task brief, isolated worktree, selected context, result, and review in one workspace.',
    image: 'agents',
    signals: ['Installed Grok CLI', 'HTTP tool discovery', 'Isolated attempts', 'Review history'],
    sections: [
      {
        title: 'Connect Grok Build, the coding CLI.',
        paragraphs: [
          'This integration uses the installed Grok Build CLI, rather than a Grok chat in a browser. Follow the official installation and authentication instructions, confirm a small request works in your local project, then choose Grok in Jackalope’s agent configuration.',
          'Jackalope reads Grok’s account identity and available models through its CLI. Grok validates model access when a task launches. Finding an executable or saving an account profile does not establish a successful sign-in. If the first task fails immediately, inspect its authentication error before changing the task brief or project code.',
        ],
        links: [
          {
            href: 'https://docs.x.ai/build/overview',
            label: 'Install and authenticate Grok Build',
          },
        ],
      },
      {
        title: 'Use discovery for supported project tools.',
        paragraphs: [
          'Grok can discover supported project connections on demand through Jackalope’s HTTP bridge. That differs from directly injecting every selected MCP server into a CLI configuration. Direct project connection delivery is not supported for this adapter.',
          'For a task that needs an external service, select a connection configured for on-demand discovery and first request a small read. Other tools may come from Grok’s own configuration. Check which path supplies a tool when troubleshooting missing access.',
        ],
        links: [
          {
            href: '/knowledge/mcp-and-browser-automation/',
            label: 'Understand project tool delivery and discovery',
          },
        ],
      },
      {
        title: 'Try a bounded investigation before a large change.',
        paragraphs: [
          'For example: “Find why this command reports success when its output file is missing. Trace the exit-code handling, identify a reproducible case, and propose a focused fix. Preserve the existing command-line flags.” This gives you a concrete artifact to inspect before expanding the work.',
          'Jackalope retains the selected project context, worktree, attempts, and result. Review the reproduction, then continue the task with the chosen fix. A related task can update command documentation after the behavior is accepted, without editing the same checkout.',
        ],
      },
      {
        title: 'Check the account and the reported usage.',
        paragraphs: [
          'Named Grok profiles let projects select different accounts. Continuations retain their original profile. Confirm the selected account when diagnosing a provider error; switching the default for future tasks does not move an existing conversation to another identity.',
          'Jackalope can display Grok capacity when its billing interface provides it and can record reported task usage. Missing or stale information remains distinct from available capacity. Use the provider’s billing view for charges and allowances beyond recorded Jackalope attempts.',
        ],
        links: [
          {
            href: '/knowledge/task-routing-and-quotas/',
            label: 'Read quota information and routing decisions',
          },
        ],
      },
      {
        title: 'Validate the actual command behavior.',
        paragraphs: [
          'For the missing-output example, run the command with a writable destination and with a failing destination. Check the file, exit status, and error message together. A successful agent response alone cannot establish that the command now reports failures correctly.',
          'Jackalope is coming soon. Grok tasks, continuation, and review are implemented; provider permissions, installed CLI compatibility, and model access still apply. Jackalope does not include xAI model usage.',
        ],
        links: [
          {
            href: '/guides/review-ai-generated-code/',
            label: 'A practical review workflow',
          },
        ],
      },
    ],
    related: [
      { href: '/agents/', label: 'Compare supported coding agents' },
      { href: '/parallel-coding-agents/', label: 'Coordinate parallel agent tasks' },
      { href: '/guides/review-ai-generated-code/', label: 'Review agent-generated code' },
    ],
  },
  {
    path: '/agents/opencode/',
    kind: 'Agent integration',
    title: 'Run OpenCode tasks in isolated Git worktrees | Jackalope',
    description:
      'Run OpenCode tasks in isolated Git worktrees with project context, task history, coordination, and review while retaining OpenCode CLI configuration.',
    headline: 'Put OpenCode inside a project workflow.',
    lede: 'Use your installed OpenCode CLI while Jackalope gives each task a focused worktree and keeps its context, attempts, result, and review attached to the project.',
    image: 'agents',
    signals: [
      'Installed OpenCode CLI',
      'On-demand project tools',
      'Isolated attempts',
      'Combined review',
    ],
    sections: [
      {
        title: 'Choose the provider before the task.',
        paragraphs: [
          'OpenCode can connect to different model providers. Install its CLI, configure a provider through OpenCode, and confirm the model you intend to use can answer a small request. In Jackalope, select OpenCode and use its provider/model identifier format when choosing a model.',
          'A model appearing in discovery does not establish that the selected account can use it. If access fails, check the provider configuration and credentials in the same OpenCode profile before replacing the model name or retrying a large task.',
        ],
        links: [
          {
            href: 'https://opencode.ai/docs/',
            label: 'Install OpenCode and connect a provider',
          },
        ],
      },
      {
        title: 'Understand what a named profile changes.',
        paragraphs: [
          'Jackalope’s default OpenCode profile preserves the existing CLI configuration. Named profiles separate OpenCode’s data, configuration, cache, and state directories. A provider or tool configured under your normal login may therefore need setup in a new named profile.',
          'Choose the account for the project and confirm it on a small task. Follow-ups retain the profile that began the attempt, even after a different profile becomes the default. These directories organize configuration; they do not create separate operating-system permissions.',
        ],
        links: [
          {
            href: '/knowledge/multi-account-and-agents/',
            label: 'Understand named account profiles',
          },
        ],
      },
      {
        title: 'Choose how project tools reach OpenCode.',
        paragraphs: [
          'OpenCode supports direct stdio, HTTP, and SSE project connections, as well as on-demand discovery. Jackalope adds direct connections to the task process’s configuration while preserving other inline settings. Tools configured in OpenCode’s own settings remain subject to that profile’s configuration.',
          'If a task can read repository files but cannot reach a connected service, verify the tool in the selected OpenCode profile. Keep a local-only first task available so a provider or tool problem does not get confused with a worktree or build problem.',
        ],
        links: [
          {
            href: '/agents/',
            label: 'Compare project connection support across agents',
          },
        ],
      },
      {
        title: 'Start with a provider-independent result.',
        paragraphs: [
          'A useful trial is: “Add a regression test for sorting names that differ only by case. Keep the public API unchanged, use the existing test framework, and show the test result and patch.” Evaluate the behavior against the same expected output regardless of the chosen provider.',
          'Jackalope records OpenCode text, tool activity, session identity, errors, and reported usage. Inspect the actual test output and changed files. An empty response or a provider error should be diagnosed before treating the task as ready for review.',
        ],
      },
      {
        title: 'Continue the task, then inspect the combination.',
        paragraphs: [
          'Ask for a missed edge case under the same task to preserve its history and account binding. If another agent is changing a caller of the sorting function, review that interaction before integration; two separate worktrees can still disagree about expected behavior.',
          'Jackalope is coming soon. The OpenCode adapter implements execution and continuation, while real provider and installed-version checks remain necessary. Free model availability can change, and Jackalope does not supply provider access or a complete billing record.',
        ],
        links: [
          {
            href: '/guides/review-ai-generated-code/',
            label: 'Check an agent result before accepting it',
          },
        ],
      },
    ],
    related: [
      { href: '/agents/', label: 'Compare supported coding agents' },
      { href: '/git-worktrees-for-ai-agents/', label: 'How task worktrees work' },
      { href: '/features/project-context-for-coding-agents/', label: 'Project context and tools' },
    ],
  },
  {
    path: '/agents/kimi-code/',
    kind: 'Agent integration',
    title: 'Use Kimi Code for project tasks | Jackalope',
    description:
      'Set up Kimi Code in Jackalope with separate accounts, model choices, task approvals, and session continuation. Check tool, account, and usage coverage.',
    headline: 'Bring Kimi Code into your project workflow.',
    lede: 'Use your installed Kimi Code CLI while Jackalope keeps the task brief, account, progress, changes, and review together. The adapter is implemented; authenticated installed-app acceptance remains in progress.',
    image: 'agents',
    signals: ['Kimi Code CLI', 'Separate accounts', 'Task approvals', 'Session continuation'],
    sections: [
      {
        title: 'Install and detect the current CLI.',
        paragraphs: [
          'Follow Kimi’s current installation instructions, then open Agents → Configuration. Jackalope looks for the kimi executable. If it is missing, install it with npm install -g @moonshot-ai/kimi-code and restart Jackalope so it receives the updated PATH. Windows also needs Git for Windows.',
          'Older Python kimi-cli installations use a different data directory. Follow Kimi’s migration guidance before using managed account profiles; finding a kimi executable alone does not confirm version compatibility or provider access.',
        ],
        links: [
          {
            href: 'https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html',
            label: 'Kimi Code installation and migration',
          },
          { href: '/knowledge/fixing-cli-path-on-windows/', label: 'Fix missing CLI detection' },
        ],
      },
      {
        title: 'Choose the account and model.',
        paragraphs: [
          'For your existing CLI account, run kimi login. For a separate account, use Add account & sign in in Jackalope, then choose that account in Project → Settings. Named profiles keep Kimi configuration, sign-in data, and sessions in separate directories. They do not restrict access to local files.',
          'Model choices come from the selected account’s CLI session configuration. Authentication and model discovery do not guarantee that the provider will accept a task or that quota remains. Jackalope checks access when the task starts.',
        ],
        links: [
          {
            href: '/knowledge/multi-account-and-agents/',
            label: 'Accounts and credential boundaries',
          },
        ],
      },
      {
        title: 'Run a worker task and answer approvals.',
        paragraphs: [
          'Assign Kimi Code explicitly to a small task, such as reading project instructions and explaining how to run the tests. Then try a scoped change with an observable check. Kimi streams its response and tool activity into the task, with the CLI’s permission choices, including approval for the session. Structured questions support multiple questions and multiple selections.',
          'Declining an approval stops the attempt. Unanswered approvals expire after ten minutes; tasks have a thirty-minute limit. Stop ends Jackalope’s owned CLI process tree. Permission scope follows the choices reported by your CLI.',
          'Kimi supports direct stdio, HTTP, and SSE project connections through ACP, plus on-demand discovery. Direct remote connections require a CLI that advertises the transport. Tools configured inside Kimi remain subject to its own settings and permissions.',
        ],
        links: [
          {
            href: '/knowledge/connecting-custom-mcp-servers/',
            label: 'Set up project connections',
          },
        ],
      },
      {
        title: 'Continue the same session and review the result.',
        paragraphs: [
          'Continue under the original task to retain its account and load the same Kimi session. If the selected model or saved session cannot be loaded, the attempt fails rather than silently switching models or starting a new conversation.',
          'Review the actual patch and check output before integration. Protocol tests and a CLI handshake cover parts of the adapter; signed-in model execution, account switching, and installed-app behavior still need acceptance checks.',
        ],
      },
      {
        title: 'Know the current limits.',
        paragraphs: [
          'Kimi can run tasks, coordinate automatic agent routing, and power Ask Jackalope. Routing and helper requests use a separate agent definition with tools and subagents disabled.',
          'Task tokens come from the change in Kimi’s session totals, so continuation excludes earlier turns. Context occupancy is shown separately. Cache breakdown, cost, and helper token usage are unavailable. Membership quota is read for the selected managed Kimi account with a current login; custom-provider billing and extra-usage balances are separate. Missing reports stay unknown.',
        ],
        links: [
          { href: '/knowledge/task-routing-and-quotas/', label: 'Task usage and account capacity' },
          { href: '/roadmap/', label: 'Implementation and release progress' },
        ],
      },
    ],
    related: [
      { href: '/agents/', label: 'Compare supported agents' },
      { href: '/parallel-coding-agents/', label: 'Run workers in parallel' },
      { href: '/guides/review-ai-generated-code/', label: 'Review agent-generated code' },
    ],
  },
  {
    path: '/guides/run-codex-and-claude-code-in-parallel/',
    kind: 'Practical guide',
    title: 'How to run Codex and Claude Code in parallel | Jackalope',
    description:
      'A practical workflow for running Codex and Claude Code in separate Git worktrees, coordinating dependencies, and reviewing their combined changes.',
    headline: 'Run Codex and Claude Code together without sharing a checkout.',
    lede: 'Give each agent a focused outcome, isolate its files in a Git worktree, and make the combined result a deliberate review step.',
    image: 'tasks',
    signals: ['Two focused briefs', 'Two worktrees', 'Visible dependencies', 'One combined review'],
    sections: [
      {
        title: '1. Split the outcome, not the context.',
        paragraphs: [
          'Start with one project goal, then separate work only where the tasks can be reviewed independently. Give Codex and Claude Code concrete outcomes, relevant file scopes, and a shared description of the project constraints.',
          'Use a dependency when one task truly requires another task’s integrated code. Parallel work should not be an excuse to hide ordering assumptions.',
        ],
      },
      {
        title: '2. Launch each task in its own worktree.',
        paragraphs: [
          'Jackalope resolves the target branch and creates isolated workspaces for the assigned agents. Each attempt receives the project briefing, selected context, and supported tools. You can follow progress, answer questions, and stop an individual task without losing the rest of the plan.',
        ],
        bullets: [
          'Use Codex for one reviewable slice and Claude Code for another.',
          'Avoid broad overlapping scopes when the same files or contracts are involved.',
          'Send coordination notes for discoveries that affect related work.',
          'Rerun or continue a task when its result needs correction.',
        ],
      },
      {
        title: '3. Review the combination, not only the parts.',
        paragraphs: [
          'Passing checks in two worktrees does not prove the patches work together. Inspect each result, prepare the combined patch, and run the checks that matter against the integrated state before accepting it.',
          'Jackalope keeps integration explicit and stops when the target or source state has changed. It does not automatically stash, reset, or overwrite unrelated work.',
        ],
      },
      {
        title: 'Example: add a saved search filter.',
        paragraphs: [
          'Agree that a saved filter contains a name and a query before dispatch. Use that decision to distinguish the work that can start now from the work that needs an accepted prerequisite. Agent assignments are examples, not a ranking of model strengths.',
        ],
        table: {
          columns: ['Task', 'Scope and worker', 'Ready when'],
          rows: [
            [
              'Persist filters',
              'Codex: storage module and its tests.',
              'Existing saved data loads and a new filter survives a restart.',
            ],
            [
              'Document the behavior',
              'Claude Code: user guide, using the agreed name/query contract.',
              'Create, select, and remove actions are explained without inventing UI behavior.',
            ],
            [
              'Build the selector',
              'Either agent: UI and integration tests, after storage integration.',
              'The UI reads the accepted storage contract and handles an empty list.',
            ],
          ],
        },
      },
      {
        title: 'Handle a changed assumption explicitly.',
        paragraphs: [
          'If the storage task discovers that names must be unique, pause the dependent selector task and update the contract. Ask the documentation task to revise its explanation. Preserve those corrections in task history so review explains why the behavior changed.',
          'Before accepting the combined result, create a filter, restart, select it, and remove it. Check the empty list and an existing saved-data fixture. A clean merge and independent unit tests do not cover that complete workflow.',
        ],
        links: [
          {
            href: '/knowledge/git-worktrees/',
            label: 'How dependent tasks wait for integration',
          },
        ],
      },
    ],
    related: [
      { href: '/agents/codex/', label: 'Codex in Jackalope' },
      { href: '/agents/claude-code/', label: 'Claude Code in Jackalope' },
      { href: '/git-worktrees-for-ai-agents/', label: 'How agent worktrees work' },
    ],
  },
  {
    path: '/guides/review-ai-generated-code/',
    kind: 'Practical guide',
    title: 'How to review AI-generated code | Jackalope',
    description:
      'Review AI-generated code with the original brief, exact patch snapshot, checks, evidence, follow-ups, and combined integration state in view.',
    headline: 'Review the outcome, the evidence, and the exact code together.',
    lede: 'Agent output can sound complete while the code is stale, incomplete, or incompatible with another patch. Jackalope organizes review around the task and the snapshot that produced its evidence.',
    image: 'review',
    signals: [
      'Original intent',
      'Checks for the current code',
      'Visible patch',
      'Explicit decision',
    ],
    sections: [
      {
        title: 'Begin with the promised outcome.',
        paragraphs: [
          'Read the original task before the summary. Check whether the result satisfies the requested behavior and constraints, rather than accepting a confident completion message as proof.',
          'Jackalope keeps attempts, questions, corrections, and the final result under one task so the reasoning behind a change does not disappear into terminal history.',
        ],
      },
      {
        title: 'Match evidence to the code it describes.',
        paragraphs: [
          'Recorded checks and previews belong to a particular content snapshot. If files change afterward, the earlier evidence becomes stale and the behavior needs to be checked again. Missing evidence stays missing rather than being presented as a pass.',
        ],
        bullets: [
          'Inspect changed files and the patch, not only the agent summary.',
          'Review the commands and outputs that matter for the project.',
          'Try the changed behavior when automated checks cannot establish it.',
          'Ask for a focused correction instead of silently editing around a misunderstood result.',
        ],
      },
      {
        title: 'Check how the changes work together.',
        paragraphs: [
          'Independent patches can conflict semantically even when Git can combine them. Jackalope prepares a combined review from the selected task results and rechecks the source and target state before an explicit integration action.',
        ],
      },
      {
        title: 'Example: a settings value that disappears after restart.',
        paragraphs: [
          'Suppose the task was to save a notification preference. A screenshot of the new toggle proves that a control rendered. A passing component test may show that clicking it changes local state. Neither establishes that the preference was stored, read on restart, or migrated from an older profile.',
          'Trace the control through its persistence call, inspect the saved-data handling, and exercise a restart. If the agent changed only the visible toggle, ask for the missing persistence path and a check that would have caught the original bug.',
        ],
      },
      {
        title: 'Make the next review decision concrete.',
        paragraphs: [
          'Accept when the requested behavior, compatibility constraints, current patch, and relevant evidence agree. Request a correction when the implementation is incomplete. Record a specific unverified condition when the needed environment is unavailable; do not convert it into a passing check.',
          'After a follow-up, check the new patch and rerun checks affected by those edits. For parallel results, include callers of shared types and services. The useful question is what evidence would reveal a wrong assumption in this change.',
        ],
        links: [
          {
            href: 'https://google.github.io/eng-practices/review/reviewer/looking-for.html',
            label: 'Google’s code review guidance',
          },
          {
            href: '/features/browser-automation-for-coding-agents/',
            label: 'Capture useful browser evidence',
          },
        ],
      },
    ],
    related: [
      { href: '/parallel-coding-agents/', label: 'Parallel work in one review queue' },
      { href: '/git-worktrees-for-ai-agents/', label: 'Worktree isolation and integration' },
      {
        href: '/features/project-context-for-coding-agents/',
        label: 'Keep the original context attached',
      },
    ],
  },
  {
    path: '/features/project-context-for-coding-agents/',
    kind: 'Feature',
    title: 'Project context for AI coding agents | Jackalope',
    description:
      'Give coding-agent tasks selected project instructions, lessons, reusable workflows, history, and MCP tools and inspect what each task receives.',
    headline: 'Carry project knowledge forward without copying it into every prompt.',
    lede: 'Jackalope keeps project instructions, learned constraints, reusable workflows, relevant task history, and supported connections close to the task that needs them.',
    image: 'tasks',
    signals: ['Instructions', 'Lessons', 'Workflows', 'Selected tools'],
    sections: [
      {
        title: 'Context belongs to the project and the task.',
        paragraphs: [
          'Save stable project guidance once. New tasks automatically match guidelines to your prompt and inherit project defaults. Under Customize task, review or override that selection; manual choices remain explicit until reset.',
          'Select the context relevant to the work. Your agent may also have tools configured outside Jackalope; review those in its CLI settings.',
        ],
      },
      {
        title: 'Explore the codebase map.',
        paragraphs: [
          'Open Project → Codebase to explore folders and resolved file dependencies. During review, impact inspection follows references back from changed files to help you choose related checks. The map has language and resolution limits; it is guidance, not proof that tests passed.',
        ],
      },
      {
        title: 'Turn useful work into a repeatable workflow.',
        paragraphs: [
          'A successful task can become a reusable workflow with named inputs and explicit step gates. Future runs keep their own outcomes and evidence instead of flattening repeated work into one opaque automation log.',
        ],
        bullets: [
          'Store project instructions and reviewed lessons separately.',
          'Choose context and tools when composing a task.',
          'Inspect what the agent received after launch.',
          'Keep corrections and continuations attached to the original task.',
        ],
      },
      {
        title: 'Connect tools to the agents that use them.',
        paragraphs: [
          'Codex, Claude Code, OpenCode, and Kimi Code support direct project connection delivery. All six task adapters support on-demand discovery for stdio and HTTP connections. CLI-global tools remain subject to each agent’s own configuration. See the agent guide for setup details.',
        ],
      },
      {
        title: 'Choose where each piece of knowledge belongs.',
        paragraphs: [
          'Put stable conventions in project instructions: the build command, supported data formats, and ownership boundaries. Keep a task-specific requirement in the brief. Record a discovered constraint as a lesson only when its evidence and scope are clear, so a temporary workaround does not become a rule for every future task.',
          'For example, a checkout’s temporary port conflict belongs to that run. A documented requirement to preserve old preference files belongs in durable project guidance. Review or remove lessons when the code changes; saved context is useful only while its assumptions remain true.',
        ],
      },
      {
        title: 'Inspect the context when a result misses the mark.',
        paragraphs: [
          'If an agent used the wrong test command, inspect what the task received before adding more instructions. Check the project default, automatic matches, and any explicit override in Customize task. Updating a project rule helps future tasks; it does not rewrite the context already delivered to an earlier attempt.',
          'Keep secrets in the relevant private configuration instead of a reusable prompt. Selected tools and an agent’s own CLI settings can add access beyond the text in the brief, so check both when diagnosing an unexpected dependency.',
        ],
        links: [
          {
            href: '/knowledge/task-composer-and-effort-levels/',
            label: 'Inspect automatic guidance and task overrides',
          },
          {
            href: '/knowledge/mcp-and-browser-automation/',
            label: 'Understand the selected tool boundary',
          },
        ],
      },
    ],
    related: [
      { href: '/features/recurring-coding-agent-tasks/', label: 'Repeat work with context intact' },
      { href: '/agents/', label: 'Compare agent capabilities' },
      { href: '/blog/from-brief-to-review/', label: 'From brief to review' },
    ],
  },
  {
    path: '/features/recurring-coding-agent-tasks/',
    kind: 'Feature',
    title: 'Recurring coding-agent tasks & review history | Jackalope',
    description:
      'Schedule recurring coding-agent work with its project, account, context, missed-run policy, isolated worktree, result, and review history intact.',
    headline: 'Repeat the work. Keep every run reviewable.',
    lede: 'Jackalope recurring tasks preserve the project setup around a task and record each occurrence as its own result so you can review each run.',
    image: 'tasks',
    signals: ['Paused by default', 'Project-bound', 'Run history', 'Review-ready notifications'],
    sections: [
      {
        title: 'Set the schedule and the project.',
        paragraphs: [
          'Choose the project, agent, account, execution target, timezone, and missed-run policy. Use daily, weekday, weekly, hourly, or custom cron timing. New schedules start paused; review the settings before enabling them. Each run keeps its own result and history.',
          'Jackalope does not wake a closed app or sleeping computer, and it does not silently replay interrupted dispatch after a restart.',
        ],
      },
      {
        title: 'Run only when something changes.',
        paragraphs: [
          'Watch committed content on a local branch or path. Choose to notify you or launch the saved task only after a change. The first check records a baseline; unchanged checks make no model calls. Monitors do not fetch remote branches or watch uncommitted edits.',
        ],
      },
      {
        title: 'Use repetition where the outcome stays inspectable.',
        paragraphs: [
          'Recurring tasks fit dependency checks, repository audits, documentation refreshes, triage, and other focused work where every run should return evidence for review.',
        ],
        bullets: [
          'Skip or catch up one missed occurrence according to the saved policy.',
          'Prevent a schedule from overlapping its own active or interrupted run.',
          'Link failure and review-ready notifications to the actual occurrence.',
          'Return to previous results and restore archived work.',
        ],
      },
      {
        title: 'Review scheduled work, too.',
        paragraphs: [
          'Open a scheduled result, inspect its changes and checks, and ask for corrections when needed. You decide when it is ready to merge.',
        ],
      },
      {
        title: 'Example: a weekly dependency review.',
        paragraphs: [
          'Save a task that reports outdated dependencies, release notes that affect the project, and recommended checks. Make version changes a separate decision. Select the project account, choose the timezone, set a missed-run policy, and inspect the first occurrence before relying on the schedule.',
          'If your laptop was asleep, “skip” avoids replaying an old occurrence; a catch-up policy can run one missed occurrence when eligible. Review the resulting history so a missed run is not confused with a successful check that found no work.',
        ],
        links: [
          {
            href: '/knowledge/recurring-schedules-and-automation/',
            label: 'Schedule timing and missed-run behavior',
          },
        ],
      },
      {
        title: 'Choose a monitor for a content trigger.',
        paragraphs: [
          'A clock schedule asks for work at a time. A local monitor reacts to committed content changing on a selected branch or path. For a documentation audit after API changes, a monitor can avoid repeated model calls while the watched content stays unchanged.',
          'The first monitor check establishes its baseline. Commit a small relevant change to try the trigger, then inspect the notification or task it produces. Remote changes must reach the local repository separately, and uncommitted edits do not count as a monitor trigger.',
        ],
      },
    ],
    related: [
      {
        href: '/features/project-context-for-coding-agents/',
        label: 'Project context and reusable workflows',
      },
      { href: '/guides/review-ai-generated-code/', label: 'Review every generated change' },
      { href: '/parallel-coding-agents/', label: 'Coordinate several tasks' },
    ],
  },
];
