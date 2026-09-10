import type { BlogPost } from './blog-types.ts';

export const practicalPosts: BlogPost[] = [
  {
    slug: 'git-worktrees-for-ai-coding-agents',
    cover: { kind: 'parallel', tone: 'indigo', label: 'Separate spaces. Shared purpose.' },
    title: 'Git worktrees for AI coding agents: from setup to cleanup',
    seoTitle: 'Git worktree tutorial for coding agents',
    category: 'Practical guides',
    date: '2026-09-09',
    readingTime: '8 min read',
    description:
      'A practical Git worktree workflow for coding agents, with setup commands, separate dev servers, review checks, and careful cleanup.',
    sections: [
      {
        id: 'start-with-the-task',
        title: 'Start with a task that can stand on its own',
        paragraphs: [
          'You are halfway through a feature when a small production bug arrives. Switching branches means deciding what to do with unfinished changes, stopping a development server, and later reconstructing your context. A second agent makes the same problem more visible: two conversations can move independently, but they still need somewhere to put their files.',
          'A Git worktree gives another task its own checkout while sharing the repository. That is useful for a bug fix beside a feature, two independent improvements, or a review that should leave your working copy alone. It is less useful when two tasks are both redesigning the same interface. Separate folders cannot settle a disagreement about what that interface should mean.',
          'This walkthrough uses an illustrative search feature. One task adds keyboard navigation; another improves an unrelated help page. Start with a disposable or familiar repository, a committed baseline, Git, and an already configured coding agent. The commands assume the integration branch is main and the sibling directory names are unused. Substitute your actual branch and paths before running them.',
        ],
      },
      {
        id: 'create-worktrees',
        title: 'Create both checkouts from a known baseline',
        paragraphs: [
          'From the original repository, inspect the working copy and existing worktrees before creating anything. Read the commit printed by rev-parse and check that it is the intended baseline. A local main branch can be behind your remote; updating it is a separate decision. Uncommitted files in the original checkout are not part of the commit used by these commands.',
          'The two add commands create separate branches from main. The -C option on later commands lets you inspect a checkout without changing your terminal directory. Git normally refuses to check out the same branch in two places, so use one task branch per worktree rather than overriding that safeguard. The Git manual explains linked worktrees and their shared repository metadata.',
        ],
        code: {
          label: 'Run from your original repository; replace main if needed',
          language: 'sh',
          value:
            'git status --short\ngit worktree list\ngit rev-parse main\ngit worktree add -b task/search-keyboard ../search-keyboard main\ngit worktree add -b task/help-copy ../help-copy main\ngit -C ../search-keyboard status --short\ngit -C ../help-copy status --short',
        },
        links: [
          { label: 'Git: git-worktree reference', href: 'https://git-scm.com/docs/git-worktree' },
        ],
      },
      {
        id: 'prepare-environments',
        title: 'Prepare the environment, not just the files',
        paragraphs: [
          'Before asking an agent to change code, make the unmodified checkout build using the commands documented by the project. This separates an environment problem from a regression. If the baseline already fails, capture the first meaningful error and resolve it or define its impact before interpreting later results.',
          'Treat dependencies, local settings, ports, and services as an explicit setup step. For a pnpm project, that might mean pnpm install --frozen-lockfile inside each checkout. Other projects need different commands. Avoid casually linking generated folders between worktrees: one build can then replace files that another build is using.',
          'Prepare a minimal development configuration from the project template. Check where it connects before starting the app. A different source directory does not automatically mean a different database, storage bucket, browser profile, or output directory. If both checkouts write to the same external service, their effects can overlap even when their Git diffs never do.',
        ],
        table: {
          caption: 'An example environment plan for two local tasks',
          headers: ['Resource', 'Keyboard task', 'Help task'],
          rows: [
            ['Source checkout', '../search-keyboard', '../help-copy'],
            ['Development port', 'A reserved unused port', 'A different unused port'],
            ['Test data', 'Disposable search fixtures', 'Disposable documentation fixtures'],
            ['Build output', 'Inside this checkout', 'Inside this checkout'],
            ['Credentials', 'Only the access this task needs', 'No service access if unnecessary'],
          ],
        },
      },
      {
        id: 'brief-the-agent',
        title: 'Give each agent a bounded brief',
        paragraphs: [
          'Open the agent in the exact checkout assigned to it. Confirm the current folder in that session, not just the title of the terminal window. Include the outcome, the files it owns, the relevant project instructions, and the checks you expect. If another task is active, say what it owns and how to report a dependency.',
          'A useful brief leaves room for investigation while making expansion visible. The keyboard task may discover that the shared menu component needs a change. It should report that dependency before also taking over a component another agent is editing. File ownership is a coordination agreement; it is not a filesystem permission boundary.',
          'Claude Code can also create a worktree through its own --worktree option. Choose whether Git, the agent, or a workspace app manages the checkout, and keep that ownership consistent. Creating another managed worktree from inside an existing task can make it easy to review the wrong folder.',
        ],
        code: {
          label: 'Reusable task brief',
          language: 'text',
          value:
            'Outcome: make the search results usable with a keyboard.\nWorkspace: the assigned search-keyboard checkout.\nOwn: search UI and its focused interaction tests.\nDo not change: help content or unrelated shared controls.\nAcceptance: arrows move selection; Enter opens a result;\nEscape closes results; an empty list has no active result.\nRead the repository instructions and record baseline failures.\nReport shared-component dependencies before expanding scope.\nReturn: changed files, checks run, and remaining uncertainty.\nLeave commits and integration to the maintainer.',
        },
        links: [
          {
            label: 'Claude Code: worktree sessions',
            href: 'https://code.claude.com/docs/en/worktrees',
          },
        ],
      },
      {
        id: 'review-combination',
        title: 'Review each task and then the combination',
        paragraphs: [
          'When an agent finishes, start with what the task promised. Try the keyboard flow, inspect the changed files, and read the tests. A summary saying that checks passed should point to the commands and checkout that produced the result. If more edits happened afterward, the earlier result does not establish the current state.',
          'Use status to find staged and untracked files as well as ordinary edits. The commands below inspect uncommitted work and committed branch changes separately. No one diff command answers every question about the checkout. Also inspect new files themselves; an untracked filename in status does not show its contents.',
          'After individual review, integrate using your repository workflow and run the relevant checks on the combined result. Two tasks can pass separately and still disagree about a route, type, dependency version, or shared assumption. If conflicts appear, resolve the underlying decision before accepting a mechanically clean merge.',
        ],
        code: {
          label: 'Inspect the keyboard task without changing it',
          language: 'sh',
          value:
            'git -C ../search-keyboard status --short\ngit -C ../search-keyboard diff\ngit -C ../search-keyboard diff --cached\ngit -C ../search-keyboard log --oneline main..HEAD\ngit -C ../search-keyboard diff main...HEAD',
        },
      },
      {
        id: 'cleanup',
        title: 'Clean up only after the work has a home',
        paragraphs: [
          'A quiet checkout is not necessarily disposable. Before removal, confirm that no agent, editor operation, or development server is still using it. Check whether its changes have been integrated or intentionally retained elsewhere. Review ignored files too: a local database or scratch export can matter even though it never appears in the normal diff.',
          'Start with git worktree list and git -C ../search-keyboard status --short --ignored. Once you have checked and preserved anything needed, git worktree remove ../search-keyboard is the ordinary removal command. If Git refuses, investigate the reason; do not add force simply to make the error disappear. Removing a worktree and deleting its branch are separate operations.',
          'For your next task, create a checkout from the current intended baseline. Reusing an old worktree without checking its history can bring yesterday’s assumptions into today’s change. Good cleanup leaves a clear record of what was accepted, what remains unfinished, and which environments can be retired.',
        ],
      },
      {
        id: 'where-jackalope-fits',
        title: 'Keep the task attached to its workspace',
        paragraphs: [
          'The hard part of several worktrees is remembering which brief, account, result, and check belongs to each folder. Jackalope is being built to keep those pieces together, with parallel tasks and a combined review workflow. You can learn the underlying Git approach today and evaluate the desktop workflow when early access is available.',
          'Worktrees separate working files; they do not sandbox agent processes or guarantee correct code. Whether you use terminal tabs or a dedicated workspace, keep environment setup deliberate and make the integration decision from the actual changes.',
        ],
      },
    ],
    related: [
      { label: 'Jackalope’s worktree workflow', href: '/git-worktrees-for-ai-agents/' },
      {
        label: 'Use Claude Code and Codex together',
        href: '/blog/claude-code-and-codex-together/',
      },
      { label: 'Review AI-generated code', href: '/blog/review-ai-generated-code-checklist/' },
    ],
  },
  {
    slug: 'claude-code-and-codex-together',
    cover: { kind: 'agents', tone: 'honey', label: 'Two agents. One shared brief.' },
    title: 'Using Claude Code and Codex together: a practical workflow',
    seoTitle: 'Using Claude Code and Codex together',
    category: 'Working with agents',
    date: '2026-09-09',
    readingTime: '7 min read',
    description:
      'Plan independent tasks, run Claude Code and Codex in separate workspaces, exchange review evidence, and check the combined result.',
    sections: [
      {
        id: 'choose-the-work',
        title: 'Give two agents a reason to work together',
        paragraphs: [
          'Using Claude Code and Codex together is most useful when you can describe separate responsibilities. More conversations do not automatically shorten a project. Someone still has to define the contract between tasks, answer questions, inspect output, and decide what should be integrated. Your attention and the project’s shared resources are part of the capacity limit.',
          'Consider an illustrative feature: users need a keyboard-accessible search box, and the help page needs to explain the shortcuts. The interface and documentation can be developed independently once the shortcut behavior is settled. Assign either agent to either task based on your own experience and available access. This is a workflow example, not a claim that one provider is always better at a particular kind of work.',
          'A different feature may call for sequential work. If the search API shape is undecided, complete that decision before asking a second agent to build the client. Parallelize exploration or independent tests while the contract is being resolved, then start implementation against the agreed result.',
        ],
      },
      {
        id: 'write-shared-contract',
        title: 'Write the shared contract before the prompts',
        paragraphs: [
          'Begin with a short feature brief that both sessions receive. State who the feature serves, what observable behavior changes, and what remains outside the task. Define the pieces that would otherwise invite conflicting guesses: keyboard shortcuts, labels, route names, data shape, and empty-state behavior.',
          'Then divide ownership. A boundary such as “frontend” versus “tests” can be awkward if every frontend edit needs a test change. Prefer a complete, reviewable outcome where possible. For the example, the interface task owns its interaction tests; the help task owns copy and documentation checks. Both use the same written shortcut contract.',
          'Keep the shared brief small enough to inspect. Send the relevant paths and commands rather than pasting a whole repository into both conversations. If the contract changes, tell both agents what changed and which earlier assumption is no longer valid. A long transcript is not a substitute for an explicit decision.',
        ],
        table: {
          caption: 'One feature, two independently reviewable tasks',
          headers: ['Task', 'Owns', 'Ready when'],
          rows: [
            [
              'Search interaction',
              'Search UI and interaction tests',
              'Keyboard and empty-state checks pass',
            ],
            ['Shortcut help', 'Help page copy and links', 'Copy matches the agreed behavior'],
            [
              'Integration review',
              'Combined outcome',
              'Help instructions work against the final UI',
            ],
          ],
        },
      },
      {
        id: 'separate-workspaces',
        title: 'Start each session in its own checkout',
        paragraphs: [
          'Use a separate worktree for each implementation task, created from the same intended commit. Record that baseline and make the project’s setup work before editing. Reserve different local ports and disposable service data if both agents will run the application. Keep their generated output separate as well.',
          'Claude Code documents worktree sessions, and OpenAI documents managed worktrees and handoff between a worktree and a local checkout. Those are useful native options. You can also prepare ordinary Git worktrees and start each installed CLI inside its assigned folder. Pick one method and follow the current documentation for that tool instead of mixing several checkout managers mid-task.',
          'Sign in to each provider through its supported flow. Check that you are using the intended work or personal account before sharing repository context. Having both agents in one workflow does not combine subscriptions, transfer provider permissions, or imply that their usage reports cover the same activity.',
        ],
        links: [
          {
            label: 'Claude Code: parallel sessions with worktrees',
            href: 'https://code.claude.com/docs/en/worktrees',
          },
          {
            label: 'OpenAI: worktrees and handoff',
            href: 'https://learn.chatgpt.com/docs/environments/git-worktrees',
          },
          {
            label: 'Our step-by-step Git worktree tutorial',
            href: '/blog/git-worktrees-for-ai-coding-agents/',
          },
        ],
      },
      {
        id: 'dispatch',
        title: 'Dispatch with ownership and a handoff format',
        paragraphs: [
          'Give both agents the shared contract, then a task-specific brief. Ask them to identify baseline failures and dependencies before changing unrelated code. Tell them whether they may commit, install dependencies, or use connected services according to your actual project rules. Avoid leaving publication decisions implicit.',
          'Ask for progress only when it changes a decision: a blocker, a scope conflict, a completed check, or a result ready for review. Reading two streams of narration can consume the time you hoped to save. When one task is blocked, decide whether the other can continue independently or should pause before making assumptions.',
          'The output below is deliberately small. It makes it possible to tell whether a result is ready without treating the agent’s confidence as evidence. Keep failures and untested behavior visible, even when the implementation looks finished.',
        ],
        code: {
          label: 'Append this handoff request to each task brief',
          language: 'text',
          value:
            'Return a handoff with:\n- Outcome implemented and relevant changed files.\n- Workspace and baseline commit.\n- Commands run, their results, and the revision tested.\n- Manual interactions checked and evidence captured.\n- Contract changes, dependencies, and unresolved questions.\n- Work that is incomplete or could not be verified.\nDo not claim a check passed if it was skipped or blocked.',
        },
      },
      {
        id: 'cross-review',
        title: 'Use cross-review to investigate specific risks',
        paragraphs: [
          'A second agent can be useful as a reviewer after the first implementation is ready. Give it the actual patch and acceptance criteria, along with enough surrounding code to understand the behavior. Start with a read-only review so that findings and proposed changes remain distinguishable.',
          'For the keyboard task, ask whether an empty result set can produce an invalid selection, whether focus remains usable after dismissal, and whether a test would fail if the keyboard handler disappeared. For the help task, ask the reviewer to follow the instructions against the implementation rather than judging the prose alone.',
          'Keep proposed issues tied to a trigger, a code location, and an observable consequence. A reviewer can be wrong. Check each finding against the current revision before requesting a fix, and do not let the second agent expand the feature just because another approach is possible. Cross-review helps generate questions; it does not replace your acceptance decision.',
        ],
      },
      {
        id: 'integrate',
        title: 'Integrate once the shared assumptions agree',
        paragraphs: [
          'Inspect each task independently, then combine the accepted changes through your normal Git workflow. Preserve unfinished work until it has been reviewed or intentionally set aside. If both tasks changed the same file, a conflict is a request for a decision about the intended result, not an invitation to choose whichever side is easier to apply.',
          'Run the relevant checks on the combined state. Open the final search interface, follow the new help instructions, and exercise a failure or empty state. If one task renamed a shortcut while the other documented the original name, individual green checks may not catch the mismatch. The feature-level walkthrough should.',
          'When something fails, route the correction to the task that owns it and provide the reproduction. After further edits, repeat the affected checks against the new state. Do not keep citing the first successful run as evidence for a patch that has changed.',
        ],
      },
      {
        id: 'evaluate-workflow',
        title: 'Measure whether the extra coordination was worthwhile',
        paragraphs: [
          'For your first few attempts, record elapsed time to an accepted result, time spent reviewing, repeated work, and meaningful defects found. Keep provider usage separate when its units or reporting coverage differ. A fast first response is only one part of the workflow; a result that takes an hour to reconcile may not save you time.',
          'Use one agent when the work is small or tightly coupled. Use several when tasks have clear boundaries and you can actually review them. If the same shared file keeps blocking progress, change the plan rather than increasing the number of sessions.',
          'Jackalope brings supported agent tasks, account choices, worktrees, and review into one desktop workspace. It is coming soon; the manual workflow here works independently of access to Jackalope. The app tour shows the intended experience, and the compatibility page distinguishes supported execution from agents still under evaluation.',
        ],
      },
    ],
    related: [
      { label: 'Supported coding agents', href: '/agents/' },
      { label: 'Parallel work in Jackalope', href: '/parallel-coding-agents/' },
      {
        label: 'AI-generated code review checklist',
        href: '/blog/review-ai-generated-code-checklist/',
      },
    ],
  },
  {
    slug: 'review-ai-generated-code-checklist',
    cover: { kind: 'review', tone: 'mint', label: 'Look closer' },
    title: 'How to review AI-generated code: a checklist with examples',
    seoTitle: 'AI code review checklist with examples',
    category: 'Practical guides',
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
          'Suppose the task was to make a search menu usable with a keyboard. “Added key handlers and tests” sounds complete. The real requirement is more specific: arrow keys select an available result, Enter activates that result, Escape dismisses the menu, and focus remains usable. An empty result set, a changing query, and a failed request all affect whether those promises hold.',
          'This article uses small illustrative examples rather than a production implementation. Adapt the checks to your application and its risk. The goal is to find meaningful errors with a review you can explain, not to require every possible test for every patch.',
        ],
      },
      {
        id: 'inspect-scope',
        title: 'Establish what changed and what was tested',
        paragraphs: [
          'Confirm the repository, checkout, baseline, and current revision before reading findings from another session. Inspect changed files, staged edits, untracked additions, generated artifacts, and dependency changes. If the task was narrow but the patch rewrites shared infrastructure, ask what requirement made that necessary.',
          'Separate pre-existing failures from new ones. A project-wide failure may make a check inconclusive without proving that this patch caused it. Equally, one passing focused test cannot stand in for every broader check the change needs. Record the command, result, and state tested so someone else can judge the limitation.',
          'Google’s engineering review guidance is a useful foundation: examine design, functionality, complexity, tests, naming, and documentation. Apply those questions to agent-written code just as you would to any other contribution. Pay particular attention to whether the tests are meaningful, because generated tests can repeat the implementation’s assumptions.',
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
          'Consider the keyboard handler below. It looks reasonable when there are several results: increment the active index and wrap around. But JavaScript’s remainder operation with a zero divisor produces NaN. Pressing ArrowDown while results is empty therefore creates an invalid selection instead of keeping the “nothing selected” state.',
          'The review finding should name that trigger and consequence. “Potential edge cases” leaves the author guessing. “ArrowDown with zero results sets activeIndex to NaN; preserve the no-selection state and add an empty-results interaction case” gives them something reproducible to fix.',
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
          'A test named “supports keyboard navigation” can still assert only that the menu renders. Inspect what it does. Does it send a keyboard event? Does it observe the selected result? Does Enter activate the right destination? Would the test fail if the keyboard code were deleted?',
          'Use behavior assertions that match the requirement. A focused unit test can establish how an index function handles an empty list. A component interaction test can establish which result receives selection after ArrowDown. A browser check can establish that focus remains usable in the rendered application. These checks answer different questions and can complement each other.',
          'The example below is a review scenario, not a drop-in test for a particular framework. Translate it into the project’s existing tools. Keep a small set of decisive cases rather than duplicating every internal implementation detail in assertions that must change whenever the code is refactored.',
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
          'Access: permissions and sensitive data handling still follow the application’s rules.',
          'Tests: assertions would fail for a plausible broken implementation.',
          'Evidence: commands and manual checks refer to the current changed state.',
          'Integration: the combined result has been checked, with remaining uncertainty stated.',
        ],
      },
      {
        id: 'close-the-loop',
        title: 'Return precise feedback and recheck the correction',
        paragraphs: [
          'A good review comment connects a situation to a consequence and then to the expected behavior. For example: “If results refresh while the second row is selected, the selected index may exceed the new list length. Reconcile the selection when the list changes, and cover shortening the list while the menu is open.” That is more helpful than asking the author to make the code more robust.',
          'After a fix, inspect the new patch and rerun the affected checks. Revisit any earlier finding made stale by the correction. Do not accidentally accept an old screenshot or test run as evidence for new code, and do not resolve a finding solely because the author says it is fixed.',
          'Jackalope is designed to keep task results, changes, and recorded evidence together before integration. It is coming soon. Whatever interface you use today, the final review should answer three questions: what changed, what establishes that it works, and what still needs a decision.',
        ],
      },
    ],
    related: [
      { label: 'Jackalope’s review workflow', href: '/guides/review-ai-generated-code/' },
      { label: 'From a brief to a considered review', href: '/blog/from-brief-to-review/' },
      { label: 'Coordinate Claude Code and Codex', href: '/blog/claude-code-and-codex-together/' },
    ],
  },
  {
    slug: 'mcp-for-coding-agents',
    cover: { kind: 'browser', tone: 'rose', label: 'Connect with intention' },
    title: 'MCP for coding agents: tools, permissions, and project context',
    seoTitle: 'MCP for coding agents: tools and permissions',
    category: 'Practical guides',
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
          'This guide is an evaluation recipe rather than configuration for a particular server. Server names, transports, authentication, and client support vary. Use the chosen server’s official instructions alongside your agent’s documentation, and verify the actual tools exposed after connecting.',
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
          'The protocol distinguishes tools, resources, and prompts. A client may expose these differently. For practical evaluation, ask what the agent can read, what it can change, and what will require your decision. Check the server’s actual behavior rather than inferring permissions from a friendly tool name.',
          'Project instructions can tell an agent to work within certain boundaries, but prose is not an access-control mechanism. If the service supports read-only or project-scoped credentials, use the appropriate scope. If it does not support the boundary you need, choose a different setup or keep that action manual.',
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
          'For the search example, write down which connection supplies the brief, which checks the UI, and where the result will be reviewed. You may already have suitable built-in browser or repository tools. There is no benefit in introducing a second route to the same service unless it solves a specific limitation.',
          'Decide whether writing back to the issue tracker is part of the task. Reading an issue does not imply authorization to change its status or post a comment. Keeping the first trial read-only where possible makes it easier to tell whether the integration returns the right information before giving it a larger role.',
          'Use non-sensitive sample data for the first connection test. Ask the agent to identify the source of its answer and show the relevant result. If it guesses an issue’s contents after a tool failure, treat that as a failed workflow even if the answer sounds plausible.',
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
          'Keep credentials out of repository files and task transcripts. Use the storage and authentication mechanism documented for your client and service. When sharing a configuration example with a teammate, share the structure and setup steps, not a working secret. Recheck the destination and requested access when a server’s authentication flow changes.',
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
          'Ask what happens when a request times out or credentials expire. The agent should surface the failure and its effect on the task. It should not silently substitute invented data or retry a write until it happens twice. For operations that change external state, consult the server’s retry behavior and inspect the service before repeating an uncertain request.',
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
          'Keep the task’s goal, approved scope, and relevant project instructions easy to distinguish from retrieved text. Ask for source attribution when the agent bases a decision on external content. If two sources disagree about the requirement, resolve the conflict rather than encouraging the agent to choose whichever is easier to implement.',
          'Periodically remove connections that are no longer useful to the project. Check inherited client-level configuration as well as the project list. A clean project configuration does not necessarily describe every tool available through the underlying agent’s own settings.',
        ],
      },
      {
        id: 'jackalope-connections',
        title: 'Bring the connection into the project workflow',
        paragraphs: [
          'Jackalope centralizes project connections and provides built-in task tools, with support depending on the selected agent and connection type. Its knowledgebase documents configuration and troubleshooting. A listing in the MCP marketplace is not an audit or an endorsement of a third-party server’s security, reliability, or data handling.',
          'Jackalope is coming soon. While evaluating your current setup, keep a short record of what each connection is for, the identity and scope it uses, and the last operation you verified. That record is more useful than an impressive tool count when you need to understand why a task can read or change something.',
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
          'Likewise, “remote” can describe several arrangements. The agent may run on your own machine accessed remotely, on a host you manage, or in a vendor-managed environment. Write down where code and credentials go, how you reach local services, and what happens when your laptop disconnects. Evaluate the arrangement you will actually use.',
        ],
      },
      {
        id: 'use-trial',
        title: 'Run the same small trial in each candidate',
        paragraphs: [
          'Choose a familiar repository and a modest task with observable behavior. For example, improve a search menu’s keyboard interaction and update a help page. Keep the starting commit, acceptance criteria, and relevant instructions the same for each trial. Use disposable data so the evaluation does not depend on production access.',
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
          'For each capability, record a brief observation from the trial. Use “verified in my trial,” “documented but not tried,” or “unknown.” Unknown does not mean absent; it means you still need evidence before relying on the feature. This distinction matters especially when an integration works differently across agents or operating systems.',
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
          'A terminal and editor can be a good fit for one focused session. A provider’s own app may fit an established agent workflow. A workspace for multiple agents becomes attractive when projects, accounts, parallel tasks, and review need more structure. There is no need to make every project use the same interface if their needs differ.',
          'Jackalope is coming soon. Its app tour uses sample data and helps explain the interface; it does not replace a trial on your repository. Use the compatibility page and roadmap to understand current scope, then apply the same evaluation questions to Jackalope when you receive access.',
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
      { label: 'Try the two-agent workflow', href: '/blog/claude-code-and-codex-together/' },
      { label: 'Choose MCP tools deliberately', href: '/blog/mcp-for-coding-agents/' },
    ],
  },
];
