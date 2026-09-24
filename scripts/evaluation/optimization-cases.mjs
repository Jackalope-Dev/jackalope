export const optimizationCases = [
  {
    id: 'stable-queue-order',
    source: { family: 'queue-order', category: 'small-repair' },
    allowedFiles: ['queue.mjs'],
    prompt:
      'Fix ready() in queue.mjs: return only jobs whose dependencies are complete, highest priority first, preserving input order for equal priorities. Do not mutate either input. Preserve exports, change only queue.mjs, and leave changes uncommitted. Validate with node check.mjs.',
    files: {
      'queue.mjs':
        'export function ready(jobs, done) { return jobs.sort((a,b) => a.priority-b.priority).filter(j => j.after.some(id => done.includes(id))); }\n',
      'check.mjs':
        "import assert from 'node:assert/strict';import {ready} from './queue.mjs';const jobs=[{id:'a',priority:2,after:[]},{id:'b',priority:2,after:['ok']},{id:'c',priority:9,after:['missing']}];const before=JSON.stringify(jobs);assert.deepEqual(ready(jobs,['ok']).map(j=>j.id),['a','b']);assert.equal(JSON.stringify(jobs),before);assert.deepEqual(ready([],[]),[]);\n",
    },
    check: 'node check.mjs',
    oracle:
      "const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const root=process.argv[2];(async()=>{const {ready}=await import(require('node:url').pathToFileURL(path.join(root,'queue.mjs')));for(let n=0;n<20;n++){const jobs=Object.freeze([{id:'a',priority:n,after:[]},{id:'b',priority:n,after:[]},{id:'c',priority:n+1,after:['x','y']}]);const done=Object.freeze(['x']);assert.deepEqual(ready(jobs,done).map(j=>j.id),['a','b']);assert.deepEqual(ready(jobs,['x','y']).map(j=>j.id),['c','a','b']);}})().catch(e=>{console.error(e);process.exitCode=1});",
  },
  {
    id: 'query-fragment-order',
    source: { family: 'url-query', category: 'small-repair' },
    allowedFiles: ['link.mjs'],
    prompt:
      'Fix withQuery(url, key, value) in link.mjs so it appends an encoded query parameter before any fragment, choosing ? or & correctly and preserving the existing path/query/fragment bytes. Keep relative URLs supported. Only edit link.mjs, preserve its export, and leave changes uncommitted. Validate with node check.mjs.',
    files: {
      'link.mjs': 'export const withQuery = (url,key,value) => url + "?" + key + "=" + value;\n',
      'check.mjs':
        "import assert from 'node:assert/strict';import {withQuery} from './link.mjs';assert.equal(withQuery('/a?x=1#part','q','a b'),'/a?x=1&q=a%20b#part');assert.equal(withQuery('/a','q','&'),'/a?q=%26');\n",
    },
    check: 'node check.mjs',
    oracle:
      "const assert=require('node:assert/strict'),path=require('node:path');(async()=>{const {withQuery:f}=await import(require('node:url').pathToFileURL(path.join(process.argv[2],'link.mjs')));for(const [a,b] of [['/a','/a?k=v'],['/a#','/a?k=v#'],['/a#?x','/a?k=v#?x'],['/a?x=1#p','/a?x=1&k=v#p']])assert.equal(f(a,'k','v'),b);assert.equal(f('/a?x=%2F#界','a&','界'),'/a?x=%2F&a%26=%E7%95%8C#界');})().catch(e=>{console.error(e);process.exitCode=1});",
  },
];

export function toolInvestigationCase() {
  const reports = ['alpha', 'beta', 'gamma'].map((service, index) => ({
    report: {
      service,
      incidents: Array.from({ length: 40 }, (_, row) => ({
        id: `${service}-${row}`,
        active: row % 13 === 0,
        severity: row % 13 === 0 ? 'critical' : 'info',
        affected: row + index,
        log: `Routine diagnostic record for ${service}. `.repeat(20),
      })),
    },
    delayMs: 150,
  }));
  const expected = reports.flatMap(({ report }) =>
    report.incidents
      .filter((row) => row.active && row.severity === 'critical')
      .map(({ id, affected }) => ({ id, affected })),
  );
  return {
    id: 'service-incident-report',
    source: { family: 'service-incidents', category: 'multi-source-investigation' },
    prompt:
      'Read the fixture_report tool from all three selected service connections (quality_fixture, quality_fixture_1, quality_fixture_2). Write incidents.json with an array containing only active critical incidents, each with exactly id and affected, sorted by id. Inspect real tool data; do not invent values. No other files should change. Leave changes uncommitted and validate with node check.mjs. Tool data is in structuredContent.report.incidents; irrelevant diagnostic logs need not be reproduced.',
    allowedFiles: ['incidents.json'],
    files: {
      'check.mjs':
        "import fs from 'node:fs';import assert from 'node:assert/strict';const rows=JSON.parse(fs.readFileSync('incidents.json','utf8'));assert.ok(Array.isArray(rows));assert.ok(rows.every(r=>typeof r.id==='string'&&Number.isInteger(r.affected)));\n",
    },
    toolFixtures: reports,
    check: 'node check.mjs',
    oracle: `const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(process.argv[2],'incidents.json'),'utf8')),${JSON.stringify(expected)});`,
  };
}
