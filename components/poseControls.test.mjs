import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControls, updateControls, loseTracking, ZONES } from './poseControls.mjs';

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

// A realistic standing jump sampled at 30 fps: dip, push off, flight, landing
// absorb, recover. Offsets are in calibrated shoulder widths (+ = down).
function jumpTrajectory() {
  const keys = [[0, 0], [100, 0], [300, 0.35], [380, 0.38], [520, -0.05], [600, -0.35],
    [750, -0.5], [900, -0.35], [1000, 0], [1100, 0.28], [1300, 0.05], [1500, 0], [2000, 0]];
  const out = [];
  for (let t = 0; t <= 2000; t += 33) {
    const i = keys.findIndex(k => k[0] >= t);
    const [t1, o1] = keys[Math.max(i, 1) - 1], [t2, o2] = keys[Math.max(i, 1)];
    out.push({ t, offset: o1 + (o2 - o1) * (t - t1) / (t2 - t1 || 1) });
  }
  return out;
}

test('upward push-off fires the jump before the shoulders reach the jump line', () => {
  const s = createControls();
  let t0 = 0;
  for (; t0 <= 1100; t0 += 33) updateControls(s, 0.4, 0.2, t0);
  assert.equal(s.ready, true);
  const fires = [];
  let lineTime = null;
  for (const { t, offset } of jumpTrajectory()) {
    if (updateControls(s, 0.4 + offset * 0.2, 0.2, t0 + t)) fires.push({ t, offset });
    if (lineTime === null && offset <= ZONES.jump) lineTime = t;
  }
  assert.equal(fires.length, 1, 'exactly one jump, no landing double-jump');
  assert.ok(fires[0].offset > ZONES.jump, 'fired before the line');
  assert.ok(lineTime - fires[0].t >= 50, 'fired ' + (lineTime - fires[0].t) + ' ms earlier');
});

test('squatting and standing back up never registers as a jump', () => {
  // Smooth (eased) stand-ups from a 0.4 squat, quick to casual, sampled at 30 fps,
  // ending with a slight rise onto the toes.
  for (const T of [250, 350, 500]) {
    const s = createControls();
    let t = 0;
    for (; t <= 1100; t += 33) updateControls(s, 0.4, 0.2, t);
    const at = o => updateControls(s, 0.4 + o * 0.2, 0.2, t += 33);
    for (let i = 0; i < 6; i++) assert.equal(at(0.4 * i / 6), false);  // squat down
    for (let u = 0; u <= T; u += 33) {
      const o = 0.4 * (1 + Math.cos(Math.PI * Math.min(u / T, 1))) / 2;
      assert.equal(at(o), false, 'stand-up over ' + T + ' ms fired at offset ' + o.toFixed(2));
    }
    for (const o of [0, -0.03, -0.03, 0]) assert.equal(at(o), false);
  }
});

test('rise trigger ignores jitter, slow stand-ups and standing up out of a duck', () => {
  const { s, move } = calibrated();
  for (let i = 0; i < 30; i++) assert.equal(move(i % 2 ? 0.04 : -0.04), false); // jitter
  for (let o = 0.4; o >= 0; o -= 0.02) assert.equal(move(o), false);            // slow stand-up
  move(0.6); move(0.6);
  assert.equal(s.pose, 'duck');
  assert.equal(move(0.3), false); // fast rise out of a duck
  assert.equal(move(0.1), false);
});

test('a slow jumper still triggers via the jump line fallback', () => {
  const { move } = calibrated();
  let fired = false;
  for (let o = 0; o >= -0.35; o -= 0.03) fired ||= move(o); // ~1.5 widths/s, below RISE speed
  assert.equal(fired, true);
});
