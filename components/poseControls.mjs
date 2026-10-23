// Positions use image coordinates: positive offsets point DOWN.
export const ZONES = { jump: -0.25, duck: 0.35, neutralTop: -0.10, neutralBottom: 0.20 };

export function createControls() {
  return { ready: false, samples: [], baseline: 0, width: 0, offset: 0,
    pose: 'stand', armed: false, lastSeen: null };
}

export function loseTracking(s) {
  s.pose = 'stand';
  s.armed = false;
  s.lastSeen = null;
  if (!s.ready) s.samples = [];
}

export function updateControls(s, y, width, time) {
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
    // Require a roughly stationary standing pose for one second.
    if (Math.max(...ys) - Math.min(...ys) > meanWidth * 0.12) {
      s.samples = [{ y, width, time }];
      return false;
    }
    if (time - s.samples[0].time >= 1000 && s.samples.length >= 15) {
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
  const neutral = s.offset >= ZONES.neutralTop && s.offset <= ZONES.neutralBottom;
  if (neutral) {
    s.pose = 'stand';
    s.armed = true;
  } else if (s.offset >= ZONES.duck) {
    s.pose = 'duck';
    s.armed = false;
  } else if (s.offset <= ZONES.jump) {
    const fire = s.armed;
    s.pose = 'jump';
    s.armed = false;
    return fire;
  }
  return false;
}
