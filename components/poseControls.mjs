// Positions use image coordinates: positive offsets point DOWN.
// Duck is deeper than the natural pre-jump squat (~0.3–0.4) so winding up for a jump
// neither ducks nor disarms the jump.
export const ZONES = { jump: -0.25, duck: 0.45, neutralTop: -0.10, neutralBottom: 0.20 };

// Fast jump trigger: fire on the upward PUSH-OFF instead of waiting for the shoulders
// to clear the jump line, which only happens around take-off. Units are calibrated
// shoulder widths, so kids and adults use the same numbers. The line above stays as
// a fallback for slow or gentle jumpers; whichever fires first wins.
export const RISE = {
  windowMs: 150,   // look back this far for the lowest recent shoulder position
  minRise: 0.12,   // must have risen at least this far from that low point...
  minSpeed: 2.0,   // ...at least this fast (widths/s). Jitter and slow stand-ups are below.
  cooldownMs: 700  // ignore the landing bounce after a rise-triggered jump
};

export function createControls() {
  return { ready: false, samples: [], baseline: 0, width: 0, offset: 0,
    pose: 'stand', armed: false, lastSeen: null, history: [], riseSpeed: 0, lastRiseJump: -Infinity,
    calibrationDebug: { range: 0, limit: 0, reset: false, sampleCount: 0, elapsedMs: 0 } };
}

export function loseTracking(s) {
  s.pose = 'stand';
  s.armed = false;
  s.lastSeen = null;
  s.history = [];
  s.riseSpeed = 0;
  if (!s.ready) s.samples = [];
}

// Upward speed from the lowest point in the recent window (handles the dip-then-push).
function measureRise(s, time) {
  s.history.push({ offset: s.offset, time });
  while (s.history.length && time - s.history[0].time > RISE.windowMs) s.history.shift();
  const low = s.history.reduce((a, b) => (b.offset > a.offset ? b : a), s.history[0]);
  const rise = low.offset - s.offset; // positive = shoulders moved up
  const dt = (time - low.time) / 1000;
  s.riseSpeed = dt > 0 ? rise / dt : 0;
  return rise >= RISE.minRise && s.riseSpeed >= RISE.minSpeed;
}

export function updateControls(s, y, width, time, calibrationMs = 1000) {
  if (![y, width, time].every(Number.isFinite) || width < 0.02) {
    loseTracking(s);
    return false;
  }
  if (s.lastSeen !== null && time - s.lastSeen > 300) loseTracking(s);
  s.lastSeen = time;
  if (!s.ready) {
    s.samples.push({ y, width, time });
    const ys = s.samples.map(p => p.y);
    const meanWidth = s.samples.reduce((n, p) => n + p.width, 0) / s.samples.length;
    s.calibrationDebug = { range: Math.max(...ys) - Math.min(...ys),
      limit: meanWidth * 0.12, reset: false, sampleCount: s.samples.length,
      elapsedMs: time - s.samples[0].time };
    // Require a roughly stationary standing pose for one second.
    if (Math.max(...ys) - Math.min(...ys) > meanWidth * 0.12) {
      s.calibrationDebug.reset = true;
      s.samples = [{ y, width, time }];
      return false;
    }
    if (time - s.samples[0].time >= calibrationMs && s.samples.length >= 15) {
      s.baseline = ys.reduce((a, b) => a + b, 0) / ys.length;
      s.width = meanWidth;
      s.ready = true;
      s.armed = true;
      s.samples = [];
    }
    return false;
  }
  // Freeze the calibrated scale: turning/crouching must not move the lines.
  s.offset = (y - s.baseline) / s.width;
  const rising = measureRise(s, time);
  // Never from a duck: standing back up is also fast upward motion, and a duck
  // already disarms. Fires during the push, even while still below standing height.
  if (rising && s.armed && s.pose !== 'duck' && s.offset < ZONES.duck
      && time - s.lastRiseJump >= RISE.cooldownMs) {
    s.pose = 'jump';
    s.armed = false;
    s.lastRiseJump = time;
    return true;
  }
  const neutral = s.offset >= ZONES.neutralTop && s.offset <= ZONES.neutralBottom;
  if (neutral) {
    s.pose = 'stand';
    s.armed = true;
  } else if (s.offset >= ZONES.duck) {
    s.pose = 'duck';
    s.armed = false;
  } else if (s.offset <= ZONES.jump) {
    // Same physical jump that already fired early on the push-off: don't fire again.
    const fire = s.armed && time - s.lastRiseJump >= RISE.cooldownMs;
    s.pose = 'jump';
    s.armed = false;
    return fire;
  }
  return false;
}

