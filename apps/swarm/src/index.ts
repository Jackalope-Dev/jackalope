import { authorized } from './auth';
import { SwarmError } from './names';
import { Swarm } from './swarm';

export { Swarm };

/**
 * Jackalope Swarm: a coordinator for many agents working on one Artifacts
 * repository at once. Each attempt gets its own fork; every push is diffed
 * against the attempt's starting commit and compared with every other active
 * fork, so overlapping edits surface while agents are still working.
 *
 * Routes (all require `Authorization: Bearer <SWARM_TOKEN>`):
 *   GET    /v1/swarms/:repo                         live state
 *   GET    /v1/swarms/:repo/live                    WebSocket of state changes
 *   POST   /v1/swarms/:repo/forks                   fork for a new attempt
 *   POST   /v1/swarms/:repo/forks/:fork/analyze     re-read a fork after a push
 *   POST   /v1/swarms/:repo/forks/:fork/token       fresh push token
 *   DELETE /v1/swarms/:repo/forks/:fork?delete=1    stop tracking (and delete) a fork
 */

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true });
    if (!(await authorized(request, env.SWARM_TOKEN)))
      return json({ error: 'Send the swarm token as a bearer token.' }, 401);
    const match =
      /^\/v1\/swarms\/([^/]+)(?:\/(live|forks)(?:\/([^/]+)(?:\/(analyze|token))?)?)?$/.exec(
        url.pathname,
      );
    if (!match) return json({ error: 'Not found.' }, 404);
    const [, repo, section, fork, action] = match;
    if (!NAME.test(repo) || (fork && !NAME.test(fork)))
      return json({ error: 'Invalid name.' }, 400);
    if (fork && !fork.startsWith(`${repo.slice(0, 80)}--`))
      return json({ error: 'That fork does not belong to this repository.' }, 400);
    const namespace = env.SWARM as DurableObjectNamespace<Swarm>;
    const swarm = namespace.get(namespace.idFromName(repo));
    try {
      if (section === 'live') {
        if (request.headers.get('Upgrade') !== 'websocket')
          return json({ error: 'Expected a WebSocket upgrade.' }, 426);
        return swarm.fetch(
          new Request(`https://swarm/live?repo=${encodeURIComponent(repo)}`, request),
        );
      }
      if (!section && request.method === 'GET') return json(await swarm.state(repo));
      if (section === 'forks' && !fork && request.method === 'POST')
        return json(await swarm.register(repo, await body(request)), 201);
      if (fork && action === 'analyze' && request.method === 'POST')
        return json(await swarm.analyze(repo, fork));
      if (fork && action === 'token' && request.method === 'POST')
        return json(await swarm.token(fork));
      if (fork && !action && request.method === 'DELETE')
        return json(await swarm.release(repo, fork, url.searchParams.get('delete') === '1'));
      return json({ error: 'Not found.' }, 404);
    } catch (cause) {
      // Durable Object RPC keeps the message but not custom fields.
      const message = cause instanceof Error ? cause.message : String(cause);
      const known =
        cause instanceof SwarmError || /^(Unknown|Send|Use|That|The fork)/.test(message);
      if (/^Unknown fork|not found/i.test(message)) return json({ error: message }, 404);
      return json({ error: message }, known ? 400 : 502);
    }
  },
} satisfies ExportedHandler<Env>;
