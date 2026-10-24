import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunner, startRunner, jumpRunner, stepRunner, makePattern, RUNNER, difficulty } from './runnerEngine.mjs';
import { createLaneControls, calibrateLanes, updateLane, laneBoundaries, RUNNER_AREA } from './runnerControls.mjs';
import { createPlayerSession, updatePlayerSession } from './playerSession.mjs';

function running() { const s = createRunner(); startRunner(s); for (let i = 0; i < 25; i++) stepRunner(s, .1); return s; }
function obstacle(kind, lane = 0, z = 0.4) { return { id: 1, kind, lane, z, done: false }; }
function simulate(s, seconds, input = {}) { for (let i = 0; i < Math.ceil(seconds * 60); i++) stepRunner(s, 1/60, input); }

test('lane zones are mirrored and scale to both children and adults', () => {
  for (const width of [.10, .30]) {
    const l = createLaneControls(); calibrateLanes(l, .53, width, 4/3);
    assert.equal(updateLane(l, .53 + l.scale * .8, 0), -1);
    assert.equal(updateLane(l, .53, 1000), 0);
    assert.equal(updateLane(l, .53 - l.scale * .8, 2000), 1);
    const b = laneBoundaries(l);
    assert.ok(Math.abs(b.center - .47) < 1e-9);
    assert.ok(b.left < b.center && b.center < b.right);
  }
});
test('jitter around the lane boundary does not cause repeated switches', () => {
  const l = createLaneControls(); calibrateLanes(l, .5, .2, 1);
  updateLane(l, .34, 0);
  for (let i = 1; i < 30; i++) assert.equal(updateLane(l, .5 - (.58 + .05 * Math.sin(i)) * .2, i * 40), 1);
  assert.equal(updateLane(l, .5, 2000), 0);
  assert.equal(updateLane(l, NaN, 2040), 0);
});
test('large off-center players can reach both lanes before leaving the tracking area', () => {
  for (const x of [.3, .7]) {
    const s=createLaneControls(); calibrateLanes(s,x,.5,1);
    assert.equal(updateLane(s,RUNNER_AREA.exitLeft+.01,0),1);
    assert.equal(updateLane(s,RUNNER_AREA.exitRight-.01,1000),-1);
  }
});
test('paused tracking freezes distance, countdown, objects and jump physics', () => {
  const s = createRunner(); startRunner(s);
  stepRunner(s, .1, { paused: true }); assert.equal(s.countIn, 2.4);
  const r = running(); jumpRunner(r); r.objects.push(obstacle('coin', 0, 5));
  const before = JSON.stringify(r);
  stepRunner(r, .1, { paused: true }); assert.equal(JSON.stringify(r), before);
});
test('lane changes physically move the runner and can dodge a block', () => {
  const s = running(); s.objects.push(obstacle('block', 0, 12));
  simulate(s, 1.1, { lane: 1 });
  assert.equal(s.phase, 'running'); assert.equal(s.x, RUNNER.laneWidth);
});
test('barriers collide during a dropped frame; jump clears a hurdle only with height', () => {
  const s = running(); s.objects.push(obstacle('block', 0, 1)); stepRunner(s, .1);
  assert.equal(s.phase, 'over');
  const j = running(); jumpRunner(j); simulate(j, .22); j.objects.push(obstacle('hurdle'));
  stepRunner(j, .1); assert.equal(j.phase, 'running');
  const low = running(); low.objects.push(obstacle('hurdle')); stepRunner(low, .1);
  assert.equal(low.phase, 'over');
});
test('duck clears a gate; jumping or standing hits it; blocks cannot be jumped', () => {
  for (const [kind, duck, y, phase] of [['gate',true,0,'running'],['gate',false,0,'over'],['gate',true,1,'over'],['block',false,2,'over']]) {
    const s = running(); s.y = y; s.objects.push(obstacle(kind)); stepRunner(s, .04, { duck }); assert.equal(s.phase, phase);
  }
});
test('jump cannot repeat in midair or while crouching', () => {
  const s = running(); assert.ok(jumpRunner(s)); assert.equal(jumpRunner(s), false);
  simulate(s, 1); s.duck = true; assert.equal(jumpRunner(s), false);
});
test('coins score once, death freezes score, restart clears the old round', () => {
  const s = running(); s.objects.push(obstacle('coin')); stepRunner(s, .05);
  assert.equal(s.coins, 1); assert.ok(s.score >= 25); stepRunner(s, .05); assert.equal(s.coins, 1);
  s.objects.push(obstacle('block')); stepRunner(s, .04); const score = s.score;
  stepRunner(s, .1); assert.equal(s.score, score);
  startRunner(s); assert.equal(s.coins, 0); assert.equal(s.score, 0); assert.equal(s.objects.length, 0);
});
test('hundreds of generated rows leave one passable lane with coins and recovery time', () => {
  let seed = 7125; const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let n = 0; n < 1500; n++) {
    const s = createRunner(); s.elapsed = n % 150; s.speed = Math.min(RUNNER.maxSpeed, 13 + s.elapsed * RUNNER.speedRamp);
    s.lastOpen = [-1, 0, 1][n % 3]; makePattern(s, random);
    const solid = new Set(s.objects.filter(o => ['block', 'bus', 'truck'].includes(o.kind)).map(o => o.lane));
    assert.ok(solid.size <= 2); assert.ok(s.spawnIn >= 1.5);
    const coins = s.objects.filter(o => o.kind === 'coin');
    assert.ok(coins.every(o => !solid.has(o.lane)));
    // Everything in a row reaches the player together, including faster vehicles.
    const arrival = s.objects.filter(o => o.kind !== 'coin').map(o => o.z / (s.speed + o.vz));
    assert.ok(arrival.every(t => Math.abs(t - arrival[0]) < 1e-9));
    if (s.elapsed < 10) assert.ok(s.objects.every(o => ['block', 'coin'].includes(o.kind)));
  }
});
test('oncoming vehicles approach faster than scenery and their whole length collides', () => {
  const s = running(); s.objects.push({ ...obstacle('bus', 0, 30), vz: 8 });
  const z = s.objects[0].z; stepRunner(s, .1);
  assert.ok(z - s.objects[0].z > s.speed * .1 + .5);
  const side = running(); side.objects.push({ ...obstacle('truck', 0, -3), vz: 8 });
  stepRunner(side, .01); assert.equal(side.phase, 'over'); assert.match(side.crash, /truck/);
  const jumper = running(); jumper.y = 2; jumper.objects.push({ ...obstacle('bus', 0, .3), vz: 8 });
  stepRunner(jumper, .01); assert.equal(jumper.phase, 'over');
});

// A careful player with human reaction time: waits before reacting to a row, moves
// at the game's lane speed, then jumps or ducks only when the obstacle is close.
function bot(s, reaction) {
  const ahead = s.objects.filter(o => o.kind !== 'coin' && !o.done && o.z > -RUNNER.hitDepth);
  const rows = new Map();
  for (const o of ahead) { const t = o.z / (s.speed + o.vz); const r = rows.get(o.row) ?? { t, items: [] }; r.t = Math.min(r.t, t); r.items.push(o); rows.set(o.row, r); }
  const next = [...rows.values()].sort((a, b) => a.t - b.t)[0];
  const input = { lane: s.lane, duck: false };
  if (!next) return input;
  if (next.items[0].spawnedAt === undefined) next.items.forEach(o => o.spawnedAt ??= s.elapsed);
  if (s.elapsed - next.items[0].spawnedAt >= reaction) {
    const solid = new Set(next.items.filter(o => ['block','bus','truck'].includes(o.kind)).map(o => o.lane));
    const target = [-1, 0, 1].find(l => !solid.has(l));
    // Wait for a passing vehicle's tail to clear before cutting across its lane.
    const tail = s.objects.some(o => o.vz && o.z < RUNNER.hitDepth && o.z + 6 > -RUNNER.hitDepth
      && o.lane >= Math.min(s.lane, target) && o.lane <= Math.max(s.lane, target));
    if (!tail) input.lane = target;
  }
  const mine = next.items.find(o => o.lane === input.lane && ['hurdle', 'gate'].includes(o.kind));
  if (mine?.kind === 'hurdle' && next.t < .3) jumpRunner(s);
  if (mine?.kind === 'gate' && next.t < .45) input.duck = true;
  return input;
}
test('every pattern is beatable with a 0.75 s reaction time for two minutes', () => {
  for (let seedStart = 1; seedStart <= 40; seedStart++) {
    let seed = seedStart; const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const s = createRunner(); startRunner(s);
    for (let i = 0; i < 60 * 125 && s.phase !== 'over'; i++) {
      for (const o of s.objects) o.spawnedAt ??= s.elapsed;
      stepRunner(s, 1 / 60, bot(s, .75), random);
    }
    assert.notEqual(s.phase, 'over', `seed ${seedStart} crashed at ${s.elapsed.toFixed(1)}s: ${s.crash}`);
  }
});
test('standing still loses quickly once the warm-up is over', () => {
  const times = [];
  for (let seedStart = 1; seedStart <= 30; seedStart++) {
    let seed = seedStart; const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const s = createRunner(); startRunner(s);
    for (let i = 0; i < 60 * 120 && s.phase !== 'over'; i++) stepRunner(s, 1 / 60, {}, random);
    times.push(s.elapsed);
  }
  assert.ok(Math.max(...times) < 20, times.join(','));
});

const aspect = 4/3;
function person(x = .5, y = .30, width = .2) {
  const p = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (const [a,b,dy,w] of [[11,12,0,1],[15,16,1,1],[23,24,1.3,.6],[25,26,2.1,.6],[27,28,2.9,.6]]) {
    p[a] = { x: x-width/aspect*w/2, y: y+dy*width, visibility:.99 };
    p[b] = { x: x+width/aspect*w/2, y: y+dy*width, visibility:.99 };
  }
  return p;
}
test('runner tracks side lanes, keeps calibration, and clears it for the next visitor', () => {
  const s = createPlayerSession({ area: RUNNER_AREA }); let t = 0;
  const tick = (poses, playing=false) => updatePlayerSession(s, poses, t += 40, aspect, playing);
  for (let i=0;i<28;i++) tick([person()]); assert.equal(s.controls.ready, true);
  const baseline = s.controls.baseline;
  for (let x=.5;x<.85;x+=.02) assert.ok(tick([person(x)], true).tracked);
  for (let x=.84;x>.15;x-=.02) assert.ok(tick([person(x)], true).tracked);
  assert.equal(s.controls.baseline, baseline);
  for (let i=0;i<50;i++) tick([], true);
  assert.equal(s.controls.ready, false); assert.deepEqual(s.options.area, RUNNER_AREA);
  for (let i=0;i<28;i++) tick([person(.5,.5,.12)]);
  assert.ok(s.controls.ready); assert.ok(Math.abs(s.controls.baseline-.5)<1e-6);
});
test('lane changes keep the selected player even when detector order changes', () => {
  const s = createPlayerSession({ area: RUNNER_AREA }); let t=0;
  const tick = p => updatePlayerSession(s,p,t+=40,aspect,s.controls.ready);
  for(let i=0;i<28;i++) tick([person()]);
  for(let i=0;i<10;i++) {
    const p=person(.5+i*.025); const crowd=person(.5,.4,.1);
    const r=tick(i%2?[crowd,p]:[p,crowd]); assert.equal(r.landmarks,p); assert.ok(r.tracked);
  }
});
