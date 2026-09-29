/** Editable first requests offered when a project has no work yet. */
export const STARTER_PROMPTS = [
  {
    label: 'Tour this codebase',
    prompt:
      'Give me a short tour of this codebase: what it does, how it is organized and how to run it. Then suggest three small, low-risk improvements.',
  },
  {
    label: 'Find and fix a bug',
    prompt: 'Find one real bug in this project, fix it and add a test that fails without the fix.',
  },
  {
    label: 'Improve tests',
    prompt:
      'Find the most important untested behavior in this project and add focused tests for it.',
  },
  {
    label: 'Refresh the README',
    prompt:
      'Update the README so a new contributor can install, run and test this project. Verify each command you document.',
  },
];
