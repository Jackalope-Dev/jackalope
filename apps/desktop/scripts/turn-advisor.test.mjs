import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTOMATION_PRESETS, automationWrites } from '../src/lib/project-automation.ts';
import { advisorNotes, advisorStatus, defaultAdvisorSettings } from '../src/lib/turn-advisor.ts';

const note = (severity, text, extra = {}) => ({ severity, text, ...extra });
const review = (fields) => ({ status: 'done', notes: [], startedAt: 'now', ...fields });

test('delivered concerns and blockers are shown as sent; asides and repeats stay with the person', () => {
  const blocker = note('blocker', 'The migration drops data.', { path: 'db/1.sql:3' });
  const concern = note('concern', 'No test covers blank names.');
  const aside = note('aside', 'The label could be shorter.');
  const repeated = note('concern', 'Errors are swallowed.', { repeated: true });
  const sent = review({ notes: [blocker, concern, aside, repeated], delivery: 'followUp' });
  assert.deepEqual(advisorNotes(sent), { sent: [blocker, concern], kept: [aside, repeated] });
  assert.equal(
    advisorStatus(sent, 'Claude Code'),
    'Claude Code sent 2 notes to the agent as a follow-up.',
  );
  assert.equal(
    advisorStatus(review({ notes: [concern], delivery: 'message' }), 'Codex'),
    'Codex sent 1 note to the agent as a message.',
  );
});

test('notes that never reached the agent are all kept, with the reason they stayed', () => {
  const concern = note('concern', 'No test covers blank names.');
  const chained = review({
    notes: [concern],
    reason: 'The agent already worked through 2 advisor follow-ups in a row.',
  });
  assert.deepEqual(advisorNotes(chained), { sent: [], kept: [concern] });
  assert.equal(advisorStatus(chained, 'Codex'), chained.reason);
  const asides = review({ notes: [note('aside', 'A'), note('aside', 'B')] });
  assert.equal(advisorStatus(asides, 'Codex'), 'Codex left 2 notes for you.');
  // A review still reading, or one that failed, never counts its notes as sent.
  const reading = review({ status: 'reviewing', notes: [concern], delivery: 'followUp' });
  assert.deepEqual(advisorNotes(reading).sent, []);
});

test('the status line covers reading, quiet, skipped and failed reviews', () => {
  assert.equal(
    advisorStatus(review({ status: 'reviewing' }), 'Gemini'),
    'Gemini is reading this turn…',
  );
  assert.equal(advisorStatus(review({}), 'Gemini'), 'Gemini read this turn and had no notes.');
  assert.equal(
    advisorStatus(review({ status: 'skipped', reason: 'Every execution slot was busy.' }), 'x'),
    'Every execution slot was busy.',
  );
  assert.equal(advisorStatus(review({ status: 'skipped' }), 'x'), 'The advisor did not run.');
  assert.equal(
    advisorStatus(review({ status: 'failed', reason: 'The reply is not valid JSON.' }), 'Codex'),
    'Codex didn’t finish: The reply is not valid JSON.',
  );
});

test('defaults match the native settings and presets keep the advisor as saved', () => {
  assert.deepEqual(defaultAdvisorSettings, { enabled: false, maxNotes: 3, maxReviews: 10 });
  const advisor = { enabled: true, maxNotes: 2, maxReviews: 5 };
  const plan = { questionCap: 3, exportPath: 'docs/plans/{slug}.md', advisor };
  assert.deepEqual(automationWrites(AUTOMATION_PRESETS['hands-on'], plan).plan.advisor, advisor);
});
