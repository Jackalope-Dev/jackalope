const fs = require('node:fs');
const http = require('node:http');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const sessionID = 'ses_fixture';
const childID = 'ses_child';
const resumed = fs.existsSync('fixture-messages.json');
const oldChild = {
  id: 'old_child',
  sessionID: childID,
  role: 'assistant',
  time: { completed: 1 },
  tokens: { input: 999, output: 999, cache: { read: 0, write: 0 } },
};
const auth = `Basic ${Buffer.from(`jackalope:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`;
let events;
let askQuestion = false;
let denialMode = '';
let denials = 0;
const messages = fs.existsSync('fixture-messages.json')
  ? JSON.parse(fs.readFileSync('fixture-messages.json'))
  : Array.from({ length: 17 }, (_, index) => ({
      info: {
        id: `old_${index}`,
        sessionID,
        role: 'assistant',
        time: { completed: 1 },
        finish: 'stop',
      },
      parts: [{ type: 'text', text: 'Old response' }],
    }));
const emit = (type, properties) =>
  events.write(`data: ${JSON.stringify({ type, properties })}\n\n`);
const server = http.createServer((req, res) => {
  if (req.headers.authorization !== auth) {
    res.writeHead(401).end();
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;
  let raw = '';
  req.on('data', (part) => (raw += part));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    const reply = (value) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(value));
    };
    if (route === '/global/health') {
      fs.appendFileSync('health-probes.txt', 'x');
      if (fs.existsSync('stall-first-health')) {
        fs.unlinkSync('stall-first-health');
        return;
      }
      return reply({ healthy: true });
    }
    if (route === '/session' || route === `/session/${sessionID}`)
      return reply({ id: sessionID, directory: process.cwd() });
    if (route === '/session/status') return reply({});
    if (route === `/session/${sessionID}/children`)
      return reply([{ id: childID, parentID: sessionID }]);
    if (route === `/session/${childID}/children`) return reply([]);
    if (route === `/session/${childID}/message`) return reply([{ info: oldChild, parts: [] }]);
    if (route === '/config/providers')
      return reply({
        providers: [{ id: 'fixture', models: { worker: { variants: { low: {} } } } }],
      });
    if (route === `/session/${sessionID}/message`) {
      const end = url.searchParams.has('before')
        ? Number(url.searchParams.get('before'))
        : messages.length;
      const start = Math.max(0, end - Number(url.searchParams.get('limit')));
      if (start) res.setHeader('X-Next-Cursor', String(start));
      return reply(messages.slice(start, end));
    }
    if (route === '/event') {
      events = res;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': connected\n\n');
      return;
    }
    if (route === `/session/${sessionID}/prompt_async`) {
      if (body.model?.providerID !== 'fixture' || body.variant !== 'low') {
        res.writeHead(400).end();
        return;
      }
      res.writeHead(204).end();
      askQuestion = body.parts.some((part) => part.text?.includes('Question fixture'));
      denialMode = ['Continue', 'Repeat', 'Limit'].find((mode) =>
        body.parts.some((part) => part.text?.includes(`${mode} fixture`)),
      );
      if (
        JSON.parse(process.env.OPENCODE_CONFIG_CONTENT).experimental.continue_loop_on_deny !== true
      )
        throw new Error('Missing native continuation setting');
      if (resumed) emit('message.updated', { info: oldChild });
      emit('permission.asked', {
        id: 'per_fixture',
        sessionID: resumed ? childID : sessionID,
        permission: 'bash',
        patterns: ['fixture action'],
        metadata: { command: 'fixture only' },
      });
      return;
    }
    if (route === '/permission/per_fixture/reply' || route === '/question/que_fixture/reply') {
      reply(true);
      if (route.includes('/permission/')) {
        if (body.reply !== 'once') {
          denials++;
          if (denialMode === 'Repeat' || denialMode === 'Limit') {
            emit('permission.asked', {
              id: 'per_fixture',
              sessionID,
              permission: 'bash',
              patterns:
                denialMode === 'Repeat'
                  ? ['different action', 'fixture action']
                  : [`fixture action ${denials}`],
              metadata: { command: 'different metadata' },
            });
            return;
          }
          if (denialMode !== 'Continue') return;
          fs.appendFileSync('independent.txt', 'x');
        }
        if (askQuestion) {
          emit('question.asked', {
            id: 'que_fixture',
            sessionID,
            questions: [
              {
                question: 'Choose both',
                multiple: true,
                custom: false,
                options: [
                  { label: 'One', description: 'First detail' },
                  { label: 'Two', description: 'Second detail' },
                ],
              },
            ],
          });
          return;
        }
      } else if (JSON.stringify(body.answers) !== '[["One","Two"]]') return;
      if (body.reply === 'once' || route.includes('/question/'))
        fs.appendFileSync('authorized.txt', 'x');
      const info = {
        id: `msg_${messages.length}`,
        sessionID,
        role: 'assistant',
        modelID: 'worker',
        providerID: 'fixture',
        time: { completed: 1 },
        finish: 'stop',
        tokens: { input: 10, output: 3, reasoning: 2, cache: { read: 4, write: 1 } },
        cost: 0.01,
      };
      messages.push({ info, parts: [{ type: 'text', text: 'Fixture complete' }] });
      fs.writeFileSync('fixture-messages.json', JSON.stringify(messages));
      emit('message.updated', { info });
      emit('session.status', { sessionID, status: { type: 'idle' } });
      return;
    }
    res.writeHead(404).end();
  });
});
server.listen(port, '127.0.0.1');
