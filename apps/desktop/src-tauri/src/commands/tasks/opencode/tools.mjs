import { appendFile } from 'node:fs/promises';

export default async function nativeTools() {
  const mode = process.env.JACKALOPE_NATIVE_TOOLS;
  async function receipt(value) {
    const target = process.env.JACKALOPE_NATIVE_TOOLS_RECEIPT;
    if (!target) return false;
    try {
      await appendFile(target, `${JSON.stringify({ version: 1, ...value })}\n`, { mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }
  return {
    'tool.definition': async (input, output) => {
      if (input.toolID === 'read' && mode === 'bounded') {
        output.description = output.description.replace(
          'By default, this tool returns up to 2000 lines',
          'By default, this tool returns up to 120 lines',
        );
        output.description +=
          '\nJackalope defaults unspecified reads to 120 lines. Use offset and limit to inspect additional ranges; set an explicit larger limit when complete context is needed. Partial reads cannot establish absence.';
        const description =
          'Maximum lines to read. Defaults to 120; specify a larger limit when needed.';
        if (
          typeof output.parameters?.extend === 'function' &&
          typeof output.parameters.shape?.limit?.describe === 'function'
        ) {
          output.parameters = output.parameters.extend({
            limit: output.parameters.shape.limit.describe(description),
          });
          output.jsonSchema = undefined;
        } else if (output.parameters?.properties?.limit) {
          output.parameters.properties.limit.description = description;
        }
      }
    },
    'tool.execute.before': async (input, output) => {
      if (input.tool !== 'read' || mode !== 'bounded') return;
      if (output.args.limit !== undefined || output.args.offset !== undefined) return;
      if (await receipt({ mode, action: 'default-range', callID: input.callID, lines: 120 }))
        output.args.limit = 120;
    },
  };
}
