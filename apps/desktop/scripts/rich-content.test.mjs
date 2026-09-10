import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePatchFiles } from '@pierre/diffs';
import { code } from '@streamdown/code';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Streamdown } from 'streamdown';
import { ResultImage } from '../src/lib/result-images.ts';

test('untrusted Markdown images never load until explicitly opened', () => {
  let opened;
  const onOpenLink = (url) => { opened = url; };
  const html = renderToStaticMarkup(createElement(Streamdown, {
    skipHtml: true, mode: 'static',
    components: {img: (props) => createElement(ResultImage, {...props, onOpenLink})},
  }, '![diagram](https://example.invalid/pixel?data=synthetic)'));
  assert.doesNotMatch(html, /<img|<iframe|<link|src=/);
  assert.match(html, /Open image: diagram/);
  assert.equal(opened, undefined);
  const button = ResultImage({src: 'https://example.invalid/diagram', onOpenLink});
  button.props.onClick();
  assert.equal(opened, 'https://example.invalid/diagram');
  for (const src of ['javascript:alert(1)', 'data:image/svg+xml,synthetic', 'file:///etc/passwd']) {
    assert.equal(ResultImage({src, onOpenLink}).type, 'span');
  }
});

test('highlighting preserves middle edits in equal-length code blocks', async () => {
  const first = `// ${'a'.repeat(110)}\nconst value = 1;\n// ${'z'.repeat(110)}`;
  const second = first.replace('value = 1', 'value = 2');
  const highlight = (text) =>
    new Promise((resolve) => {
      const cached = code.highlight(
        { code: text, language: 'typescript', themes: ['github-light', 'github-dark'] },
        resolve,
      );
      if (cached) resolve(cached);
    });
  const original = await highlight(first);
  const edited = await highlight(second);
  const text = (result) =>
    result.tokens.map((line) => line.map((token) => token.content).join('')).join('\n');
  assert.equal(text(original), first);
  assert.equal(text(edited), second);
  assert.notDeepEqual(original.tokens, edited.tokens);
});

test('diff parsing retains rename metadata and every line in large patches', () => {
  const renamed =
    'diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n';
  const entries = parsePatchFiles(renamed, undefined, true).flatMap((patch) => patch.files);
  assert.equal(entries[0].name, 'new.ts');
  assert.equal(entries[0].prevName, 'old.ts');
  const patch = `diff --git a/large.ts b/large.ts\nnew file mode 100644\n--- /dev/null\n+++ b/large.ts\n@@ -0,0 +1,10000 @@\n${Array.from({ length: 10000 }, (_, i) => `+export const value${i} = ${i};`).join('\n')}\n`;
  const large = parsePatchFiles(patch, undefined, true)[0].files[0];
  assert.equal(large.unifiedLineCount, 10000);
  assert.equal(large.additionLines.length, 10000);
  assert.match(large.additionLines.at(-1), /value9999 = 9999/);
});
