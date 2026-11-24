// A stand-in for `codex app-server` (and `codex exec`) for the native session tests.
// Turns replay notifications recorded from Codex 0.156.1 (fixtures/*.jsonl) with this
// process's thread and turn IDs; a prompt keyword picks the turn. Threads persist in
// threads.json beside the script, so a new process resumes them as Codex does from disk.
// Every process, client message and approval answer is logged as JSON lines.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const dir = __dirname;
const log = (file, value) => fs.appendFileSync(path.join(dir, file), `${JSON.stringify(value)}\n`);
const args = process.argv.slice(2);
log('processes.jsonl', { pid: process.pid, args, cwd: process.cwd() });
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const stateFile = path.join(dir, 'threads.json');
const load = () => (fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {});
const save = (threads) => fs.writeFileSync(stateFile, JSON.stringify(threads));

if (args[0] === 'exec') {
  let input = '';
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    log('exec.jsonl', { args, input });
    const resume = args.indexOf('resume');
    send({ type: 'thread.started', thread_id: resume >= 0 ? args[resume + 1] : 'exec-thread' });
    send({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: 'Exec turn done' },
    });
    send({
      type: 'turn.completed',
      usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 },
    });
  });
} else {
  let next = 1000;
  let made = 0;
  const waiting = new Map();
  const ask = (method, params) =>
    new Promise((resolve) => {
      const id = next++;
      waiting.set(id, resolve);
      send({ id, method, params });
    });
  let active = null;
  const id = (kind) => `${kind}-${process.pid}-${++made}`;

  const replay = async (name, thread, turn) => {
    const lines = fs.readFileSync(path.join(dir, name), 'utf8').trim().split('\n');
    const started = lines.map((line) => JSON.parse(line)).find((m) => m.method === 'turn/started');
    const recordedThread = started.params.threadId;
    const recordedTurn = started.params.turn.id;
    for (const line of lines) {
      const message = JSON.parse(
        line.split(recordedThread).join(thread).split(recordedTurn).join(turn),
      );
      if (message.method === undefined) continue;
      if (message.id !== undefined) {
        const reply = await ask(message.method, message.params);
        log('approvals.jsonl', { method: message.method, reply });
      } else send(message);
    }
  };

  const finish = (thread, turn, text) => {
    const item = { type: 'agentMessage', id: `msg-${turn}`, text: '', phase: 'final_answer' };
    send({ method: 'item/started', params: { item, threadId: thread, turnId: turn } });
    send({
      method: 'item/agentMessage/delta',
      params: { threadId: thread, turnId: turn, itemId: item.id, delta: text },
    });
    send({
      method: 'item/completed',
      params: { item: { ...item, text }, threadId: thread, turnId: turn },
    });
    const last = {
      totalTokens: 12,
      inputTokens: 10,
      cachedInputTokens: 4,
      cacheWriteInputTokens: 0,
      outputTokens: 2,
      reasoningOutputTokens: 0,
    };
    send({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: thread,
        turnId: turn,
        tokenUsage: { total: last, last, modelContextWindow: 1000 },
      },
    });
    send({
      method: 'turn/completed',
      params: { threadId: thread, turn: { id: turn, items: [], status: 'completed', error: null } },
    });
  };

  const approve = async (thread, turn, method, params) => {
    const reply = await ask(method, { threadId: thread, turnId: turn, startedAtMs: 0, ...params });
    log('approvals.jsonl', { method, reply });
    return reply;
  };

  const turnStarted = (thread, turn) =>
    send({
      method: 'turn/started',
      params: {
        threadId: thread,
        turn: { id: turn, items: [], status: 'inProgress', error: null },
      },
    });

  const run = async (thread, turn, text) => {
    if (text.includes('APPROVE')) return replay('turn-approval.jsonl', thread, turn);
    if (text.includes('FAIL')) return replay('turn-failed.jsonl', thread, turn);
    turnStarted(thread, turn);
    if (text.includes('ROUTINE')) {
      await approve(thread, turn, 'item/commandExecution/requestApproval', {
        kind: 'command',
        itemId: 'exec-1',
        command: "/bin/zsh -lc 'git status'",
        cwd: process.cwd(),
        reason: 'Needs access to the repository.',
      });
    }
    if (text.includes('SETTLE')) {
      // Codex settles the request itself; any later answer is only logged.
      const id = next++;
      waiting.set(id, (reply) => log('late.jsonl', { reply }));
      send({
        id,
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId: thread,
          turnId: turn,
          itemId: 'exec-3',
          kind: 'command',
          command: "/bin/zsh -lc 'git push origin master'",
          startedAtMs: 0,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      send({ method: 'serverRequest/resolved', params: { threadId: thread, requestId: id } });
    }
    if (text.includes('RISKY')) {
      const push = {
        type: 'commandExecution',
        id: 'exec-2',
        command: "/bin/zsh -lc 'git push --force origin master'",
        cwd: process.cwd(),
        status: 'inProgress',
        commandActions: [],
        aggregatedOutput: null,
        exitCode: null,
      };
      send({ method: 'item/started', params: { item: push, threadId: thread, turnId: turn } });
      await approve(thread, turn, 'item/commandExecution/requestApproval', {
        kind: 'command',
        itemId: 'exec-2',
        command: push.command,
        cwd: process.cwd(),
        reason: 'Publishing needs the network.',
      });
      send({
        method: 'item/completed',
        params: { item: { ...push, status: 'declined' }, threadId: thread, turnId: turn },
      });
      const change = {
        type: 'fileChange',
        id: 'patch-1',
        changes: [{ path: '/etc/hosts', kind: { type: 'update' }, diff: '' }],
        status: 'inProgress',
      };
      send({ method: 'item/started', params: { item: change, threadId: thread, turnId: turn } });
      await approve(thread, turn, 'item/fileChange/requestApproval', {
        itemId: 'patch-1',
        reason: 'Edit hosts',
      });
      send({
        method: 'item/completed',
        params: { item: { ...change, status: 'declined' }, threadId: thread, turnId: turn },
      });
    }
    if (text.includes('STEER')) {
      const steered = await new Promise((resolve) => {
        active.steered = resolve;
        setTimeout(() => resolve('(nothing)'), 20000);
      });
      return finish(thread, turn, `Steered: ${steered}`);
    }
    if (text.includes('SLOW')) {
      const command = {
        type: 'commandExecution',
        id: 'exec-slow',
        command: "/bin/zsh -lc 'sleep 30'",
        cwd: process.cwd(),
        status: 'inProgress',
        commandActions: [],
        aggregatedOutput: null,
        exitCode: null,
      };
      send({ method: 'item/started', params: { item: command, threadId: thread, turnId: turn } });
      await new Promise((resolve) => {
        active.interrupted = resolve;
      });
      send({
        method: 'item/completed',
        params: {
          item: { ...command, status: 'failed', exitCode: -1 },
          threadId: thread,
          turnId: turn,
        },
      });
      send({
        method: 'turn/completed',
        params: {
          threadId: thread,
          turn: { id: turn, items: [], status: 'interrupted', error: null },
        },
      });
      return;
    }
    finish(thread, turn, `Turn ${turn} done`);
  };

  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.method === undefined) {
      const resolve = waiting.get(message.id);
      waiting.delete(message.id);
      resolve?.(message.result ?? { error: message.error });
      return;
    }
    log('requests.jsonl', { pid: process.pid, method: message.method, params: message.params });
    const reply = (result) => send({ id: message.id, result });
    const fail = (code, text) => send({ id: message.id, error: { code, message: text } });
    const params = message.params ?? {};
    switch (message.method) {
      case 'initialize':
        if (fs.existsSync(path.join(dir, 'slow-initialize'))) {
          setTimeout(() => reply({ userAgent: 'fake/0.156.1' }), 3000);
          return undefined;
        }
        return reply({
          userAgent: 'fake/0.156.1',
          codexHome: dir,
          platformFamily: 'unix',
          platformOs: 'macos',
        });
      case 'initialized':
        return undefined;
      case 'thread/start': {
        if (fs.existsSync(path.join(dir, 'no-thread-start'))) {
          return fail(
            -32600,
            'Invalid request: unknown variant `thread/start`, expected one of `initialize`',
          );
        }
        const threads = load();
        const thread = id('thread');
        threads[thread] = [];
        save(threads);
        reply({ thread: { id: thread, historyMode: 'paginated' } });
        return send({ method: 'thread/started', params: { thread: { id: thread } } });
      }
      case 'thread/resume': {
        if (!load()[params.threadId])
          return fail(-32600, `no rollout found for thread id ${params.threadId}`);
        return reply({ thread: { id: params.threadId, historyMode: 'paginated' } });
      }
      case 'turn/start': {
        // Codex took the turn but exited before confirming it.
        if (fs.existsSync(path.join(dir, 'exit-on-turn-start'))) process.exit(1);
        const turn = id('turn');
        const threads = load();
        threads[params.threadId].push(turn);
        save(threads);
        active = { thread: params.threadId, turn };
        reply({ turn: { id: turn, items: [], status: 'inProgress', error: null } });
        // Crashes mid-turn, leaving a child that holds this process's output open.
        if (params.input[0].text.includes('ORPHAN')) {
          require('node:child_process').spawn(
            process.execPath,
            ['-e', 'setTimeout(() => {}, 30000)'],
            {
              stdio: ['ignore', 'inherit', 'ignore'],
            },
          );
          setTimeout(() => process.exit(1), 100);
          return undefined;
        }
        run(params.threadId, turn, params.input[0].text).then(() => {
          active = null;
        });
        return undefined;
      }
      case 'turn/steer':
        if (!active || active.turn !== params.expectedTurnId)
          return fail(-32600, 'no active turn to steer');
        reply({ turnId: active.turn });
        return active.steered?.(params.input[0].text);
      case 'turn/interrupt':
        reply({});
        return active?.interrupted?.();
      case 'thread/turns/list': {
        const turns = (load()[params.threadId] ?? []).slice().reverse();
        const start = params.cursor ? Number(params.cursor) : 0;
        const limit = params.limit ?? 25;
        return reply({
          data: turns
            .slice(start, start + limit)
            .map((turn) => ({ id: turn, items: [], status: 'completed' })),
          nextCursor: start + limit < turns.length ? String(start + limit) : null,
          backwardsCursor: null,
        });
      }
      case 'thread/revert': {
        const threads = load();
        const turns = threads[params.threadId] ?? [];
        const index = turns.indexOf(params.beforeTurnId);
        if (index < 0) return fail(-32600, 'unknown turn');
        threads[params.threadId] = turns.slice(0, index);
        save(threads);
        return reply({
          thread: { id: params.threadId },
          turnsBackwardsCursor: null,
          itemsBackwardsCursor: null,
        });
      }
      case 'thread/fork': {
        const threads = load();
        const turns = threads[params.threadId] ?? [];
        const kept = params.lastTurnId
          ? turns.slice(0, turns.indexOf(params.lastTurnId) + 1)
          : turns.slice();
        const thread = id('thread');
        threads[thread] = kept;
        save(threads);
        return reply({
          thread: { id: thread, forkedFromId: params.threadId, historyMode: 'paginated' },
        });
      }
      default:
        return fail(
          -32600,
          `Invalid request: unknown variant \`${message.method}\`, expected one of \`initialize\``,
        );
    }
  });
}
