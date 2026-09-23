import assert from 'node:assert/strict';
import test from 'node:test';
import { mcpEndpointError } from '../src/lib/mcp-endpoint.ts';

test('MCP requires encrypted remote transport and accepts explicit loopback services', () => {
  for (const url of [
    'https://example.invalid/mcp',
    'http://localhost:8787/mcp',
    'http://127.0.0.1:8080',
    'http://[::1]:8080',
    'http://127.2.3.4',
  ])
    assert.equal(mcpEndpointError(url), undefined, url);
  for (const url of [
    'http://example.invalid',
    'http://192.168.1.1',
    'http://localhost.example.invalid',
    'http://0.0.0.0',
    'https://user:secret@example.invalid',
    'https://example.invalid/#token',
    'file:///mcp',
    'not a url',
  ])
    assert.ok(mcpEndpointError(url), url);
});
