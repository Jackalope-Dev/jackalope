// Secrets are not in the generated types: set SWARM_TOKEN with `wrangler secret put`.
interface Env {
  SWARM_TOKEN?: string;
  /** Set by Jackalope's one-click setup to the version of the bundle it uploaded. */
  SWARM_VERSION?: string;
}
