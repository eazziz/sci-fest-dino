export const RUNNER = { laneWidth: 2.6, initialSpeed: 13, maxSpeed: 22,
  jumpVelocity: 10.5, gravity: 26, playerRadius: 0.30, hitDepth: 0.50 };

export function createRunner() {
  return { phase: 'idle', elapsed: 0, distance: 0, speed: RUNNER.initialSpeed,
    score: 0, coins: 0, lane: 0, x: 0, y: 0, vy: 0, duck: false,
    objects: [], nextId: 0, spawnIn: 1.8, countIn: 0, crash: '', hitId: null,
    collected: [], passed: 0, combo: 0 };
}
export function startRunner(s) {
  Object.assign(s, createRunner(), { phase: 'countdown', countIn: 2.4 });
}
export function jumpRunner(s) {
  if (s.phase !== 'running' || s.y > 0.04 || s.vy > 0 || s.duck) return false;
  s.vy = RUNNER.jumpVelocity;
  return true;
}

export function makePattern(s, random = Math.random) {
  const clearLane = Math.min(2, Math.floor(random() * 3)) - 1;
  const lanes = [-1, 0, 1].filter(l => l !== clearLane);
  const count = s.elapsed < 12 ? 1 : 2;
  const z = 68;
  for (let i = 0; i < count; i++) {
    const kind = s.elapsed < 12 ? 'block' : ['block', 'hurdle', 'gate'][Math.min(2, Math.floor(random() * 3))];
    s.objects.push({ id: ++s.nextId, kind, lane: lanes[i], z, done: false });
  }
  for (let i = 0; i < 5; i++) s.objects.push({ id: ++s.nextId, kind: 'coin',
    lane: clearLane, z: z + i * 2.6, done: false });
  // Every row has an empty lane and >= 2.3 seconds before the next row.
  s.spawnIn = Math.max(2.3, 3.2 - s.elapsed / 150);
}

export function obstacleHits(kind, y, duck) {
  if (kind === 'block') return true;
  if (kind === 'hurdle') return y < 0.82;
  if (kind === 'gate') return y + (duck ? 0.75 : 1.9) > 1.1;
  return false;
}

export function stepRunner(s, delta, input = {}, random = Math.random) {
  s.collected = [];
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
    s.speed = Math.min(RUNNER.maxSpeed, RUNNER.initialSpeed + s.elapsed * 0.08);
    s.distance += s.speed * dt;
    const travel = Math.max(-18 * dt, Math.min(18 * dt, s.lane * RUNNER.laneWidth - s.x));
    s.x += travel;
    s.y += s.vy * dt;
    s.vy -= RUNNER.gravity * dt;
    if (s.y <= 0) { s.y = 0; s.vy = 0; }
    s.spawnIn -= dt;
    if (s.spawnIn <= 0) makePattern(s, random);
    for (const obj of s.objects) {
      obj.z -= s.speed * dt;
      if (obj.done || Math.abs(obj.z) > RUNNER.hitDepth) continue;
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
        s.crash = obj.kind === 'block' ? 'Move into an open lane' : obj.kind === 'hurdle' ? 'Jump over the low barriers' : 'Duck under the blue gates';
        s.hitId = obj.id;
        break;
      }
    }
    for (const obj of s.objects) if (!obj.done && obj.kind !== 'coin' && obj.z < -RUNNER.hitDepth) { obj.done = true; s.passed++; }
    s.objects = s.objects.filter(o => o.z > -10 && !(o.kind === 'coin' && o.done));
    s.score = Math.floor(s.distance) + s.coins * 25;
  }
}
