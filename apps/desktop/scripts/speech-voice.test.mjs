import assert from 'node:assert/strict';
import test from 'node:test';
import { bestVoice, isUsableVoice } from '../src/lib/speech-text.ts';

const voice = (name, lang = 'en-US', extra = {}) => ({
  name,
  lang,
  voiceURI: name,
  localService: true,
  default: false,
  ...extra,
});

test('novelty and Eloquence voices are never chosen while a real voice exists', () => {
  const voices = [
    voice('Fred', 'en-US', { default: true }),
    voice('Eddy (English (US))'),
    voice('Samantha'),
  ];
  assert.equal(bestVoice(voices, 'en-US').name, 'Samantha');
  assert.equal(isUsableVoice(voice('Zarvox')), false);
  assert.equal(isUsableVoice(voice('Grandma (English (UK))', 'en-GB')), false);
});

test('premium and neural voices win over the standard ones', () => {
  const voices = [voice('Samantha'), voice('Ava (Premium)'), voice('Zoe (Enhanced)')];
  assert.equal(bestVoice(voices, 'en-US').name, 'Ava (Premium)');
  const windows = [
    voice('Microsoft David - English (United States)'),
    voice('Microsoft Aria Online (Natural) - English (United States)', 'en-US', {
      localService: false,
    }),
  ];
  assert.equal(bestVoice(windows, 'en-US').name, windows[1].name);
});

test("the person's language comes before voice quality", () => {
  const voices = [voice('Ava (Premium)'), voice('Thomas', 'fr-FR')];
  assert.equal(bestVoice(voices, 'fr-FR').name, 'Thomas');
  assert.equal(
    bestVoice([voice('Daniel', 'en_GB'), voice('Thomas', 'fr-FR')], 'en-US').name,
    'Daniel',
  );
});
