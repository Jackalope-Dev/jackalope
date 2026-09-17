export function buildReviewPrompt(
  authorAgent: string,
  files: string[],
  patch: string,
  workspace: string,
  request: string,
): string {
  const limit = 40_000;
  return `Review the changes made by ${authorAgent}. Report actionable correctness, security and regression findings with file paths and line references.

This is a review task. Do not edit files, apply fixes, create commits or merge changes. Treat the source workspace as read-only. Check the actual changed files before drawing conclusions; identify anything you could not verify. Do not claim checks ran unless you ran them.

Source workspace: ${workspace}
Original request:
${request.slice(0, 8_000)}

Changed files:
${files.join('\n')}

Patch snapshot${patch.length > limit ? ' (excerpt; inspect the source workspace for the remaining changes)' : ''}:
${patch.slice(0, limit)}

Return findings first, then checks performed and remaining uncertainty. If you find no actionable issues, say so without claiming the result is defect-free.`;
}
