export interface OutcomeReceipt {
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
