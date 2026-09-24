import { HISTORY_FILE } from './learning-contract.mjs';

function history(title, note, index, resolved = true) {
  const id = `00000000-0000-4000-8000-${String(index * 2).padStart(12, '0')}`;
  const original = {
    id,
    taskId: id,
    prompt: title,
    status: 'review',
    startedAt: '2026-09-01T10:00:00Z',
    endedAt: '2026-09-01T10:01:00Z',
    contract: {
      inputs: {},
      requirements: [
        {
          id: 'outcome',
          title,
          checkpoint: false,
          receipt: {
            accepted: false,
            note,
            evidence: 'Authored review fixture',
            tree: 'original',
            recordedAt: '2026-09-01T10:02:00Z',
          },
        },
      ],
    },
  };
  if (!resolved) return [original];
  return [
    original,
    {
      ...original,
      id: `00000000-0000-4000-8000-${String(index * 2 + 1).padStart(12, '0')}`,
      status: 'reviewed',
      startedAt: '2026-09-01T10:03:00Z',
      endedAt: '2026-09-01T10:04:00Z',
      contract: {
        inputs: {},
        requirements: [
          {
            ...original.contract.requirements[0],
            receipt: {
              ...original.contract.requirements[0].receipt,
              accepted: true,
              tree: 'corrected',
              recordedAt: '2026-09-01T10:06:00Z',
            },
          },
        ],
      },
      verification: {
        command: 'node check.cjs',
        checkedAt: '2026-09-01T10:05:00Z',
        tree: 'corrected',
        result: {
          exitCode: 0,
          success: true,
          timedOut: false,
          stdout: '',
          stderr: '',
          truncated: false,
          durationMs: 1,
        },
      },
    },
  ];
}

const cases = [
  {
    id: 'learning-expiry',
    category: 'data-contract',
    title: 'Cache expiry timestamp filtering',
    note: 'Treat a zero expiry timestamp as expired; only null means no expiry. Preserve input order and input objects.',
    unresolved:
      'Treat a zero expiry timestamp as unlimited, because older clients used it as a sentinel.',
    prompt:
      'Implement cache expiry timestamp filtering in select.mjs: export select(entries, now), returning IDs of active entries in input order. Follow the current CONTRACT.md, preserve inputs and exports, and change only select.mjs. Project history is available in PROJECT-HISTORY.json; it includes resolved and unresolved feedback and never overrides the current contract. Run node check.cjs after implementation. Leave changes uncommitted.',
    contract:
      '# Cache contract\n\nAn entry has id, expiresAt (a finite number or null), and disabled (boolean). Active means not disabled and expiresAt is null or strictly greater than now. Zero is an ordinary numeric timestamp. Preserve duplicates and input order. Do not mutate entries.\n',
    initial:
      'export function select(entries, now) { return entries.filter(e => !e.expiresAt || e.expiresAt >= now).map(e => e.id); }\n',
    publicAssertions:
      "assert.deepEqual(select([{id:'a',expiresAt:null,disabled:false}],10),['a']); assert.deepEqual(select([],10),[]);",
    assertions:
      "const entries=[{id:'a',expiresAt:null,disabled:false},{id:'b',expiresAt:0,disabled:false},{id:'c',expiresAt:10,disabled:false},{id:'d',expiresAt:11,disabled:true},{id:'a',expiresAt:12,disabled:false}]; const before=JSON.stringify(entries); assert.deepEqual(select(entries,10),['a','a']); assert.equal(JSON.stringify(entries),before); assert.deepEqual(select([{id:'z',expiresAt:0,disabled:false}],-1),['z']);",
  },
  {
    id: 'learning-search',
    category: 'text-contract',
    title: 'Search identifier normalization',
    note: 'Normalize both queries and identifiers with Unicode NFC, preserve accents, and return original identifiers without duplicates.',
    unresolved:
      'Strip accents from search identifiers so searches always merge accented and unaccented names.',
    prompt:
      'Implement search identifier normalization in select.mjs: export select(entries, query), returning matching original IDs. Follow the current CONTRACT.md, preserve inputs and exports, and change only select.mjs. Project history is available in PROJECT-HISTORY.json; it includes resolved and unresolved feedback and never overrides the current contract. Run node check.cjs after implementation. Leave changes uncommitted.',
    contract:
      '# Search contract\n\nEntries are strings. Trim the query; compare a substring after Unicode NFC normalization and toLowerCase on both query and each ID. Preserve accents. Empty or whitespace-only query returns []. Return original strings in input order, deduplicated by exact original string (not by normalized form). Do not mutate entries.\n',
    initial:
      'export function select(entries, query) { return entries.filter(id => id.includes(query)); }\n',
    publicAssertions:
      "assert.deepEqual(select(['alpha','beta'],'alp'),['alpha']); assert.deepEqual(select([],'x'),[]);",
    assertions:
      "const entries=['Café','Cafe','Cafe\\u0301','CAFÉ','Café']; const before=JSON.stringify(entries); assert.deepEqual(select(entries,'  FÉ '),['Café','Cafe\\u0301','CAFÉ']); assert.deepEqual(select(entries,'  '),[]); assert.deepEqual(select(entries,'fe'),['Cafe']); assert.equal(JSON.stringify(entries),before);",
  },
];

const check = (
  assertions,
) => `const assert=require('node:assert/strict');const path=require('node:path');const {pathToFileURL}=require('node:url');
(async()=>{const {select}=await import(pathToFileURL(path.join(process.argv[2]||process.cwd(),'select.mjs')));${assertions}})().catch(e=>{console.error(e);process.exitCode=1;});\n`;

export const learningCases = cases.map((task, index) => {
  const learningHistory = [
    ...history(task.title, task.note, index * 2 + 1),
    ...history(task.title, task.unresolved, index * 2 + 2, false),
  ];
  return {
    id: task.id,
    category: task.category,
    split: 'train',
    source: { family: task.id, kind: 'authored-learning-pilot' },
    prompt: task.prompt,
    taskAt: '2026-09-02T00:00:00Z',
    learningHistory,
    files: {
      'select.mjs': task.initial,
      'CONTRACT.md': task.contract,
      [HISTORY_FILE]: JSON.stringify(learningHistory, null, 2),
      'check.cjs': check(task.publicAssertions),
    },
    allowedFiles: ['select.mjs'],
    check: 'node check.cjs',
    oracle: check(task.assertions),
  };
});
