/**
 * Local checks for the host connection form. Each mirrors the rule the native side applies
 * when pairing (src-tauri/src/commands/remote), so a field can say what will be refused before
 * anything is sent. The other computer still decides whether a code is current.
 */

export interface FieldCheckResult {
  tone: 'ok' | 'pending' | 'error' | 'info';
  message: string;
}

/** pairing::SHORT_ALPHABET: Crockford base32, without I, L, O and U. */
const SHORT_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SHORT_LENGTH = 10;
/** A pairing link carries a 64-character hex code instead. */
const LINK_LENGTH = 64;

const compact = (value: string) => value.replace(/[\s-]/g, '');

/** pairing_code reads look-alike letters as digits. */
const readAsHost = (value: string) => value.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');

/**
 * The code as it reads best while being typed: a short code in capitals grouped as
 * ABCDE-FGHJK. Anything longer is left as typed, since it may be a link's hex code.
 */
export function formatPairingCode(value: string): string {
  const code = compact(value);
  if (code.length > SHORT_LENGTH || !/^[a-z0-9]*$/i.test(code)) return value;
  const upper = code.toUpperCase();
  return upper.length > 5 ? `${upper.slice(0, 5)}-${upper.slice(5)}` : upper;
}

export function checkPairingCode(value: string): FieldCheckResult | null {
  const code = compact(value);
  if (!code) return null;
  if (code.length > SHORT_LENGTH) {
    if (!/^[0-9a-f]+$/i.test(code))
      return { tone: 'error', message: 'Pairing codes are 10 characters, like ABCDE-FGHJK.' };
    return code.length === LINK_LENGTH
      ? { tone: 'ok', message: 'That’s a pairing link code. The other computer checks it next.' }
      : { tone: 'pending', message: `Link code: ${code.length} of ${LINK_LENGTH} characters` };
  }
  const unused = [...new Set([...readAsHost(code)].filter((c) => !SHORT_ALPHABET.includes(c)))];
  if (unused.length)
    return {
      tone: 'error',
      message: `Pairing codes don’t use ${unused.map((c) => `“${c}”`).join(', ')}.`,
    };
  return code.length < SHORT_LENGTH
    ? { tone: 'pending', message: `${code.length} of ${SHORT_LENGTH} characters` }
    : { tone: 'ok', message: 'Looks right. The other computer checks it when you connect.' };
}

/** transport::ssh_alias: an SSH config alias or user@hostname, with no options or commands. */
export function checkSshAlias(value: string): FieldCheckResult | null {
  const alias = value.trim();
  if (!alias) return null;
  if (alias.length > 200 || alias.startsWith('-') || !/^[A-Za-z0-9._@-]+$/.test(alias))
    return {
      tone: 'error',
      message: 'Use an SSH configuration alias or user@hostname, without spaces or symbols.',
    };
  return { tone: 'ok', message: `Connects the way \`ssh ${alias}\` does from your terminal.` };
}

/** remote::origin: an https origin without a path, credentials, query or fragment. */
export function checkHttpsOrigin(value: string): FieldCheckResult | null {
  const address = value.trim();
  if (!address) return null;
  if (!address.includes('://')) return { tone: 'info', message: 'Start with https://' };
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { tone: 'error', message: 'Enter the HTTPS address for this host.' };
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    return { tone: 'error', message: 'Use an HTTPS origin without a path, credentials or query.' };
  return { tone: 'ok', message: `Connects to ${url.host}.` };
}

/** How remote screens name the computer they run on. */
export function thisComputerLabel(platform = globalThis.navigator?.platform ?? ''): string {
  return /Mac/i.test(platform) ? 'This Mac' : /Win/i.test(platform) ? 'This PC' : 'This computer';
}
