function task(id, category, split, instruction, broken, visible, hidden) {
  return {
    id,
    category,
    split,
    allowedFiles: ['index.mjs'],
    prompt: `${instruction} Change only index.mjs, preserve the named export, run node --test and leave changes uncommitted.`,
    files: {
      'index.mjs': broken,
      'index.test.mjs': `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { solve } from './index.mjs';\ntest('public contract', () => { ${visible} });\n`,
    },
    check: 'node --test',
    oracle: `const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path'); const {pathToFileURL}=require('node:url'); const root=process.argv[2]; const read=n=>fs.readFileSync(path.join(root,n),'utf8'); (async()=>{ const {solve}=await import(pathToFileURL(path.join(root,'index.mjs'))); ${hidden} })().catch(e=>{console.error(e);process.exitCode=1});`,
  };
}

export const heldoutCases = [
  task(
    'query-values',
    'data-contracts',
    'train',
    'Implement solve(query, key): parse an optional leading ? query string using URL query semantics and return every value for key in source order. Decode percent escapes and + spaces. Missing keys return [].',
    'export const solve = (query, key) => query.split("&").filter(p=>p.startsWith(key+"=")).map(p=>p.split("=")[1]);\n',
    "assert.deepEqual(solve('?tag=hello+world&tag=a%3Db', 'tag'), ['hello world','a=b']);",
    "assert.deepEqual(solve('?tag=hello+world&tag=a%3Db', 'tag'), ['hello world','a=b']); assert.deepEqual(solve('x=1&xx=2&x=&x=3','x'),['1','','3']); assert.deepEqual(solve('','x'),[]); assert.deepEqual(solve('a%20b=%E2%9C%93','a b'),['✓']);",
  ),
  task(
    'stable-dedup',
    'collections',
    'train',
    'Implement solve(items): retain the FIRST object for each id, preserving source order. Treat numeric and string ids as distinct. Do not mutate the array or objects. Return a new array, including for empty input.',
    'export const solve = items => items;\n',
    "assert.deepEqual(solve([{id:1,v:'a'},{id:1,v:'b'}]),[{id:1,v:'a'}]);",
    "const a=Object.freeze({id:1,v:'a'}), b=Object.freeze({id:'1',v:'b'}); const items=Object.freeze([a,b,Object.freeze({id:1,v:'c'})]); assert.deepEqual(solve(items),[a,b]); assert.equal(solve(items)[0],a); const empty=[]; assert.deepEqual(solve(empty),[]); assert.notEqual(solve(empty),empty); assert.deepEqual(solve([{id:'__proto__'},{id:'constructor'},{id:'__proto__'}]),[{id:'__proto__'},{id:'constructor'}]);",
  ),
  task(
    'retry-delay',
    'boundary-logic',
    'train',
    'Implement solve(attempt, base, cap): return min(cap, base * 2 ** attempt). All arguments must be finite numbers; attempt must be a nonnegative integer and base/cap nonnegative. Invalid arguments throw RangeError. Overflow saturates at cap; base zero returns zero even for huge attempts.',
    'export const solve = (attempt, base, cap) => base * attempt;\n',
    'assert.equal(solve(3, 100, 500), 500); assert.throws(()=>solve(-1,100,500), RangeError);',
    "assert.equal(solve(0,100,500),100); assert.equal(solve(3,100,500),500); assert.equal(solve(2000,0,50),0); assert.equal(solve(2000,1,50),50); for(const args of [[-1,1,2],[0.5,1,2],[0,-1,2],[0,1,-2],[Infinity,1,2],[0,NaN,2],[0,1,Infinity],['1',1,2]]) assert.throws(()=>solve(...args),RangeError);",
  ),
  task(
    'csv-cell',
    'data-contracts',
    'holdout',
    'Implement solve(value): convert the value to a string, then encode one CSV cell. Quote cells containing commas, double quotes, CR or LF, doubling embedded double quotes. Otherwise return the string unchanged. Do not trim or append a newline.',
    'export const solve = value => String(value);\n',
    "assert.equal(solve('a,b'), '\"a,b\"');",
    "for(const [input,expected] of [['a,b','\"a,b\"'],['a\"b','\"a\"\"b\"'],['a\\nb','\"a\\nb\"'],['a\\rb','\"a\\rb\"'],[' x ',' x '],['',''],[0,'0'],[false,'false']]) assert.equal(solve(input),expected);",
  ),
  task(
    'group-records',
    'collections',
    'holdout',
    'Implement solve(records): return a Map from each record.group to an array of the original records in that group. Preserve first-seen group order and input order within groups. Keep numeric and string keys distinct. Do not mutate the input or records.',
    'export const solve = records => new Map(records.map(r=>[r.group,[r]]));\n',
    "assert.deepEqual([...solve([{group:'a',v:1},{group:'a',v:2}]).values()],[[{group:'a',v:1},{group:'a',v:2}]]);",
    "const a=Object.freeze({group:'__proto__',v:1}), b=Object.freeze({group:1,v:2}), c=Object.freeze({group:'1',v:3}), d=Object.freeze({group:'__proto__',v:4}); const records=Object.freeze([a,b,c,d]); const result=solve(records); assert.ok(result instanceof Map); assert.deepEqual([...result.keys()],['__proto__',1,'1']); assert.deepEqual(result.get('__proto__'),[a,d]); assert.equal(result.get(1)[0],b); assert.equal(solve([]).size,0);",
  ),
  task(
    'page-window',
    'boundary-logic',
    'holdout',
    'Implement solve(items, page, size): return a new array for the one-based page. page and size must be positive safe integers or throw RangeError. Out-of-range pages return []; do not mutate items. Preserve the final partial page.',
    'export const solve = (items, page, size) => items.slice(page * size, (page + 1) * size);\n',
    'assert.deepEqual(solve([1,2,3,4,5],1,2),[1,2]);',
    "const items=Object.freeze([1,2,3,4,5]); assert.deepEqual(solve(items,1,2),[1,2]); assert.deepEqual(solve(items,3,2),[5]); assert.deepEqual(solve(items,4,2),[]); assert.deepEqual(solve([],1,1),[]); for(const n of [0,-1,1.5,NaN,Infinity,'1',Number.MAX_SAFE_INTEGER+1]) { assert.throws(()=>solve(items,n,2),RangeError); assert.throws(()=>solve(items,1,n),RangeError); } assert.deepEqual(solve(items,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER),[]);",
  ),
];
