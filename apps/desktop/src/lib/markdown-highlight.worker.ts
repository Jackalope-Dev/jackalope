import type { HighlightOptions } from '@streamdown/code';
import { createHighlighterCore, type LanguageRegistration } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import dark from 'shiki/themes/github-dark.mjs';
import light from 'shiki/themes/github-light.mjs';

const highlighter = createHighlighterCore({
  themes: [light, dark],
  langs: [],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
});
self.onmessage = async (
  event: MessageEvent<{
    key: string;
    options: HighlightOptions;
    language: string;
    grammar: LanguageRegistration[];
  }>,
) => {
  const { key, options, language, grammar } = event.data;
  try {
    const instance = await highlighter;
    if (grammar.length && !instance.getLoadedLanguages().includes(language))
      await instance.loadLanguage(grammar);
    const [light, dark] = options.themes;
    const result = instance.codeToTokens(options.code, {
      lang: language,
      themes: {
        light: typeof light === 'string' ? light : (light.name ?? 'github-light'),
        dark: typeof dark === 'string' ? dark : (dark.name ?? 'github-dark'),
      },
    });
    self.postMessage({ key, result });
  } catch {
    self.postMessage({ key, error: true });
  }
};
