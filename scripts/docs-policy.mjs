import path from 'node:path';

export function documentationIssues(documents) {
  const issues = [];
  const index = documents.get('docs/README.md') ?? '';
  const indexed = new Set(
    [...index.matchAll(/\[[^\]]*\]\(([^\s)#]+)(?:#[^)]*)?\)/g)].map((match) =>
      path.posix.normalize(`docs/${decodeURIComponent(match[1])}`),
    ),
  );
  for (const [file, source] of documents) {
    const prose = source.replace(/(```|~~~)[\s\S]*?\1/g, '');
    const isGuide = file.startsWith('docs/');
    const stem = path.posix.basename(file, path.posix.extname(file));
    if (isGuide && !['docs/README.md', 'docs/AGENTS.md'].includes(file) && !indexed.has(file))
      issues.push(`${file}: register this maintained guide in docs/README.md.`);
    if (
      /(?:^|\/)(?:plans|decisions|experiments|audits|reports|handoffs|internal)\//i.test(file) ||
      (!file.startsWith('releases/') && /\d{4}-\d{2}-\d{2}/.test(stem)) ||
      /(?:^|[-_])(?:audit|handoff|work-log|decision-record|design-doc|design-spec|implementation-plan|experiment-report|test-results)(?:[-_]|$)/i.test(
        stem,
      )
    )
      issues.push(`${file}: internal records and dated documents belong outside tracked source.`);
    if (
      isGuide &&
      /^#{1,6}\s+.*(?:\b\d{4}-\d{2}-\d{2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b)/im.test(
        prose,
      )
    )
      issues.push(`${file}: dated work sections belong in the task/PR or private evidence.`);
    if (
      isGuide &&
      /^#{1,6}\s+(?:Local measurements|Local validation|Integration decisions|Recorded (?:local )?evidence|Session (?:summary|handoff)|Work (?:log|summary)|(?:Implementation|Design) (?:plan|proposal)|Owner decisions)\b/im.test(
        prose,
      )
    )
      issues.push(`${file}: keep the behavior or repeatable procedure, not a work record.`);
    if (
      /(?:[A-Z]:[\\/]Users[\\/](?!<)[^\s/\\]+|\/Users\/(?!<)[^\s/]+|jackalope-private(?:-backups)?[\\/])/i.test(
        prose,
      )
    )
      issues.push(`${file}: replace personal/private storage paths with portable guidance.`);
  }
  return issues;
}
