import { authorized } from './auth';
import { forkPrefix, REPO_NAME, type SwarmResult } from './names';
import { Swarm } from './swarm';

export { Swarm };

/**
 * Jackalope Swarm: a coordinator for many agents working on one Artifacts
 * repository at once. Each attempt gets its own fork; every push is diffed
 * against the attempt's starting commit and compared with every other active
 * fork, so overlapping edits surface while agents are still working.
 *
 * `/health` is public and reports the bundle version Jackalope deployed, if any.
 * Other routes require `Authorization: Bearer <SWARM_TOKEN>`:
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

const reply = <T>(result: SwarmResult<T>, status = 200) =>
  result.ok ? json(result.value, status) : json({ error: result.error }, result.status);

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, version: env.SWARM_VERSION ?? null });
    if (!(await authorized(request, env.SWARM_TOKEN)))
      return json({ error: 'Send the swarm token as a bearer token.' }, 401);
    const match =
      /^\/v1\/swarms\/([^/]+)(?:\/(live|forks)(?:\/([^/]+)(?:\/(analyze|token))?)?)?$/.exec(
        url.pathname,
      );
    if (!match) return json({ error: 'Not found.' }, 404);
    const [, repo, section, fork, action] = match;
    if (!REPO_NAME.test(repo) || (fork && !REPO_NAME.test(fork)))
      return json({ error: 'Invalid name.' }, 400);
    if (fork && !fork.startsWith(forkPrefix(repo)))
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
      if (!section && request.method === 'GET') return reply(await swarm.state(repo));
      if (section === 'forks' && !fork && request.method === 'POST')
        return reply(await swarm.register(repo, await body(request)), 201);
      if (fork && action === 'analyze' && request.method === 'POST')
        return reply(await swarm.analyze(repo, fork));
      if (fork && action === 'token' && request.method === 'POST')
        return reply(await swarm.token(fork));
      if (fork && !action && request.method === 'DELETE')
        return reply(await swarm.release(repo, fork, url.searchParams.get('delete') === '1'));
      return json({ error: 'Not found.' }, 404);
    } catch (cause) {
      return json({ error: cause instanceof Error ? cause.message : String(cause) }, 502);
    }
  },
} satisfies ExportedHandler<Env>;
