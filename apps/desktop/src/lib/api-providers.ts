export const apiProviders = [
  { id: 'deepseek', name: 'DeepSeek', key: 'DEEPSEEK_API_KEY' },
  { id: 'openrouter', name: 'OpenRouter', key: 'OPENROUTER_API_KEY' },
  { id: 'openai', name: 'OpenAI', key: 'OPENAI_API_KEY' },
  { id: 'anthropic', name: 'Anthropic', key: 'ANTHROPIC_API_KEY' },
  { id: 'google', name: 'Google Gemini', key: 'GEMINI_API_KEY' },
  { id: 'xai', name: 'xAI', key: 'XAI_API_KEY' },
  { id: 'groq', name: 'Groq', key: 'GROQ_API_KEY' },
  { id: 'mistral', name: 'Mistral', key: 'MISTRAL_API_KEY' },
] as const;

export type ApiProvider = (typeof apiProviders)[number];
