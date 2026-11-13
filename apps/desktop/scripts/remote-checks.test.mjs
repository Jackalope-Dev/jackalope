import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkHttpsOrigin,
  checkPairingCode,
  checkSshAlias,
  formatPairingCode,
} from '../src/lib/remote-checks.ts';

test('pairing codes group as they are typed and longer link codes stay as typed', () => {
  assert.equal(formatPairingCode('abc'), 'ABC');
  assert.equal(formatPairingCode('abcdefg'), 'ABCDE-FG');
  assert.equal(formatPairingCode(' abcde fghjk '), 'ABCDE-FGHJK');
  assert.equal(formatPairingCode('ABCDE-FGHJK'), 'ABCDE-FGHJK');
  const link = 'a'.repeat(20);
  assert.equal(formatPairingCode(link), link);
});

test('pairing code checks follow the host: look-alikes read as digits, U is never used', () => {
  assert.equal(checkPairingCode(''), null);
  assert.equal(checkPairingCode('ABC').tone, 'pending');
  assert.equal(checkPairingCode('ABCDE-FGHJK').tone, 'ok');
  // The host reads O as 0 and I or L as 1, so these are valid.
  assert.equal(checkPairingCode('O1LI2-ABCDE').tone, 'ok');
  assert.equal(checkPairingCode('UUUUU').tone, 'error');
  assert.match(checkPairingCode('ABC!D').message, /“!”/);
  assert.equal(checkPairingCode('f'.repeat(64)).tone, 'ok');
  assert.equal(checkPairingCode('f'.repeat(30)).tone, 'pending');
  assert.equal(checkPairingCode('z'.repeat(30)).tone, 'error');
});

test('SSH aliases follow the native rule against options and commands', () => {
  assert.equal(checkSshAlias(''), null);
  assert.equal(checkSshAlias('dev@build-host').tone, 'ok');
  for (const bad of ['-oProxyCommand=evil', 'host;command', 'host command', '$(command)'])
    assert.equal(checkSshAlias(bad).tone, 'error', bad);
});

test('HTTPS addresses must be a bare https origin', () => {
  assert.equal(checkHttpsOrigin(''), null);
  assert.equal(checkHttpsOrigin('workstation').tone, 'info');
  assert.equal(checkHttpsOrigin('https://workstation:8443').tone, 'ok');
  assert.equal(checkHttpsOrigin('https://workstation:8443/').tone, 'ok');
  for (const bad of ['http://workstation', 'https://a/b', 'https://u:p@a', 'https://a?x=1'])
    assert.equal(checkHttpsOrigin(bad).tone, 'error', bad);
});
