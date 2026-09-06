export const siteOrigin = 'https://jackalope.dev';
export const company = { name: 'Jackalope Digital LLC', url: 'https://jackalope.digital' };

export const posts = [
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
          'Jackalope brings that surrounding work into one desktop workspace. It is a product of Jackalope Digital LLC, built around the idea that your tools should give you room to think.',
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
          'Jackalope is in development, with Windows x64 as the initial release target. The first public installer is still being prepared. The website tour uses fictional project data to show the interface; it is not evidence of real agent execution.',
          'We will share development notes and public release announcements here. Join the waitlist if you would like an email when the Windows download is available.',
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
          'This describes the current development workflow. Public Windows release acceptance is still in progress; follow the changelog for availability.',
        ],
      },
    ],
  },
];

export const updates = [
  {
    id: 'workspace-foundations',
    date: '2026-09-06',
    status: 'In development',
    title: 'More of the work, in one place.',
    description:
      'The current development build brings task work and project context into a more focused workspace.',
    items: [
      'Tasks groups active work, saved evidence, and recurring work. Project holds codebase exploration, worktrees, and context.',
      'Project tool selections can travel with Codex and Claude Code task launches, while existing CLI-global tools remain available.',
      'Recurring work includes timezone and missed-run controls. The app must remain running; it cannot wake a closed app or a sleeping computer.',
      'Account-aware usage views and locally bundled fonts are part of the current development build.',
    ],
    note: 'Development milestone, not a public release. Installed-app acceptance, signing, and the first public Windows installer remain pending.',
  },
  {
    id: 'a-first-look',
    date: '2026-09-06',
    status: 'Website',
    title: 'A first look at Jackalope.',
    description: 'A place to explore the product and follow what comes next.',
    items: [
      'Real interface captures in light and dark appearances, using an explicitly fictional Atlas project.',
      'An interactive recorded tour covering task drafting, patch review, agent selection, and the live theme palette.',
      'A three-step introduction, product notes, and a Windows waitlist.',
    ],
    note: 'The walkthrough illustrates the interface with sample data. It does not launch an agent task.',
  },
];

export const pages = [
  {
    path: '/',
    title: 'Jackalope — Big ideas. Room to run.',
    description:
      'A calmer desktop home for your coding agents, tasks, Git worktrees, and review. Join the Windows waitlist for Jackalope by Jackalope Digital LLC.',
  },
  {
    path: '/blog/',
    title: 'Field notes — Jackalope',
    description:
      'Notes from the Jackalope studio on building a calmer workspace and working thoughtfully with coding agents.',
  },
  {
    path: '/changelog/',
    title: 'Changelog — Jackalope',
    description:
      'Follow Jackalope development milestones, website updates, and future public Windows releases.',
  },
  {
    path: '/privacy/',
    title: 'Website & email privacy — Jackalope',
    description:
      'How the Jackalope marketing website and optional email waitlist handle the information you provide.',
  },
  ...posts.map((post) => ({
    path: `/blog/${post.slug}/`,
    title: `${post.title} — Jackalope`,
    description: post.description,
  })),
];

export function normalizePath(path: string) {
  const trimmed = path.replace(/\/index\.html$/, '/').replace(/\/+$/, '');
  return trimmed ? `${trimmed}/` : '/';
}
