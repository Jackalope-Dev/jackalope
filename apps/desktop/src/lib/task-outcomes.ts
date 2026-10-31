interface OutcomeReceipt {
  accepted: boolean;
  evidence: string;
  note: string;
  tree: string;
  recordedAt: string;
}
export interface Requirement {
  id: string;
  title: string;
  checkpoint: boolean;
  receipt: OutcomeReceipt | null;
}
export interface TaskContract {
  step?: number;
  requirements: Requirement[];
  inputs: Record<string, string>;
}
export function requirementState(item: Requirement, tree: string | null) {
  if (!item.receipt) return 'Not verified';
  if (!tree) return 'Snapshot not checked';
  if (item.receipt.tree !== tree) return 'Evidence needs refreshing';
  return item.receipt.accepted ? 'Accepted by you' : 'Needs changes';
}
export function correctionPrompt(items: Requirement[]) {
  return `Address these requirements, then provide fresh evidence for review:\n\n${items.map((item) => `- ${item.title}${item.receipt?.note ? `\n  Review feedback: ${item.receipt.note}` : ''}`).join('\n')}\n\nPreserve the other agreed outcomes. Report anything you could not verify.`;
}
export function requirementAssessment(
  steps: import('./task-runtime').ValidationStep[] | undefined,
  id: string,
) {
  for (const step of [...(steps ?? [])].reverse()) {
    const answer = step.requirements?.find((item) => item.requirementId === id);
    if (answer) return { answer, timestamp: step.timestamp };
  }
  return null;
}

/** Weakest to strongest; Jackalope only lowers a claimed level, never raises it. */
export type EvidenceLevel = 'stated' | 'cited' | 'reasoned' | 'ran' | 'reproduced';
const evidenceOrder: EvidenceLevel[] = ['stated', 'cited', 'reasoned', 'ran', 'reproduced'];
export const evidenceLabel: Record<EvidenceLevel, string> = {
  stated: 'Stated',
  cited: 'Cited code',
  reasoned: 'Reasoned through',
  ran: 'Ran it',
  reproduced: 'Shown in the app',
};
export interface SafetyFact {
  fact: string;
  level: EvidenceLevel;
  evidence: string[];
  reasoning?: string;
  command?: string;
  output?: string;
  checkedLevel?: EvidenceLevel;
  checkNote?: string;
}
export interface GoalRestatement {
  goal: string;
  problem: string;
  smallestChange: string;
  recordedAt?: string;
}
interface Rated {
  level?: EvidenceLevel;
  checkedLevel?: EvidenceLevel;
  checkNote?: string;
}
/** Checked strength for review. Reports saved before levels existed are unrated. */
export function evidenceStrength(answer: Rated) {
  const checked = answer.checkedLevel ?? null;
  if (!checked) return { checked, label: 'Unrated', lowered: null };
  const claimed = answer.level ?? checked;
  return {
    checked,
    label: evidenceLabel[checked],
    lowered:
      evidenceOrder.indexOf(checked) < evidenceOrder.indexOf(claimed)
        ? `Claimed ${evidenceLabel[claimed].toLowerCase()}${answer.checkNote ? `. ${answer.checkNote}` : ''}`
        : null,
  };
}
/** The weakest checked level across requirements, and how many have no rated assessment. */
export function weakestEvidence(
  steps: import('./task-runtime').ValidationStep[] | undefined,
  requirements: Pick<Requirement, 'id'>[],
) {
  let weakest: EvidenceLevel | null = null;
  let unrated = 0;
  for (const item of requirements) {
    const level = requirementAssessment(steps, item.id)?.answer.checkedLevel;
    if (!level) unrated += 1;
    else if (!weakest || evidenceOrder.indexOf(level) < evidenceOrder.indexOf(weakest))
      weakest = level;
  }
  return { weakest, unrated };
}
/** The latest safety fact any report gave, if one did. */
export function latestSafetyFact(steps: import('./task-runtime').ValidationStep[] | undefined) {
  return [...(steps ?? [])].reverse().find((step) => step.safetyFact)?.safetyFact ?? null;
}
