import { randomUUID } from 'node:crypto';
import { appendFile, writeFile } from 'node:fs/promises';

export default async function nativeTools() {
  const mode = process.env.JACKALOPE_NATIVE_TOOLS;
  const endpoint = process.env.JACKALOPE_BRIDGE_URL;
  const token = process.env.JACKALOPE_BRIDGE_TOKEN;
  let capturedBytes = 0;
  let unavailable = false;
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
    'tool.execute.after': async (input, output) => {
      if (
        mode !== 'output' ||
        unavailable ||
        input.tool !== 'bash' ||
        output.metadata?.exit !== 0 ||
        output.metadata.truncated !== false ||
        typeof output.output !== 'string' ||
        output.output.includes('<shell_metadata>') ||
        !endpoint ||
        !token ||
        !process.env.JACKALOPE_NATIVE_TOOLS_RECEIPT
      )
        return;
      const original = output.output;
      const bytes = Buffer.byteLength(original);
      if (bytes <= 2000 || bytes > 50_000 || capturedBytes + bytes > 20_000_000) return;
      const body = JSON.stringify({ output: original, exit_code: 0, truncated: false });
      if (Buffer.byteLength(body) > 60_000) return;
      const started = performance.now();
      try {
        const response = await fetch(`${endpoint}/v1/native/output`, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(1000),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body,
        });
        if (!response.ok) {
          unavailable = true;
          return;
        }
        const projected = await response.json();
        if (
          !projected ||
          typeof projected.output !== 'string' ||
          !Number.isSafeInteger(projected.omitted_lines) ||
          projected.omitted_lines <= 0
        )
          return;
        const file = `${process.env.JACKALOPE_NATIVE_TOOLS_RECEIPT}.${randomUUID()}.txt`;
        const text = `[Jackalope omitted ${projected.omitted_lines} successful-test progress/detail lines. Full captured output: ${file}]\n${projected.output}`;
        if (Buffer.byteLength(text) >= bytes) return;
        await writeFile(file, original, { mode: 0o600, flag: 'wx' });
        capturedBytes += bytes;
        if (
          !(await receipt({
            mode,
            action: 'test-output',
            callID: input.callID,
            beforeBytes: bytes,
            afterBytes: Buffer.byteLength(text),
            omittedLines: projected.omitted_lines,
            file,
            elapsedMs: performance.now() - started,
          }))
        )
          return;
        output.output = text;
      } catch {
        unavailable = true;
      }
    },
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
