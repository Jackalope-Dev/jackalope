/**
 * Signup emails a confirmation link to whatever address it is given. Reserved
 * test domains can never receive it, and throwaway inbox domains are where
 * signup bots collect it, so the signup route accepts these addresses without
 * storing them or sending anything.
 *
 * A listed domain also covers its subdomains: bots rotate random labels such as
 * `0tm.sablereels.com` and `iis.sablereels.com` under one throwaway domain.
 */
const RESERVED_TLDS = new Set(['test', 'invalid', 'example', 'localhost', 'local']);
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];

/** Seen in Jackalope signup abuse, plus widely used disposable inbox services. */
const THROWAWAY_DOMAINS = [
  'brimac.net',
  'euploading.com',
  'gloatinggoat.com',
  'repairhubde.com',
  'sablereels.com',
  '10minutemail.com',
  '10minutemail.net',
  '1secmail.com',
  '1secmail.net',
  '1secmail.org',
  'burnermail.io',
  'discard.email',
  'dispostable.com',
  'dropmail.me',
  'emailondeck.com',
  'fakeinbox.com',
  'getnada.com',
  'grr.la',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.info',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'nada.email',
  'pokemail.net',
  'sharklasers.com',
  'spam4.me',
  'spamgourmet.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempmail.net',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'tmpmail.net',
  'tmpmail.org',
  'trashmail.com',
  'trashmail.de',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
];
const BLOCKED_DOMAINS = new Set([...RESERVED_DOMAINS, ...THROWAWAY_DOMAINS]);

/** Whether signup should drop this (already normalized) address without emailing it. */
export function blockedSignupEmail(email: string) {
  const labels = email
    .slice(email.lastIndexOf('@') + 1)
    .toLowerCase()
    .replace(/\.$/, '')
    .split('.');
  if (RESERVED_TLDS.has(labels.at(-1) ?? '')) return true;
  return labels.some((_, index) => BLOCKED_DOMAINS.has(labels.slice(index).join('.')));
}
