export async function providerJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('provider_rejected');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) throw new Error('provider_response_too_large');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('provider_response_invalid');
    return value as Record<string, unknown>;
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}
