import updates from './changelog.json' with { type: 'json' };
import { growthPost } from './growth-content.ts';
import { marketingPages } from './marketing-content.ts';

export const siteOrigin = 'https://jackalope.dev';
export const company = { name: 'Jackalope Digital LLC', url: 'https://jackalope.digital' };

export const tour = {
  title: 'A little look around Jackalope.',
  description:
    'Follow tasks, focus your review queue, inspect a question and result, and explore agents in light and dark. A 40-second interface tour with fictional Atlas project data.',
  published: '2026-09-08T21:45:00Z',
  transcript:
    'Start in Tasks with one question, one result ready to review, one working task, and one saved idea. Focus the review queue, then switch to the board. Open the navigation task to inspect its question. Return to the keyboard-search task and read its result before integration. Explore the agent roster and switch from light to dark. This recording shows current app components with fictional Atlas project data; no native agent tasks run. There is no audio.',
};

export const posts = [
  growthPost,
  {
    slug: 'work-and-personal-accounts',
    title: 'Work and personal accounts, with room for both.',
    category: 'Working with agents',
    date: '2026-09-06',
    readingTime: '3 min read',
    description:
      'Set up separate agent sign-ins, choose accounts for each project, and inspect task usage together in Jackalope.',
    sections: [
      {
        title: 'One workspace, deliberate account choices.',
        paragraphs: [
          'A client repository and a weekend project can call for different accounts, instructions, and tools. Jackalope brings their tasks into one workspace while giving you explicit choices about which agent and account each project uses.',
          'Separate account profiles are implemented for the built-in Codex, Claude Code, Grok, and OpenCode adapters. Custom agents without a supported profile mechanism do not get this capability. Cross-platform release acceptance, including real multiple-account provider lifecycle trials, is still in progress.',
        ],
      },
      {
        title: '01. Give each sign-in a name.',
        paragraphs: [
          'In Agents → Configuration, expand Accounts for your agent. Add profiles with useful names such as Work and Personal, then use Sign in for each one. The agent opens its own sign-in flow with a separate profile directory; you do not paste provider passwords into Jackalope.',
          'The active account supplies the default for projects that inherit it. You can also return to the normal CLI sign-in. These labels are yours to manage; a profile name is not proof of the provider identity signed in there.',
        ],
      },
      {
        title: '02. Set the project’s account and context.',
        paragraphs: [
          'Open Project → Context. Choose the default task agent, restrict which agents are available for that project, and select an account for each supported agent. Pin Work for your client project and Personal for your own project instead of leaving both on “Whichever account is active.”',
          'Add the project instructions and review the context included with a new task. Select the tools the task needs. Project-selected connections are additional to the agent’s existing configuration, so review any inherited provider or CLI-global tools too.',
        ],
      },
      {
        title: '03. Follow the work across accounts.',
        paragraphs: [
          'Jackalope records the account profile used for an attempt. Continuing that task retains the original profile even if you change the active account later. To work under another account, start a new task rather than moving an existing conversation between identities.',
          'Use Tasks to follow progress, answer questions, and inspect changes. Parallel plans coordinate agent work in separate Git worktrees, with scopes and dependencies; review and integration remain explicit decisions.',
          'In Usage, filter by account, project, and period, then inspect or export the selected attempts. Token totals use reported usage from Jackalope tasks. Missing reports stay unavailable, and activity outside Jackalope is not a complete part of this view.',
        ],
      },
      {
        title: 'Know what the separation means.',
        paragraphs: [
          'Profiles separate supported agents’ sign-in and configuration directories. Project settings organize instructions and agent choices. They do not create separate operating-system users or prevent an agent with local permissions from reading other files.',
          'Provider accounts, subscriptions, data policies, and connected tools still apply. Follow your organization’s requirements for repositories and credentials. Jackalope makes the choices easier to manage and inspect; it does not promise complete data isolation or a replacement for provider billing.',
        ],
      },
    ],
  },
  {
    slug: 'room-for-the-work',
    title: 'A little more room for the work.',
    category: 'From the studio',
    date: '2026-09-06',
    readingTime: '3 min read',
    description:
      'Why we are building a calmer desktop home for your projects, coding agents, and the decisions that stay yours.',
    sections: [
      {
        title: 'The task is bigger than the prompt.',
        paragraphs: [
          'A good prompt is a beginning. There is still a project to understand, a branch to work from, progress to follow, and a change to review. When that context lives across several terminals and tabs, keeping track becomes its own job.',
          'Jackalope brings that surrounding work into one cross-platform workspace. It is a product of Jackalope Digital LLC, built around the idea that your tools should give you room to think.',
        ],
      },
      {
        title: 'Your agents, with their own room to work.',
        paragraphs: [
          'You bring a local Git repository and your existing coding-agent setup. Jackalope works with locally configured agents such as Codex and Claude Code. It does not include an AI subscription or replace your provider account.',
          'Tasks keep the brief and the work together. An isolated Git worktree gives a task a separate working directory, so experiments can happen alongside other work. Isolation helps organize changes; it does not make unreviewed code safe to merge.',
        ],
      },
      {
        title: 'The final call stays with you.',
        paragraphs: [
          'When an attempt is ready, read the result, inspect its patch, and run the project checks. Continue with feedback when something needs another pass. A completed agent response is a point for review, not a promise that the change is correct.',
          'That is the rhythm we are designing for: an idea, room to explore, and a clear return to you.',
        ],
      },
      {
        title: 'Growing in the open.',
        paragraphs: [
          'Jackalope is coming soon. The website tour uses fictional project data to show the interface; it is not evidence of real agent execution.',
          'We will share development notes and public release announcements here. Join the waitlist for early-access news.',
        ],
      },
    ],
  },
  {
    slug: 'from-brief-to-review',
    title: 'From a clear brief to a considered review.',
    category: 'Working with agents',
    date: '2026-09-06',
    readingTime: '3 min read',
    description:
      'A practical walkthrough of the task workflow: choose the project, describe the outcome, then inspect what comes back.',
    sections: [
      {
        title: '01. Start with the right project.',
        paragraphs: [
          'Choose your local Git repository and the branch you intend to work from. Keep the project guidelines close: how to build, which checks matter, and any conventions an agent should follow.',
          'Configure your coding agent and its account before starting work. Jackalope uses your local agent installation and existing sign-in. If that setup is missing or unavailable, resolve it first.',
        ],
      },
      {
        title: '02. Describe the outcome.',
        paragraphs: [
          'Open New task and describe what should be different when the work is done. For example: “Make search usable from the keyboard. Arrow keys should move through results, Enter should open the selected result, and Escape should close the list.”',
          'Choose the agent and execution target. A separate worktree is useful when you want an experiment to have its own working directory. Save an idea for later when you are still shaping the brief.',
        ],
      },
      {
        title: '03. Stay available for the important decisions.',
        paragraphs: [
          'Follow the task as it runs and respond when it needs input. The result belongs to an attempt, so its context stays connected to the original task.',
          'If the direction is wrong, stop and adjust the brief. Keeping the request specific is more useful than allowing a task to expand indefinitely.',
        ],
      },
      {
        title: '04. Read, check, then decide.',
        paragraphs: [
          'Inspect the patch and the agent’s summary. Run the checks appropriate to your project, and try the behavior that changed. Recorded checks refer to a particular file snapshot; changes after that point need another check.',
          'Ask for another iteration when necessary. Review the combined result before integrating work from multiple tasks. Each task can pass on its own while the combination still needs attention.',
          'This describes the current development workflow. Cross-platform release acceptance is still in progress; follow the changelog for availability.',
        ],
      },
    ],
  },
];

export { updates };

export const pages = [
  {
    path: '/',
    title: 'Jackalope: Run Codex, Claude Code & coding agents in parallel',
    description:
      'Run Codex, Claude Code, Grok, and OpenCode in parallel Git worktrees. Keep project context, agent coordination, evidence, and code review in one cross-platform workspace.',
  },
  {
    path: '/tour/',
    title: 'Jackalope app tour: Tasks, coding agents & code review',
    description: tour.description,
  },
  {
    path: '/blog/',
    title: 'Field notes | Jackalope',
    description:
      'Notes from the Jackalope studio on building a calmer workspace and working thoughtfully with coding agents.',
  },
  {
    path: '/changelog/',
    title: 'Changelog | Jackalope',
    description:
      'Follow Jackalope development milestones, website updates, and future public releases.',
  },
  {
    path: '/privacy/',
    title: 'Privacy policy | Jackalope',
    description:
      'How Jackalope handles website, early-access, desktop, feedback, and optional usage information.',
  },
  {
    path: '/terms/',
    title: 'Terms of service | Jackalope',
    description:
      'Terms for Jackalope’s website and hosted early-access service, with desktop open-source license information.',
  },
  {
    path: '/access/',
    title: 'Your early access | Jackalope',
    description: 'Your private Jackalope downloads and invitations.',
  },
  ...marketingPages.map((page) => ({
    path: page.path,
    title: page.title,
    description: page.description,
  })),
  ...posts.map((post) => ({
    path: `/blog/${post.slug}/`,
    title: `${post.title} | Jackalope`,
    description: post.description,
  })),
];

export function normalizePath(path: string) {
  const trimmed = path.replace(/\/index\.html$/, '/').replace(/\/+$/, '');
  return trimmed ? `${trimmed}/` : '/';
}
