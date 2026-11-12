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
  /** The local port Tailscale Serve sends HTTPS port 8443 to, when it's a plain local proxy. */
  servePort?: number;
  /** The port Remote access listens on here, sent alongside `servePort`. */
  listenPort?: number;
}

/**
 * Tailscale Serve already proxies HTTPS to another local port than this Jackalope listens
 * on, often another Jackalope profile or one that isn't running, so phones get a 502.
 */
export function servePortMismatch(status: TailscaleStatus | null) {
  if (!status?.servePort || !status.listenPort || status.servePort === status.listenPort)
    return null;
  return { serves: status.servePort, listens: status.listenPort };
}

/**
 * The page Tailscale names for turning on a feature it needs, such as Serve, taken from
 * its own message. Only Tailscale's sign-in site is trusted as a link.
 */
export function tailscaleEnableLink(message: string) {
  const match = message.match(/https:\/\/login\.tailscale\.com\/[^\s"'<>)]+/);
  return match ? match[0].replace(/[.,;]+$/, '') : null;
}
