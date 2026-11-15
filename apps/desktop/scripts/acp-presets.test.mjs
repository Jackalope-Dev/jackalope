import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACP_PRESETS,
  orderedPresets,
  presetCommandNames,
  presetPath,
  splitArguments,
} from '../src/lib/acp-presets.ts';

test('presets carry launchable arguments and unique identities', () => {
  assert.equal(new Set(ACP_PRESETS.map((preset) => preset.id)).size, ACP_PRESETS.length);
  for (const preset of ACP_PRESETS) {
    // The native launch accepts 1 to 8 arguments of up to 80 characters.
    assert.ok(preset.args.length >= 1 && preset.args.length <= 8, preset.id);
    assert.ok(preset.args.every((arg) => arg && arg.length <= 80));
    assert.ok(preset.url.startsWith('https://'), preset.id);
    for (const name of [...preset.binaries, ...(preset.windowsBinaries ?? [])])
      assert.match(name, /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/);
  }
});

test('Windows looks for the command that is not the command prompt', () => {
  assert.ok(presetCommandNames(false).includes('cmd'));
  assert.ok(!presetCommandNames(true).includes('cmd'));
  assert.ok(presetCommandNames(true).includes('cmdc'));
  const commandCode = ACP_PRESETS.find((preset) => preset.id === 'command-code');
  assert.equal(presetPath(commandCode, { cmd: 'C:/Windows/cmd.exe' }, true), undefined);
  assert.equal(presetPath(commandCode, { cmdc: 'C:/npm/cmdc.cmd' }, true), 'C:/npm/cmdc.cmd');
});

test('installed presets lead the list', () => {
  const ordered = orderedPresets({ goose: '/usr/local/bin/goose' }, false);
  assert.equal(ordered[0].id, 'goose');
  assert.equal(ordered.length, ACP_PRESETS.length);
  assert.deepEqual(
    orderedPresets({}, false).map((preset) => preset.id),
    ACP_PRESETS.map((preset) => preset.id),
  );
});

test('arguments keep quoted values together', () => {
  assert.deepEqual(splitArguments('  --profile acp '), ['--profile', 'acp']);
  assert.deepEqual(splitArguments('--config "C:/My Tools/a.json" \'x y\''), [
    '--config',
    'C:/My Tools/a.json',
    'x y',
  ]);
  assert.deepEqual(splitArguments(''), []);
});
