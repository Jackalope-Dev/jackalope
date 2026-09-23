import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const definitions = [
  [
    'preview-port',
    'preview-url.ts',
    'port < 1024',
    'port < 1',
    'Reject preview ports below 1024 and above 65535, noninteger ports, and unsafe paths.',
    "assert.equal(m.previewUrl(81,'/'),null); assert.equal(m.previewUrl(1024,'/'),'http://127.0.0.1:1024/');",
  ],
  [
    'preview-escape',
    'preview-url.ts',
    "encodeURI(path).replace(/%25([\\da-f]{2})/gi, '%$1')",
    'encodeURI(path)',
    'Preserve existing percent escapes in preview URLs while encoding literal spaces and Unicode.',
    "assert.equal(m.previewUrl(5180,'/a%20b'),'http://127.0.0.1:5180/a%20b'); assert.equal(m.previewUrl(5180,'/a b'),'http://127.0.0.1:5180/a%20b');",
  ],
  [
    'preview-network-path',
    'preview-url.ts',
    "path.startsWith('//')",
    "path.startsWith('///')",
    'Reject every network-path reference, including //localhost, without changing valid local preview paths.',
    "assert.equal(m.previewUrl(5180,'//localhost/a'),null); assert.equal(m.previewUrl(5180,'//127.0.0.1:5180/a'),null);",
  ],
  [
    'endpoint-credentials',
    'mcp-endpoint.ts',
    '!url.username &&',
    'true &&',
    'Reject MCP endpoint URLs containing a username, including URLs without a password.',
    "assert.ok(m.mcpEndpointError('https://user@example.com/mcp')); assert.equal(m.mcpEndpointError('https://example.com/mcp'),undefined);",
  ],
  [
    'endpoint-fragments',
    'mcp-endpoint.ts',
    '!url.hash &&',
    'true &&',
    'Reject MCP endpoint URLs containing a fragment and preserve query parameters.',
    "assert.ok(m.mcpEndpointError('https://example.com/mcp#token')); assert.equal(m.mcpEndpointError('https://example.com/mcp?x=1'),undefined);",
  ],
  [
    'endpoint-loopback',
    'mcp-endpoint.ts',
    "url.protocol === 'http:' && local",
    "url.protocol === 'http:'",
    'Allow HTTP MCP endpoints only on localhost or loopback IP addresses. HTTPS remote endpoints remain valid.',
    "assert.ok(m.mcpEndpointError('http://example.com/mcp')); assert.equal(m.mcpEndpointError('http://127.0.0.1:8080/mcp'),undefined);",
  ],
  [
    'signin-credentials',
    'sign-in-links.ts',
    '!url.username &&',
    'true &&',
    'Sign-in links must reject URLs containing a username, including URLs without passwords, and reject HTTP.',
    "assert.equal(m.signInUrl('https://user@example.com/login'),null); assert.equal(m.signInUrl('http://example.com'),null);",
  ],
  [
    'signin-exact-host',
    'sign-in-links.ts',
    '.includes(url.hostname)',
    '.some(host => url.hostname.endsWith(host))',
    'Claude authorization links must use an exact approved hostname. Reject lookalike prefix hosts.',
    "assert.equal(m.isClaudeAuthorizationUrl('https://evilclaude.ai/oauth/authorize'),false); assert.equal(m.isClaudeAuthorizationUrl('https://claude.ai/oauth/authorize'),true);",
  ],
  [
    'signin-port',
    'sign-in-links.ts',
    "url.port === ''",
    'true',
    'Reject Claude authorization URLs with a nondefault port while accepting ordinary HTTPS authorization URLs.',
    "assert.equal(m.isClaudeAuthorizationUrl('https://claude.ai:8443/oauth/authorize'),false); assert.equal(m.isClaudeAuthorizationUrl('https://claude.ai/oauth/authorize'),true);",
  ],
  [
    'title-saved',
    'task-title.ts',
    'return savedTitle.trim();',
    'return firstLine;',
    'Preserve an explicitly saved title that differs from the automatically truncated first prompt line.',
    "assert.equal(m.taskTitle('Build navigation','  Navigation polish  '),'Navigation polish');",
  ],
  [
    'title-limit',
    'task-title.ts',
    'words.slice(0, 10)',
    'words.slice(0, 20)',
    'Generated task titles must contain at most ten words while preserving saved user titles.',
    "assert.equal(m.taskTitle('Build alpha beta gamma delta epsilon zeta eta theta iota kappa lambda').split(' ').length,10);",
  ],
  [
    'title-empty',
    'task-title.ts',
    "'Untitled task'",
    "''",
    'Return Untitled task when the request is empty or contains only a Markdown heading label.',
    "assert.equal(m.taskTitle('  '),'Untitled task'); assert.equal(m.taskTitle('# Task'),'Untitled task');",
  ],
  [
    'impact-unresolved',
    'codebase-impact.ts',
    "reference.status !== 'resolved'",
    "reference.status === 'missing'",
    'Dependency impact must follow only resolved references; ambiguous references must not create dependents.',
    "assert.deepEqual(m.affectedFiles({references:[{source:'a',target:'b',status:'ambiguous'}]},['b']),[]);",
  ],
  [
    'impact-transitive',
    'codebase-impact.ts',
    'index < queue.length',
    'index < changed.length',
    'Return all transitive reverse dependents of changed files, sorted, with the original changed files excluded.',
    "assert.deepEqual(m.affectedFiles({references:[{source:'b',target:'a',status:'resolved'},{source:'c',target:'b',status:'resolved'}]},['a']),['b','c']);",
  ],
  [
    'impact-direction',
    'codebase-impact.ts',
    'reverse.set(reference.target, sources)',
    'reverse.set(reference.source, sources)',
    'Impact analysis must traverse from a changed imported file to its importers, not from importers to imports.',
    "assert.deepEqual(m.affectedFiles({references:[{source:'a',target:'b',status:'resolved'}]},['b']),['a']); assert.deepEqual(m.affectedFiles({references:[{source:'a',target:'b',status:'resolved'}]},['a']),[]);",
  ],
  [
    'cache-inflight',
    'read-cache.ts',
    'if (previous.pending) return previous.pending;',
    'if (false) return previous.pending!;',
    'Concurrent reads of the same cache key must share one in-flight loader, with both callers receiving its result.',
    "const c=m.createReadCache(1000); let calls=0, finish; const loader=()=>{calls++; return new Promise(r=>finish=r)}; const a=c.read('k',loader),b=c.read('k',loader); assert.equal(calls,1); finish(7); assert.deepEqual(await Promise.all([a,b]),[7,7]);",
  ],
  [
    'cache-expiry',
    'read-cache.ts',
    'Date.now() - previous.updatedAt < ttl',
    'true',
    'Cached values must expire at the TTL boundary; zero TTL always reloads after completion.',
    "const c=m.createReadCache(0); assert.equal(await c.read('k',()=>Promise.resolve(1)),1); assert.equal(await c.read('k',()=>Promise.resolve(2)),2);",
  ],
  [
    'cache-force',
    'read-cache.ts',
    'if (force) previous?.controller.abort();',
    'if (false) previous?.controller.abort();',
    'A forced cache read must abort the previous in-flight loader and retain only the newer result.',
    "const c=m.createReadCache(1000); let signal,finish; const old=c.read('k',s=>{signal=s;return new Promise(r=>finish=r)}); assert.equal(await c.read('k',()=>Promise.resolve(2),true),2); assert.equal(signal.aborted,true); finish(1); await old; assert.equal(c.peek('k'),2);",
  ],
  [
    'cache-clear',
    'read-cache.ts',
    'for (const entry of entries.values()) entry.controller.abort();',
    'for (const entry of entries.values()) void entry;',
    'Clearing the read cache must abort all pending loaders and leave no cached values after their eventual completion.',
    "const c=m.createReadCache(1000); let signal,finish; const p=c.read('k',s=>{signal=s; return new Promise(r=>finish=r)}); c.clear(); assert.equal(signal.aborted,true); finish(1); await p; assert.equal(c.peek('k'),undefined);",
  ],
  [
    'cache-limit',
    'read-cache.ts',
    'entries.size > limit',
    'entries.size > limit + 1',
    'Enforce the configured cache entry limit; evict and abort the oldest pending entry when capacity is exceeded.',
    "const c=m.createReadCache(1000,1); let signal,finish; const p=c.read('old',s=>{signal=s; return new Promise(r=>finish=r)}); await c.read('new',()=>Promise.resolve(2)); assert.equal(signal.aborted,true); finish(1); await p; assert.equal(c.peek('old'),undefined); assert.equal(c.peek('new'),2);",
  ],
];

export async function repositoryCases(revision = 'HEAD') {
  const root = new URL('../../', import.meta.url);
  const commit = execFileSync('git', ['rev-parse', revision], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  return Promise.all(
    definitions.map(async ([id, filename, before, after, requirement, checks]) => {
      const sourcePath = `apps/desktop/src/lib/${filename}`;
      const original = execFileSync('git', ['show', `${commit}:${sourcePath}`], {
        cwd: root,
        encoding: 'utf8',
      });
      if (original.split(before).length !== 2) throw new Error(`Mutation must match once: ${id}`);
      const broken = original.replace(before, after);
      const test = `import assert from 'node:assert/strict'; import * as m from './${filename}';\n${checks}\n`;
      const files = {
        [filename]: broken,
        'contract.test.mjs': test,
        'package.json': '{"type":"module"}\n',
        'README.md': `Repository-derived seeded defect from Jackalope.\n${requirement}\n`,
        LICENSE: await readFile(new URL('LICENSE', root), 'utf8'),
      };
      const protectedFiles = Object.fromEntries(
        Object.entries(files).filter(([name]) => name !== filename),
      );
      const shared =
        filename === 'read-cache.ts'
          ? "const clean=m.createReadCache(1000); assert.equal(await clean.read('v',()=>Promise.resolve(0)),0); assert.equal(clean.peek('v'),0); clean.clear(); assert.equal(clean.peek('v'),undefined);"
          : '';
      return {
        id: `repo-${id}`,
        category: filename.replace('.ts', ''),
        split: ['codebase-impact.ts', 'read-cache.ts'].includes(filename) ? 'holdout' : 'train',
        source: {
          repository: 'Jackalope-Dev/jackalope',
          revision: commit,
          path: sourcePath,
          sha256: createHash('sha256').update(original).digest('hex'),
          kind: 'seeded-defect',
          family: filename,
        },
        prompt: `${requirement} Fix ${filename}. Preserve unrelated behavior and existing exports. Do not edit contract.test.mjs or other files. Run node --test contract.test.mjs after implementation. Leave changes uncommitted.`,
        files,
        check: 'node --test contract.test.mjs',
        allowedFiles: [filename],
        referenceFiles: { [filename]: original },
        oracle: `const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');const root=process.argv[2];(async()=>{const m=await import(pathToFileURL(path.join(root,${JSON.stringify(filename)}))); ${checks} ${shared} for(const [name,text] of Object.entries(${JSON.stringify(protectedFiles)})) assert.equal(fs.readFileSync(path.join(root,name),'utf8'),text); assert.deepEqual(fs.readdirSync(root).filter(n=>n!=='.git').sort(),${JSON.stringify(Object.keys(files).sort())});})().catch(e=>{console.error(e);process.exitCode=1});`,
      };
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Supply an output suite path.');
  await writeFile(
    process.argv[2],
    `${JSON.stringify({ cases: await repositoryCases(process.argv[3]) }, null, 2)}\n`,
  );
}
