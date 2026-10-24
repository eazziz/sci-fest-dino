import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControls, updateControls, loseTracking } from './poseControls.mjs';

function calibrated(y = 0.4, width = 0.2) {
  const s = createControls();
  for (let t = 0; t <= 1000; t += 40) {
    assert.equal(updateControls(s, y, width, t), false);
  }
  assert.equal(s.ready, true);
  let time = 1000;
  return { s, move: offset => updateControls(s, y + offset * width, width, time += 40) };
}

test('duck then fast return to standing does not jump', () => {
  const {s, move} = calibrated();
  assert.equal(move(0.5), false);
  assert.equal(s.pose, 'duck');
  assert.equal(move(0), false);
  assert.equal(s.pose, 'stand');
});
test('jump once, require neutral before another jump', () => {
  const {move} = calibrated();
  assert.equal(move(-0.3), true);
  assert.equal(move(-0.4), false);
  assert.equal(move(-0.23), false);
  assert.equal(move(-0.3), false);
  assert.equal(move(0), false);
  assert.equal(move(-0.3), true);
});
test('duck release hysteresis and direct duck-to-high rejection', () => {
  const {s, move} = calibrated();
  move(0.5);
  move(0.3);
  assert.equal(s.pose, 'duck');
  assert.equal(move(-0.4), false);
  move(0);
  assert.equal(move(-0.3), true);
});
test('same normalized movements for different heights and scales', () => {
  for (const y of [0.25, 0.6]) for (const width of [0.08, 0.3]) {
    const {s, move} = calibrated(y, width);
    move(0.5);
    assert.equal(s.pose, 'duck');
    move(0);
    assert.equal(move(-0.3), true);
  }
});
test('squatting down to wind up for a jump neither ducks nor blocks the jump', () => {
  const {s, move} = calibrated();
  for (const dip of [0.3, 0.38, 0.42, 0.38]) {
    assert.equal(move(dip), false);
    assert.notEqual(s.pose, 'duck');
  }
  assert.equal(move(-0.3), true); // straight from the squat into the jump
});
test('tracking loss releases duck and requires neutral to rearm', () => {
  const {s, move} = calibrated();
  move(0.5);
  loseTracking(s);
  assert.equal(s.pose, 'stand');
  assert.equal(move(-0.3), false);
  move(0);
  assert.equal(move(-0.3), true);
});
test('calibration resets when moving or tracking is missing', () => {
  const s = createControls();
  updateControls(s, 0.4, 0.2, 0);
  updateControls(s, 0.5, 0.2, 500);
  assert.equal(s.samples.length, 1);
  assert.equal(s.ready, false);
  loseTracking(s);
  assert.equal(s.samples.length, 0);
  updateControls(s, NaN, 0.2, 600);
  assert.equal(s.ready, false);
});
