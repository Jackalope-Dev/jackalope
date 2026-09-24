import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const families = {
  incidents: {
    array: 'incidents',
    flag: 'active',
    state: 'severity',
    wanted: 'critical',
    other: 'info',
    field: 'affected',
  },
  inventory: {
    array: 'products',
    flag: 'available',
    state: 'region',
    wanted: 'west',
    other: 'east',
    field: 'quantity',
  },
  builds: {
    array: 'jobs',
    flag: 'finished',
    state: 'conclusion',
    wanted: 'failure',
    other: 'success',
    field: 'duration',
  },
  tickets: {
    array: 'tickets',
    flag: 'open',
    state: 'priority',
    wanted: 'urgent',
    other: 'normal',
    field: 'customer',
  },
};

export function retrievalCase({ seed, family, services = 3, rows = 70, empty = false }) {
  const f = families[family];
  if (!f || !Number.isInteger(seed) || ![1, 3].includes(services) || ![30, 70, 120].includes(rows))
    throw new Error(
      'Use a defined retrieval family, integer seed, one or three services and 30, 70 or 120 rows.',
    );
  const expected = [];
  const toolFixtures = Array.from({ length: services }, (_, service) => {
    const data = Array.from({ length: rows }, (_, index) => {
      const hash = createHash('sha256').update(`${seed}:${family}:${service}:${index}`).digest();
      const id = hash.subarray(0, 9).toString('hex');
      const flag = hash[9] % 3 === 0;
      const match = !empty && hash[10] % 3 === 0;
      const measure =
        family === 'tickets'
          ? `customer-${hash.subarray(14, 19).toString('hex')}`
          : hash.readUInt16LE(11);
      if (flag && match) expected.push({ id, [f.field]: measure });
      return {
        id,
        [f.flag]: flag,
        [f.state]: match ? f.wanted : f.other,
        [f.field]: measure,
        owner: index % 4 ? null : '界',
        diagnostic: Array.from({ length: 12 }, (_, line) =>
          createHash('sha256').update(`${id}:${line}`).digest('hex'),
        ).join(' '),
      };
    });
    return { report: { [f.array]: data }, delayMs: 0 };
  });
  expected.sort((a, b) => a.id.localeCompare(b.id));
  const connections = Array.from(
    { length: services },
    (_, n) => `quality_fixture${n ? `_${n}` : ''}`,
  ).join(', ');
  return {
    id: `${family}-${seed}`,
    split: 'held-out',
    source: {
      family: `retrieval-${family}`,
      category: 'structured-tool-retrieval',
      seed,
      services,
      rows,
      empty,
    },
    prompt: `Read fixture_report from every selected connection (${connections}). Write answer.json with an array of records where ${f.flag} is true and ${f.state} is exactly '${f.wanted}', each with exactly id and ${f.field}, sorted by id ascending. Inspect actual tool data and preserve exact values. Data is at structuredContent.report.${f.array}. Diagnostic fields are irrelevant. Only create answer.json, leave changes uncommitted, and validate with node check.mjs.`,
    allowedFiles: ['answer.json'],
    toolFixtures,
    files: {
      'check.mjs': `import fs from 'node:fs';import assert from 'node:assert/strict';const rows=JSON.parse(fs.readFileSync('answer.json','utf8'));assert.ok(Array.isArray(rows));for(const row of rows){assert.deepEqual(Object.keys(row).sort(),${JSON.stringify(['id', f.field].sort())});assert.equal(typeof row.id,'string');assert.equal(typeof row[${JSON.stringify(f.field)}],${JSON.stringify(family === 'tickets' ? 'string' : 'number')});}\n`,
    },
    check: 'node check.mjs',
    oracle: `const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(process.argv[2],'answer.json'),'utf8')),${JSON.stringify(expected)});`,
  };
}

export function retrievalSuite(split = 'held-out') {
  if (!['pilot', 'held-out'].includes(split)) throw new Error('Choose pilot or held-out.');
  const cases =
    split === 'pilot'
      ? [
          retrievalCase({ seed: 1729, family: 'incidents' }),
          retrievalCase({ seed: 1733, family: 'inventory', services: 1, rows: 30 }),
        ]
      : Object.keys(families).flatMap((family, index) => [
          retrievalCase({ seed: 7103 + index * 20, family, services: 1, rows: 30 }),
          retrievalCase({ seed: 7109 + index * 20, family, services: 3, rows: 120 }),
          retrievalCase({
            seed: 7111 + index * 20,
            family,
            services: 3,
            rows: 70,
            empty: index === 3,
          }),
        ]);
  return {
    cases: cases.map((item) => ({ ...item, split: split === 'held-out' ? 'holdout' : split })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2])
    throw new Error('Usage: node retrieval-cases.mjs suite.json [pilot|held-out]');
  await writeFile(process.argv[2], `${JSON.stringify(retrievalSuite(process.argv[3]), null, 2)}\n`);
}
