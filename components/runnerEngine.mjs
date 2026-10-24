export const RUNNER = { laneWidth: 2.6, initialSpeed: 13, maxSpeed: 23, speedRamp: 0.15,
  jumpVelocity: 10.5, gravity: 26, playerRadius: 0.30, hitDepth: 0.50, spawnZ: 68 };

// Oncoming traffic: `length` extends away from the player behind the front bumper.
export const VEHICLES = { bus: { length: 5.6 }, truck: { length: 4.2 } };
const SOLID = new Set(['block', 'bus', 'truck']);
export const isVehicle = kind => kind in VEHICLES;
export const objectLength = kind => VEHICLES[kind]?.length ?? 0;

const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const pick = (list, random) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];

// Difficulty by seconds survived. Tuned so most first-time players last 30–60 s.
export function difficulty(t) {
  if (t < 10) return { stage: 'warmup', gap: 2.6, twoLane: 0, action: 0, vehicle: 0 };
  if (t < 25) { const k = (t - 10) / 15;
    return { stage: 'build', gap: lerp(2.4, 2.0, k), twoLane: lerp(0.35, 0.8, k), action: 0, vehicle: lerp(0.2, 0.4, k) }; }
  if (t < 45) { const k = (t - 25) / 20;
    return { stage: 'combo', gap: lerp(2.0, 1.75, k), twoLane: 1, action: lerp(0.3, 0.45, k), vehicle: 0.45 }; }
  const k = (t - 45) / 30;
  return { stage: 'rush', gap: lerp(1.75, 1.5, k), twoLane: 1, action: lerp(0.5, 0.7, k), vehicle: lerp(0.5, 0.6, k) };
}
// Vehicles drive toward the player on top of the scroll speed; later ones are faster.
export const vehicleSpeed = t => 6 + Math.min(6, Math.max(0, t - 10) * 0.1);

export function createRunner() {
  return { phase: 'idle', elapsed: 0, distance: 0, speed: RUNNER.initialSpeed,
    score: 0, coins: 0, lane: 0, x: 0, y: 0, vy: 0, duck: false,
    objects: [], nextId: 0, nextRow: 0, spawnIn: 1.8, countIn: 0, crash: '', hitId: null,
    collected: [], honks: [], passed: 0, combo: 0, lastOpen: 0, lastAction: false };
}
export function startRunner(s) {
  Object.assign(s, createRunner(), { phase: 'countdown', countIn: 2.4 });
}
export function jumpRunner(s) {
  if (s.phase !== 'running' || s.y > 0.04 || s.vy > 0 || s.duck) return false;
  s.vy = RUNNER.jumpVelocity;
  return true;
}

// One row = everything that reaches the player at the same moment. Each row leaves
// exactly one lane without a block or vehicle; that lane may hold a hurdle or gate.
export function makePattern(s, random = Math.random) {
  const d = difficulty(s.elapsed);
  // Usually move the open lane so standing still is never a strategy.
  const others = [-1, 0, 1].filter(l => l !== s.lastOpen);
  const open = random() < 0.75 ? pick(others, random) : s.lastOpen;
  const blocked = [-1, 0, 1].filter(l => l !== open);
  const row = ++s.nextRow;
  const arrive = RUNNER.spawnZ / s.speed;
  const action = random() < d.action;
  const add = (kind, lane) => {
    const vz = isVehicle(kind) ? vehicleSpeed(s.elapsed) : 0;
    s.objects.push({ id: ++s.nextId, kind, lane, row, vz, z: (s.speed + vz) * arrive, done: false, honked: false });
  };
  if (d.stage === 'warmup') {
    // Single block in the lane the player was last guided to.
    add('block', s.lastOpen === open ? pick(blocked, random) : s.lastOpen);
  } else {
    const lanes = random() < d.twoLane ? blocked : [pick(blocked, random)];
    for (const lane of lanes) {
      const vehicle = random() < d.vehicle;
      const kind = vehicle ? pick(['bus', 'truck'], random)
        : action ? 'block' : pick(['block', 'block', 'hurdle', 'gate'], random);
      add(kind, lane);
    }
    if (action) add(random() < 0.5 ? 'hurdle' : 'gate', open);
  }
  for (let i = 0; i < 5; i++) s.objects.push({ id: ++s.nextId, kind: 'coin', lane: open, row, vz: 0,
    z: RUNNER.spawnZ + (action ? 2.6 : 0) + i * 2.6, done: false });
  // Extra recovery for crossing two lanes, or for moving right after a jump/duck.
  let gap = d.gap;
  if (Math.abs(open - s.lastOpen) === 2) gap += 0.35;
  if (s.lastAction && open !== s.lastOpen) gap += 0.2;
  s.spawnIn = gap;
  s.lastOpen = open; s.lastAction = action;
}

export function obstacleHits(kind, y, duck) {
  if (SOLID.has(kind)) return true;
  if (kind === 'hurdle') return y < 0.82;
  if (kind === 'gate') return y + (duck ? 0.75 : 1.9) > 1.1;
  return false;
}
const CRASH = { block: 'Move into an open lane', hurdle: 'Jump over the low barriers',
  gate: 'Duck under the blue gates', bus: 'Dodge the oncoming bus!', truck: 'Dodge the oncoming truck!' };

export function stepRunner(s, delta, input = {}, random = Math.random) {
  s.collected = []; s.honks = [];
  if (!Number.isFinite(delta) || delta <= 0 || input.paused || !['countdown', 'running'].includes(s.phase)) return;
  s.lane = Math.max(-1, Math.min(1, input.lane ?? s.lane));
  s.duck = Boolean(input.duck);
  if (s.phase === 'countdown') {
    s.x = s.lane * RUNNER.laneWidth;
    s.countIn -= Math.min(delta, 0.1);
    if (s.countIn <= 0) s.phase = 'running';
    return;
  }
  // Integrate with substeps so dropped frames cannot skip a collision or coin.
  let remaining = Math.min(delta, 0.1);
  while (remaining > 0 && s.phase === 'running') {
    const dt = Math.min(remaining, 1 / 120);
    remaining -= dt;
    s.elapsed += dt;
    s.speed = Math.min(RUNNER.maxSpeed, RUNNER.initialSpeed + s.elapsed * RUNNER.speedRamp);
    s.distance += s.speed * dt;
    const travel = Math.max(-18 * dt, Math.min(18 * dt, s.lane * RUNNER.laneWidth - s.x));
    s.x += travel;
    s.y += s.vy * dt;
    s.vy -= RUNNER.gravity * dt;
    if (s.y <= 0) { s.y = 0; s.vy = 0; }
    s.spawnIn -= dt;
    if (s.spawnIn <= 0) makePattern(s, random);
    for (const obj of s.objects) {
      obj.z -= (s.speed + (obj.vz ?? 0)) * dt;
      if (isVehicle(obj.kind) && !obj.honked && obj.z < (s.speed + obj.vz) * 1.6) { obj.honked = true; s.honks.push(obj.id); }
      const len = objectLength(obj.kind);
      if (obj.done || obj.z > RUNNER.hitDepth || obj.z + len < -RUNNER.hitDepth) continue;
      const dx = Math.abs(obj.lane * RUNNER.laneWidth - s.x);
      if (obj.kind === 'coin') {
        if (dx < 0.75 && s.y < 1.55) {
          obj.done = true;
          s.coins++;
          s.combo++;
          s.collected.push(obj.id);
        }
      } else if (dx < 0.84 + RUNNER.playerRadius && obstacleHits(obj.kind, s.y, s.duck)) {
        s.phase = 'over';
        s.crash = CRASH[obj.kind];
        s.hitId = obj.id;
        break;
      }
    }
    for (const obj of s.objects) if (!obj.done && obj.kind !== 'coin' && obj.z + objectLength(obj.kind) < -RUNNER.hitDepth) { obj.done = true; s.passed++; }
    s.objects = s.objects.filter(o => o.z + objectLength(o.kind) > -10 && !(o.kind === 'coin' && o.done));
    s.score = Math.floor(s.distance) + s.coins * 25;
  }
}
