import { expect, it } from 'vitest';
import { blockedSignupEmail } from '../src/access/signup-domains';

it('blocks reserved test domains and throwaway domains with any subdomain', () => {
  for (const email of [
    'a@example.com',
    'a@example.net',
    'a@example.org',
    'a@mail.example.com',
    'a@anything.test',
    'a@host.invalid',
    'a@iis.sablereels.com',
    'a@iih.sablereels.com',
    'a@3od.repairhubde.com',
    'a@d4k.gloatinggoat.com',
    'a@oas.brimac.net',
    'a@euploading.com',
    'a@yopmail.com',
    'a@example.com.',
  ])
    expect(blockedSignupEmail(email), email).toBe(true);
});

it('allows ordinary domains, including ones that only resemble blocked names', () => {
  for (const email of [
    'a@gmail.com',
    'a@pm.me',
    'a@cs.example.edu',
    'a@notexample.com',
    'a@example.co',
    'a@sablereels.com.au',
    'a@mysablereels.com',
    'a@testing.dev',
  ])
    expect(blockedSignupEmail(email), email).toBe(false);
});
