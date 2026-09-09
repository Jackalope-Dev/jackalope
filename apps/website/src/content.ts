import { practicalPosts } from './blog-content.ts';
import type { BlogPost } from './blog-types.ts';
import updates from './changelog.json' with { type: 'json' };
import { growthPost } from './growth-content.ts';
import { knowledgeGuides } from './knowledge-content.ts';
import { marketingPages } from './marketing-content.ts';

export const siteOrigin = 'https://jackalope.dev';
export const company = { name: 'Jackalope Digital LLC', url: 'https://jackalope.digital' };

export const tour = {
  title: 'More room to build.',
  description:
    'Explore themes, project setup, task dispatch, browser tools, agent accounts, and the interactive codebase map in a 64-second tour with sample data.',
  durationSeconds: 64,
  video: '/media/launch-v4-720p.mp4',
  poster: '/media/launch-v4-poster.png',
  captions: '/media/launch-v4.vtt',
  published: '2026-09-09T18:00:00Z',
  transcript:
    'Your next idea. Already in motion. Choose a theme, set up a project and its agents, and open your workspace. Describe an outcome and dispatch a task. Watch a sample browser booking flow, then inspect its check results and screenshot evidence in Jackalope. Bring Codex, Claude Code, Grok, and OpenCode together, with separate work and personal accounts. Explore directories and file dependencies in the interactive codebase map. More room to build. Get early access at jackalope.dev. This recorded frontend walkthrough uses fictional Atlas data and an original instrumental track. Task execution, account identities, and check results are sample states; browser interactions are scripted. No native agent task or Windows app-control session is launched.',
};

export const posts: BlogPost[] = [
  ...practicalPosts,
  growthPost,
  {
    slug: 'work-and-personal-accounts',
    title: 'Work and personal accounts, with room for both.',
    seoTitle: 'Separate work and personal coding-agent accounts',
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
          'Create separate account profiles for Codex, Claude Code, Grok, and OpenCode. Give each sign-in a useful name, then choose which projects use it.',
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
    seoTitle: 'Why we are building a coding-agent workspace',
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
          'Join the waitlist to hear when early access opens. The app tour gives you a look at the workspace using sample project data.',
          'We will share development notes and public release announcements here. Join the waitlist for early-access news.',
        ],
      },
    ],
  },
  {
    slug: 'from-brief-to-review',
    title: 'From a clear brief to a considered review.',
    seoTitle: 'Coding-agent workflow: From brief to code review',
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
        ],
      },
    ],
  },
];

export { updates };

export type SitePage = {
  path: string;
  title: string;
  description: string;
  noindex?: boolean;
};

export const pages: SitePage[] = [
  {
    path: '/',
    title: 'Jackalope: Run AI coding agents in parallel',
    description:
      'Run Codex, Claude Code, Grok, and OpenCode in parallel Git worktrees. Coordinate tasks, keep project context, and review code in one desktop workspace.',
  },
  {
    path: '/tour/',
    title: 'Jackalope app tour: Tasks, coding agents & code review',
    description: tour.description,
  },
  {
    path: '/blog/',
    title: 'Coding-agent workflows & field notes | Jackalope',
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
    path: '/knowledge/',
    title: 'Coding-agent guides & troubleshooting | Jackalope',
    description:
      'Explore official guides, parallel worktree architecture, multi-account setup, automatic quota handoff, and troubleshooting recipes for Jackalope.',
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
    path: '/waitlist/',
    noindex: true,
    title: 'Your waitlist place | Jackalope',
    description: 'Your private waitlist position and referral progress.',
  },
  {
    path: '/access/',
    noindex: true,
    title: 'Your early access | Jackalope',
    description: 'Your private Jackalope downloads and invitations.',
  },
  {
    path: '/feedback/',
    noindex: true,
    title: 'Share your experience | Jackalope',
    description: 'Share private feedback about your experience with Jackalope.',
  },
  ...marketingPages.map((page) => ({
    path: page.path,
    title: page.title,
    description: page.description,
  })),
  ...posts.map((post) => ({
    path: `/blog/${post.slug}/`,
    title: `${post.seoTitle || post.title} | Jackalope`,
    description: post.description,
  })),
  ...knowledgeGuides.map((guide) => ({
    path: `/knowledge/${guide.slug}/`,
    title: `${guide.shortTitle} | Jackalope`,
    description: guide.description,
  })),
];

export function normalizePath(path: string) {
  const trimmed = path.replace(/\/index\.html$/, '/').replace(/\/+$/, '');
  return trimmed ? `${trimmed}/` : '/';
}
