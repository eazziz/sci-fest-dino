import { createControls, loseTracking, updateControls } from './poseControls.mjs';

// Camera coordinates, independent of the display's letterboxing / mirrored view.
// Keep these together so the on-screen area and player selection agree.
export const PLAY_AREA = { left: 0.30, right: 0.70, exitLeft: 0.18, exitRight: 0.82 };
export const SESSION_TIMING = { settle: 1000, frameGap: 300, departure: 1800 };

export function createPlayerSession() {
  return {
    controls: createControls(), track: null, samples: [], lastSeen: null,
    lastUpdate: null, wasPlaying: false, phase: 'waiting', progress: 0
  };
}

const visible = p => p && Number.isFinite(p.x) && Number.isFinite(p.y)
  && (p.visibility ?? 0) >= 0.6 && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a, b, aspect) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
const inArea = (x, expanded = false) => x >= (expanded ? PLAY_AREA.exitLeft : PLAY_AREA.left)
  && x <= (expanded ? PLAY_AREA.exitRight : PLAY_AREA.right);

function straightLeg(hip, knee, ankle, aspect) {
  if (![hip, knee, ankle].every(visible)) return true; // Feet may be outside the frame.
  const a = { x: (hip.x - knee.x) * aspect, y: hip.y - knee.y };
  const b = { x: (ankle.x - knee.x) * aspect, y: ankle.y - knee.y };
  const length = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  return length > 0 && (a.x * b.x + a.y * b.y) / length < -0.85;
}

export function describePose(landmarks, aspect = 1) {
  if (!landmarks || !Number.isFinite(aspect) || aspect <= 0) return null;
  const [left, right] = [landmarks[11], landmarks[12]];
  if (![left, right].every(visible)) return null;
  const shoulder = midpoint(left, right);
  const width = distance(left, right, aspect);
  if (width < 0.06 || width > 0.65) return null;
  const hipsVisible = [landmarks[23], landmarks[24]].every(visible);
  const hip = hipsVisible ? midpoint(landmarks[23], landmarks[24]) : null;
  const torso = hip ? distance(shoulder, hip, aspect) : null;
  const upright = Boolean(hip && hip.y - shoulder.y > width * 0.65
    && Math.abs(hip.x - shoulder.x) * aspect < width * 0.6
    && Math.abs(left.y - right.y) < width * 0.35
    && shoulder.y > width * 0.35 + 0.03 // Leave room for a jump.
    && [15, 16].every(i => !visible(landmarks[i]) || landmarks[i].y > shoulder.y)
    && straightLeg(landmarks[23], landmarks[25], landmarks[27], aspect)
    && straightLeg(landmarks[24], landmarks[26], landmarks[28], aspect));
  return { landmarks, x: shoulder.x, y: shoulder.y, width, hip, torso, upright };
}

function clearCalibration(session) {
  session.controls = createControls();
  session.samples = [];
  session.progress = 0;
}

function matchPlayer(track, candidates, aspect) {
  // Pose array indices are NOT identities: the detector can reorder them every frame.
  // Compare to the last location and the acquired body scale instead.
  const matches = candidates.flatMap(p => {
    const dx = Math.abs(p.x - track.x) * aspect / track.width;
    const dy = Math.abs(p.y - track.y) / track.width;
    const scale = p.width / track.anchorWidth;
    const torsoScale = p.torso && track.anchorTorso ? p.torso / track.anchorTorso : 1;
    if (!inArea(p.x, true) || dx > 0.75 || dy > 1.4 || scale < 0.6 || scale > 1.65
      || torsoScale < 0.55 || torsoScale > 1.7) return [];
    return [{ pose: p, score: dx * 2 + dy * 0.35 + Math.abs(Math.log(scale)) }];
  }).sort((a, b) => a.score - b.score);
  // Overlapping people cannot be identified reliably from pose geometry alone.
  if (matches.length > 1 && matches[1].score - matches[0].score < 0.3) return null;
  return matches[0]?.pose ?? null;
}

function acquirePlayer(candidates) {
  const ranked = candidates.filter(p => inArea(p.x) && p.hip).map(p => ({
    pose: p, score: Math.abs(p.x - 0.5) * 2 - p.width * 0.6
  })).sort((a, b) => a.score - b.score);
  if (ranked.length > 1 && ranked[1].score - ranked[0].score < 0.08) return null;
  return ranked[0]?.pose ?? null;
}

/** One update per fresh inference (or an empty list on a camera stall).
 * `departed` tells the game to end the old session. Never reuse its calibration.
 */
export function updatePlayerSession(session, poses, time, aspect = 1, playing = false) {
  const result = { landmarks: null, tracked: false, jump: false, duck: false,
    departed: false, phase: 'waiting', progress: 0, message: 'Step into the middle to play' };
  if (!Number.isFinite(time)) return result;
  if (session.wasPlaying && !playing) clearCalibration(session);
  session.wasPlaying = playing;

  // A suspended tab / camera gap must not count toward a standing dwell.
  if (session.lastUpdate !== null && time - session.lastUpdate > SESSION_TIMING.frameGap) {
    loseTracking(session.controls);
    session.samples = [];
  }
  session.lastUpdate = time;

  // Check expiry BEFORE matching: a newcomer must not revive an expired track.
  if (session.track && time - session.lastSeen >= SESSION_TIMING.departure) {
    Object.assign(session, createPlayerSession());
    result.departed = true;
    return result;
  }

  const candidates = poses.map(p => describePose(p, aspect)).filter(Boolean);
  const pose = session.track ? matchPlayer(session.track, candidates, aspect) : acquirePlayer(candidates);
  if (!pose) {
    loseTracking(session.controls);
    session.samples = [];
    session.progress = 0;
    session.phase = session.track ? 'lost' : 'waiting';
    result.phase = session.phase;
    result.message = session.track ? 'Come back to the middle — waiting for you'
      : candidates.some(p => inArea(p.x) && !p.hip) ? 'Step back a little so your hips are visible'
      : candidates.filter(p => inArea(p.x)).length > 1 ? 'One player in the middle'
      : result.message;
    return result;
  }

  if (!session.track) {
    session.track = { ...pose, anchorWidth: pose.width, anchorTorso: pose.torso };
  } else {
    session.track.x = pose.x;
    session.track.y = pose.y;
    session.track.width = pose.width;
  }
  session.lastSeen = time;
  result.landmarks = pose.landmarks;
  result.tracked = true;

  if (!session.controls.ready) {
    session.phase = 'settling';
    if (!pose.upright || !inArea(pose.x)) {
      clearCalibration(session);
      result.message = !pose.hip ? 'Step back a little so your hips are visible'
        : !inArea(pose.x) ? 'Step into the middle to play' : 'Stand naturally, facing the screen';
    } else {
      session.samples.push({ x: pose.x, width: pose.width, hipY: pose.hip.y });
      const range = key => Math.max(...session.samples.map(p => p[key]))
        - Math.min(...session.samples.map(p => p[key]));
      if (range('x') * aspect > pose.width * 0.15 || range('width') > pose.width * 0.12
        || range('hipY') > pose.width * 0.15) {
        clearCalibration(session);
        session.samples.push({ x: pose.x, width: pose.width, hipY: pose.hip.y });
      }
      updateControls(session.controls, pose.y, pose.width, time, SESSION_TIMING.settle);
      // Shoulder motion can reset the controls' samples independently.
      if (session.controls.samples.length === 1) session.samples = session.samples.slice(-1);
      session.progress = session.controls.ready ? 1
        : Math.min(1, (time - session.controls.samples[0].time) / SESSION_TIMING.settle);
      result.message = 'Getting ready…';
      if (session.controls.ready) {
        session.track.anchorWidth = session.controls.width;
        session.track.anchorTorso = pose.torso;
        session.samples = [];
      }
    }
  } else {
    result.jump = updateControls(session.controls, pose.y, pose.width, time);
    result.duck = session.controls.pose === 'duck';
  }

  if (session.controls.ready) {
    session.phase = playing ? 'playing' : 'ready';
    result.message = playing ? result.duck ? 'DUCK — stay low for birds'
      : session.controls.pose === 'jump' ? 'JUMP' : 'RUN — jump over cacti, duck under birds'
      : 'Ready — jump to play!';
  }
  result.phase = session.phase;
  result.progress = session.progress;
  return result;
}
