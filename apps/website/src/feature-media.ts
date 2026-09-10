type FeatureMedia = {
  title: string;
  caption: string;
  clip?: 'browser' | 'composer' | 'accounts';
  image?: 'tasks' | 'review' | 'recurring';
  width?: number;
  height?: number;
  steps: { title: string; detail: string; section: number }[];
};

export const featureMedia: Record<string, FeatureMedia> = {
  '/features/browser-automation-for-coding-agents/': {
    title: 'From browser interaction to task evidence',
    caption:
      'A scripted browser example, recorded in the sample workspace. Follow the interaction, then see its checks and screenshot in Evidence.',
    clip: 'browser',
    steps: [
      {
        title: 'Try the interaction',
        detail: 'Navigate, fill a form, and check the states that matter.',
        section: 1,
      },
      {
        title: 'Bring back evidence',
        detail: 'Keep screenshots and findings attached to the task.',
        section: 2,
      },
      {
        title: 'Review the behavior',
        detail: 'Use the evidence to decide what still needs checking.',
        section: 3,
      },
    ],
  },
  '/features/project-context-for-coding-agents/': {
    title: 'Put the right context behind the brief',
    caption:
      'The actual task composer with Atlas sample data. See where effort, workspace, context, and tools fit before starting a task.',
    clip: 'composer',
    steps: [
      {
        title: 'Start with an outcome',
        detail: 'Describe what you want to change in the project.',
        section: 1,
      },
      {
        title: 'Choose what travels with it',
        detail: 'Review project guidance and selected tools.',
        section: 3,
      },
      {
        title: 'Inspect what was received',
        detail: 'Return to the task’s context when a result needs correction.',
        section: 6,
      },
    ],
  },
  '/features/recurring-coding-agent-tasks/': {
    title: 'A schedule for the clock. A monitor for changes.',
    caption:
      'The Recurring view with two paused Atlas examples: a weekly dependency review and a local API monitor. No scheduled work has run.',
    image: 'recurring',
    width: 1416,
    height: 716,
    steps: [
      {
        title: 'Choose a rhythm',
        detail: 'Set timing, timezone, and what to do after a missed run.',
        section: 1,
      },
      {
        title: 'Or watch for a change',
        detail: 'Check committed content before involving an agent.',
        section: 2,
      },
      {
        title: 'Keep the review',
        detail: 'Every occurrence keeps its own result and history.',
        section: 4,
      },
    ],
  },
  '/parallel-coding-agents/': {
    title: 'Independent tasks. One place to follow them.',
    caption:
      'The Tasks view with fictional Atlas work, grouped by what needs attention. Open any task to return to its result and history.',
    image: 'tasks',
    steps: [
      {
        title: 'Give each task a boundary',
        detail: 'Split the work into independent outcomes.',
        section: 4,
      },
      {
        title: 'Keep files separate',
        detail: 'Use a worktree and branch for each parallel task.',
        section: 2,
      },
      {
        title: 'Come back to review',
        detail: 'Inspect the results before integrating the work.',
        section: 3,
      },
    ],
  },
  '/git-worktrees-for-ai-agents/': {
    title: 'The task stays connected to the change',
    caption:
      'An Atlas sample task result. Changes & checks, Evidence, Activity, and Context stay together before Review integration.',
    image: 'review',
    steps: [
      {
        title: 'Separate the checkout',
        detail: 'Give each agent its own working directory.',
        section: 1,
      },
      {
        title: 'Inspect before integration',
        detail: 'Review the task and the combined patch.',
        section: 2,
      },
      {
        title: 'Clean up deliberately',
        detail: 'Keep unfinished work safe when removing worktrees.',
        section: 5,
      },
    ],
  },
  '/agents/': {
    title: 'Find your agents and account profiles',
    caption:
      'A short tour of agent configuration with sample accounts. Open each agent to find its setup and account controls.',
    clip: 'accounts',
    steps: [
      { title: 'Bring your CLI', detail: 'Use the agent tools you already work with.', section: 1 },
      {
        title: 'Check the fit',
        detail: 'Review the capabilities each adapter supports.',
        section: 2,
      },
      {
        title: 'Keep accounts in view',
        detail: 'Choose the profile appropriate to the work.',
        section: 5,
      },
    ],
  },
};
