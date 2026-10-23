import { createControls, loseTracking, updateControls } from './poseControls.mjs';

// Camera coordinates, independent of the display's letterboxing / mirrored view.
// Keep these together so the on-screen area and player selection agree.
export const PLAY_AREA = { left: 0.30, right: 0.70, exitLeft: 0.18, exitRight: 0.82 };
export const SESSION_TIMING = { settle: 1000, frameGap: 300, departure: 1800 };

export function createPlayerSession() {
  return {
    controls: createControls(), track: null, samples: [], lastSeen: null,
    lastUpdate: null, wasPlaying: false, phase: 'waiting', progress: 0, lastReset: null
  };
}

// Some PoseLandmarker builds return x/y/z without a visibility score. Missing
// metadata is not a zero-confidence detection. Always require valid in-frame
// coordinates, and enforce the confidence threshold when a score is supplied.
const visible = p => p && Number.isFinite(p.x) && Number.isFinite(p.y)
  && (p.visibility == null || (Number.isFinite(p.visibility) && p.visibility >= 0.6))
  && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a, b, aspect) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
const inArea = (x, expanded = false) => x >= (expanded ? PLAY_AREA.exitLeft : PLAY_AREA.left)
  && x <= (expanded ? PLAY_AREA.exitRight : PLAY_AREA.right);

const number = value => Number.isFinite(value) ? value.toFixed(3) : '—';
function check(id, label, passed, detail) {
  return { id, label, status: typeof passed === 'string' ? passed
    : passed === null ? 'wait' : passed ? 'pass' : 'fail', detail };
}

function legCheck(landmarks, indices, aspect, side) {
  const [hip, knee, ankle] = indices.map(i => landmarks?.[i]);
  if (![hip, knee, ankle].every(visible)) {
    return check(side + 'Leg', side + ' leg straight', 'skip', 'Optional: leg is not fully visible');
  }
  const a = { x: (hip.x - knee.x) * aspect, y: hip.y - knee.y };
  const b = { x: (ankle.x - knee.x) * aspect, y: ankle.y - knee.y };
  const length = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  const cosine = length > 0 ? (a.x * b.x + a.y * b.y) / length : NaN;
  return check(side + 'Leg', side + ' leg straight', length > 0 && cosine < -0.85,
    'Knee cosine ' + number(cosine) + ' < -0.850');
}

// These reports are also the actual calibration gates; the UI does not duplicate them.
export function inspectPose(landmarks, aspect = 1) {
  const [left, right] = [landmarks?.[11], landmarks?.[12]];
  const shouldersVisible = [left, right].every(visible);
  const hipsVisible = [landmarks?.[23], landmarks?.[24]].every(visible);
  const confidence = indices => {
    const points = indices.map(i => landmarks?.[i]);
    const scores = points.map(p => !p ? 'landmark missing' : p.visibility == null
      ? 'not supplied' : number(p.visibility)).join(' / ');
    const invalid = points.flatMap((p, i) => p && (!Number.isFinite(p.x) || !Number.isFinite(p.y)
      || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)
      ? [(i ? 'R' : 'L') + ' X/Y ' + number(p.x) + '/' + number(p.y) + ' outside frame'] : []);
    return 'Confidence L/R: ' + scores + '; need ≥ 0.600 when supplied; '
      + 'missing score uses coordinates' + (invalid.length ? '; ' + invalid.join('; ') : '');
  };
  const checks = [
    check('shoulders', 'Both shoulders visible', shouldersVisible,
      confidence([11, 12])),
    check('hips', 'Both hips visible', hipsVisible,
      confidence([23, 24]))
  ];
  if (!shouldersVisible || !Number.isFinite(aspect) || aspect <= 0) {
    for (const [id, label] of [['width', 'Shoulder size'], ['torso', 'Torso upright'],
      ['lean', 'No sideways lean'], ['level', 'Shoulders level'], ['headroom', 'Room to jump'],
      ['arms', 'Arms lowered'], ['LeftLeg', 'Left leg straight'], ['RightLeg', 'Right leg straight']]) {
      checks.push(check(id, label, null, 'Waiting for visible shoulders / valid camera dimensions'));
    }
    return { pose: null, checks };
  }
  const shoulder = midpoint(left, right);
  const width = distance(left, right, aspect);
  const hip = hipsVisible ? midpoint(landmarks[23], landmarks[24]) : null;
  const torso = hip ? distance(shoulder, hip, aspect) : null;
  checks.push(
    check('width', 'Shoulder size', width >= 0.06 && width <= 0.65,
      number(width) + '; allowed 0.060–0.650 (image-height units)'),
    check('torso', 'Torso upright', hip ? hip.y - shoulder.y > width * 0.65 : null,
      hip ? number(hip.y - shoulder.y) + ' > ' + number(width * 0.65) : 'Waiting for hips'),
    check('lean', 'No sideways lean', hip ? Math.abs(hip.x - shoulder.x) * aspect < width * 0.6 : null,
      hip ? number(Math.abs(hip.x - shoulder.x) * aspect) + ' < ' + number(width * 0.6) : 'Waiting for hips'),
    check('level', 'Shoulders level', Math.abs(left.y - right.y) < width * 0.35,
      number(Math.abs(left.y - right.y)) + ' < ' + number(width * 0.35)),
    check('headroom', 'Room to jump', shoulder.y > width * 0.35 + 0.03,
      'Shoulder Y ' + number(shoulder.y) + ' > ' + number(width * 0.35 + 0.03)),
    check('arms', 'Arms lowered', [15, 16].every(i => !visible(landmarks[i]) || landmarks[i].y > shoulder.y),
      'Visible wrists must be below shoulders'),
    legCheck(landmarks, [23, 25, 27], aspect, 'Left'),
    legCheck(landmarks, [24, 26, 28], aspect, 'Right')
  );
  const upright = checks.every(c => c.status !== 'fail' && c.status !== 'wait');
  return { pose: width < 0.06 || width > 0.65 ? null
    : { landmarks, x: shoulder.x, y: shoulder.y, width, hip, torso, upright }, checks };
}

export function describePose(landmarks, aspect = 1) {
  return inspectPose(landmarks, aspect).pose;
}

function clearCalibration(session) {
  session.controls = createControls();
  session.samples = [];
  session.progress = 0;
}

function trackChecks(track, p, aspect) {
  const dx = Math.abs(p.x - track.x) * aspect / track.width;
  const dy = Math.abs(p.y - track.y) / track.width;
  const scale = p.width / track.anchorWidth;
  const torsoScale = p.torso && track.anchorTorso ? p.torso / track.anchorTorso : 1;
  return {
    score: dx * 2 + dy * 0.35 + Math.abs(Math.log(scale)),
    checks: [
      check('trackX', 'Player match: horizontal', dx <= 0.75, number(dx) + ' ≤ 0.750 shoulder widths'),
      check('trackY', 'Player match: vertical', dy <= 1.4, number(dy) + ' ≤ 1.400 shoulder widths'),
      check('trackScale', 'Player match: shoulder size', scale >= 0.6 && scale <= 1.65, number(scale) + '; allowed 0.600–1.650'),
      check('trackTorso', 'Player match: torso size', torsoScale >= 0.55 && torsoScale <= 1.7,
        p.torso && track.anchorTorso ? number(torsoScale) + '; allowed 0.550–1.700' : 'Torso unavailable; size check bypassed')
    ]
  };
}

function matchPlayer(track, candidates, aspect) {
  // Detection order is not identity. Use the previous location and acquired scale.
  const matches = candidates.flatMap(p => {
    const match = trackChecks(track, p, aspect);
    if (!inArea(p.x, true) || match.checks.some(c => c.status === 'fail')) return [];
    return [{ pose: p, score: match.score }];
  }).sort((a, b) => a.score - b.score);
  const ambiguous = matches.length > 1 && matches[1].score - matches[0].score < 0.3;
  return { pose: ambiguous ? null : matches[0]?.pose ?? null,
    eligibleCount: matches.length, ambiguous,
    margin: matches.length > 1 ? matches[1].score - matches[0].score : null, minMargin: 0.3 };
}

function acquirePlayer(candidates) {
  const ranked = candidates.filter(p => inArea(p.x) && p.hip).map(p => ({
    pose: p, score: Math.abs(p.x - 0.5) * 2 - p.width * 0.6
  })).sort((a, b) => a.score - b.score);
  const ambiguous = ranked.length > 1 && ranked[1].score - ranked[0].score < 0.08;
  return { pose: ambiguous ? null : ranked[0]?.pose ?? null,
    eligibleCount: ranked.length, ambiguous,
    margin: ranked.length > 1 ? ranked[1].score - ranked[0].score : null, minMargin: 0.08 };
}

/** One update per fresh inference (or an empty list on a camera stall).
 * `departed` tells the game to end the old session. Never reuse its calibration.
 */
export function updatePlayerSession(session, poses, time, aspect = 1, playing = false) {
  const result = { landmarks: null, tracked: false, jump: false, duck: false,
    departed: false, phase: 'waiting', progress: 0, message: 'Step into the middle to play',
    debug: { time, detected: poses.length, focusedIndex: null, gapMs: null,
      checks: [], candidates: [], sampleCount: 0, elapsedMs: 0, lastReset: session.lastReset,
      baseline: session.controls.baseline, width: session.controls.width, offset: session.controls.offset,
      armed: session.controls.armed, calibrated: session.controls.ready } };
  const finish = () => {
    result.debug.lastReset = session.lastReset;
    result.debug.calibrated = session.controls.ready;
    result.debug.baseline = session.controls.baseline;
    result.debug.width = session.controls.width;
    result.debug.offset = session.controls.offset;
    result.debug.armed = session.controls.armed;
    if (session.controls.ready) {
      result.debug.sampleCount = session.controls.calibrationDebug.sampleCount;
      result.debug.elapsedMs = session.controls.calibrationDebug.elapsedMs;
    }
    if (!session.controls.ready) {
      for (const [id, label] of [['stableX', 'Stable horizontal position'], ['stableWidth', 'Stable shoulder size'],
        ['stableHips', 'Stable hip height'], ['stableShoulders', 'Stable shoulder height'],
        ['samples', 'Enough fresh samples'], ['duration', 'Standing dwell complete']]) {
        if (!result.debug.checks.some(c => c.id === id)) {
          result.debug.checks.push(check(id, label, null, 'Waiting for player selection and standing checks'));
        }
      }
    }
    return result;
  };
  const resetReason = reason => { session.lastReset = { reason, time }; };
  if (!Number.isFinite(time)) return result;
  if (session.wasPlaying && !playing) { clearCalibration(session); resetReason('Round ended: starting a new calibration'); }
  session.wasPlaying = playing;

  // A suspended tab / camera gap must not count toward a standing dwell.
  result.debug.gapMs = session.lastUpdate === null ? null : time - session.lastUpdate;
  result.debug.checks.push(check('frameGap', 'Update gap within limit',
    result.debug.gapMs === null ? null : result.debug.gapMs <= SESSION_TIMING.frameGap,
    (result.debug.gapMs === null ? 'First update' : Math.round(result.debug.gapMs) + ' ms')
      + '; maximum ' + SESSION_TIMING.frameGap + ' ms'));
  if (session.lastUpdate !== null && time - session.lastUpdate > SESSION_TIMING.frameGap) {
    resetReason('Update gap exceeded ' + SESSION_TIMING.frameGap + ' ms');
    loseTracking(session.controls);
    session.samples = [];
  }
  session.lastUpdate = time;

  // Check expiry BEFORE matching: a newcomer must not revive an expired track.
  if (session.track && time - session.lastSeen >= SESSION_TIMING.departure) {
    Object.assign(session, createPlayerSession());
    result.departed = true;
    resetReason('Player absent for ' + SESSION_TIMING.departure + ' ms');
    return finish();
  }

  const hadTrack = Boolean(session.track);
  const reports = poses.map((landmarks, index) => {
    const report = inspectPose(landmarks, aspect);
    if (report.pose) {
      report.checks.push(check('center', 'Inside entry area',
        inArea(report.pose.x), 'Torso center X ' + number(report.pose.x) + '; allowed '
          + PLAY_AREA.left + '–' + PLAY_AREA.right));
      if (hadTrack) report.checks.push(check('trackingArea', 'Inside tracking area',
        inArea(report.pose.x, true), 'Torso center X ' + number(report.pose.x) + '; allowed '
          + PLAY_AREA.exitLeft + '–' + PLAY_AREA.exitRight),
        ...trackChecks(session.track, report.pose, aspect).checks);
    }
    return { ...report, index };
  });
  const candidates = reports.map(r => r.pose).filter(Boolean);
  const selection = hadTrack ? matchPlayer(session.track, candidates, aspect) : acquirePlayer(candidates);
  const pose = selection.pose;
  const focus = reports.find(r => r.pose && r.pose === pose) ?? [...reports].sort((a, b) => {
    const x = r => r.pose?.x ?? ((poses[r.index]?.[11]?.x ?? 0) + (poses[r.index]?.[12]?.x ?? 0)) / 2;
    return Math.abs(x(a) - 0.5) - Math.abs(x(b) - 0.5);
  })[0];
  result.debug.focusedIndex = focus?.index ?? null;
  result.debug.candidates = reports.map(r => ({ index: r.index, checks: r.checks }));
  result.debug.checks.push(check('detection', 'Pose detected', poses.length > 0, poses.length + ' raw pose(s)'),
    check('selection', hadTrack ? 'Selected player matched' : 'Unique player selected', Boolean(pose),
      selection.ambiguous ? 'Ambiguous: score gap ' + number(selection.margin) + ' < ' + selection.minMargin
      : selection.eligibleCount + ' eligible candidate(s)'));
  if (focus) result.debug.checks.push(...focus.checks);
  if (!pose) {
    if (session.controls.samples.length) resetReason('Selected player missing or ambiguous');
    loseTracking(session.controls);
    session.samples = [];
    session.progress = 0;
    session.phase = session.track ? 'lost' : 'waiting';
    result.phase = session.phase;
    result.message = session.track ? 'Come back to the middle — waiting for you'
      : candidates.some(p => inArea(p.x) && !p.hip) ? 'Step back a little so your hips are visible'
      : candidates.filter(p => inArea(p.x)).length > 1 ? 'One player in the middle'
      : result.message;
    return finish();
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
      resetReason(focus.checks.find(c => c.status === 'fail')?.label ?? 'Outside entry area');
      clearCalibration(session);
      result.message = !pose.hip ? 'Step back a little so your hips are visible'
        : !inArea(pose.x) ? 'Step into the middle to play' : 'Stand naturally, facing the screen';
    } else {
      session.samples.push({ x: pose.x, width: pose.width, hipY: pose.hip.y });
      const range = key => Math.max(...session.samples.map(p => p[key]))
        - Math.min(...session.samples.map(p => p[key]));
      const stability = [
        check('stableX', 'Stable horizontal position', range('x') * aspect <= pose.width * 0.15,
          number(range('x') * aspect) + ' ≤ ' + number(pose.width * 0.15)),
        check('stableWidth', 'Stable shoulder size', range('width') <= pose.width * 0.12,
          number(range('width')) + ' ≤ ' + number(pose.width * 0.12)),
        check('stableHips', 'Stable hip height', range('hipY') <= pose.width * 0.15,
          number(range('hipY')) + ' ≤ ' + number(pose.width * 0.15))
      ];
      result.debug.checks.push(...stability);
      if (stability.some(c => c.status === 'fail')) {
        resetReason(stability.find(c => c.status === 'fail').label);
        clearCalibration(session);
        session.samples.push({ x: pose.x, width: pose.width, hipY: pose.hip.y });
      }
      updateControls(session.controls, pose.y, pose.width, time, SESSION_TIMING.settle);
      const shoulderDebug = session.controls.calibrationDebug;
      result.debug.checks.push(check('stableShoulders', 'Stable shoulder height', !shoulderDebug.reset,
        number(shoulderDebug.range) + ' ≤ ' + number(shoulderDebug.limit)));
      if (shoulderDebug.reset) resetReason('Stable shoulder height');
      result.debug.sampleCount = session.controls.ready ? shoulderDebug.sampleCount : session.controls.samples.length;
      result.debug.elapsedMs = session.controls.ready ? shoulderDebug.elapsedMs
        : time - session.controls.samples[0].time;
      result.debug.checks.push(
        check('samples', 'Enough fresh samples', session.controls.ready || session.controls.samples.length >= 15,
          result.debug.sampleCount + ' / 15 samples'),
        check('duration', 'Standing dwell complete', session.controls.ready || result.debug.elapsedMs >= SESSION_TIMING.settle,
          Math.round(result.debug.elapsedMs) + ' / ' + SESSION_TIMING.settle + ' ms'));
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
  return finish();
}
