import type { LiveSession } from './live-session.ts';
import type { TaskRun } from './run-types.ts';

/**
 * A conversation as Markdown: what the person sent and each reply, in order. It holds
 * only what the transcript shows, so tool activity, paths and usage stay out.
 */
export function sessionMarkdown(session: LiveSession, runs: TaskRun[], agentName: string) {
  const results = new Map(runs.map((run) => [run.id, run.result?.trim() ?? '']));
  const lastOfRun = new Map<string, string>();
  for (const message of session.messages)
    if (message.runId && !message.canceled) lastOfRun.set(message.runId, message.id);
  const speaker = session.persona?.name ?? agentName;
  const parts = [
    `# ${session.title.trim() || 'Conversation'}`,
    [session.request.projectName, session.createdAt.slice(0, 10)].filter(Boolean).join(' · '),
  ];
  for (const message of session.messages) {
    if (message.canceled) continue;
    // A wake-up or another bot's message is labelled as the transcript labels it.
    parts.push(`**${message.origin ? message.origin.label : 'You'}**\n\n${message.text.trim()}`);
    const reply = message.runId && lastOfRun.get(message.runId) === message.id;
    const result = reply ? results.get(message.runId as string) : '';
    if (result) parts.push(`**${speaker}**\n\n${result}`);
  }
  return `${parts.filter(Boolean).join('\n\n')}\n`;
}
