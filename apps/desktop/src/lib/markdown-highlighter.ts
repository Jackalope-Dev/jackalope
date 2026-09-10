import type { CodeHighlighterPlugin, HighlightResult } from '@streamdown/code';
import type { BundledLanguage } from 'shiki';
import { bundledLanguages, bundledLanguagesInfo } from 'shiki/langs';

const aliases = new Map(
  bundledLanguagesInfo.flatMap((entry) =>
    [entry.id, ...(entry.aliases ?? [])].map((name) => [name, entry.id]),
  ),
);
const languages = bundledLanguagesInfo.map((entry) => entry.id as BundledLanguage);

export function createMarkdownHighlighter() {
  let worker: Worker | undefined;
  const cache = new Map<string, HighlightResult>();
  const pending = new Map<string, Set<(result: HighlightResult) => void>>();
  let cacheSize = 0;
  const dispose = () => {
    worker?.terminate();
    worker = undefined;
    cache.clear();
    pending.clear();
    cacheSize = 0;
  };
  const plugin: CodeHighlighterPlugin = {
    name: 'shiki',
    type: 'code-highlighter',
    getSupportedLanguages: () => languages,
    getThemes: () => ['github-light', 'github-dark'],
    supportsLanguage: (language) => aliases.has(language.trim().toLowerCase()),
    highlight(options, callback) {
      const key = JSON.stringify(options);
      const cached = cache.get(key);
      if (cached) return cached;
      if (!callback) return null;
      const waiting = pending.get(key);
      if (waiting) {
        waiting.add(callback);
        return null;
      }
      try {
        if (!worker) {
          worker = new Worker(new URL('./markdown-highlight.worker.ts', import.meta.url), {
            type: 'module',
          });
          worker.onmessage = (event: MessageEvent<{ key: string; result?: HighlightResult }>) => {
            const { key, result } = event.data;
            const callbacks = pending.get(key);
            pending.delete(key);
            if (!result) return;
            while (cache.size && (cache.size >= 64 || cacheSize + key.length > 512_000)) {
              const oldest = cache.keys().next().value;
              if (oldest === undefined) break;
              cache.delete(oldest);
              cacheSize -= oldest.length;
            }
            cache.set(key, result);
            cacheSize += key.length;
            for (const notify of callbacks ?? []) notify(result);
          };
          worker.onerror = dispose;
        }
        pending.set(key, new Set([callback]));
        const target = worker;
        const language = aliases.get(options.language.trim().toLowerCase()) as
          | BundledLanguage
          | undefined;
        void (language ? bundledLanguages[language]() : Promise.resolve([]))
          .then((grammar) => {
            if (target === worker)
              target.postMessage({ key, options, language: language ?? 'text', grammar });
          })
          .catch(() => pending.delete(key));
      } catch {
        dispose();
      }
      return null;
    },
  };
  return { plugin, dispose };
}
