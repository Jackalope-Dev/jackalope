import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { qualityCases } from './quality-cases.mjs';

const extensions = [
  [
    'csv-cell',
    'Extend solve so null and undefined become an empty CSV cell. Preserve all other encoding behavior.',
    "assert.equal(solve(null),''); assert.equal(solve(undefined),''); assert.equal(solve('a,b'),'\"a,b\"');",
  ],
  [
    'group-records',
    'Extend solve(records, key = "group") to group by the specified property. Preserve original records, insertion order, key types, and the default group property.',
    "assert.deepEqual([...solve([{kind:'a',v:1},{kind:'a',v:2}], 'kind').values()],[[{kind:'a',v:1},{kind:'a',v:2}]]);",
  ],
  [
    'page-window',
    'Extend solve(items, page = 1, size = 10) to support omitted page and size with those defaults. Keep validation for explicitly invalid values and preserve existing pagination behavior.',
    'assert.deepEqual(solve([1,2,3]),[1,2,3]); assert.deepEqual(solve([1,2,3],2,2),[3]);',
  ],
];
export const continuationCases = extensions.map(([id, request, checks]) => {
  const original = qualityCases.find((item) => item.id === id);
  return {
    ...original,
    id: `continue-${id}`,
    category: 'native-continuation',
    split: 'regression',
    followups: [
      `${request} Change only index.mjs, run node --test after implementation and leave changes uncommitted.`,
    ],
    oracle:
      original.oracle +
      `\n(async()=>{const {solve}=await import(require('node:url').pathToFileURL(require('node:path').join(root,'index.mjs')));${checks}})().catch(e=>{console.error(e);process.exitCode=1});`,
  };
});
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Supply an output suite path.');
  await writeFile(process.argv[2], JSON.stringify({ cases: continuationCases }, null, 2));
}
