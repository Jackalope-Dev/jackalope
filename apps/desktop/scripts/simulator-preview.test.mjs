import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeElement,
  elementAt,
  framePosition,
  highlightBox,
  simulatorStatus,
} from '../src/lib/simulator-preview.ts';

test('pointer positions map to fractions of the frame and nothing outside it', () => {
  const rect = { left: 100, top: 50, width: 200, height: 400 };
  assert.deepEqual(framePosition(200, 250, rect), { x: 0.5, y: 0.5 });
  assert.deepEqual(framePosition(100, 50, rect), { x: 0, y: 0 });
  assert.deepEqual(framePosition(300, 450, rect), { x: 1, y: 1 });
  assert.equal(framePosition(99, 250, rect), null);
  assert.equal(framePosition(200, 451, rect), null);
  assert.equal(framePosition(200, 250, { ...rect, width: 0 }), null);
});

const elements = {
  screen: [402, 874],
  elements: [
    { type: 'application', label: 'Demo', frame: [0, 0, 402, 874] },
    { type: 'window', frame: [0, 0, 402, 874] },
    { type: 'other', frame: [20, 100, 360, 200] },
    { type: 'cell', label: 'Profile', frame: [20, 100, 360, 60] },
    { type: 'button', label: 'Edit', frame: [300, 110, 60, 40] },
  ],
};

test('hovering finds the smallest labelled element, as Select saves it', () => {
  const at = (x, y) => elementAt(elements, { x: x / 402, y: y / 874 });
  assert.equal(at(320, 120)?.label, 'Edit');
  assert.equal(at(40, 120)?.label, 'Profile');
  assert.equal(at(40, 250)?.type, 'other');
  assert.equal(elementAt({ screen: null, elements: elements.elements }, { x: 0.5, y: 0.5 }), null);
});

test('highlights sit over the element in percent of the frame', () => {
  assert.deepEqual(highlightBox(elements.elements[4], [402, 874]), {
    left: '74.63%',
    top: '12.59%',
    width: '14.93%',
    height: '4.58%',
  });
  assert.equal(describeElement(elements.elements[4]), 'button “Edit”');
  assert.equal(
    describeElement({ type: 'image', identifier: 'logo', frame: [0, 0, 1, 1] }),
    'image #logo',
  );
  assert.equal(describeElement({ type: 'other', frame: [0, 0, 1, 1] }), 'other');
});

test('the status line follows the build and input driver', () => {
  const base = {
    udid: 'U',
    device: 'Jackalope abcd1234',
    bundleId: null,
    input: 'off',
    inputError: null,
    error: null,
    appearance: null,
    contentSize: null,
    landscape: false,
  };
  assert.equal(simulatorStatus({ ...base, phase: 'building' }), 'Building for Jackalope abcd1234…');
  assert.match(simulatorStatus({ ...base, phase: 'running', input: 'starting' }), /preparing taps/);
  assert.equal(
    simulatorStatus({ ...base, phase: 'running', input: 'ready' }),
    'Running on Jackalope abcd1234',
  );
  assert.equal(simulatorStatus(null), 'Starting…');
});
