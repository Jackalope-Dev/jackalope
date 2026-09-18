import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const plugin = new URL('./opencode-history-plugin.mjs', import.meta.url);
const core = new URL('./history-compaction.mjs', import.meta.url);

export async function historyExperimentIdentity(agent, experiments) {
  if (!Object.values(experiments).some((options) => options['history-compaction'] !== 'off'))
    return null;
  if (agent !== 'opencode') throw new Error('History compaction requires OpenCode.');
  return Object.fromEntries(
    await Promise.all(
      [plugin, core].map(async (url) => [
        url.pathname.split('/').at(-1),
        createHash('sha256')
          .update(await readFile(url))
          .digest('hex'),
      ]),
    ),
  );
}

export function historyExperimentEnvironment(mode, receiptPath, env = process.env) {
  if (mode === 'off') return { JACKALOPE_HISTORY_COMPACTION_RECEIPT: '' };
  if (mode !== 'deduplicate') throw new Error('Unknown history compaction mode.');
  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT || '{}');
  if (
    !config ||
    Array.isArray(config) ||
    typeof config !== 'object' ||
    (config.plugin !== undefined && !Array.isArray(config.plugin))
  ) {
    throw new Error('Invalid inherited OpenCode configuration.');
  }
  const plugins = config.plugin ?? [];
  return {
    JACKALOPE_HISTORY_COMPACTION_RECEIPT: receiptPath,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...config,
      plugin: [...new Set([...plugins, plugin.href])],
    }),
  };
}

export async function historyExperimentReceipt(mode, receiptPath) {
  if (mode === 'off') return null;
  try {
    const receipts = (await readFile(receiptPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { invocations: receipts.length, receipts };
  } catch (error) {
    if (error.code === 'ENOENT') return { invocations: 0, receipts: [] };
    throw error;
  }
}
