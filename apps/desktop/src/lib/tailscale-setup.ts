/** Where private HTTPS setup stands, as `remote_tailscale_status` reports it. */
export interface TailscaleStatus {
  installed: boolean;
  signedIn: boolean;
  magicDns: boolean;
  https: boolean;
  /** Phones and tablets signed in to the same tailnet. */
  phones: string[];
  /** Tailscale's own message when it could not report status. */
  error: string | null;
}

/**
 * The page Tailscale names for turning on a feature it needs, such as Serve, taken from
 * its own message. Only Tailscale's sign-in site is trusted as a link.
 */
export function tailscaleEnableLink(message: string) {
  const match = message.match(/https:\/\/login\.tailscale\.com\/[^\s"'<>)]+/);
  return match ? match[0].replace(/[.,;]+$/, '') : null;
}
