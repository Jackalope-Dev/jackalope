import type { MarketingPage } from './marketing-content.ts';

type Comparison = {
  slug: string;
  name: string;
  description: string;
  lede: string;
  signals: string[];
  sections: MarketingPage['sections'];
} & NonNullable<MarketingPage['comparison']>;

const reviewed = '2026-09-09';
const comparisons: Comparison[] = [
  {
    slug: 'superset',
    name: 'Superset',
    reviewed,
    description:
      'Jackalope vs Superset: compare parallel coding agents, Git worktrees, recurring tasks, remote hosts, accounts, and how changes reach review.',
    lede: 'Both bring multiple coding agents into one workspace. The useful comparison is how you organize the work between the first prompt and the final integration.',
    signals: ['Agent choice', 'Worktree isolation', 'Recurring work', 'Review workflow'],
    sources: [
      { label: 'Superset product overview', href: 'https://superset.sh/' },
      { label: 'Superset documentation', href: 'https://docs.superset.sh/' },
      { label: 'Superset automations', href: 'https://docs.superset.sh/automations' },
      { label: 'Superset remote access', href: 'https://docs.superset.sh/remote-access' },
    ],
    rows: [
      {
        topic: 'Work organization',
        jackalope: 'Tasks with context, attempts, dependencies, and review.',
        competitor: 'Agent workspaces with branches, status, and review.',
      },
      {
        topic: 'Parallel changes',
        jackalope: 'Local worktrees; dependency-aware plans and combined patch preparation.',
        competitor: 'Isolated worktrees; branches and pull requests for integration.',
      },
      {
        topic: 'Recurring work',
        jackalope: 'Local recurring tasks and inspectable run history.',
        competitor: 'Scheduled agent sessions and automation controls.',
      },
      {
        topic: 'Remote execution',
        jackalope: 'Remote hosts are roadmap work.',
        competitor: 'Remote hosts and cross-device workspace access are documented.',
      },
    ],
    sections: [
      {
        title: 'Where Superset fits',
        paragraphs: [
          'Superset presents an agent-independent workspace with parallel worktrees, recurring automation, remote hosts, and a built-in review flow. It lets developers retain their agent accounts and switch agents by task. Its documentation also describes a CLI, TypeScript SDK, and MCP server for controlling the workspace programmatically.',
        ],
        links: [
          { label: 'Read Superset’s product overview', href: 'https://superset.sh/' },
          {
            label: 'Browse Superset’s documentation',
            href: 'https://docs.superset.sh/',
          },
          { label: 'Superset automations', href: 'https://docs.superset.sh/automations' },
          { label: 'Superset remote access', href: 'https://docs.superset.sh/remote-access' },
        ],
      },
      {
        title: 'Where Jackalope puts the emphasis',
        paragraphs: [
          'Jackalope starts with the outcome you want and keeps the brief, project context, selected account, attempts, questions, and result attached to it. That organization is useful when a task needs several follow-ups or when you return to a project after working elsewhere. You can inspect what happened without treating a terminal tab as the only record of the work.',
          'For coordinated changes, a parallel plan can name independent tasks, file scopes, dependencies, and a concurrency limit. Work that depends on another task waits for its changes to be integrated. This matters when an API change must land before an agent can build the interface that consumes it.',
        ],
      },
      {
        title: 'Compare integration, not just parallel execution',
        paragraphs: [
          'A good evaluation should include two agents changing related behavior. Separate worktrees prevent edits from colliding in one directory, but they cannot prevent incompatible assumptions about an API or data shape. You still need a review of the combined result.',
          'Jackalope prepares a combined patch from selected results and rechecks the source and target before an explicit integration action. Assess whether that step helps you catch problems earlier than reviewing independent branches alone. Keep your project checks in the trial: neither a completed agent response nor a clean merge establishes correct behavior.',
        ],
      },
      {
        title: 'Accounts, automation, and cost',
        paragraphs: [
          'Superset’s automation documentation distinguishes a created workspace from a successful agent outcome: run history records dispatch, while the workspace contains the resulting work. It also documents failed dispatch to offline hosts. Include both the scheduled run and the agent’s actual result when evaluating recurring work.',
          'For either workspace, list the agents and accounts you actually need before choosing. In Jackalope, provider support differs by adapter, and a catalog entry does not by itself mean task execution is implemented. Use the compatibility page to check your required agent and tool flow.',
          'Jackalope uses your installed agents and provider access; model usage is not included. Its public price has not been announced. Separate workspace charges, model usage, and any remote compute when estimating cost. For unattended local tasks, include the practical requirement that the host and required services remain available.',
        ],
      },
      {
        title: 'Which workflow should you try?',
        paragraphs: [
          'Our assessment: include Superset in your shortlist when remote hosts or scripting the workspace is central to the way you work. Consider Jackalope early access when your main challenge is maintaining task continuity and bringing dependent changes together for one deliberate review.',
          'Try a small feature split into a backend change, a user interface change, and a verification task. Record how often you must repeat context, how a blocked task becomes visible, and what evidence survives a follow-up. Those observations are more useful than counting how many sessions you can open.',
        ],
      },
    ],
    faqs: [
      {
        question: 'Is Jackalope a replacement for Superset?',
        answer:
          'It is an alternative workspace for supervising coding agents. Evaluate the task and review flow against your needs; Jackalope does not currently replace a remote-host requirement.',
      },
      {
        question: 'Can I keep using my existing agents?',
        answer:
          'Yes, with a supported Jackalope adapter and your own provider account. Check agent compatibility before moving work; provider features and authentication options differ.',
      },
      {
        question: 'Can I download Jackalope now?',
        answer:
          'Jackalope is coming soon. Join the early-access waitlist; public downloads and pricing have not been announced.',
      },
    ],
  },
  {
    slug: 'orca',
    name: 'Orca',
    reviewed,
    description:
      'Jackalope vs Orca: compare agent workspaces, browser evidence, terminals, remote access, account workflows, and review of parallel changes.',
    lede: 'Orca and Jackalope both bring agent work and code review together. Choose by the way you navigate active work, capture evidence, and finish a change.',
    signals: ['Task continuity', 'Browser tools', 'Agent accounts', 'Code review'],
    sources: [
      { label: 'Orca product overview', href: 'https://www.onorca.dev/' },
      { label: 'What is Orca? Official documentation', href: 'https://www.onorca.dev/docs' },
      { label: 'Orca Design Mode', href: 'https://www.onorca.dev/docs/browser/design-mode' },
      { label: 'Orca mobile companion', href: 'https://www.onorca.dev/docs/mobile' },
    ],
    rows: [
      {
        topic: 'Workspace focus',
        jackalope: 'Task intent, attempts, evidence, and review across projects.',
        competitor: 'Worktrees with agent sessions, terminals, browser panes, and diffs.',
      },
      {
        topic: 'Browser work',
        jackalope: 'Task-owned browser sessions and captured review evidence.',
        competitor: 'Per-worktree browser and Design Mode for sending UI context to agents.',
      },
      {
        topic: 'Review',
        jackalope: 'Individual results and combined patch preparation.',
        competitor: 'Diff annotation, agent feedback, and GitHub review tools.',
      },
      {
        topic: 'Away from the desktop',
        jackalope: 'Remote hosts and phone access are future work.',
        competitor: 'SSH workspaces and a mobile companion are advertised.',
      },
    ],
    sections: [
      {
        title: 'Where Orca fits',
        paragraphs: [
          'Orca combines agent terminals, Git worktrees, editing, browser tools, and diffs. Its product page describes Design Mode, inline diff comments sent to agents, GitHub and Linear integration, SSH worktrees, and mobile access. Its documentation positions remote compute on machines and cloud accounts you control.',
        ],
        links: [
          { label: 'Explore Orca’s published features', href: 'https://www.onorca.dev/' },
          { label: 'Read Orca’s workspace model', href: 'https://www.onorca.dev/docs' },
          { label: 'Orca Design Mode', href: 'https://www.onorca.dev/docs/browser/design-mode' },
          { label: 'Orca mobile companion', href: 'https://www.onorca.dev/docs/mobile' },
        ],
      },
      {
        title: 'A task can outlive its current session',
        paragraphs: [
          'Jackalope is organized around the work you want completed. A task retains its brief, project, account, follow-up attempts, questions, and result. When a change needs another pass, the original intent remains visible alongside what the agent did. This gives you a place to resume work without reconstructing the history from several terminal windows.',
          'That becomes useful across projects. You can look for work that needs attention, return to a specific task, and inspect its evidence before deciding what to ask next. The point of a trial is to see whether this organization reduces the effort of supervising your normal workload.',
        ],
      },
      {
        title: 'Browser inspection should end in usable evidence',
        paragraphs: [
          'For a user interface fix, include the reproduction steps, the expected result, a narrow viewport, and keyboard behavior in the task brief. Jackalope’s browser workflow can retain screenshots and accessibility findings with the task so that review has more to go on than the agent’s summary.',
          'Compare how naturally each workspace lets you move from an observed defect to a focused correction and then to evidence of the repaired behavior. A screenshot is one state, not proof that the entire flow works. Keep an explicit check for the original bug and any important failure state.',
        ],
      },
      {
        title: 'Review across more than one branch',
        paragraphs: [
          'Jackalope can prepare a combined patch from parallel task results before integration. For a feature with dependencies, its plan records which work must be integrated before the next task begins. These controls help separate “the agent finished” from “the change is ready for dependent work.”',
          'An effective trial includes a deliberately overlapping edit. Ask what happens when one task changes a shared type and another uses the old contract. Evaluate the review information, recovery path, and amount of manual explanation needed. Worktree isolation alone cannot resolve that kind of disagreement.',
        ],
      },
      {
        title: 'Choose around your daily loop',
        paragraphs: [
          'Orca’s mobile companion documentation labels it beta and describes pairing to a desktop, with status, recent output, and selected controls available from a phone. Check the required host connection and the actions you need before treating mobile access as a replacement for the desktop review workflow.',
          'Our assessment: Orca deserves consideration if a pane-based development environment, direct visual feedback to agents, or access to remote work is essential. Jackalope is worth evaluating if you want project context, task continuity, and combined review to organize your local agent work.',
          'Keep account requirements in the trial as well. Jackalope supports named agent profiles where the adapter permits them, but provider coverage differs. Model access comes from your own provider, and public Jackalope pricing has not been announced. Start with a disposable project and one familiar agent before moving a demanding workflow.',
        ],
      },
    ],
    faqs: [
      {
        question: 'Does Jackalope have Orca’s mobile workflow?',
        answer:
          'No. Phone access and remote hosts remain future work for Jackalope. A workflow that requires those today needs a product with that capability already available.',
      },
      {
        question: 'Do browser screenshots prove the code works?',
        answer:
          'No. In Jackalope they support review alongside the patch and reported checks. You still need to exercise the changed behavior and validate the result in the relevant environment.',
      },
      {
        question: 'Should I switch every project at once?',
        answer:
          'Start with one small project when you receive early access. Compare follow-up effort, review clarity, and account behavior before deciding whether to move more work.',
      },
    ],
  },
  {
    slug: 'conductor',
    name: 'Conductor',
    reviewed,
    description:
      'Jackalope vs Conductor: compare local agent coordination with cloud workspaces, shared sessions, agent subscriptions, and code review workflows.',
    lede: 'The important question is where your agents should work and who needs to participate. Local task coordination and shared cloud sessions solve different needs.',
    signals: [
      'Local or cloud',
      'Shared sessions',
      'Task dependencies',
      'Review before integration',
    ],
    sources: [
      { label: 'Conductor product overview', href: 'https://www.conductor.build/' },
      { label: 'Conductor documentation', href: 'https://www.conductor.build/docs' },
      {
        label: 'Conductor multiplayer',
        href: 'https://www.conductor.build/docs/cloud/collaboration',
      },
    ],
    rows: [
      {
        topic: 'Execution',
        jackalope: 'Installed agents working in local project workspaces.',
        competitor: 'Local workspaces and isolated cloud environments.',
      },
      {
        topic: 'Collaboration',
        jackalope: 'Coordination among agent tasks; shared human teams are future work.',
        competitor: 'Shared workspace links and real-time participation.',
      },
      {
        topic: 'Agent choice',
        jackalope: 'Supported native adapters with project/account configuration.',
        competitor: 'Claude Code, Codex, Cursor, and OpenCode are documented.',
      },
      {
        topic: 'Integration',
        jackalope: 'Dependency-aware plans and explicit combined patch review.',
        competitor: 'Workspace diffs, pull requests, merge, and archive flows.',
      },
    ],
    sections: [
      {
        title: 'Where Conductor fits',
        paragraphs: [
          'Conductor’s current site emphasizes cloud sandboxes and multiplayer workspaces. It describes isolated microVMs, shared workspace links, presence, and prompting agents together. Its documentation also describes local workspaces and a workflow from agent execution through diff review, pull requests, merge, and archive.',
        ],
        links: [
          {
            label: 'Read Conductor’s cloud and multiplayer overview',
            href: 'https://www.conductor.build/',
          },
          { label: 'Read Conductor’s introduction', href: 'https://www.conductor.build/docs' },
          {
            label: 'Conductor multiplayer',
            href: 'https://www.conductor.build/docs/cloud/collaboration',
          },
        ],
      },
      {
        title: 'Local coordination is Jackalope’s starting point',
        paragraphs: [
          'Jackalope operates around installed agents and local Git projects. The task carries its instructions, account, context, attempts, and review evidence. This is useful when your development workflow depends on tools and services already configured on your computer and you want to supervise the work there.',
          'For multiple tasks, Jackalope can create isolated worktrees and record dependencies. If a migration or API change needs to land first, dependent work waits for integration. Human collaboration in a shared live session is a different requirement; Jackalope’s agent coordination should not be mistaken for a multiplayer product.',
        ],
      },
      {
        title: 'Choose the execution environment before the interface',
        paragraphs: [
          'Conductor’s multiplayer documentation describes organization members opening shared workspaces and chats, seeing live output and presence, and reassigning work to teammates. Its direct workspace link is for organization members. That is a concrete human handoff flow to test if collaboration is your reason for choosing cloud execution.',
          'List what your project needs to run: a database, private packages, environment variables, a browser preview, and any platform-specific tooling. Then decide which of those can move to another environment. A remote workspace is useful only if it can reproduce the conditions under which your changes need to work.',
          'For a local Jackalope trial, start with a working checkout and establish a baseline build before asking an agent to edit it. Give each task clear setup and validation instructions. Local execution keeps the files on the host, but agents may still send code and context to their model providers.',
        ],
      },
      {
        title: 'Test how dependent changes reach review',
        paragraphs: [
          'A practical comparison is a feature with one shared contract and two callers. Let the first task propose the contract change, inspect it, and then let dependent work continue against the accepted result. Watch whether the tool makes the prerequisite and its status easy to understand.',
          'Jackalope’s combined patch preparation provides a separate decision point before integration. You can examine selected outputs together, with source and target checks guarding against stale preparation. Project tests remain necessary: a conflict-free combination can still break behavior.',
        ],
      },
      {
        title: 'Availability and the right fit',
        paragraphs: [
          'Our assessment: prioritize Conductor in your evaluation when shared cloud workspaces and live teammate participation are requirements. Consider Jackalope early access when you want to coordinate local agents with project context and explicit review of dependent changes.',
          'Jackalope is coming soon, and public pricing has not been announced. Your provider account supplies model access. If you are budgeting for a cloud workflow, compare workspace subscription, execution resources, and model usage separately rather than treating the agent subscription as the whole cost.',
        ],
      },
    ],
    faqs: [
      {
        question: 'Does Jackalope run agents in hosted cloud sandboxes?',
        answer:
          'No. Its current workflow uses local agents and local workspaces. Remote hosts and distributed execution remain roadmap work.',
      },
      {
        question: 'Is agent coordination the same as multiplayer?',
        answer:
          'No. Jackalope coordinates tasks and dependencies among agents. Shared workspaces for human teammates are a separate, future capability.',
      },
      {
        question: 'Can local files still reach a model provider?',
        answer:
          'Yes. A local workspace describes where files and processes live. Agents and connected tools can send data under their own configuration and provider policies.',
      },
    ],
  },
  {
    slug: 'emdash',
    name: 'Emdash',
    reviewed,
    description:
      'Jackalope vs Emdash: compare parallel agents, reusable context, MCP tools, recurring tasks, browser previews, remote development, and review.',
    lede: 'Both products connect agent work with the surrounding development workflow. Compare the depth of your required integrations and the way a task moves from setup to review.',
    signals: ['Reusable context', 'MCP connections', 'Recurring tasks', 'Browser evidence'],
    sources: [
      { label: 'Emdash product overview', href: 'https://emdash.com/' },
      { label: 'Emdash official documentation', href: 'https://emdash.com/docs' },
      { label: 'Emdash remote development', href: 'https://emdash.com/docs/remote-development' },
      { label: 'Emdash MCP library', href: 'https://emdash.com/docs/library/mcp' },
    ],
    rows: [
      {
        topic: 'Parallel tasks',
        jackalope: 'Isolated worktrees with task dependencies and a concurrency limit.',
        competitor: 'Worktree-based tasks with separate conversations and review state.',
      },
      {
        topic: 'Reusable resources',
        jackalope: 'Project instructions, knowledge, workflows, and selected MCP tools.',
        competitor: 'Library of prompts, skills, and MCP servers.',
      },
      {
        topic: 'Review and evidence',
        jackalope: 'Task evidence and combined patch preparation.',
        competitor: 'Diff review, browser previews, PRs, and CI monitoring.',
      },
      {
        topic: 'Remote development',
        jackalope: 'Planned; current task execution is local.',
        competitor: 'SSH and provisioned remote workspaces are documented.',
      },
    ],
    sections: [
      {
        title: 'Where Emdash fits',
        paragraphs: [
          'Emdash describes an open-source development environment with parallel agents, recurring work, an in-app browser, and reusable prompts, skills, and MCP servers. Its documentation includes issue intake, GitHub checks, remote development, and persistent terminal sessions. It advertises broad CLI agent coverage and desktop downloads for macOS, Windows, and Linux.',
        ],
        links: [
          { label: 'Explore Emdash’s product', href: 'https://emdash.com/' },
          { label: 'Read Emdash’s capability overview', href: 'https://emdash.com/docs' },
          {
            label: 'Emdash remote development',
            href: 'https://emdash.com/docs/remote-development',
          },
          { label: 'Emdash MCP library', href: 'https://emdash.com/docs/library/mcp' },
        ],
      },
      {
        title: 'Project context should survive changing agents',
        paragraphs: [
          'Jackalope keeps project instructions and selected tools at the project level, with relevant context attached to the task. The goal is continuity when you change workers or revisit unfinished work. A follow-up should begin with an understandable brief and previous result, rather than requiring a fresh explanation of the entire project.',
          'When comparing resource libraries, bring one real project rule, one reusable workflow, and one external tool. Check whether each reaches the agent that needs it and whether you can inspect the effective configuration. A large library has little value if its instructions are not applied to the intended task.',
        ],
      },
      {
        title: 'Tool availability is a contract to check',
        paragraphs: [
          'Emdash’s MCP library writes configuration into the selected agents’ native config files, making those connections available in sessions outside Emdash too. Jackalope’s project selection is a different delivery model. When evaluating either, check whether a tool should follow the account everywhere or be selected for a particular project and task.',
          'Jackalope’s MCP support depends on the selected agent adapter and connection. It manages project-selected tools centrally, but that does not mean every provider supports the same delivery method or interaction. Check compatibility for the exact agent and service combination you plan to use.',
          'Use a harmless read operation in your first trial. Confirm which project supplied the connection, whether the agent can discover the relevant capability, and what happens when access fails. Keep credentials and production write permissions out of a comparison exercise until you understand the flow.',
        ],
      },
      {
        title: 'Recurring work needs a review habit',
        paragraphs: [
          'A useful recurring task produces something you can inspect: a maintenance patch, a test report, or a bounded investigation. Jackalope keeps recurring work connected to local execution and task history. Plan around the availability of the host and its dependencies.',
          'Try a weekly dependency review with an explicit instruction to report findings before changing versions. Then evaluate how clearly you can identify the latest run, inspect its result, and stop or revise the task. Frequency is less important than whether an unattended result is understandable when you return.',
        ],
      },
      {
        title: 'Choose by the work around the agent',
        paragraphs: [
          'Our assessment: evaluate Emdash when a broad agent catalog, issue intake, or remote development is central to your workflow. Evaluate Jackalope when your priority is carrying context and evidence through a local task lifecycle, with dependent work and combined review.',
          'Use the same small UI change in both trials. Capture a browser check, request a follow-up, and review the final patch. Jackalope is coming soon; join the waitlist to try it when invited. Model access remains with your provider, and public Jackalope pricing has not been announced.',
        ],
      },
    ],
    faqs: [
      {
        question: 'Does Jackalope support every agent in Emdash’s catalog?',
        answer:
          'No such parity is claimed. Jackalope implements specific adapters, and some catalog entries support setup without task execution. Check the current compatibility page for your agent.',
      },
      {
        question: 'Does adding an MCP server make every tool available everywhere?',
        answer:
          'No. Tool delivery depends on connection configuration, project selection, and the agent adapter. Verify the exact combination with a small task.',
      },
      {
        question: 'Can I move my entire development setup without testing it?',
        answer:
          'Start with a disposable project and one workflow. Validate instructions, tool access, setup, and review before transferring important work.',
      },
    ],
  },
  {
    slug: 'braid',
    name: 'Braid',
    reviewed,
    description:
      'Jackalope vs Braid: compare Git worktrees, agent sessions, project setup, GitHub review, task dependencies, and integration of parallel changes.',
    lede: 'Worktrees give parallel coding agents separate places to edit. The choice of workspace determines how you prepare those places and bring the results back together.',
    signals: ['Git worktrees', 'Project setup', 'Session context', 'Combined review'],
    sources: [
      { label: 'Braid product overview', href: 'https://getbraid.dev/' },
      {
        label: 'Braid projects and worktrees documentation',
        href: 'https://getbraid.dev/docs/features/projects-and-worktrees/',
      },
    ],
    rows: [
      {
        topic: 'Primary organization',
        jackalope: 'Tasks, attempts, project context, and review evidence.',
        competitor: 'Projects, worktrees, agent sessions, and a session/PR overview.',
      },
      {
        topic: 'Project setup',
        jackalope: 'Project instructions and task context for supported local agents.',
        competitor: 'Lifecycle scripts, copied setup files, and branch-prefix configuration.',
      },
      {
        topic: 'Review workflow',
        jackalope: 'Prepare selected changes as a combined patch before integration.',
        competitor: 'Built-in stage, commit, push, PR checks, and merge controls.',
      },
      {
        topic: 'Dependent work',
        jackalope: 'Plans hold dependent tasks until prerequisite integration.',
        competitor: 'Separate worktrees organize parallel branches and sessions.',
      },
    ],
    sections: [
      {
        title: 'Where Braid fits',
        paragraphs: [
          'Braid presents a desktop workspace with Git worktrees, agent sessions, terminals, an editor, and GitHub review controls. Its documentation describes per-project setup, run, and archive scripts, plus copying local configuration into new worktrees. Worktree navigation includes status indicators and pull request badges.',
        ],
        links: [
          { label: 'Explore Braid’s features', href: 'https://getbraid.dev/' },
          {
            label: 'Read Braid’s project setup documentation',
            href: 'https://getbraid.dev/docs/features/projects-and-worktrees/',
          },
        ],
      },
      {
        title: 'A worktree is the start of a task environment',
        paragraphs: [
          'A separate checkout gives an agent its own files and branch. It does not automatically provide dependencies, a database, environment configuration, or an unused development-server port. Include those requirements when comparing any workspace that creates worktrees for you.',
          'Jackalope attaches project context and instructions to tasks so the agent can understand the setup and expected outcome. For an evaluation, choose a repository whose baseline checks already pass. Record the commands needed to reproduce that baseline in a new checkout, then see how well the task retains that knowledge.',
        ],
      },
      {
        title: 'Follow the outcome through multiple attempts',
        paragraphs: [
          'In Jackalope, a task keeps the brief, agent, account, questions, follow-up attempts, and result together. That makes a distinction between the work you requested and any single run that tried to complete it. A correction remains part of the same outcome instead of becoming an unrelated session.',
          'Test this with a bug that needs a second pass. Ask the agent to fix the reproduction, inspect the result, and then supply a missed edge case. Compare how easy it is to understand the original requirement, the rejected behavior, and the latest change without reopening every conversation.',
        ],
      },
      {
        title: 'Review the relationship between branches',
        paragraphs: [
          'Jackalope’s parallel plans can express dependencies and delay downstream work until an upstream change is integrated. Its review preparation combines selected task outputs and rechecks the source and target state before integration. This is especially useful to evaluate on changes that share a public interface.',
          'For example, split a settings feature into persistence, validation, and presentation. Decide which pieces can run independently and which require an accepted contract first. A workspace helps when it makes that sequence visible; opening all three agents at once is not necessarily the fastest route to a correct result.',
        ],
      },
      {
        title: 'Make the decision with a real branch lifecycle',
        paragraphs: [
          'Our assessment: Braid is worth evaluating if you want project setup, editing, sessions, and GitHub review close together. Consider Jackalope early access if you want task history and explicit integration of dependent results to organize your work.',
          'Run the trial through review and cleanup rather than stopping when the agent replies. Verify that important uncommitted files remain available, identify which branch owns the final change, and confirm your normal checks on the combined result. Jackalope is coming soon, with model access supplied by your provider and public pricing still unannounced.',
        ],
      },
    ],
    faqs: [
      {
        question: 'Do separate worktrees guarantee conflict-free changes?',
        answer:
          'No. They separate working directories. Different branches can still change the same code or make incompatible assumptions, so integration and behavior checks remain necessary.',
      },
      {
        question: 'Is a task the same as an agent session?',
        answer:
          'In Jackalope, a task can contain multiple attempts and follow-ups. The task preserves the requested outcome and its history beyond one session.',
      },
      {
        question: 'What should I compare before switching?',
        answer:
          'Use a real setup, edit, follow-up, review, and cleanup cycle. Check agent compatibility and preserve your existing work until the new workflow is accepted.',
      },
    ],
  },
  {
    slug: 'worktree',
    name: 'Worktree',
    reviewed,
    description:
      'Jackalope vs Worktree: compare local agent coordination with shared AI threads, team collaboration, cloud execution, MCP connections, and review.',
    lede: 'Worktree is a product for people collaborating with AI. Jackalope focuses on coordinating coding-agent tasks. Decide who needs to share the work before comparing the interfaces.',
    signals: ['Human collaboration', 'Agent coordination', 'Execution location', 'Review context'],
    sources: [
      { label: 'Worktree product overview', href: 'https://tryworktree.com/' },
      { label: 'Worktree documentation', href: 'https://tryworktree.com/docs' },
      { label: 'Worktree cloud workspaces', href: 'https://tryworktree.com/docs/cloud-workspaces' },
      { label: 'Worktree providers and MCP', href: 'https://tryworktree.com/docs/connections' },
    ],
    rows: [
      {
        topic: 'Collaboration model',
        jackalope: 'Local supervision and coordination of agent tasks.',
        competitor: 'Human teammates can participate in shared AI threads.',
      },
      {
        topic: 'Execution options',
        jackalope: 'Local project workspaces; remote execution is future work.',
        competitor: 'Private Local, Shared Local, and managed Cloud workspaces.',
      },
      {
        topic: 'Context and tools',
        jackalope: 'Project context and selected MCP tools for supported agents.',
        competitor: 'Workspace conversations, provider connections, and MCP tools.',
      },
      {
        topic: 'Review',
        jackalope: 'Task evidence, attempts, and combined patch preparation.',
        competitor: 'Conversation and changed files together for shared review.',
      },
    ],
    sections: [
      {
        title: 'Where Worktree fits',
        paragraphs: [
          'Worktree brings shared agent conversations, code changes, and human collaboration into a desktop workspace. Its docs distinguish private local execution, shared local workspaces, and managed cloud environments. Shared local work requires the owner’s computer to remain online. Providers and MCP tools connect at the workspace level.',
        ],
        links: [
          { label: 'Explore Worktree’s collaboration model', href: 'https://tryworktree.com/' },
          {
            label: 'Read the Local, Shared Local, and Cloud documentation',
            href: 'https://tryworktree.com/docs',
          },
          {
            label: 'Worktree cloud workspaces',
            href: 'https://tryworktree.com/docs/cloud-workspaces',
          },
          { label: 'Worktree providers and MCP', href: 'https://tryworktree.com/docs/connections' },
        ],
      },
      {
        title: 'Separate team collaboration from agent coordination',
        paragraphs: [
          'Jackalope organizes tasks assigned to coding agents. It can carry project context, account choices, task dependencies, and results across a local workflow. That helps one operator supervise several pieces of work without confusing their branches or losing the original brief.',
          'A team sharing a live conversation has additional needs: who can join, who can send instructions, who owns the environment, and who makes the final review decision. Jackalope’s current agent coordination does not implement that shared-human-workspace model. Treat that as a functional requirement, not a cosmetic difference.',
        ],
      },
      {
        title: 'Decide who needs the execution environment',
        paragraphs: [
          'Worktree’s connection documentation says Cloud and shared Local Threads accept API connections, while supported personal OAuth connections remain available in private Local Threads. Check this distinction if your current workflow depends on a subscription sign-in; do not assume that sharing a workspace preserves the same authentication option.',
          'If the same developer always runs and reviews the project, a local workflow may be sufficient. If a teammate needs to continue while that developer is offline, the lifetime and accessibility of the environment become part of the product choice. Write down those requirements before trialing tools.',
          'In Jackalope, repositories and task workspaces live on your computer. Agents and connected services can still transmit context according to their configuration. Local storage does not imply that no data reaches a provider, and separate account profiles do not isolate access to local files.',
        ],
      },
      {
        title: 'Review with enough context to make a decision',
        paragraphs: [
          'Jackalope keeps the task’s requested outcome, attempts, evidence, and resulting patch connected. For parallel work, combined review helps you inspect how changes fit together before integration. A dependency can wait for the prerequisite’s actual integration rather than trusting a completion message.',
          'Try a bug investigation followed by an implementation and a verification pass. Ask whether another reviewer can identify what was requested, what changed, which checks ran, and what remains uncertain. A useful record makes those questions answerable without a separate verbal handoff.',
        ],
      },
      {
        title: 'Choose the collaboration you actually need',
        paragraphs: [
          'Our assessment: shortlist Worktree when teammates must participate in the same agent conversation or share an execution environment. Consider Jackalope when your requirement is local coordination of independent and dependent agent tasks with a clear review decision.',
          'For costs, Worktree’s documentation distinguishes private local use from paid sharing and cloud capacity. Check its current plans for the configuration you need. Jackalope’s public pricing is unannounced, and its early-access workflow uses your own agent provider access. Avoid comparing only subscription labels when hosting and model costs differ.',
        ],
        links: [
          { label: 'Worktree’s workspace and plan overview', href: 'https://tryworktree.com/docs' },
        ],
      },
    ],
    faqs: [
      {
        question: 'Is Worktree the same thing as a Git worktree?',
        answer:
          'No. Worktree is the product at tryworktree.com. A Git worktree is a separate checkout associated with a repository; both products use that Git concept in their workflows.',
      },
      {
        question: 'Can teammates join a Jackalope task live?',
        answer:
          'Shared team workspaces are future work. Current coordination concerns agent tasks and their dependencies, rather than multiple people participating in one live session.',
      },
      {
        question: 'Can I evaluate Jackalope for a solo workflow?',
        answer:
          'Yes, through early access when invited. Start with a familiar local project and compare task history, context, and review against your existing process.',
      },
    ],
  },
  {
    slug: 'codius',
    name: 'Codius',
    reviewed,
    description:
      'Jackalope vs Codius: compare local agent tasks with desktop, web, and mobile access, host ownership, recurring work, providers, and code review.',
    lede: 'Codius emphasizes reaching your agents across devices. Jackalope emphasizes the continuity of local tasks and the review of their results. Start with where you need to work.',
    signals: ['Host ownership', 'Cross-device access', 'Task history', 'Review evidence'],
    sources: [
      { label: 'Codius product overview', href: 'https://codius.ai/' },
      { label: 'Codius CLI and host workflow', href: 'https://codius.ai/codius-cli' },
    ],
    rows: [
      {
        topic: 'Access surfaces',
        jackalope: 'Desktop workflow; remote and phone access are planned.',
        competitor: 'Desktop, web, and phone access to supported agents.',
      },
      {
        topic: 'Execution host',
        jackalope: 'Your local machine and project workspaces.',
        competitor: 'Hosts you control, reached directly or through a relay.',
      },
      {
        topic: 'Provider configuration',
        jackalope: 'Supported adapters, named accounts, and project choices.',
        competitor: 'First-class agents, an ACP catalog, and optional Codius models.',
      },
      {
        topic: 'Work and review',
        jackalope: 'Attempts, task evidence, dependencies, and combined patches.',
        competitor: 'Sessions, worktrees, previews, review, and scheduled work.',
      },
    ],
    sections: [
      {
        title: 'Where Codius fits',
        paragraphs: [
          'Codius advertises desktop, browser, and phone access to coding agents running on hosts you control. Its site describes direct or relay connections, isolated worktrees, schedules, browser previews, and a provider catalog. The CLI covers host, pairing, schedule, and daemon workflows. Optional Codius model access is distinct from bringing an existing agent account.',
        ],
        links: [
          { label: 'Read Codius’s product and provider overview', href: 'https://codius.ai/' },
          { label: 'Explore the Codius CLI', href: 'https://codius.ai/codius-cli' },
        ],
      },
      {
        title: 'Access and coordination are separate decisions',
        paragraphs: [
          'Being able to reach an agent from another device solves an access problem. Knowing which task needs attention, which account ran it, and whether related changes are ready to integrate solves a coordination problem. Some workflows need both; others are primarily local.',
          'Jackalope concentrates on the latter through tasks with project context, attempts, questions, results, and evidence. It does not currently provide remote-host or mobile execution control. If checking in from a phone is essential to your day, make that a requirement before weighing the rest of the interface.',
        ],
      },
      {
        title: 'Keep the account and project attached to the work',
        paragraphs: [
          'Jackalope supports project-level agent choices and named account profiles where the adapter permits them. A task continuation retains its original account binding. This is useful when work and personal projects must use different provider identities and you need to understand which identity belongs to an existing task.',
          'Evaluate the actual agent you intend to use rather than a provider logo. Authentication, model selection, tools, usage reporting, and continuation support can differ between adapters. A successful sign-in is not enough: run a small task and a follow-up, then inspect the recorded result.',
        ],
      },
      {
        title: 'Review the result when you return',
        paragraphs: [
          'A task running while you are occupied elsewhere should leave a result you can understand. In Jackalope, the requested outcome, attempts, reported checks, and evidence remain together. Selected parallel results can be prepared as a combined patch before an explicit integration decision.',
          'For a useful trial, ask for a focused bug fix, leave it running, and come back without rereading the whole transcript. Can you identify the changed behavior, find the relevant files, and see what the agent did not verify? Then request a correction and confirm that the original intent remains easy to find.',
        ],
      },
      {
        title: 'Compare the full operating cost',
        paragraphs: [
          'Our assessment: consider Codius when cross-device access to your own hosts is a priority. Consider Jackalope early access when you want local task supervision, project continuity, and combined review without making remote access part of the workflow.',
          'List model usage, host resources, and any workspace or connection plan separately when comparing costs. Jackalope does not include an AI subscription and has not announced public pricing. For a local trial, include the practical cost of keeping your development environment available for scheduled tasks.',
        ],
      },
    ],
    faqs: [
      {
        question: 'Can Jackalope reach my agents from a phone?',
        answer:
          'Not currently. Phone access and remote hosts are roadmap items. The current task workflow runs on the local desktop.',
      },
      {
        question: 'Does Jackalope include model credits?',
        answer:
          'No. You bring a supported locally installed agent and its provider account. The provider determines model access, usage limits, and charges.',
      },
      {
        question: 'What should I test with multiple accounts?',
        answer:
          'Check the selected identity on a new task, continue an existing task, and confirm the recorded account remains correct. Jackalope account support depends on the agent adapter.',
      },
    ],
  },
  {
    slug: 'hermes',
    name: 'Hermes Agent',
    reviewed,
    description:
      'Jackalope vs Hermes Agent by Nous Research: compare coding-agent workspaces with persistent agent memory, messaging, automation, and task review.',
    lede: 'Hermes is an agent with memory, tools, and automation. Jackalope is a workspace for supervising supported coding agents. They sit at different layers of a workflow.',
    signals: ['Agent or workspace', 'Persistent context', 'Automation', 'Human review'],
    sources: [
      { label: 'Hermes Agent by Nous Research', href: 'https://hermes-agent.nousresearch.com/' },
      { label: 'Hermes Agent documentation', href: 'https://hermes-agent.nousresearch.com/docs' },
      {
        label: 'Hermes memory system',
        href: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/memory',
      },
      {
        label: 'Hermes tools and execution backends',
        href: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/tools',
      },
    ],
    rows: [
      {
        topic: 'Product role',
        jackalope: 'Desktop workspace coordinating supported coding agents.',
        competitor: 'An autonomous agent with memory, tools, and model configuration.',
      },
      {
        topic: 'Continuity',
        jackalope: 'Project context, task attempts, results, and review history.',
        competitor: 'Persistent memory and reusable agent-created skills.',
      },
      {
        topic: 'Automation',
        jackalope: 'Local recurring tasks and dependency-aware agent plans.',
        competitor: 'Gateway scheduling, messaging integrations, and subagents.',
      },
      {
        topic: 'Execution and review',
        jackalope: 'Local Git worktrees and explicit combined patch review.',
        competitor: 'Configurable execution backends and general-purpose agent tools.',
      },
    ],
    sections: [
      {
        title: 'Where Hermes Agent fits',
        paragraphs: [
          'Nous Research’s Hermes Agent combines persistent memory, skills, tools, messaging integrations, scheduling, and subagents. Its documentation describes configurable model providers and multiple execution backends. It is a general-purpose agent that can perform coding and other work, rather than solely an interface for supervising independent coding-agent products.',
        ],
        links: [
          { label: 'Explore Hermes Agent', href: 'https://hermes-agent.nousresearch.com/' },
          {
            label: 'Read the official Hermes documentation',
            href: 'https://hermes-agent.nousresearch.com/docs',
          },
          {
            label: 'Hermes memory system',
            href: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/memory',
          },
          {
            label: 'Hermes tools and execution backends',
            href: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/tools',
          },
        ],
      },
      {
        title: 'Choose the layer you need to change',
        paragraphs: [
          'If you want a different agent to reason, use tools, and remember previous work, you are evaluating the worker. If you already use several coding agents and want to organize their projects, accounts, tasks, and results, you are evaluating the workspace around those workers.',
          'Jackalope addresses that workspace layer. It retains the task brief, selected agent and account, worktree, attempts, questions, and evidence. It does not promise to make every provider behave identically or to replace the agent’s reasoning. Its value needs to be judged through the supervision and review work it helps you do.',
        ],
      },
      {
        title: 'Memory and project context are related but different',
        paragraphs: [
          'Hermes documents bounded memory files that are loaded as a snapshot at the start of a session. Updates persist for later sessions, and separate agents should use separate profiles. Compare those ownership and update rules with the project guidance you want a coding task to receive, instead of treating every form of persistent context as interchangeable.',
          'A useful comparison asks what information should persist, who controls it, and how it affects the next task. Personal preferences, project architecture, a reusable procedure, and evidence from a failed attempt are different kinds of context. Putting them all in one conversation can make later work harder to understand.',
          'Jackalope keeps project context and task history connected to the relevant project and outcome. When trialing it, return to an unfinished task after completing unrelated work. Check that the original request, account, and previous result remain identifiable, and that the agent receives the instructions appropriate to that project.',
        ],
      },
      {
        title: 'Automation still needs an acceptance step',
        paragraphs: [
          'An agent can finish a sequence of tool calls without satisfying the original requirement. Jackalope makes review part of the task lifecycle: inspect the patch, reported checks, and evidence before accepting the result. For parallel work, prepare the combined changes and review their interaction before integration.',
          'Use two different trial tasks to separate these needs. One might be a recurring research summary, where freshness and useful sources matter. The other might be a code change across two dependent components, where branch state, tests, and integration matter. The best choice may differ between those tasks.',
        ],
      },
      {
        title: 'A complementary idea is not an implemented integration',
        paragraphs: [
          'Our assessment: evaluate Hermes when you want a persistent general-purpose agent with automation and messaging. Evaluate Jackalope when you want to supervise supported coding agents in local projects and retain a reviewable history of their work.',
          'Jackalope does not currently advertise a native Hermes task adapter. Do not assume that the products can be connected simply because their roles could complement one another. Check supported adapters before planning a combined workflow. Jackalope is coming soon, public pricing is unannounced, and model access comes from your own provider.',
        ],
      },
    ],
    faqs: [
      {
        question: 'Is Jackalope another AI model or agent?',
        answer:
          'Jackalope is a desktop workspace and execution harness for supported coding agents. Users bring locally installed agents and their provider accounts.',
      },
      {
        question: 'Can I run Hermes inside Jackalope?',
        answer:
          'A native Hermes task adapter is not currently advertised. Treat that integration as unsupported unless the current compatibility documentation explicitly says otherwise.',
      },
      {
        question: 'Which Hermes product is compared here?',
        answer:
          'This page refers to Hermes Agent by Nous Research at hermes-agent.nousresearch.com, not unrelated products with the Hermes name.',
      },
    ],
  },
];

export const comparisonLinks = comparisons.map(({ slug, name }) => ({
  href: `/compare/${slug}/`,
  label: `Jackalope vs ${name}`,
}));

export const comparisonPages: MarketingPage[] = comparisons.map((comparison) => ({
  path: `/compare/${comparison.slug}/`,
  kind: 'Workspace comparison',
  title: `Jackalope vs ${comparison.name}: Workflow comparison`,
  description: comparison.description,
  headline: `Jackalope vs ${comparison.name}`,
  lede: comparison.lede,
  image: 'review',
  signals: comparison.signals,
  sections: comparison.sections,
  comparison,
  related: [
    { href: '/compare/', label: 'All comparisons' },
    ...comparisonLinks.filter((link) => link.href !== `/compare/${comparison.slug}/`),
    { href: '/compare/terminal-tabs/', label: 'Jackalope and terminal tabs' },
  ],
}));
