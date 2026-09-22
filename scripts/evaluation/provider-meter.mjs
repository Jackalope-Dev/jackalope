import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';

export function deepseekUsage(usage) {
  if (!usage) return null;
  const input = usage.prompt_tokens,
    output = usage.completion_tokens;
  const cacheRead = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens;
  if (
    ![input, output, cacheRead].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    cacheRead > input
  )
    return null;
  return {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    reasoning: usage.completion_tokens_details?.reasoning_tokens ?? null,
  };
}

export async function startProviderMeter({
  key,
  model,
  upstream = 'https://api.deepseek.com',
  fetchImpl = fetch,
}) {
  if (!key || !/^deepseek\/[\w.-]+$/.test(model))
    throw new Error('Provider accounting requires a DeepSeek key and explicit DeepSeek model.');
  const token = randomUUID(),
    records = [],
    active = new Set();
  const apiModel = model.slice('deepseek/'.length);
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }
    const record = {
      sequence: records.length + 1,
      model,
      status: null,
      elapsedMs: null,
      usage: null,
      finished: false,
      startedAt: new Date().toISOString(),
      toolCount: null,
      toolSchemaBytes: null,
      messageCount: null,
      messageBytes: null,
      reportedModel: null,
      reasoningEffort: null,
      thinking: null,
    };
    records.push(record);
    const start = performance.now(),
      controller = new AbortController();
    active.add(controller);
    const timer = setTimeout(() => controller.abort(), 180_000);
    response.on('close', () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      if (request.method !== 'POST' || request.url !== '/chat/completions')
        throw new Error('Unsupported endpoint');
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 8_388_608) throw new Error('Request limit');
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks),
        parsed = JSON.parse(body);
      if (parsed.model !== apiModel) throw new Error('Unplanned model');
      record.toolCount = Array.isArray(parsed.tools) ? parsed.tools.length : 0;
      record.toolSchemaBytes = Buffer.byteLength(JSON.stringify(parsed.tools ?? []));
      record.messageCount = Array.isArray(parsed.messages) ? parsed.messages.length : null;
      record.messageBytes = Buffer.byteLength(JSON.stringify(parsed.messages ?? []));
      record.reasoningEffort = [
        'none',
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ].includes(parsed.reasoning_effort)
        ? parsed.reasoning_effort
        : null;
      record.thinking = ['enabled', 'disabled'].includes(parsed.thinking?.type)
        ? parsed.thinking.type
        : null;
      const result = await fetchImpl(`${upstream}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body,
        signal: controller.signal,
        redirect: 'error',
      });
      record.status = result.status;
      response.writeHead(result.status, {
        'Content-Type': result.headers.get('content-type') ?? 'application/json',
      });
      const streaming = result.headers.get('content-type')?.includes('text/event-stream');
      const decoder = new TextDecoder();
      let pending = '',
        overflow = false;
      const inspect = (line) => {
        if (!line.startsWith('data:')) return;
        try {
          const value = JSON.parse(line.slice(5));
          if (typeof value.model === 'string' && /^deepseek[\w.-]{0,150}$/.test(value.model))
            record.reportedModel = value.model;
          if (value.usage) record.usage = deepseekUsage(value.usage);
        } catch {}
      };
      for await (const chunk of result.body ?? []) {
        response.write(chunk);
        if (overflow) continue;
        pending += decoder.decode(chunk, { stream: true });
        if (pending.length > 2_097_152) {
          overflow = true;
          record.usage = null;
          pending = '';
          continue;
        }
        if (streaming) {
          const lines = pending.split('\n');
          pending = lines.pop();
          for (const line of lines) inspect(line);
        }
      }
      pending += decoder.decode();
      if (!overflow) {
        if (streaming) inspect(pending);
        else {
          try {
            const value = JSON.parse(pending);
            record.usage = deepseekUsage(value.usage);
            if (typeof value.model === 'string' && /^deepseek[\w.-]{0,150}$/.test(value.model))
              record.reportedModel = value.model;
          } catch {}
        }
      }
      record.finished = true;
      response.end();
    } catch {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    } finally {
      clearTimeout(timer);
      active.delete(controller);
      record.elapsedMs = performance.now() - start;
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    token,
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      for (const controller of active) controller.abort();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      const complete =
        records.length > 0 &&
        records.every((r) => r.finished && r.status >= 200 && r.status < 300 && r.usage);
      const usage = complete
        ? Object.fromEntries(
            ['input', 'output', 'cacheRead', 'cacheWrite'].map((key) => [
              key,
              records.reduce((sum, record) => sum + record.usage[key], 0),
            ]),
          )
        : null;
      return {
        version: 1,
        provider: 'deepseek',
        scope:
          'All requests through this isolated provider endpoint, including auxiliary calls and retries; no prompts, response text or keys retained.',
        complete,
        usage,
        maxRequestInput: complete ? Math.max(...records.map((r) => r.usage.input)) : null,
        requests: records,
      };
    },
  };
}

export async function inspectProviderProfile(directory) {
  const present = async (name) => {
    try {
      await stat(path.join(directory, name));
      return true;
    } catch (error) {
      return error.code === 'ENOENT' ? false : null;
    }
  };
  return {
    configPresent: await present('config/opencode/opencode.json'),
    catalogPresent: await present('cache/opencode/models.json'),
    pluginManifestPresent: await present(
      'config/opencode/node_modules/@opencode-ai/plugin/package.json',
    ),
  };
}

export async function prepareProviderMeter(directory, model) {
  const key =
    process.env.DEEPSEEK_API_KEY ??
    JSON.parse(await readFile(path.join(homedir(), '.local/share/opencode/auth.json'), 'utf8'))
      .deepseek?.key;
  const meter = await startProviderMeter({ key, model });
  try {
    const profileStateBeforeSetup = await inspectProviderProfile(directory);
    const config = path.join(directory, 'config');
    await mkdir(path.join(config, 'opencode'), { recursive: true });
    await writeFile(
      path.join(config, 'opencode/opencode.json'),
      JSON.stringify({
        enabled_providers: ['deepseek'],
        model,
        small_model: model,
        share: 'disabled',
        plugin: [],
        provider: {
          deepseek: { options: { baseURL: meter.url, apiKey: '{env:DEEPSEEK_API_KEY}' } },
        },
      }),
      { mode: 0o600 },
    );
    const env = { ...process.env };
    for (const name of Object.keys(env)) {
      if (/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/.test(name) && !name.startsWith('JACKALOPE_'))
        delete env[name];
    }
    for (const name of ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT'])
      delete env[name];
    Object.assign(env, {
      DEEPSEEK_API_KEY: meter.token,
      XDG_CONFIG_HOME: config,
      XDG_DATA_HOME: path.join(directory, 'data'),
      XDG_CACHE_HOME: path.join(directory, 'cache'),
      XDG_STATE_HOME: path.join(directory, 'state'),
      OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
    });
    return {
      ...meter,
      env,
      async close() {
        return { ...(await meter.close()), profileStateBeforeSetup };
      },
    };
  } catch (error) {
    await meter.close();
    throw error;
  }
}
