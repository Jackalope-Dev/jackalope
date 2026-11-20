import type { BlogPost } from './blog-types.ts';

export const practicalPosts: BlogPost[] = [
  {
    slug: 'run-ai-coding-agents-in-parallel',
    cover: { kind: 'parallel', tone: 'rose', label: 'More hands. One review.' },
    title: 'How to run AI coding agents in parallel without drowning in review',
    seoTitle: 'How to run AI coding agents in parallel',
    category: 'Practical guides',
    author: 'caden-sumner',
    date: '2026-11-04',
    readingTime: '7 min read',
    description:
      'Run several coding agents at once: choose independent tasks, find shared resources, set a concurrency limit you can review, and merge in a safe order.',
    sections: [
      {
        id: 'bottleneck',
        title: 'Parallel agents move the bottleneck',
        paragraphs: [
          'Starting five coding-agent sessions takes about a minute. Codex in one terminal, Claude Code in another, a third agent chasing a flaky test. For a while it feels like the team just got bigger.',
          'Then the results arrive. Each one needs someone to read the patch, run it, decide whether it is right and merge it without breaking the others. Agents write code in parallel; you still review it one change at a time. Running agents in parallel pays off when the tasks are genuinely independent and the results come back in a shape you can review as fast as they land. This guide is about getting both of those right.',
        ],
      },
      {
        id: 'independent-work',
        title: 'Pick work that is actually independent',
        paragraphs: [
          'A useful test: could these changes be merged in any order, and would each still make sense on its own? If yes, they are good parallel candidates. If one task needs a decision or an interface that another task is still producing, they are a sequence, however separate the prompts sound.',
          'Split by outcome, not by layer. "Add the export button" split into a frontend agent and a backend agent creates two halves that only work together, and neither agent can check its own result. "Fix the date parsing bug" and "add keyboard shortcuts to the settings page" are separate outcomes, each with its own check.',
        ],
        table: {
          caption: 'What to run in parallel and what to keep in sequence',
          headers: ['Usually fine in parallel', 'Usually better in sequence'],
          rows: [
            [
              'Bug fixes in unrelated modules',
              'A refactor and a feature that touches the refactored code',
            ],
            [
              'Tests for existing, stable behavior',
              'An API change and the client code that consumes it',
            ],
            ['Docs or help text that does not depend on new code', 'Two schema migrations'],
            [
              'Investigations that only report findings',
              'Any task whose brief says "whatever the other agent decides"',
            ],
          ],
        },
      },
      {
        id: 'shared-resources',
        title: 'Find the shared resources before the agents do',
        paragraphs: [
          '[Separate checkouts](/git-worktrees-for-ai-agents/) stop two agents from editing the same files. They do not separate everything else the project touches. Most surprising failures in parallel agent work come from a resource that both tasks quietly share.',
          'Before starting, list what a typical task reads and writes outside its own source files. Then give each task its own copy, make the resource read-only for agents, or decide that tasks touching it run one at a time.',
        ],
        bullets: [
          'Lockfiles and dependency manifests: two agents adding packages conflict on every merge.',
          "Database schema and migrations: numbered migrations collide, and a shared dev database lets one agent's test data break another's run.",
          'Generated code: two agents regenerating the same client produce noisy, conflicting diffs.',
          "Fixed ports: two dev servers on port 3000 means one agent tests the other's build.",
          'Provider usage limits: several sessions on one account draw on the same allowance, so a busy run can stall every agent at once.',
        ],
        code: {
          label: 'Give each checkout its own port and database',
          language: 'bash',
          value:
            '# Run from each task\'s worktree\nexport PORT=$((3000 + RANDOM % 1000))\nexport DATABASE_URL="postgres://localhost/app_$(basename "$PWD")"\npnpm db:reset && pnpm dev',
        },
        links: [
          {
            label: 'Git worktrees for AI coding agents',
            href: '/git-worktrees-for-ai-agents/',
          },
          { label: 'git worktree documentation', href: 'https://git-scm.com/docs/git-worktree' },
        ],
      },
      {
        id: 'concurrency',
        title: 'Set the concurrency limit from your review capacity',
        paragraphs: [
          'The right number of agents is not how many your machine or plan can run. It is how many results you can review properly in the time the agents take to produce them. If finished tasks sit in a queue for hours, the extra agents are producing work that goes stale against a moving main branch.',
          'Start with two. Run a few rounds and watch where the time goes. If you finish reviewing before the next result lands, add a third. If you catch yourself approving patches after skimming the summary, or merge conflicts start appearing between tasks, lower the limit again. Larger, well-tested tasks support more concurrency than small ones that each need a careful read.',
        ],
        bullets: [
          'Raise the limit when reviews finish before new results arrive and merges stay clean.',
          'Lower it when results wait unreviewed, conflicts repeat, or agents ask you the same question.',
          'Keep the limit per project: a well-tested backend and an untested prototype need different caps.',
        ],
      },
      {
        id: 'briefs',
        title: 'Write briefs that end in a handoff',
        paragraphs: [
          'A parallel agent cannot lean over and ask what the other one is doing, so the brief has to carry the boundaries. Name the outcome, the files the task owns, the files it must leave alone, the check that proves it works, and what it should report when it stops.',
          'The report matters as much as the code. Ask each agent to list the files it changed, the checks it ran with their results, and anything it assumed or could not finish. A consistent handoff lets you review five results in the same order every time instead of rediscovering what each one did.',
        ],
        code: {
          label: 'A brief for one parallel task',
          language: 'markdown',
          value:
            "## Outcome\nDates in the CSV import parse in the user's locale, not UTC.\n\n## Scope\n- Own: src/import/dates.ts and its tests.\n- Leave alone: src/import/schema.ts (another task is changing it).\n\n## Done when\n- pnpm test --filter import passes, including a new case for en-GB dates.\n\n## Report\n- Files changed, checks run with results, assumptions, open questions.\n- Do not commit or merge.",
        },
      },
      {
        id: 'merge-order',
        title: 'Merge one at a time, in dependency order',
        paragraphs: [
          'Each task passing its own checks does not mean the combination passes. Two changes can each be correct and still conflict in behavior: one renames a setting while another adds a new reader of the old name. Integrate results one at a time, rerun the full checks after each merge, and update the remaining branches before reviewing them.',
          'Merge prerequisites first, then their dependents, then independent work in whatever order it finished. When a result fails review, send precise feedback to the same task instead of starting a new one, so the correction keeps its history. After the last merge, run the whole suite once more on the combined result before you call the batch done.',
        ],
        links: [
          {
            label: 'How to review AI-generated code',
            href: '/blog/review-ai-generated-code-checklist/',
          },
        ],
      },
      {
        id: 'when-to-stop',
        title: 'Know when to go back to one agent',
        paragraphs: [
          'Parallel work is a tool for a particular kind of backlog: several well-understood, separable changes. It is the wrong tool for exploratory work, for a design that has not settled, or for a change concentrated in one module. In those cases a single focused session, followed by review, is faster than coordinating several agents around an open question.',
          "Watch for the signs: you rewrite briefs mid-run because the plan changed, agents keep touching each other's files, or most of your time goes to resolving conflicts rather than reviewing behavior. Pause new tasks, finish what is running, and decide the open question before fanning out again.",
        ],
      },
      {
        id: 'where-jackalope-fits',
        title: 'Keep the plan and the review in one place',
        paragraphs: [
          "Jackalope is a desktop workspace for running Codex, Claude Code and other coding agents side by side. A parallel plan holds each task's brief, file scope, dependencies and assigned agent, with a concurrency limit per project. Each task can get its own Git worktree, and finished work returns to one review queue with its patch, checks and attempt history, so you can inspect the combined result before it reaches your branch.",
          'It does not make independent tasks out of dependent ones. The choices above, what to split, what to share and how many agents to run, still decide whether parallel work saves time.',
        ],
        links: [
          { label: 'Parallel coding agents in Jackalope', href: '/parallel-coding-agents/' },
          {
            label: 'Run Codex and Claude Code in parallel',
            href: '/guides/run-codex-and-claude-code-in-parallel/',
          },
        ],
      },
    ],
    related: [
      {
        label: 'Git worktrees for AI coding agents',
        href: '/git-worktrees-for-ai-agents/',
      },
      {
        label: 'Use Claude Code and Codex together',
        href: '/guides/run-codex-and-claude-code-in-parallel/',
      },
      {
        label: 'Write project instructions agents follow',
        href: '/blog/agents-md-claude-md-project-instructions/',
      },
    ],
  },
  {
    slug: 'agents-md-claude-md-project-instructions',
    cover: { kind: 'context', tone: 'honey', label: 'Write it down once.' },
    title: 'AGENTS.md and CLAUDE.md: writing project instructions agents follow',
    seoTitle: 'AGENTS.md vs CLAUDE.md: a practical guide',
    category: 'Practical guides',
    author: 'caden-sumner',
    date: '2026-09-27',
    readingTime: '7 min read',
    description:
      'Write an AGENTS.md or CLAUDE.md coding agents follow: what to include, sharing one file across Codex, Claude Code and Gemini CLI, and testing it.',
    sections: [
      {
        id: 'why-instruction-files',
        title: 'Stop repeating the same correction',
        paragraphs: [
          'Every coding agent starts a session knowing nothing about your repository. It guesses the package manager, runs the wrong test command, and formats files the way it saw most often in training. You correct it, the session ends, and the next one makes the same guess.',
          'A project instruction file fixes that at the source. It is a Markdown file in the repository that the agent reads before it starts work. Written well, it replaces the first ten minutes of every conversation. Written badly, it becomes a long list of rules the agent skims, half follows or applies in the wrong place.',
        ],
      },
      {
        id: 'which-file',
        title: 'Know which file each agent reads',
        paragraphs: [
          "AGENTS.md is an open format supported by many tools, including Codex and OpenCode. Claude Code reads CLAUDE.md. Gemini CLI reads GEMINI.md by default, and its context file name can be configured. Check each tool's documentation for the version you run, because loading rules change.",
          'You rarely need three copies. Keep the shared guidance in AGENTS.md and make the other files thin pointers. Claude Code supports importing another file with an @ reference, so a one-line CLAUDE.md can pull in AGENTS.md and add only what is specific to Claude. Copies drift; one source with small agent-specific additions does not.',
        ],
        table: {
          caption: 'Default instruction files by agent',
          headers: ['Agent', 'Reads by default', 'Sharing approach'],
          rows: [
            ['Codex', 'AGENTS.md', 'Use AGENTS.md as the source'],
            ['OpenCode', 'AGENTS.md', 'Use AGENTS.md as the source'],
            ['Claude Code', 'CLAUDE.md', 'Import @AGENTS.md from CLAUDE.md'],
            ['Gemini CLI', 'GEMINI.md', 'Configure the context file name, or point to AGENTS.md'],
          ],
        },
        code: {
          label: 'CLAUDE.md that reuses the shared file',
          language: 'markdown',
          value:
            '@AGENTS.md\n\n## Claude Code only\n- Prefer the project skills in .claude/skills when one fits.',
        },
        links: [
          { label: 'AGENTS.md format', href: 'https://agents.md/' },
          {
            label: 'Claude Code: memory and CLAUDE.md',
            href: 'https://code.claude.com/docs/en/memory',
          },
        ],
      },
      {
        id: 'what-to-include',
        title: 'Write what the agent cannot discover',
        paragraphs: [
          'An agent can read your code. It cannot read the reasons behind it. The most useful lines describe commands, boundaries and decisions that are not obvious from the files: which check proves a change works, which directories are generated, which API must stay backward compatible.',
          'Leave out what the repository already says. Restating the folder structure or listing every dependency costs context on every task and goes stale quickly. If a rule matters only for one package, put it in a nested file in that directory instead of the root file; tools that support nested files apply the closest one to the files being edited.',
        ],
        bullets: [
          'Setup, build and test commands, including the fast targeted check and the full one.',
          'Boundaries: generated files, vendored code, migrations or data that must not be edited.',
          'Conventions that differ from the ecosystem default, with a one-line reason.',
          'What done means: which checks must pass and what the agent should report back.',
          'Actions that need a person, such as committing, deploying or changing credentials.',
        ],
        code: {
          label: 'A compact AGENTS.md',
          language: 'markdown',
          value:
            '# Agent guidance\n\n## Commands\n- Install: pnpm install --frozen-lockfile\n- Fast check: pnpm test --filter <package>\n- Before finishing: pnpm verify\n\n## Boundaries\n- Do not edit src/generated/; run pnpm codegen instead.\n- Keep saved-data formats backward compatible.\n\n## Conventions\n- Styling comes from packages/brand tokens, not hard-coded colors.\n- Comments explain non-obvious behavior, not what the code does.\n\n## Finishing\n- Do not commit. Report changed files, checks run and open questions.',
        },
      },
      {
        id: 'write-for-following',
        title: 'Phrase rules so they can be followed',
        paragraphs: [
          'Agents follow specific, checkable instructions far better than general advice. "Write clean code" changes nothing. "Run pnpm verify before reporting a task as done" changes behavior, and you can tell whether it happened.',
          'Give the reason when a rule looks arbitrary. An agent that knows why generated files are off limits will regenerate them instead of editing them by hand, and will ask when the situation is unclear. Keep the file short enough to read in full; if it grows past a page or two, move detail into linked guides and keep only the pointers at the top level.',
        ],
        table: {
          caption: 'Vague instructions and followable ones',
          headers: ['Instead of', 'Write'],
          rows: [
            [
              'Test your changes.',
              'Run pnpm test --filter <package> while working and pnpm verify before finishing.',
            ],
            [
              'Be careful with the database.',
              'Never edit files in migrations/; create a new migration instead.',
            ],
            [
              'Follow our style.',
              'Use the shared Button component; do not add page-specific button styles.',
            ],
            ["Don't break things.", 'Keep exported function signatures in packages/api stable.'],
          ],
        },
      },
      {
        id: 'test-the-file',
        title: 'Test the file like any other change',
        paragraphs: [
          'After editing the file, start a fresh session and give the agent a small, real task. Watch for the specific behavior the new line was meant to change: did it run the right check, avoid the generated folder, stop before committing? If not, the instruction is too vague, too buried, or contradicted somewhere else.',
          'Review the file when it changes, the same way you review code. Remove lines that no longer match the repository, and resolve contradictions between the root file and nested ones. A stale instruction is worse than none, because the agent will follow it confidently.',
        ],
      },
      {
        id: 'where-jackalope-fits',
        title: 'Keep guidance with every task',
        paragraphs: [
          "Jackalope keeps project guidance, reusable workflows and editable lessons with each project, and shows the context that carries into a new task before it starts. The jackalope command's /init asks an agent to write or refresh AGENTS.md for the current repository.",
          'An instruction file shapes what an agent tries. It does not guarantee the result. Keep reviewing the changes and checks, and fold what you learn back into the file.',
        ],
        links: [
          {
            label: 'Project context in Jackalope',
            href: '/features/project-context-for-coding-agents/',
          },
        ],
      },
    ],
    related: [
      { label: 'MCP for coding agents', href: '/blog/mcp-for-coding-agents/' },
      {
        label: 'Use Claude Code and Codex together',
        href: '/guides/run-codex-and-claude-code-in-parallel/',
      },
      { label: 'Review AI-generated code', href: '/blog/review-ai-generated-code-checklist/' },
    ],
  },
  {
    slug: 'review-ai-generated-code-checklist',
    cover: { kind: 'review', tone: 'mint', label: 'Look closer' },
    title: 'How to review AI-generated code: a checklist with examples',
    seoTitle: 'AI code review checklist with examples',
    category: 'Practical guides',
    author: 'caden-sumner',
    date: '2026-09-09',
    readingTime: '7 min read',
    description:
      'Review AI-generated code against requirements, meaningful tests, and the combined patch. Includes examples and a reusable review brief.',
    sections: [
      {
        id: 'start-with-outcome',
        title: 'Review the promised behavior before the summary',
        paragraphs: [
          'An agent can produce a convincing explanation alongside code that misses the requirement. Start a review by restating what should be different for the person using the software. Then find the code and evidence that establish that behavior. The summary is a useful index into the work, but the work is what you are accepting.',
          'Suppose the task was to make a search menu usable with a keyboard. "Added key handlers and tests" sounds complete. The real requirement is more specific: arrow keys select an available result, Enter activates that result, Escape dismisses the menu, and focus remains usable. An empty result set, a changing query, and a failed request all affect whether those promises hold.',
          'This article uses small illustrative examples rather than a production implementation. Adapt the checks to your application and its risk. The goal is to find meaningful errors with a review you can explain, not to require every possible test for every patch.',
        ],
      },
      {
        id: 'inspect-scope',
        title: 'Establish what changed and what was tested',
        paragraphs: [
          'Confirm the repository, checkout, baseline, and current revision before reading findings from another session. Inspect changed files, staged edits, untracked additions, generated artifacts, and dependency changes. If the task was narrow but the patch rewrites shared infrastructure, ask what requirement made that necessary.',
          'Separate pre-existing failures from new ones. A project-wide failure may make a check inconclusive without proving that this patch caused it. Equally, one passing focused test cannot stand in for every broader check the change needs. Record the command, result, and state tested so someone else can judge the limitation.',
          "Google's engineering review guidance is a useful foundation: examine design, functionality, complexity, tests, naming, and documentation. Apply those questions to agent-written code just as you would to any other contribution. Pay particular attention to whether the tests are meaningful, because generated tests can repeat the implementation's assumptions.",
        ],
        links: [
          {
            label: 'Google engineering practices: what to look for in a code review',
            href: 'https://google.github.io/eng-practices/review/reviewer/looking-for.html',
          },
        ],
      },
      {
        id: 'find-edge-case',
        title: 'Look for a concrete input that breaks the promise',
        paragraphs: [
          'Consider the keyboard handler below. It looks reasonable when there are several results: increment the active index and wrap around. But JavaScript\'s remainder operation with a zero divisor produces NaN. Pressing ArrowDown while results is empty therefore creates an invalid selection instead of keeping the "nothing selected" state.',
          'The review finding should name that trigger and consequence. "Potential edge cases" leaves the author guessing. "ArrowDown with zero results sets activeIndex to NaN; preserve the no-selection state and add an empty-results interaction case" gives them something reproducible to fix.',
          'The appropriate fix depends on the component. It may use -1, null, or another representation for no selection. Check every consumer of that state, including Enter handling, highlighted rows, and accessibility attributes. A local guard can still leave another path activating an item that no longer exists.',
        ],
        code: {
          label: 'Illustrative bug: the empty-results case is missing',
          language: 'ts',
          value:
            'function nextIndex(activeIndex: number, results: unknown[]) {\n  return (activeIndex + 1) % results.length;\n}\n\nnextIndex(-1, []); // NaN',
        },
        links: [
          {
            label: 'MDN: JavaScript remainder and a zero divisor',
            href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Remainder',
          },
        ],
      },
      {
        id: 'test-the-test',
        title: 'Ask whether the test would catch a broken implementation',
        paragraphs: [
          'A test named "supports keyboard navigation" can still assert only that the menu renders. Inspect what it does. Does it send a keyboard event? Does it observe the selected result? Does Enter activate the right destination? Would the test fail if the keyboard code were deleted?',
          'Use behavior assertions that match the requirement. A focused unit test can establish how an index function handles an empty list. A component interaction test can establish which result receives selection after ArrowDown. A browser check can establish that focus remains usable in the rendered application. These checks answer different questions and can complement each other.',
          "The example below is a review scenario, not a drop-in test for a particular framework. Translate it into the project's existing tools. Keep a small set of decisive cases rather than duplicating every internal implementation detail in assertions that must change whenever the code is refactored.",
        ],
        code: {
          label: 'A behavior-focused test scenario',
          language: 'text',
          value:
            'Given the search field is focused and there are no results,\nwhen the user presses ArrowDown and then Enter,\nthen no result is selected and no navigation occurs.\n\nGiven two results are available,\nwhen the user presses ArrowDown and then Enter,\nthen the first result opens.\n\nGiven the menu is open,\nwhen the user presses Escape,\nthen the menu closes and keyboard focus remains usable.',
        },
      },
      {
        id: 'check-integration',
        title: 'Inspect the seams between independently correct changes',
        paragraphs: [
          'Imagine one agent adds a search endpoint returning a field named label, while another builds a component that reads title. Each agent tests against its own fixture. Both suites pass, but the combined interface renders blank results. File isolation and a clean merge did not establish that the two sides agreed.',
          'At integration time, trace one real value across the boundary. Start with the response or stored record, follow its transformation, and inspect what the UI consumes. Check error shapes and optional values too. A shared type helps only when both sides use it and runtime input actually respects it.',
          'Apply the same reasoning to permission checks, migrations, saved settings, and recurring jobs. A new UI can appear correct while an older stored record fails to load. Ask which existing caller or previously saved value encounters the change, then choose a check that exercises that path.',
        ],
        table: {
          caption: 'Match the evidence to the question',
          headers: ['Question', 'Useful evidence'],
          rows: [
            ['Does the empty-list rule hold?', 'A focused test of the behavior'],
            ['Does keyboard focus work in the UI?', 'Interaction testing in the rendered page'],
            ['Do API and UI agree?', 'A contract or integration check across the boundary'],
            ['Can existing data still load?', 'A representative older-data regression case'],
            ['Does the final combination work?', 'Checks on the integrated revision'],
          ],
        },
      },
      {
        id: 'reusable-checklist',
        title: 'Use a short checklist for the acceptance decision',
        paragraphs: [
          'Read the checklist against the actual change, and mark a point as not applicable when there is a clear reason. A copy-only update and an authentication change deserve different depth. The checklist should make review decisions visible, not encourage a ritual where every box is marked without evidence.',
          'When asking another agent to review, provide the checklist and request only actionable findings with a reproduction or code-based explanation. Keep that review read-only until you decide which findings are valid. Several agents agreeing with each other is not independent proof of correctness.',
        ],
        bullets: [
          'Outcome: the requested user behavior is present, including the important failure or empty state.',
          'Scope: every material change has a reason connected to the task.',
          'Correctness: boundary values, asynchronous changes, and error paths are handled where relevant.',
          'Compatibility: existing callers and saved data remain supported, or migration is explicit.',
          "Access: permissions and sensitive data handling still follow the application's rules.",
          'Tests: assertions would fail for a plausible broken implementation.',
          'Evidence: commands and manual checks refer to the current changed state.',
          'Integration: the combined result has been checked, with remaining uncertainty stated.',
        ],
      },
      {
        id: 'close-the-loop',
        title: 'Return precise feedback and recheck the correction',
        paragraphs: [
          'A good review comment connects a situation to a consequence and then to the expected behavior. For example: "If results refresh while the second row is selected, the selected index may exceed the new list length. Reconcile the selection when the list changes, and cover shortening the list while the menu is open." That is more helpful than asking the author to make the code more robust.',
          'After a fix, inspect the new patch and rerun the affected checks. Revisit any earlier finding made stale by the correction. Do not accidentally accept an old screenshot or test run as evidence for new code, and do not resolve a finding solely because the author says it is fixed.',
          'Jackalope keeps task results, changes, and recorded evidence together before integration. Whatever interface you use today, the final review should answer three questions: what changed, what establishes that it works, and what still needs a decision.',
        ],
      },
    ],
    related: [
      { label: "Jackalope's review workflow", href: '/guides/review-ai-generated-code/' },
      { label: 'From a brief to a considered review', href: '/blog/from-brief-to-review/' },
      {
        label: 'Coordinate Claude Code and Codex',
        href: '/guides/run-codex-and-claude-code-in-parallel/',
      },
    ],
  },
  {
    slug: 'mcp-for-coding-agents',
    cover: { kind: 'browser', tone: 'rose', label: 'Connect with intention' },
    title: 'MCP for coding agents: tools, permissions, and project context',
    seoTitle: 'MCP for coding agents: tools and permissions',
    category: 'Practical guides',
    author: 'caden-sumner',
    date: '2026-09-09',
    readingTime: '7 min read',
    description:
      'Build a focused MCP setup for coding agents. Choose useful tools, understand access, test connections, and keep project context deliberate.',
    sections: [
      {
        id: 'start-with-question',
        title: 'Start with the missing capability',
        paragraphs: [
          'A coding agent can inspect a repository and still lack the information needed to finish a task. The acceptance criteria may live in an issue tracker, the current behavior in a browser, and the API explanation in maintained documentation. Model Context Protocol, or MCP, provides a common way for compatible applications to connect to tools and context.',
          'A useful setup begins with a question the agent cannot currently answer or an action it cannot currently perform. For an accessible-search task, that could mean reading the approved issue and inspecting the local page. Start with those capabilities. Add another connection only when its role in the workflow is clear.',
          "This guide is an evaluation recipe rather than configuration for a particular server. Server names, transports, authentication, and client support vary. Use the chosen server's official instructions alongside your agent's documentation, and verify the actual tools exposed after connecting.",
        ],
        links: [
          {
            label: 'Model Context Protocol documentation',
            href: 'https://modelcontextprotocol.io/docs/getting-started/intro',
          },
        ],
      },
      {
        id: 'understand-parts',
        title: 'Separate the connection from the permission',
        paragraphs: [
          'Think about three separate decisions: which service or program you connect, which identity it uses, and which actions that identity can perform. A successful connection answers only the first part. A tool can appear in a list while its account lacks access to the project, or while the account has far broader access than the task requires.',
          "The protocol distinguishes tools, resources, and prompts. A client may expose these differently. For practical evaluation, ask what the agent can read, what it can change, and what will require your decision. Check the server's actual behavior rather than inferring permissions from a friendly tool name.",
          '[Project instructions](/blog/agents-md-claude-md-project-instructions/) can tell an agent to work within certain boundaries, but prose is not an access-control mechanism. If the service supports read-only or project-scoped credentials, use the appropriate scope. If it does not support the boundary you need, choose a different setup or keep that action manual.',
        ],
        links: [
          {
            label: 'MCP architecture and protocol components',
            href: 'https://modelcontextprotocol.io/docs/learn/architecture',
          },
        ],
      },
      {
        id: 'choose-connections',
        title: 'Design a small tool plan for one real task',
        paragraphs: [
          "For the search example, write down which connection supplies the brief, which checks the UI, and where the result will be reviewed. You may already have suitable built-in browser or repository tools. Don't add a second route to the same service unless it solves a specific limitation.",
          'Decide whether writing back to the issue tracker is part of the task. Reading an issue does not imply authorization to change its status or post a comment. Keeping the first trial read-only where possible makes it easier to tell whether the integration returns the right information before giving it a larger role.',
          "Use non-sensitive sample data for the first connection test. Ask the agent to identify the source of its answer and show the relevant result. If it guesses an issue's contents after a tool failure, treat that as a failed workflow even if the answer sounds plausible.",
        ],
        table: {
          caption: 'An illustrative tool plan for an accessible-search task',
          headers: ['Need', 'Candidate capability', 'First check'],
          rows: [
            [
              'Approved requirements',
              'Issue lookup scoped to the project',
              'Read one known sample issue',
            ],
            [
              'Current UI behavior',
              'Browser access to the local test app',
              'Open the page and inspect focus',
            ],
            ['API reference', 'Documentation lookup', 'Find a known function or endpoint'],
            ['Publication', 'Keep manual for the first trial', 'Review the result before posting'],
          ],
        },
      },
      {
        id: 'local-and-remote',
        title: 'Understand where the server runs',
        paragraphs: [
          'A local stdio server is a program launched on your machine. Inspect its source, publisher, installation instructions, and exact startup command before running it. A remote HTTP server is a service you connect to; inspect its operator, authentication flow, and data handling. Neither choice is inherently trustworthy just because it uses MCP.',
          'The MCP security guidance explicitly treats local server execution as a security concern and discusses consent, access, and other protocol risks. In practice, a project folder or Git worktree is not a sandbox for a program running with your local privileges. Account profiles can organize credentials without creating separate operating-system users.',
          "Keep credentials out of repository files and task transcripts. Use the storage and authentication mechanism documented for your client and service. When sharing a configuration example with a teammate, share the structure and setup steps, not a working secret. Recheck the destination and requested access when a server's authentication flow changes.",
        ],
        links: [
          {
            label: 'MCP: security best practices',
            href: 'https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices',
          },
          {
            label: 'Claude Code: MCP setup and configuration scopes',
            href: 'https://code.claude.com/docs/en/mcp',
          },
        ],
      },
      {
        id: 'test-connection',
        title: 'Test discovery, access, and failure separately',
        paragraphs: [
          'First check whether the client discovers the connection and lists the expected capability. Next perform a small operation against a resource whose contents you already know. Then verify a failure path, such as a nonexistent sample issue or an account without access to a disposable test project. These establish different things.',
          "Ask what happens when a request times out or credentials expire. The agent should surface the failure and its effect on the task. It should not silently substitute invented data or retry a write until it happens twice. For operations that change external state, consult the server's retry behavior and inspect the service before repeating an uncertain request.",
          'Keep the validation proportional. A read-only reference lookup needs less ceremony than a tool that changes production records. What matters is having enough evidence to understand the operation you are enabling and a clear way to stop using the connection when it no longer fits.',
        ],
        code: {
          label: 'A reusable first-connection test brief',
          language: 'text',
          value:
            'Use the selected issue lookup to read our sample issue.\nReport the issue title, source, and acceptance criteria.\nDo not modify the issue or post a comment.\nIf the connection is unavailable or access is denied,\nreport that limitation and stop this lookup.\nDo not infer missing requirements from the issue title.',
        },
      },
      {
        id: 'manage-context',
        title: 'Keep retrieved material in its proper role',
        paragraphs: [
          'Issue comments, documents, and web pages may contain useful facts as well as incorrect or malicious instructions. Treat retrieved material as source content to evaluate. It should not acquire permission to change the task just because it came back through a tool. A comment asking for credentials is not part of implementing keyboard navigation.',
          "Keep the task's goal, approved scope, and relevant project instructions easy to distinguish from retrieved text. Ask for source attribution when the agent bases a decision on external content. If two sources disagree about the requirement, resolve the conflict rather than encouraging the agent to choose whichever is easier to implement.",
          "Periodically remove connections that are no longer useful to the project. Check inherited client-level configuration as well as the project list. A clean project configuration does not necessarily describe every tool available through the underlying agent's own settings.",
        ],
      },
      {
        id: 'jackalope-connections',
        title: 'Bring the connection into the project workflow',
        paragraphs: [
          "Jackalope centralizes project connections and provides built-in task tools, with support depending on the selected agent and connection type. Its knowledgebase documents configuration and troubleshooting. A listing in the MCP marketplace is not an audit or an endorsement of a third-party server's security, reliability, or data handling.",
          'While evaluating your current setup, keep a short record of what each connection is for, the identity and scope it uses, and the last operation you verified. That record is more useful than an impressive tool count when you need to understand why a task can read or change something.',
        ],
      },
    ],
    related: [
      {
        label: 'Connect custom MCP servers in Jackalope',
        href: '/knowledge/connecting-custom-mcp-servers/',
      },
      {
        label: 'Project context for coding agents',
        href: '/features/project-context-for-coding-agents/',
      },
      { label: 'Work and personal agent accounts', href: '/blog/work-and-personal-accounts/' },
    ],
  },
  {
    slug: 'choose-ai-coding-agent-workspace',
    cover: { kind: 'map', tone: 'honey', label: 'Find your way of working' },
    title: 'How to choose an AI coding-agent workspace',
    seoTitle: 'How to choose an AI coding-agent workspace',
    category: 'Choosing your tools',
    author: 'caden-sumner',
    date: '2026-09-09',
    readingTime: '7 min read',
    description:
      'Choose a coding-agent workspace around task setup, parallel work, review, tools, and recovery. Includes a practical evaluation scorecard.',
    sections: [
      {
        id: 'choose-around-work',
        title: 'Choose around the work you repeat',
        paragraphs: [
          'The best workspace for you is the one that makes your recurring development work easier to complete and review. A feature list can help narrow the field, but it cannot tell you whether you will understand a result after three tasks, two projects, and an interruption. Evaluate the whole path from brief to accepted change.',
          'Start by describing your current workflow. Do you mostly finish one task in an editor, supervise several agents across repositories, or return to background work later? Which parts create friction: environment setup, answering questions, choosing accounts, finding a diff, or combining changes? Put those needs in order before looking at product claims.',
          'This guide explains how to evaluate a workspace. The maintained comparison pages contain product-specific details and sources. Jackalope publishes both, so our perspective is explicit: we care about keeping tasks, agent choices, context, and review together. Your priorities may favor a different workflow.',
        ],
        links: [
          { label: 'Compare coding-agent workspaces and read the sources', href: '/compare/' },
        ],
      },
      {
        id: 'distinguish-layers',
        title: 'Distinguish the agent, the workspace, and the environment',
        paragraphs: [
          'The agent performs the reasoning and tool-driven work. The workspace organizes how you start tasks, follow them, and inspect their output. The execution environment is where files, processes, credentials, and services live. A product can combine these layers, but they still answer different questions.',
          'If you want to keep using a particular agent, verify its actual execution support. A logo on a page may describe an integration, account setup, a terminal you can launch manually, or a complete task interface. Ask what works end to end: sign-in, streaming output, questions, cancellation, continuation, and review.',
          'Likewise, "remote" can describe several arrangements. The agent may run on your own machine accessed remotely, on a host you manage, or in a vendor-managed environment. Write down where code and credentials go, how you reach local services, and what happens when your laptop disconnects. Evaluate the arrangement you will actually use.',
        ],
      },
      {
        id: 'use-trial',
        title: 'Run the same small trial in each candidate',
        paragraphs: [
          "Choose a familiar repository and a modest task with observable behavior. For example, improve a search menu's keyboard interaction and update a help page. Keep the starting commit, acceptance criteria, and relevant instructions the same for each trial. Use disposable data so the evaluation does not depend on production access.",
          'Include one independent task and one real dependency. You want to see how the workspace handles parallel progress and how it represents work that cannot start yet. Also ask a follow-up after the first result. A product that makes the first prompt easy may still make continuation hard to follow.',
          'Do not treat a single trial as a scientific benchmark of model quality. Provider versions, access, caches, and task familiarity can change the outcome. Use it to observe your own workflow: what you had to configure, what you could inspect, and where you lost track of the work.',
        ],
        code: {
          label: 'A repeatable workspace evaluation task',
          language: 'text',
          value:
            'Start from the recorded baseline of our sample repository.\nTask A: make the search results keyboard accessible.\nTask B: update help text to the agreed shortcut contract.\nKeep task ownership and workspaces distinct.\nAsk me to resolve any shared-contract ambiguity.\nShow the results, changed files, and checks for each task.\nLet me request a correction before integration.\nLeave publication and final integration to my decision.',
        },
      },
      {
        id: 'scorecard',
        title: 'Use evidence instead of counting checkmarks',
        paragraphs: [
          'For each capability, record a brief observation from the trial. Use "verified in my trial," "documented but not tried," or "unknown." Unknown does not mean absent; it means you still need evidence before relying on the feature. This distinction matters especially when an integration works differently across agents or operating systems.',
          'Weight the rows by your actual needs. If all your work happens locally, a remote feature may have little value to you. If you switch between client projects every day, account selection and context may matter more than a polished first-run demo. Decide which requirements are essential before adding scores.',
        ],
        table: {
          caption: 'A workspace evaluation scorecard to reuse in your trial',
          headers: ['Area', 'Question to answer', 'Evidence to keep'],
          rows: [
            [
              'Setup',
              'Can a fresh task run the project?',
              'Setup steps and first successful check',
            ],
            [
              'Agent support',
              'Does my chosen agent complete the workflow?',
              'Sign-in, questions, stop, and continuation',
            ],
            [
              'Parallel work',
              'Are ownership and dependencies understandable?',
              'Two-task trial and a blocked dependency',
            ],
            [
              'Accounts',
              'Can I identify the account used for a project?',
              'Verified identity and task selection behavior',
            ],
            ['Review', 'Can I inspect exactly what changed?', 'Individual and combined patches'],
            [
              'Tools',
              'Can I see what the task can access?',
              'Selected connections and a known tool result',
            ],
            ['Recovery', 'Can I return after interruption?', 'Retained work and recovery behavior'],
            ['Cost', 'What am I paying for?', 'Workspace fee, provider access, usage coverage'],
          ],
        },
      },
      {
        id: 'parallel-review',
        title: 'Inspect review and integration as closely as dispatch',
        paragraphs: [
          'Parallel worktrees are already part of several established workflows. Cursor and Conductor both document them. Their existence alone does not answer how you will compare results, reconcile shared assumptions, or keep track of a correction. Those are good places to spend your trial time.',
          'Open a result and find its brief, changed files, checks, and unresolved questions. Ask for a follow-up and see whether the relationship to the original task stays clear. Then inspect two changes together. Can you tell which tasks contributed them and whether their evidence still describes the current state?',
          'Create a harmless conflict in a disposable evaluation repository if you need to assess conflict handling. Does the product explain what is blocked and preserve both sources? Can you return to the task for a correction? Do not score an integration workflow solely on a clean happy-path demonstration.',
        ],
        links: [
          { label: 'Cursor: worktrees', href: 'https://cursor.com/docs/configuration/worktrees' },
          {
            label: 'Conductor: parallel agents',
            href: 'https://www.conductor.build/docs/concepts/parallel-agents',
          },
          {
            label: 'Our AI-generated code review checklist',
            href: '/blog/review-ai-generated-code-checklist/',
          },
        ],
      },
      {
        id: 'recovery-and-cost',
        title: 'Include interruption, cleanup, and ongoing cost',
        paragraphs: [
          'A realistic trial includes leaving and returning. Stop a disposable task, restart the application normally, and inspect what remains. Check whether the saved result, files, and account association are still understandable. Do not deliberately interrupt work on a valuable repository just to test recovery.',
          'Ask how worktrees and histories are retained, exported, or removed. Find out what happens to unfinished files when you archive a task. If the answer is unclear, preserve the work and consult the product documentation before trying cleanup. A retained conversation and a retained checkout are related but different things.',
          'Compare costs using current published terms and the access you plan to use. A workspace subscription may be separate from provider access or hosted execution. Usage reporting may show tokens for some tasks and quota percentages for others. Avoid treating these as interchangeable units or assuming a dashboard captures work performed outside the application.',
        ],
      },
      {
        id: 'make-choice',
        title: 'Choose the workflow with the fewest important gaps',
        paragraphs: [
          'After the trial, write a short decision: the essential requirements met, the important unknowns, and the limitations you are willing to accept. Keep the evidence beside that decision. If a feature is planned rather than available, evaluate the product without it and revisit when it ships.',
          "A terminal and editor can be a good fit for one focused session. A provider's own app may fit an established agent workflow. A workspace for multiple agents becomes attractive when projects, accounts, parallel tasks, and review need more structure. You don't need to use the same interface for every project if their needs differ.",
          "Jackalope's app tour uses sample data and helps explain the interface; it does not replace a trial on your repository. Use the compatibility page and roadmap to understand current scope, then apply the same evaluation questions to Jackalope.",
        ],
        links: [
          { label: 'Compare apps with current product references', href: '/compare/' },
          { label: 'Jackalope agent compatibility', href: '/agents/' },
          { label: 'Jackalope roadmap', href: '/roadmap/' },
        ],
      },
    ],
    related: [
      { label: 'Compare Jackalope and terminal tabs', href: '/compare/terminal-tabs/' },
      {
        label: 'Try the two-agent workflow',
        href: '/guides/run-codex-and-claude-code-in-parallel/',
      },
      { label: 'Choose MCP tools deliberately', href: '/blog/mcp-for-coding-agents/' },
    ],
  },
];
