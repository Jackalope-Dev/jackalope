import { appendFile } from 'node:fs/promises';
import { deduplicateReadHistory } from './history-compaction.mjs';

export default async function historyPlugin() {
  return {
    'experimental.chat.messages.transform': async (_input, output) => {
      if (process.env.JACKALOPE_HISTORY_COMPACTION !== 'deduplicate') return;
      const started = performance.now();
      const result = deduplicateReadHistory(output.messages);
      const receipt = {
        version: 1,
        policy: 'exact-read-duplicates-v1',
        skipped: result.skipped,
        beforeBytes: result.beforeBytes,
        afterBytes: result.afterBytes,
        replacements: result.replacements,
        elapsedMs: performance.now() - started,
      };
      const receiptPath = process.env.JACKALOPE_HISTORY_COMPACTION_RECEIPT;
      if (!receiptPath) return;
      try {
        await appendFile(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
      } catch {
        return;
      }
      if (result.replacements.length) {
        output.messages.splice(0, output.messages.length, ...result.messages);
      }
    },
  };
}
