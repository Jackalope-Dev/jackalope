// Harder authored fixtures: the requested change spans several files or rules the visible
// tests only partly cover, so an unverified first attempt usually misses something. Each
// hidden oracle checks every stated requirement, beyond the project's own tests.

const prelude = `const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path'); const {pathToFileURL}=require('node:url'); const root=process.argv[2]; const read=n=>fs.readFileSync(path.join(root,n),'utf8');`;
const load = (file, body) =>
  `${prelude} (async()=>{ const mod=await import(pathToFileURL(path.join(root,'${file}'))); ${body} })().catch(e=>{console.error(e);process.exitCode=1});`;
const verify =
  'Run the saved project verification command node --test through Jackalope computer_verify, inspect any failures and correct the implementation.';

export const hardCases = [
  {
    id: 'invoice-rules',
    allowedFiles: ['invoice.mjs'],
    prompt: `invoiceTotal(lines, discountPercent) in invoice.mjs returns wrong totals. Make it follow every rule in README.md. Change only invoice.mjs. ${verify} Leave changes uncommitted.`,
    files: {
      'package.json': '{"type":"module"}\n',
      'README.md':
        '# Invoices\n\nAll amounts are integer cents.\n\n- A line is `{ price, qty }`; a missing `qty` means 1.\n- A negative `price` or `qty`, or a non-integer `qty`, throws a `RangeError`.\n- `discountPercent` (default 0) must be between 0 and 100 inclusive, otherwise throw a `RangeError`.\n- The discount applies to the subtotal and is rounded half up to whole cents before it is subtracted.\n- An empty invoice totals 0.\n- `lines` must not be mutated.\n',
      'invoice.mjs':
        'export function invoiceTotal(lines, discountPercent = 0) {\n  let subtotal = 0;\n  for (const line of lines) subtotal += line.price * line.qty;\n  return Math.round(subtotal - (subtotal * discountPercent) / 100);\n}\n',
      'invoice.test.mjs':
        "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { invoiceTotal } from './invoice.mjs';\n\ntest('sums lines', () => {\n  assert.equal(invoiceTotal([{ price: 250, qty: 2 }, { price: 100, qty: 1 }]), 600);\n});\n\ntest('missing quantity means one', () => {\n  assert.equal(invoiceTotal([{ price: 199 }]), 199);\n});\n",
    },
    check: 'node --test',
    oracle: load(
      'invoice.mjs',
      `const t=mod.invoiceTotal;
assert.equal(t([]),0);
assert.equal(t([{price:250,qty:2},{price:100}]),600);
assert.equal(t([{price:1005}],10),904);
assert.equal(t([{price:1015}],10),913);
assert.equal(t([{price:333,qty:3}],50),499);
assert.equal(t([{price:1000}],0),1000);
assert.equal(t([{price:1000}],100),0);
for (const bad of [[{price:-1}],[{price:5,qty:-1}],[{price:5,qty:1.5}]]) assert.throws(()=>t(bad),RangeError);
for (const pct of [-1,101]) assert.throws(()=>t([{price:5}],pct),RangeError);
const lines=[{price:100,qty:2}]; const before=JSON.stringify(lines); t(lines,25); assert.equal(JSON.stringify(lines),before);`,
    ),
  },
  {
    id: 'rename-export',
    allowedFiles: ['api.mjs', 'profile.mjs', 'admin.mjs', 'report.mjs'],
    prompt: `Rename fetchUser to loadUser in api.mjs and update every place in the project that calls it. Keep fetchUser exported from api.mjs as a deprecated alias that delegates to loadUser, so existing external callers keep working. Do not change behavior, tests or other files. ${verify} Leave changes uncommitted.`,
    files: {
      'package.json': '{"type":"module"}\n',
      'api.mjs':
        "const users = new Map([[1, { id: 1, name: 'Ada' }], [2, { id: 2, name: 'Lin' }]]);\n\nexport function fetchUser(id) {\n  const user = users.get(id);\n  if (!user) throw new Error('No user ' + id);\n  return { ...user };\n}\n",
      'profile.mjs':
        "import { fetchUser } from './api.mjs';\n\nexport const profileName = (id) => fetchUser(id).name;\n",
      'admin.mjs':
        "import * as api from './api.mjs';\n\nexport const adminLabel = (id) => 'admin:' + api.fetchUser(id).name;\n",
      'report.mjs':
        "import { fetchUser as getUser } from './api.mjs';\n\nexport const reportLine = (ids) => ids.map((id) => getUser(id).name).join(', ');\n",
      'app.test.mjs':
        "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { profileName } from './profile.mjs';\nimport { adminLabel } from './admin.mjs';\nimport { reportLine } from './report.mjs';\n\ntest('callers keep working', () => {\n  assert.equal(profileName(1), 'Ada');\n  assert.equal(adminLabel(2), 'admin:Lin');\n  assert.equal(reportLine([1, 2]), 'Ada, Lin');\n});\n",
    },
    check: 'node --test',
    oracle: load(
      'api.mjs',
      `assert.equal(typeof mod.loadUser,'function');
assert.equal(typeof mod.fetchUser,'function');
assert.deepEqual(mod.loadUser(1),{id:1,name:'Ada'});
assert.deepEqual(mod.fetchUser(2),{id:2,name:'Lin'});
assert.throws(()=>mod.loadUser(9),/No user 9/);
const copy=mod.loadUser(1); copy.name='x'; assert.equal(mod.loadUser(1).name,'Ada');
assert.match(read('api.mjs'),/deprecated/i);
for (const file of ['profile.mjs','admin.mjs','report.mjs']) { const source=read(file); assert.ok(!/fetchUser/.test(source), file+' still calls fetchUser'); assert.ok(/loadUser/.test(source), file+' does not use loadUser'); }
const {profileName}=await import(pathToFileURL(path.join(root,'profile.mjs'))); assert.equal(profileName(2),'Lin');
const {adminLabel}=await import(pathToFileURL(path.join(root,'admin.mjs'))); assert.equal(adminLabel(1),'admin:Ada');
const {reportLine}=await import(pathToFileURL(path.join(root,'report.mjs'))); assert.equal(reportLine([2,1]),'Lin, Ada');`,
    ),
  },
  {
    id: 'merge-events',
    allowedFiles: ['events.mjs'],
    prompt: `Implement mergeEvents(a, b) in events.mjs. Each input is an array of events { id, at, updatedAt } sorted by ascending at. Return one array sorted by ascending at that keeps a single event per id: the one with the greater updatedAt, or the one from b when updatedAt ties. Events with equal at keep their relative order, with a's before b's. An id can repeat within one input; the same rule applies. Do not mutate the inputs or their events. Change only events.mjs. ${verify} Leave changes uncommitted.`,
    files: {
      'package.json': '{"type":"module"}\n',
      'events.mjs':
        'export function mergeEvents(a, b) {\n  return [...a, ...b].sort((x, y) => x.at - y.at);\n}\n',
      'events.test.mjs':
        "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { mergeEvents } from './events.mjs';\n\ntest('merges by time', () => {\n  const a = [{ id: 'a', at: 1, updatedAt: 1 }, { id: 'c', at: 5, updatedAt: 1 }];\n  const b = [{ id: 'b', at: 3, updatedAt: 1 }];\n  assert.deepEqual(mergeEvents(a, b).map((event) => event.id), ['a', 'b', 'c']);\n});\n",
    },
    check: 'node --test',
    oracle: load(
      'events.mjs',
      `const m=mod.mergeEvents, ids=r=>r.map(e=>e.id+':'+e.updatedAt);
assert.deepEqual(m([],[]),[]);
assert.deepEqual(ids(m([{id:'x',at:1,updatedAt:1}],[{id:'x',at:4,updatedAt:2}])),['x:2']);
assert.deepEqual(ids(m([{id:'x',at:4,updatedAt:3}],[{id:'x',at:1,updatedAt:2}])),['x:3']);
assert.deepEqual(m([{id:'x',at:2,updatedAt:5,src:'a'}],[{id:'x',at:2,updatedAt:5,src:'b'}]).map(e=>e.src),['b']);
assert.deepEqual(ids(m([{id:'p',at:2,updatedAt:1},{id:'q',at:2,updatedAt:1}],[{id:'s',at:1,updatedAt:1},{id:'r',at:2,updatedAt:1}])),['s:1','p:1','q:1','r:1']);
assert.deepEqual(ids(m([{id:'d',at:1,updatedAt:1},{id:'d',at:3,updatedAt:9}],[])),['d:9']);
const a=[{id:'k',at:1,updatedAt:1},{id:'z',at:6,updatedAt:1}], b=[{id:'k',at:2,updatedAt:2}], before=JSON.stringify([a,b]);
const out=m(a,b); assert.deepEqual(ids(out),['k:2','z:1']); assert.equal(JSON.stringify([a,b]),before);`,
    ),
  },
];
