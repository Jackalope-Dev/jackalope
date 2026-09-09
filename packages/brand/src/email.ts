import { DEFAULT_THEME, themeTokens } from './tokens.ts';

/**
 * The one palette every Jackalope email uses.
 *
 * Mail clients cannot follow the app's theme, so emails commit to a single
 * editorial surface: warm paper, near-black headings, and exactly one accent.
 * The neutrals are fixed literals; the accent is read from the app's own token
 * pipeline so the button in an email is the same colour as the button in the
 * product. Keep this in step with the Sequenzy email design system.
 */
const action = themeTokens({ ...DEFAULT_THEME, isDark: false, appearance: 'manual' });

export const EMAIL_PALETTE = {
  /** Page behind the message. */
  bg: '#f4f0eb',
  /** The letter itself. */
  surface: '#faf8f6',
  /** Callout panel holding the single action. */
  panel: '#ffffff',
  /** Rules and panel edges. */
  border: '#ded5cc',
  borderSubtle: '#ece5dd',
  /** Headings and the wordmark. */
  ink: '#29241f',
  /** Body copy and footer. */
  muted: '#62584e',
  /** Kickers, stamps, timestamps. Dark enough to clear 4.5:1 on both surfaces. */
  faint: '#756a5f',
  /** The product's action colour, contrast-corrected against white. */
  accent: action['--color-action'],
  onAccent: action['--color-on-action'],
  /** Accent tuned for text on warm paper rather than for a filled button. */
  accentInk: '#4338ca',
} as const;

/** Body stack. Mail clients ignore webfonts often enough to lead with the fallback. */
export const EMAIL_FONT =
  "'Plus Jakarta Sans','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif";

export const EMAIL_COMPANY = {
  product: 'Jackalope',
  legalName: 'Jackalope Digital LLC',
  site: 'https://jackalope.dev',
  companySite: 'https://jackalope.digital',
  /** CAN-SPAM and the Sequenzy footer both require a real postal address. */
  postalAddress: '',
} as const;
