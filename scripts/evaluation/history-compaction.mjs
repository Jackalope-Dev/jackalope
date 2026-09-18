import { createHash } from 'node:crypto';

const readTools = new Set(['read', 'grep', 'glob']);
const maxBytes = 1_000_000;

export function deduplicateReadHistory(messages) {
  const result = { messages, replacements: [], beforeBytes: 0, afterBytes: 0, skipped: null };
  if (!Array.isArray(messages) || messages.length > 500) {
    result.skipped = 'unsupported-or-oversized-history';
    return result;
  }
  const candidates = [];
  for (const [messageIndex, message] of messages.entries()) {
    if (message?.info?.role !== 'assistant' || !Array.isArray(message.parts)) continue;
    for (const [partIndex, part] of message.parts.entries()) {
      const state = part?.state;
      if (
        part?.type !== 'tool' ||
        !readTools.has(part.tool) ||
        state?.status !== 'completed' ||
        typeof state.output !== 'string' ||
        !/^[\w.:-]{1,160}$/.test(part.callID ?? '') ||
        state.time?.compacted != null ||
        state.attachments?.length ||
        state.metadata?.truncated ||
        state.metadata?.error ||
        state.metadata?.isError
      )
        continue;
      const bytes = Buffer.byteLength(state.output);
      result.beforeBytes += bytes;
      if (result.beforeBytes > maxBytes) {
        result.skipped = 'history-byte-limit';
        result.afterBytes = result.beforeBytes;
        return result;
      }
      if (bytes < 2_000) continue;
      candidates.push({ messageIndex, partIndex, part, bytes });
    }
  }
  const seen = new Map();
  const replacements = new Map();
  for (const candidate of candidates) {
    const { part } = candidate;
    const state = part.state;
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          tool: part.tool,
          input: state.input,
          output: state.output,
          title: state.title,
          metadata: state.metadata,
        }),
      )
      .digest('hex');
    const original = seen.get(digest);
    if (!original) {
      seen.set(digest, candidate);
      continue;
    }
    if (original.part.callID === part.callID) continue;
    const output = `[Jackalope: exact duplicate of the ${part.tool} result retained at earlier tool call ${original.part.callID}; sha256 ${digest}. Arguments, output, title and metadata match. No additional source content.]`;
    const afterBytes = Buffer.byteLength(output);
    if (afterBytes >= candidate.bytes) continue;
    replacements.set(`${candidate.messageIndex}:${candidate.partIndex}`, output);
    result.replacements.push({
      callId: part.callID,
      retainedCallId: original.part.callID,
      sha256: digest,
      beforeBytes: candidate.bytes,
      afterBytes,
    });
  }
  result.afterBytes =
    result.beforeBytes -
    result.replacements.reduce((sum, row) => sum + row.beforeBytes - row.afterBytes, 0);
  if (replacements.size) {
    result.messages = messages.map((message, messageIndex) => ({
      ...message,
      ...(Array.isArray(message?.parts)
        ? {
            parts: message.parts.map((part, partIndex) => {
              const output = replacements.get(`${messageIndex}:${partIndex}`);
              return output === undefined ? part : { ...part, state: { ...part.state, output } };
            }),
          }
        : {}),
    }));
  }
  return result;
}
