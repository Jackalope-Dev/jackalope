/**
 * Advice on a pasted API key from the prefixes providers publish. It never blocks a key:
 * formats change, and the real check is the connection itself.
 */
const PREFIXES: Record<string, { name: string; prefixes: string[] }> = {
  ANTHROPIC_API_KEY: { name: 'Anthropic', prefixes: ['sk-ant-'] },
  OPENROUTER_API_KEY: { name: 'OpenRouter', prefixes: ['sk-or-'] },
  OPENAI_API_KEY: { name: 'OpenAI', prefixes: ['sk-'] },
  DEEPSEEK_API_KEY: { name: 'DeepSeek', prefixes: ['sk-'] },
  GEMINI_API_KEY: { name: 'Google Gemini', prefixes: ['AIza'] },
  XAI_API_KEY: { name: 'xAI', prefixes: ['xai-'] },
  GROQ_API_KEY: { name: 'Groq', prefixes: ['gsk_'] },
};

export interface KeyAdvice {
  tone: 'ok' | 'info' | 'error';
  message: string;
}

/** `envKey` is the provider's key variable, such as ANTHROPIC_API_KEY; others get generic advice. */
export function apiKeyAdvice(envKey: string | undefined, value: string): KeyAdvice | undefined {
  const key = value.trim();
  if (!key) return undefined;
  if (/\s/.test(key))
    return {
      tone: 'error',
      message: 'The key has a space or line break inside it. Paste it again on its own.',
    };
  const known = envKey ? PREFIXES[envKey] : undefined;
  if (known && !known.prefixes.some((prefix) => key.startsWith(prefix)))
    return {
      tone: 'info',
      message: `${known.name} keys usually start with ${known.prefixes.join(' or ')}. Check you copied the right key.`,
    };
  if (key.length < 20) return { tone: 'info', message: 'That looks short for an API key.' };
  if (value !== key)
    return { tone: 'info', message: 'Spaces at the start or end are part of what you pasted.' };
  return {
    tone: 'ok',
    message: known ? `Looks like a ${known.name} key.` : 'Looks like a complete key.',
  };
}
