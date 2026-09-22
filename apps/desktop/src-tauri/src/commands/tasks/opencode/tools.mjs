import { randomUUID } from 'node:crypto';
import { appendFile, writeFile } from 'node:fs/promises';

export default async function nativeTools() {
  const mode = process.env.JACKALOPE_NATIVE_TOOLS;
  const endpoint = process.env.JACKALOPE_BRIDGE_URL;
  const token = process.env.JACKALOPE_BRIDGE_TOKEN;
  let capturedBytes = 0;
  let pendingBytes = 0;
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
      if (bytes <= 2000 || bytes > 50_000 || capturedBytes + pendingBytes + bytes > 20_000_000)
        return;
      if (!original.includes(' passed') && !original.includes('# pass ')) return;
      const body = JSON.stringify({ output: original, exit_code: 0, truncated: false });
      if (Buffer.byteLength(body) > 60_000) return;
      const started = performance.now();
      pendingBytes += bytes;
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
      } finally {
        pendingBytes -= bytes;
      }
    },
  };
}
