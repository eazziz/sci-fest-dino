import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerSession, updatePlayerSession, describePose } from './playerSession.mjs';

const aspect = 4 / 3;
function person({ x = 0.5, y = 0.35, width = 0.2, hips = true, crouch = false } = {}) {
  const p = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  const set = (i, px, py) => { p[i] = { x: px, y: py, visibility: 0.99 }; };
  set(11, x - width / aspect / 2, y);
  set(12, x + width / aspect / 2, y);
  set(15, x - width / aspect / 2, y + width);
  set(16, x + width / aspect / 2, y + width);
  if (hips) for (const [hip, knee, ankle, sign] of [[23, 25, 27, -1], [24, 26, 28, 1]]) {
    const hx = x + sign * width * 0.3 / aspect;
    set(hip, hx, y + width * 1.3);
    set(knee, hx + (crouch ? sign * width / aspect : 0), y + width * 2.1);
    set(ankle, hx, y + width * 2.9);
  }
  return p;
}

function harness() {
  const session = createPlayerSession();
  let time = -40;
  return { session, tick(poses, playing = false, dt = 40) {
    return updatePlayerSession(session, poses, time += dt, aspect, playing);
  }, settle(p = person(), playing = false) {
    let result;
    for (let i = 0; i < 27; i++) result = this.tick([p], playing);
    return result;
  } };
}

test('walk up, settle, then first jump fires without a gesture or button', () => {
  const h = harness();
  assert.equal(h.tick([]).phase, 'waiting');
  assert.equal(h.tick([person()]).phase, 'settling');
  assert.equal(h.settle().phase, 'ready');
  assert.equal(h.tick([person({ y: 0.28 })]).jump, true);
});

test('child and adult get independent baseline and body-relative thresholds', () => {
  for (const [y, width] of [[0.6, 0.1], [0.22, 0.3]]) {
    const h = harness();
    assert.equal(h.settle(person({ y, width })).phase, 'ready');
    assert.ok(Math.abs(h.session.controls.baseline - y) < 0.0001);
    assert.equal(h.tick([person({ y: y - width * 0.3, width })], true).jump, true);
  }
});

test('passers-by and spectators outside the entry area cannot calibrate', () => {
  const h = harness();
  assert.equal(h.settle(person({ x: 0.85 })).phase, 'waiting');
  assert.equal(h.session.controls.ready, false);
  for (let i = 0; i < 8; i++) h.tick([person()]);
  h.tick([]);
  assert.equal(h.session.controls.ready, false);
});

test('choose centered player and preserve identity when detector order changes', () => {
  const h = harness();
  const player = person();
  const spectator = person({ x: 0.76, y: 0.25 });
  for (let i = 0; i < 27; i++) assert.equal(h.tick([spectator, player]).landmarks, player);
  assert.equal(h.tick([player, spectator], true).landmarks, player);
  assert.equal(h.tick([spectator, player], true).landmarks, player);
});

test('crowded acquisition waits rather than guessing between equally centered people', () => {
  const h = harness();
  for (let i = 0; i < 30; i++) {
    const r = h.tick([person({ x: 0.45 }), person({ x: 0.55 })]);
    assert.equal(r.tracked, false);
    assert.equal(r.message, 'One player in the middle');
  }
});

test('overlap with another plausible track pauses controls', () => {
  const h = harness();
  h.settle();
  const r = h.tick([person({ x: 0.49 }), person({ x: 0.51 })], true);
  assert.equal(r.tracked, false);
  assert.equal(r.jump, false);
});

test('walking sideways or approaching the camera does not count as settled', () => {
  for (const property of ['x', 'width']) {
    const h = harness();
    for (let i = 0; i < 80; i++) {
      h.tick([person({ [property]: property === 'x' ? 0.5 + (i % 8) * 0.01 : 0.18 + (i % 8) * 0.006 })]);
      assert.equal(h.session.controls.ready, false);
    }
  }
});

test('standing checks reject visible crouch, raised arms and sideways lean', () => {
  const poses = [person({ crouch: true }), person(), person()];
  poses[1][15].y = 0.2;
  poses[2][23].x += 0.2;
  poses[2][24].x += 0.2;
  for (const p of poses) {
    const h = harness();
    assert.equal(h.settle(p).phase, 'settling');
    assert.equal(h.session.controls.ready, false);
  }
});

test('hips required for acquisition, feet optional, low-confidence shoulders rejected', () => {
  const h = harness();
  assert.equal(h.settle(person({ hips: false })).phase, 'waiting');
  const p = person();
  p[27].visibility = p[28].visibility = 0;
  assert.equal(h.settle(p).phase, 'ready');
  p[11].visibility = 0.2;
  assert.equal(h.tick([p], true).tracked, false);
});

test('no clipped-head calibration or malformed pose', () => {
  assert.equal(describePose([], aspect), null);
  assert.equal(describePose(person(), NaN), null);
  const h = harness();
  assert.equal(h.settle(person({ y: 0.04 })).phase, 'settling');
  assert.equal(h.session.controls.ready, false);
});

test('calibration freezes throughout jumping and ducking, even with hidden hips', () => {
  const h = harness();
  h.settle();
  const { baseline, width } = h.session.controls;
  assert.equal(h.tick([person({ y: 0.28, hips: false })], true).jump, true);
  h.tick([person()], true);
  for (let i = 0; i < 80; i++) {
    assert.equal(h.tick([person({ y: 0.45, hips: false })], true).duck, true);
  }
  assert.equal(h.session.controls.baseline, baseline);
  assert.equal(h.session.controls.width, width);
});

test('brief loss retains calibration but requires neutral before another jump', () => {
  const h = harness();
  h.settle();
  h.tick([person()], true);
  for (let i = 0; i < 10; i++) assert.equal(h.tick([], true).tracked, false);
  assert.equal(h.session.controls.ready, true);
  assert.equal(h.tick([person({ y: 0.28 })], true).jump, false);
  h.tick([person()], true);
  assert.equal(h.tick([person({ y: 0.28 })], true).jump, true);
});

test('departure clears old calibration and new child settles afresh', () => {
  const h = harness();
  h.settle();
  h.tick([person()], true);
  let departed = false;
  for (let i = 0; i < 48; i++) departed ||= h.tick([], true).departed;
  assert.equal(departed, true);
  assert.equal(h.session.controls.ready, false);
  assert.equal(h.session.track, null);
  assert.equal(h.settle(person({ y: 0.6, width: 0.1 })).phase, 'ready');
  assert.ok(Math.abs(h.session.controls.baseline - 0.6) < 0.0001);
});

test('a visible spectator cannot keep the departing player session alive', () => {
  const h = harness();
  h.settle();
  let departed = false;
  for (let i = 0; i < 46; i++) {
    const r = h.tick([person({ x: 0.8 })], true);
    assert.equal(r.tracked, false);
    departed ||= r.departed;
  }
  assert.equal(departed, true);
});

test('crossing exit boundary tolerates brief excursion then releases player', () => {
  const h = harness();
  h.settle();
  for (const x of [0.58, 0.66, 0.74, 0.8]) assert.equal(h.tick([person({ x })], true).tracked, true);
  assert.equal(h.tick([person({ x: 0.86 })], true).tracked, false);
  assert.equal(h.tick([person({ x: 0.8 })], true).tracked, true);
});

test('camera/tab gap cannot complete calibration or revive an expired player', () => {
  const h = harness();
  for (let i = 0; i < 20; i++) h.tick([person()]);
  assert.equal(h.tick([person()], false, 500).phase, 'settling');
  assert.equal(h.session.controls.ready, false);
  h.settle();
  const r = h.tick([person()], true, 2500);
  assert.equal(r.departed, true);
  assert.equal(r.jump, false);
  assert.equal(h.session.controls.ready, false);
});

test('between rounds automatically remeasure standing position, never the death crouch', () => {
  const h = harness();
  h.settle();
  h.tick([person()], true);
  const crouch = person({ crouch: true });
  h.tick([crouch], true);
  assert.equal(h.settle(crouch).phase, 'settling');
  assert.equal(h.session.controls.ready, false);
  assert.equal(h.settle(person({ y: 0.38 })).phase, 'ready');
  assert.ok(Math.abs(h.session.controls.baseline - 0.38) < 0.0001);
});

test('diagnostics expose missing hips and optional legs without changing the gates', () => {
  const h = harness();
  let r = h.tick([person({ hips: false })]);
  assert.equal(r.debug.checks.find(c => c.id === 'hips').status, 'fail');
  assert.equal(r.debug.checks.find(c => c.id === 'selection').status, 'fail');
  assert.equal(r.debug.checks.find(c => c.id === 'duration').status, 'wait');
  const p = person();
  p[27].visibility = p[28].visibility = 0;
  r = h.tick([p]);
  assert.equal(r.debug.checks.find(c => c.id === 'LeftLeg').status, 'skip');
  assert.equal(r.debug.checks.find(c => c.id === 'RightLeg').status, 'skip');
  assert.equal(h.settle(p).phase, 'ready');
});

test('diagnostics name the posture check that resets calibration', () => {
  const h = harness();
  const p = person();
  p[15].y = 0.2;
  const r = h.tick([p]);
  assert.equal(r.debug.checks.find(c => c.id === 'arms').status, 'fail');
  assert.equal(r.debug.lastReset.reason, 'Arms lowered');
  assert.equal(r.debug.sampleCount, 0);
});

test('diagnostics report real slow update intervals and preserve reset history', () => {
  const h = harness();
  for (let i = 0; i < 10; i++) h.tick([person()]);
  let r = h.tick([person()], false, 450);
  assert.equal(r.debug.gapMs, 450);
  assert.equal(r.debug.checks.find(c => c.id === 'frameGap').status, 'fail');
  assert.match(r.debug.lastReset.reason, /Update gap exceeded 300 ms/);
  assert.equal(r.debug.sampleCount, 1);
  r = h.tick([person()]);
  assert.equal(r.debug.checks.find(c => c.id === 'frameGap').status, 'pass');
  assert.match(r.debug.lastReset.reason, /Update gap exceeded/);
});

test('diagnostics retain the shoulder motion that caused a sample reset', () => {
  const h = harness();
  for (let i = 0; i < 8; i++) h.tick([person()]);
  const p = person();
  p[11].y += 0.04;
  p[12].y += 0.04;
  const r = h.tick([p]);
  assert.equal(r.debug.checks.find(c => c.id === 'stableShoulders').status, 'fail');
  assert.equal(r.debug.lastReset.reason, 'Stable shoulder height');
  assert.equal(r.debug.sampleCount, 1);
});

test('diagnostics report each pose and the actual completed sample count', () => {
  const h = harness();
  let r;
  for (let i = 0; i < 27; i++) r = h.tick([person({ x: .85 }), person()]);
  assert.equal(r.debug.detected, 2);
  assert.equal(r.debug.focusedIndex, 1);
  assert.equal(r.debug.candidates.length, 2);
  assert.equal(r.debug.candidates[0].checks.find(c => c.id === 'center').status, 'fail');
  assert.equal(r.debug.calibrated, true);
  assert.equal(r.debug.sampleCount, 26);
  assert.equal(r.debug.elapsedMs, 1000);
});

test('diagnostics distinguish the smaller calibration entry area from the tracking area', () => {
  const h = harness();
  h.tick([person({ x: .69 })]);
  const r = h.tick([person({ x: .74 })]);
  assert.equal(r.tracked, true);
  assert.equal(r.debug.checks.find(c => c.id === 'center').status, 'fail');
  assert.equal(r.debug.checks.find(c => c.id === 'trackingArea').status, 'pass');
  assert.equal(r.debug.lastReset.reason, 'Inside entry area');
});
