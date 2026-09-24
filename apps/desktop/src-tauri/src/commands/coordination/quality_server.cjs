const fs = require('node:fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
require('node:readline')
  .createInterface({ input: process.stdin })
  .on('line', (line) => {
    const q = JSON.parse(line);
    if (process.argv[4])
      fs.appendFileSync(
        process.argv[4],
        `${JSON.stringify({ method: q.method, protocolVersion: q.params?.protocolVersion })}\n`,
      );
    const send = (result) => console.log(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }));
    if (q.method === 'initialize') {
      const supported = ['2025-11-25', '2025-06-18', '2024-11-05'];
      send({
        protocolVersion: supported.includes(q.params?.protocolVersion)
          ? q.params.protocolVersion
          : supported[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'result-fixture', version: '2' },
      });
    } else if (q.method === 'ping') send({});
    else if (q.method === 'tools/list')
      send({
        tools: [
          {
            name: 'fixture_report',
            description: 'Return this service report in structuredContent.report.',
            annotations: { readOnlyHint: true, destructiveHint: false },
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      });
    else if (q.method === 'tools/call') {
      fs.appendFileSync(process.argv[3], 'call\n');
      setTimeout(
        () =>
          send({
            content: [{ type: 'text', text: JSON.stringify(data) }],
            structuredContent: data,
            isError: false,
          }),
        Math.min(1000, Math.max(0, Number(data.delayMs) || 0)),
      );
    } else if (q.id !== undefined)
      console.log(
        JSON.stringify({
          jsonrpc: '2.0',
          id: q.id,
          error: { code: -32601, message: 'Method not found' },
        }),
      );
  });
