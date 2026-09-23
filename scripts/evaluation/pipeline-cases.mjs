import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const pipelineCases = [8, 160].map((size) => {
  const incidents = Array.from({ length: size }, (_, index) => ({
    id: `incident-${String(index).padStart(3, '0')}`,
    active: index % 7 === 2,
    deployment: `deployment-${index % 11}`,
    affected: index * 13 + 1,
    diagnostics: `Routine trace for incident ${index}; no additional action requested. `.repeat(12),
  }));
  const deployments = Array.from({ length: 11 }, (_, index) => ({
    id: `deployment-${index}`,
    revision: `revision-${index * 17}`,
    owner: `team-${index % 4}`,
    details: `Historical release record ${index}; deployment metadata. `.repeat(80),
  }));
  const answer = incidents
    .filter((row) => row.active)
    .map((row) => ({
      id: row.id,
      affected: row.affected,
      revision: deployments.find((deployment) => deployment.id === row.deployment).revision,
      owner: deployments.find((deployment) => deployment.id === row.deployment).owner,
    }));
  const check = `import fs from 'node:fs';import assert from 'node:assert/strict';const rows=JSON.parse(fs.readFileSync('result.json','utf8'));assert.ok(Array.isArray(rows));assert.ok(rows.every(r=>typeof r.id==='string'&&Number.isInteger(r.affected)&&typeof r.revision==='string'&&typeof r.owner==='string'));\n`;
  return {
    id: `incident-deployment-join-${size}`,
    split: 'screening',
    source: { family: 'incident-deployment-join', category: 'authored-structured-retrieval' },
    prompt:
      'Use fixture_report from the two selected service connections: quality_fixture has incidents at structuredContent.report.incidents; quality_fixture_1 has deployments at structuredContent.report.deployments. Arguments are empty objects. Write result.json with all incidents where active is true, joined by incident.deployment = deployment.id. Include exactly id, affected, revision and owner, sorted by incident id. Deployment ids are unique. Read the real reports; diagnostic logs are unnecessary. Do not inspect tool server configuration or source. Change only result.json, validate with node check.mjs and leave changes uncommitted.',
    files: { 'check.mjs': check },
    allowedFiles: ['result.json'],
    check: 'node check.mjs',
    toolFixtures: [{ report: { incidents } }, { report: { deployments } }],
    oracle: `const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const root=process.argv[2];assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'result.json'),'utf8')),${JSON.stringify(answer)});assert.equal(fs.readFileSync(path.join(root,'check.mjs'),'utf8'),${JSON.stringify(check)});`,
  };
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Supply an output suite JSON path.');
  await writeFile(process.argv[2], `${JSON.stringify({ cases: pipelineCases }, null, 2)}\n`);
}
