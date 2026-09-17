import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const toolResultCases = ['deliveries', 'builds', 'packages'].map((category, index) => {
  const readme = 'Local synthetic MCP response extraction fixture.\n';
  const key = `${category}-42`;
  const answer = {
    id: key,
    status: 'blocked',
    reason: ['checksum mismatch', 'missing target runtime', 'incompatible peer version'][index],
    ...[
      { retryAfter: null },
      { failedTargets: ['win-x64', 'mac-arm64'] },
      { requirements: { minimum: '2.0', optional: false }, note: 'Résumé ✓' },
    ][index],
  };
  const report = { [key]: answer };
  for (let i = 0; i < 1200; i++)
    report[`${category}-other-${i}`] = {
      id: `${category}-other-${i}`,
      status: i % 2 ? 'ready' : 'pending',
      details: `Unrelated record ${i}: expected artifact ${i * 17}, worker ${i % 13}, revision ${i * 31}; ordinary processing completed and no action is required for the requested record.`,
    };
  const check = `node -e "JSON.parse(require('fs').readFileSync('result.json','utf8'))"`;
  return {
    id: `tool-${category}`,
    category: 'large-tool-result',
    split: 'holdout',
    prompt: `Use the selected fixture_report MCP tool to retrieve record ${key} at /structuredContent/report/${key}. Write that exact record as JSON to result.json. The tool returns a report keyed by record ID; select only the requested record if your tool interface supports it. Do not use other connections, inspect the server configuration or read its source. Run ${check} to verify. Leave changes uncommitted.`,
    files: { 'README.md': readme },
    check,
    toolFixture: { report },
    oracle: `const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');const root=process.argv[2];assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'result.json'),'utf8')),${JSON.stringify(answer)});assert.equal(fs.readFileSync(path.join(root,'README.md'),'utf8'),${JSON.stringify(readme)});const files=cp.execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split(/\\r?\\n/).filter(Boolean);assert.deepEqual(files,['result.json']);assert.equal(cp.execFileSync('git',['diff','--name-only','HEAD'],{cwd:root,encoding:'utf8'}).trim(),'');`,
  };
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Supply an output suite JSON path.');
  await writeFile(process.argv[2], `${JSON.stringify({ cases: toolResultCases }, null, 2)}\n`);
}
