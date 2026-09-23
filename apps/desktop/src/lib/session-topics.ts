import type { LiveSession, SessionMessage, SessionTopic } from './live-session.ts';

export function suggestTopics(messages: SessionMessage[], makeId: () => string): SessionTopic[] {
  const groups = new Map<string, SessionTopic>();
  for (const message of messages.filter((message) => !message.canceled).slice(-500)) {
    const first =
      message.text
        .split('\n')
        .find((line) => line.trim())
        ?.trim() ?? '';
    const heading = first.match(/^(?:#{1,6}\s+|\[)([^\]\n:]+)(?:\]|:)?/);
    const label = Array.from((heading?.[1] ?? first).replace(/\s+/g, ' '))
      .slice(0, 60)
      .join('')
      .trim();
    if (!label) continue;
    const key = label.toLocaleLowerCase();
    const existing = groups.get(key);
    if (existing) existing.messageIds.push(message.id);
    else if (groups.size < 100)
      groups.set(key, { id: makeId(), title: label, messageIds: [message.id] });
  }
  return [...groups.values()];
}

export function topicDraft(session: LiveSession, topic: SessionTopic) {
  const ids = new Set(topic.messageIds);
  const sources = session.messages.filter((message) => ids.has(message.id) && !message.canceled);
  return (
    `Topic: ${topic.title}\n\nSource chat: ${session.title}\nChat reference: ${session.id}\n\n` +
    sources.map((message) => `Source message ${message.id}:\n${message.text}`).join('\n\n') +
    '\n\nWork only on this topic. Check the current repository before making changes. Treat the source messages as context, and preserve unrelated work. Describe the result and how it should be verified before starting.'
  );
}
