// Camera x is unmirrored. Negative image movement is RIGHT on the mirrored TV.
export const RUNNER_AREA = { exitLeft: 0.08, exitRight: 0.92 };
export const LANE_ZONE = { enter: 0.60, leave: 0.38 };
export function createLaneControls() {
  return { ready: false, center: 0.5, scale: 0.15, lane: 0, offset: 0, lastSeen: null };
}
export function calibrateLanes(s, x, width, aspect) {
  if (![x, width, aspect].every(Number.isFinite) || width <= 0 || aspect <= 0) return;
  s.ready = true;
  s.center = x;
  // Keep both side lanes reachable even when a large player calibrates off-center.
  const room = Math.min(x - RUNNER_AREA.exitLeft, RUNNER_AREA.exitRight - x);
  s.scale = Math.min(width / aspect, Math.max(.03, room * .8 / LANE_ZONE.enter));
  s.lane = 0;
  s.offset = 0;
  s.lastSeen = null;
}
export function updateLane(s, x, time) {
  if (!s.ready || !Number.isFinite(x) || !Number.isFinite(time)) return s.lane;
  const raw = (s.center - x) / s.scale;
  const dt = s.lastSeen === null ? 1 : Math.max(0, (time - s.lastSeen) / 1000);
  // Time-based filtering keeps the feel consistent across different webcams.
  s.offset += (raw - s.offset) * (1 - Math.exp(-dt / 0.045));
  s.lastSeen = time;
  if (s.offset < -LANE_ZONE.enter) s.lane = -1;
  else if (s.offset > LANE_ZONE.enter) s.lane = 1;
  else if (Math.abs(s.offset) < LANE_ZONE.leave) s.lane = 0;
  else if (s.lane === -1 && s.offset > -LANE_ZONE.leave) s.lane = 0;
  else if (s.lane === 1 && s.offset < LANE_ZONE.leave) s.lane = 0;
  return s.lane;
}

export function laneBoundaries(s) {
  // Normalized *mirrored* view coordinates, shared with the camera overlay.
  const center = 1 - s.center;
  return { left: center - s.scale * LANE_ZONE.enter, center,
    right: center + s.scale * LANE_ZONE.enter };
}
