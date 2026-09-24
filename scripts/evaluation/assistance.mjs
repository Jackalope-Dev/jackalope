import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function assistanceEvidence(records, labels) {
  if (!Array.isArray(records) || !records.length || !Array.isArray(labels) || !labels.length)
    throw new Error('Provide decision receipts and independent relevance labels.');
  const byId = new Map();
  for (const record of records) {
    if (!record.id || byId.has(record.id)) throw new Error('Missing or duplicate decision ID.');
    byId.set(record.id, record);
  }
  const seen = new Set();
  let relevant = 0;
  let retainedRelevant = 0;
  let irrelevant = 0;
  let wouldSuppress = 0;
  let falseNegatives = 0;
  let unavailable = 0;
  for (const label of labels) {
    const key = `${label.recordId}:${label.questionId}`;
    if (seen.has(key) || typeof label.relevant !== 'boolean')
      throw new Error('Labels must be unique and explicitly true or false.');
    seen.add(key);
    const record = byId.get(label.recordId);
    if (!record) throw new Error('Label refers to a missing decision receipt.');
    const assistance = record.evidence?.assistance;
    if (assistance?.mode !== 'shadow')
      throw new Error('Use explicitly recorded shadow assessments.');
    const monitor = assistance.operation === 'monitor_relevance' && label.questionId === 'relevant';
    const context =
      ['source_ranking', 'memory_selection', 'documentation_selection'].includes(
        assistance.operation,
      ) && /^relevance_\d+$/.test(label.questionId);
    if (!monitor && !context)
      throw new Error(
        'Label must identify a relevance question, not a conflict or review assessment.',
      );
    const answer = record.answers?.[label.questionId];
    const failed = record.decision?.fallbackReason != null;
    const probability = monitor ? answer?.noul : answer?.probabilities?.['0'];
    const known = !failed && Number.isFinite(probability) && probability >= 0 && probability <= 1;
    const suppress = known && (monitor ? probability <= 0.02 : probability >= 0.95);
    if (!known) unavailable++;
    if (suppress) wouldSuppress++;
    if (label.relevant) {
      relevant++;
      if (suppress) falseNegatives++;
      else retainedRelevant++;
    } else irrelevant++;
  }
  const costs = records.map((record) => record.decision?.usage?.estimatedCostUsd);
  const costKnown = costs.every((value) => Number.isFinite(value) && value >= 0);
  return {
    receipts: records.length,
    labels: labels.length,
    relevant,
    irrelevant,
    retainedRelevant,
    falseNegatives,
    wouldSuppress,
    unavailable,
    relevanceRecall: relevant ? retainedRelevant / relevant : null,
    estimatedDecisionCostUsd: costKnown ? costs.reduce((sum, cost) => sum + cost, 0) : null,
    actualAgentsAvoided: 0,
    publicationEligible: false,
    scope:
      'Shadow relevance screening only. Unavailable decisions retain evidence. Decision cost is a token-price estimate, not an invoice. Proposed suppression is not an avoided agent call, task-quality result or measured saving. Include downstream matched execution and all decision costs before making a product claim.',
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [records, labels, output] = process.argv.slice(2);
  if (!records || !labels)
    throw new Error('Usage: node assistance.mjs <receipts.json> <labels.json> [report.json]');
  const report = assistanceEvidence(
    JSON.parse(await readFile(records, 'utf8')),
    JSON.parse(await readFile(labels, 'utf8')),
  );
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (output) await writeFile(output, text);
  else process.stdout.write(text);
}
