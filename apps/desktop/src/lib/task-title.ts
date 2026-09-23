export function taskTitle(prompt = '', savedTitle?: string): string {
  const firstLine = prompt.trim().split(/\r?\n/)[0];
  if (savedTitle?.trim() && savedTitle.trim() !== firstLine.slice(0, 160)) return savedTitle.trim();
  const lines = prompt
    .replace(/```[\s\S]*?(?:```|$)/g, '')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:#{1,6}\s*|[-*+]\s+|\d+[.)]\s+)/, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*`#]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(
      (line) =>
        line &&
        !/^(?:🎯\s*)?(?:objective|request|task|context|instructions|description)\s*:?$/i.test(line),
    );
  const objective =
    lines.find((line) => /^(?:🎯\s*)?(?:objective|task|request)\s*:/i.test(line)) ?? lines[0] ?? '';
  let title = objective.replace(/^(?:🎯\s*)?(?:objective|task|request)\s*:\s*/i, '');
  for (let index = 0; index < 3; index++) {
    title = title.replace(
      /^(?:(?:hey|hi|hello)[,!]?\s+|please\s+|(?:can|could|would) you\s+|(?:i think\s+)?we (?:should|need to|want to)\s+|i (?:want|need|would like)(?: you)? to\s+|let['’]?s\s+|help me\s+|maybe\s+)/i,
      '',
    );
  }
  title = title.split(/(?:[.!?](?:\s|$)|\s+(?:because|so that|in order to)\s+)/)[0].trim();
  const words = title.split(/\s+/);
  if (words.length > 10) title = words.slice(0, 10).join(' ');
  if (title.length > 72) title = title.slice(0, 72).replace(/\s+\S*$/, '');
  title = title
    .replace(/(?:\s+(?:a|an|the|to|with|for|of|and|or|in|on|that|which))+$/i, '')
    .replace(/[,:;.!?\s]+$/, '');
  return title ? title[0].toUpperCase() + title.slice(1) : 'Untitled task';
}
