import React, { useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import CalibrationDebug, { type DebugSnapshot } from './CalibrationDebug';
import { createPlayerSession, updatePlayerSession, SESSION_TIMING, PLAY_AREA } from './playerSession.mjs';
import { createLaneControls, calibrateLanes, updateLane, laneBoundaries, RUNNER_AREA } from './runnerControls.mjs';
import { createRunner, startRunner, jumpRunner, stepRunner } from './runnerEngine.mjs';
import { createRunnerScene } from './runnerScene';
import './runner.css';

type Mode = 'camera' | 'keyboard';
type Actions = { camera: (device?: string) => Promise<void>; keyboard: () => void;
  reset: () => void; start: () => void; mute: () => void; lane: (lane: number) => void;
  jump: () => void; duck: (value: boolean) => void };
const laneName = (lane: number) => ['LEFT', 'CENTER', 'RIGHT'][lane + 1];
const CONNECTIONS = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],
  [23,24],[23,25],[25,27],[24,26],[26,28]];

export default function RunnerGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const actionRef = useRef<Actions | null>(null);
  const debugRef = useRef(false);
  const [showDebug, setShowDebug] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState('');
  const [ui, setUi] = useState({ mode: 'camera' as Mode, phase: 'idle', cameraReady: false,
    cameraStarting: false, status: 'Step into the middle to play', sessionPhase: 'waiting',
    progress: 0, ready: false, tracked: false, lane: 0, duck: false, jumping: false,
    score: 0, coins: 0, best: 0, countdown: 3, muted: false, error: '', fatal: '',
    crash: '', debug: null as DebugSnapshot | null, devices: [] as MediaDeviceInfo[], device: '' });

  useEffect(() => {
    document.title = 'Lane Runner — Body Controlled';
    let disposed = false, raf = 0, last = 0, lastUi = -Infinity, lastInference = 0, videoTime = -1;
    let lastFresh = 0, model: PoseLandmarker | null = null, stream: MediaStream | null = null;
    let scene: ReturnType<typeof createRunnerScene> | null = null;
    let session = createPlayerSession({ area: RUNNER_AREA });
    let lanes = createLaneControls();
    let engine = createRunner();
    let mode: Mode = 'camera', cameraStarting = false, cameraReady = false, muted = false;
    let error = '', fatal = '', status = 'Step into the middle to play', tracked = false;
    let phase = 'waiting', progress = 0, debug: DebugSnapshot | null = null;
    let keyboardLane = 0, keyboardDuck = false, best = 0, restartAt = 0;
    let devices: MediaDeviceInfo[] = [], device = '';
    let audio: AudioContext | null = null;
    let requestGeneration = 0;
    const downKeys = new Set<string>();
    try { best = Number(localStorage.getItem('science-fest-runner-best')) || 0; } catch { /* private browsing */ }
    try { scene = createRunnerScene(canvasRef.current!); }
    catch { fatal = 'The 3D game could not start. Enable hardware acceleration in your browser and reload.'; }

    const sound = (type: 'coin' | 'jump' | 'crash' | 'start' | 'horn') => {
      if (!audio || audio.state !== 'running' || muted) return;
      if (type === 'horn') {
        // Two-tone "beep beep" so players hear traffic before it reaches them.
        const now = audio.currentTime;
        for (const [offset, freq] of [[0, 392], [0, 494], [0.2, 392], [0.2, 494]]) {
          const osc = audio.createOscillator(), gain = audio.createGain();
          osc.type = 'square'; osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.025, now + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.15);
          osc.connect(gain); gain.connect(audio.destination); osc.start(now + offset); osc.stop(now + offset + 0.16);
          osc.onended = () => { osc.disconnect(); gain.disconnect(); };
        }
        return;
      }
      const osc = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
      const notes = { coin: [880, 1320, 0.09], jump: [260, 620, 0.15], crash: [150, 45, 0.3], start: [440, 880, 0.2] };
      const [from, to, duration] = notes[type];
      osc.type = type === 'crash' ? 'sawtooth' : 'sine';
      osc.frequency.setValueAtTime(from, now); osc.frequency.exponentialRampToValueAtTime(to, now + duration);
      gain.gain.setValueAtTime(type === 'crash' ? 0.045 : 0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(now + duration);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    };
    const unlockAudio = () => {
      try { audio ??= new (window.AudioContext || (window as any).webkitAudioContext)(); void audio.resume().catch(() => {}); } catch { /* sound is optional */ }
    };
    const stopCamera = () => {
      requestGeneration++;
      stream?.getTracks().forEach(t => t.stop()); stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      cameraReady = false; cameraStarting = false; videoTime = -1; lastFresh = 0;
    };
    const reset = () => {
      engine = createRunner(); session = createPlayerSession({ area: RUNNER_AREA }); lanes = createLaneControls();
      tracked = false; phase = 'waiting'; progress = 0; debug = null;
      keyboardLane = 0; keyboardDuck = false; downKeys.clear();
      status = mode === 'camera' ? 'Step into the middle to play' : 'Arrow keys to move · Space to jump';
      overlayRef.current?.getContext('2d')?.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      lastUi = -Infinity;
    };
    const start = () => {
      if (fatal || performance.now() < restartAt || !['idle', 'over'].includes(engine.phase)) return;
      if (mode === 'camera' && (!session.controls.ready || !tracked)) return;
      startRunner(engine); sound('start'); lastUi = -Infinity;
    };
    const jump = () => {
      if (['idle', 'over'].includes(engine.phase)) start();
      else if (jumpRunner(engine)) sound('jump');
    };
    const startCamera = async (requestedDevice?: string) => {
      if (cameraStarting || disposed) return;
      unlockAudio(); stopCamera(); mode = 'camera'; reset(); cameraStarting = true; error = '';
      const generation = requestGeneration;
      const cancelled = () => disposed || generation !== requestGeneration;
      let pending: MediaStream | null = null;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost.');
        pending = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 960 },
          frameRate: { ideal: 30, max: 30 }, ...(requestedDevice ? { deviceId: { exact: requestedDevice } } : {}) }, audio: false });
        if (cancelled()) { pending.getTracks().forEach(t => t.stop()); return; }
        stream = pending;
        const video = videoRef.current!; video.srcObject = stream; await video.play();
        status = 'Loading pose tracking…';
        if (!model) {
          const vision = await FilesetResolver.forVisionTasks('/wasm');
          const options = { baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'GPU' as const },
            runningMode: 'VIDEO' as const, numPoses: 3 };
          let loaded: PoseLandmarker;
          try { loaded = await PoseLandmarker.createFromOptions(vision, options); }
          catch { loaded = await PoseLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } }); }
          if (cancelled()) { loaded.close(); return; }
          model = loaded;
        }
        if (cancelled()) return;
        devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        if (cancelled()) return;
        device = stream!.getVideoTracks()[0]?.getSettings().deviceId ?? '';
        cameraReady = true; status = 'Step into the middle to play';
        stream!.getVideoTracks()[0].addEventListener('ended', () => {
          if (cancelled()) return;
          stopCamera(); reset(); error = 'Camera disconnected. Reconnect it, then enable the camera again.';
        });
      } catch (err) {
        pending?.getTracks().forEach(t => t.stop());
        if (!cancelled()) {
          stopCamera();
          const e = err as Error;
          error = e.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow camera access in your browser, then try again.'
            : e.name === 'NotFoundError' ? 'No camera found. Connect your webcam and try again.'
            : e.name === 'NotReadableError' ? 'The camera is busy. Close any other app using it and try again.'
            : `Could not start camera tracking: ${e.message}`;
        }
      } finally { if (!cancelled()) cameraStarting = false; lastUi = -Infinity; }
    };
    actionRef.current = { camera: startCamera, keyboard: () => { unlockAudio(); stopCamera(); mode = 'keyboard'; error = ''; reset(); },
      reset, start, mute: () => { muted = !muted; unlockAudio(); },
      lane: value => { if (mode === 'keyboard') keyboardLane = value; }, jump: () => { if (mode === 'keyboard') { unlockAudio(); jump(); } },
      duck: value => { if (mode === 'keyboard') keyboardDuck = value; } };

    function drawOverlay(points: any[] | null) {
      const canvas = overlayRef.current!, video = videoRef.current!;
      if (!video.videoWidth) return;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
      const ctx = canvas.getContext('2d')!, w = canvas.width, h = canvas.height, scale = h / 480;
      ctx.clearRect(0, 0, w, h);
      if (lanes.ready) {
        const bounds = laneBoundaries(lanes), split = [0, bounds.left, bounds.right, 1];
        // Draw in display coordinates while CSS mirrors the entire canvas.
        ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1);
        ctx.fillStyle = '#00cc8814'; ctx.fillRect(split[lanes.lane + 1] * w, 0, (split[lanes.lane + 2] - split[lanes.lane + 1]) * w, h);
        ctx.lineWidth = 2 * scale; ctx.setLineDash([10 * scale, 9 * scale]);
        for (const x of [bounds.left, bounds.right]) { ctx.strokeStyle = '#ffffffaa'; ctx.beginPath(); ctx.moveTo(x * w, h * .14); ctx.lineTo(x * w, h * .9); ctx.stroke(); }
        ctx.strokeStyle = '#00e7a0'; ctx.beginPath(); ctx.moveTo(bounds.center * w, h * .14); ctx.lineTo(bounds.center * w, h * .9); ctx.stroke();
        ctx.setLineDash([]); ctx.font = `bold ${13 * scale}px monospace`; ctx.textAlign = 'center';
        for (const lane of [-1, 0, 1]) {
          const x = lane === -1 ? bounds.left / 2 : lane === 1 ? (bounds.right + 1) / 2 : bounds.center;
          ctx.fillStyle = '#101719aa'; ctx.fillRect(x * w - 37 * scale, h * .88, 74 * scale, 23 * scale);
          ctx.fillStyle = lane === lanes.lane ? '#70ffb5' : '#ffffff'; ctx.fillText(laneName(lane), x * w, h * .88 + 16 * scale);
        }
        ctx.restore();
      } else {
        ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2 * scale; ctx.setLineDash([12 * scale, 9 * scale]);
        ctx.strokeRect(PLAY_AREA.left * w, h * .10, (PLAY_AREA.right - PLAY_AREA.left) * w, h * .78); ctx.setLineDash([]);
      }
      if (!points) return;
      const visible = (p: any) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && (!Number.isFinite(p.visibility) || p.visibility > 0.5);
      ctx.lineWidth = 3 * scale; ctx.strokeStyle = '#5dffac';
      for (const [a, b] of CONNECTIONS) if (visible(points[a]) && visible(points[b])) {
        ctx.beginPath(); ctx.moveTo(points[a].x * w, points[a].y * h); ctx.lineTo(points[b].x * w, points[b].y * h); ctx.stroke();
      }
      ctx.fillStyle = '#a4ffd0';
      for (const i of new Set(CONNECTIONS.flat())) if (visible(points[i])) { ctx.beginPath(); ctx.arc(points[i].x * w, points[i].y * h, 4 * scale, 0, Math.PI * 2); ctx.fill(); }
    }

    function predict(now: number) {
      if (mode !== 'camera' || !cameraReady || !model || now - lastInference < 1000 / 30) return;
      lastInference = now;
      const video = videoRef.current!;
      let points: any[][] = [], fresh = false, inferenceMs: number | null = null, inferenceError: string | null = null;
      const previous = lastFresh;
      if (video.readyState >= 2 && video.currentTime !== videoTime) {
        videoTime = video.currentTime;
        try { const before = performance.now(); points = model.detectForVideo(video, now).landmarks;
          inferenceMs = performance.now() - before; lastFresh = now; fresh = true; }
        catch (e) { inferenceError = (e as Error).message; }
      }
      if (!fresh && !inferenceError && now - lastFresh <= SESSION_TIMING.frameGap) return;
      const playing = ['countdown', 'running'].includes(engine.phase);
      const result = updatePlayerSession(session, points, now, video.videoWidth / video.videoHeight || 1, playing);
      if (result.departed) { reset(); drawOverlay(null); return; }
      tracked = result.tracked; phase = result.phase; progress = result.progress;
      status = result.message;
      if (!session.controls.ready) lanes = createLaneControls();
      else if (!lanes.ready && session.track) calibrateLanes(lanes, session.track.x, session.controls.width, video.videoWidth / video.videoHeight);
      if (result.landmarks && lanes.ready) {
        const x = (result.landmarks[11].x + result.landmarks[12].x) / 2;
        updateLane(lanes, x, now);
      }
      engine.duck = result.duck;
      if (result.jump && tracked) jump();
      if (session.controls.ready && tracked) {
        status = engine.phase === 'over' ? 'Stand in the middle, then jump to retry'
          : playing ? `${laneName(lanes.lane)} LANE · ${result.duck ? 'DUCK' : session.controls.pose === 'jump' ? 'JUMP' : 'Move, jump & duck'}`
          : 'Ready — jump to play!';
      }
      debug = { session: result.debug, freshFrame: fresh, inferenceMs,
        inferenceGapMs: previous ? now - previous : null, frameAgeMs: now - lastFresh, inferenceError };
      drawOverlay(result.landmarks);
    }

    const keydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (mode !== 'keyboard' || ['INPUT','SELECT','TEXTAREA'].includes(target?.tagName)) return;
      if (target?.tagName === 'BUTTON' && e.code === 'Space' && !target.closest('.runner-touch-controls')) return;
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','KeyA','KeyD','KeyW','KeyS'].includes(e.code)) return;
      e.preventDefault(); if (downKeys.has(e.code)) return; downKeys.add(e.code); unlockAudio();
      if (['ArrowLeft','KeyA'].includes(e.code)) keyboardLane = Math.max(-1, keyboardLane - 1);
      else if (['ArrowRight','KeyD'].includes(e.code)) keyboardLane = Math.min(1, keyboardLane + 1);
      else if (['ArrowDown','KeyS'].includes(e.code)) keyboardDuck = true;
      else jump();
    };
    const keyup = (e: KeyboardEvent) => { downKeys.delete(e.code); if (['ArrowDown','KeyS'].includes(e.code)) keyboardDuck = false; };
    const blur = () => { downKeys.clear(); keyboardDuck = false; };
    const syncFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    const contextLost = (event: Event) => { event.preventDefault(); fatal = 'Graphics were interrupted. Reload the page to restart the game.'; };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    document.addEventListener('fullscreenchange', syncFullscreen);
    canvasRef.current!.addEventListener('webglcontextlost', contextLost);
    function frame(now: number) {
      if (disposed) return;
      const dt = last ? Math.min((now - last) / 1000, .1) : 0; last = now;
      if (!document.hidden && !fatal) {
        predict(now);
        const prior = engine.phase;
        stepRunner(engine, dt, { lane: mode === 'keyboard' ? keyboardLane : lanes.lane,
          duck: mode === 'keyboard' ? keyboardDuck : engine.duck,
          paused: mode === 'camera' && !tracked });
        if (engine.collected.length) sound('coin');
        if (engine.honks.length) sound('horn');
        if (prior !== 'over' && engine.phase === 'over') {
          sound('crash'); restartAt = now + 1000;
          if (engine.score > best) { best = engine.score; try { localStorage.setItem('science-fest-runner-best', String(best)); } catch { /* optional */ } }
        }
        scene?.render(engine, dt, now / 1000, engine.phase === 'idle');
      }
      if (now - lastUi > 100) {
        lastUi = now;
        setUi({ mode, phase: engine.phase, cameraReady, cameraStarting, status, sessionPhase: phase,
          progress, ready: session.controls.ready, tracked, lane: mode === 'keyboard' ? keyboardLane : lanes.lane,
          duck: engine.duck, jumping: engine.y > .1, score: engine.score, coins: engine.coins, best,
          countdown: Math.max(1, Math.ceil(engine.countIn)), muted, error, fatal, crash: engine.crash,
          debug: debugRef.current ? debug : null, devices, device });
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      disposed = true; stopCamera(); cancelAnimationFrame(raf); model?.close(); scene?.dispose(); void audio?.close();
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur);
      document.removeEventListener('fullscreenchange', syncFullscreen);
      canvasRef.current?.removeEventListener('webglcontextlost', contextLost);
      actionRef.current = null;
    };
  }, []);

  const toggleFullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); setNotice(''); }
    catch { setNotice("Use your browser’s View menu to enter full screen."); }
  };
  const cameraMode = ui.mode === 'camera';
  const active = ['running', 'countdown'].includes(ui.phase);
  return <div className="tv-layout runner-layout">
    <section className="game-panel" aria-label="Lane Runner game">
      <header className="game-header">
        <h1>LANE RUNNER</h1>
        <div className="display-controls">
          <button onClick={() => { debugRef.current = !showDebug; setShowDebug(!showDebug); }} aria-pressed={showDebug} aria-controls="calibration-debug">DEBUG {showDebug ? 'ON' : 'OFF'}</button>
          <button onClick={() => actionRef.current?.mute()} aria-pressed={ui.muted}>SOUND {ui.muted ? 'OFF' : 'ON'}</button>
          <button onClick={toggleFullscreen}>{fullscreen ? 'EXIT FULL SCREEN' : 'FULL SCREEN'}</button>
        </div>
      </header>
      {notice && <p className="display-message" role="status">{notice}</p>}
      <div className="game-stage runner-stage">
        <canvas ref={canvasRef} className="runner-canvas" aria-label="Three-lane campus runner" />
        <div className="runner-score" aria-label="Game score"><span>SCORE {String(ui.score).padStart(5, '0')}</span><span className="runner-coins">● {ui.coins}</span><small>BEST {String(ui.best).padStart(5, '0')}</small></div>
        {ui.fatal ? <div className="runner-screen"><div className="runner-card"><h2>GRAPHICS INTERRUPTED</h2><p role="alert">{ui.fatal}</p><button onClick={() => location.reload()}>RELOAD GAME</button></div></div>
          : ui.phase === 'idle' ? <div className="runner-screen"><div className="runner-card">
            <span className="runner-kicker">YOUR BODY IS THE CONTROLLER</span>
            <h2>{!cameraMode ? 'READY TO RUN?' : ui.ready ? 'READY!' : ui.cameraStarting ? 'GETTING READY…' : ui.cameraReady ? ui.sessionPhase === 'settling' ? 'STAND NATURALLY' : 'STEP INTO THE MIDDLE' : 'STEP IN. RUN.'}</h2>
            <p>{!cameraMode ? 'Dodge traffic, jump barriers, duck gates. Keep going.' : ui.cameraReady ? ui.ready ? 'Jump to play' : 'Face the screen. We’ll do the rest.' : 'Move left & right, jump, and duck to play.'}</p>
            {cameraMode && !ui.cameraReady && <button className="runner-primary" disabled={ui.cameraStarting} onClick={() => void actionRef.current?.camera()}>{ui.cameraStarting ? 'OPENING CAMERA…' : 'ENABLE CAMERA'}</button>}
            {cameraMode && ui.sessionPhase === 'settling' && <progress className="settle-progress" max={1} value={ui.progress} aria-label="Automatic calibration" />}
            {!cameraMode && <button className="runner-primary" onClick={() => actionRef.current?.start()}>START RUN</button>}
            {ui.error && <p className="runner-error" role="alert">{ui.error}</p>}
            {cameraMode && !ui.cameraReady && <button className="runner-text-button" disabled={ui.cameraStarting} onClick={() => actionRef.current?.keyboard()}>TRY WITH KEYBOARD</button>}
          </div></div> : null}
        {active && cameraMode && !ui.tracked && <div className="tracking-pause"><p>WAITING FOR YOU</p><span>Step back into view to keep running.</span></div>}
        {ui.phase === 'countdown' && (!cameraMode || ui.tracked) && <div className="runner-countdown" role="status"><strong>{ui.countdown}</strong><span>GET READY</span></div>}
        {ui.phase === 'over' && !ui.fatal && <div className="runner-screen runner-gameover"><div className="runner-card">
          <span className="runner-kicker">NICE RUN!</span><h2>GAME OVER</h2>
          <div className="runner-results"><span>{ui.score}<small>SCORE</small></span><span>{ui.coins}<small>COINS</small></span></div>
          <p>{ui.crash}</p>
          <strong className="runner-retry">{cameraMode ? ui.ready && ui.tracked ? 'JUMP TO RESTART' : 'STAND IN THE MIDDLE' : 'SPACE TO RESTART'}</strong>
          {!cameraMode && <button onClick={() => actionRef.current?.start()}>RUN AGAIN</button>}
          {cameraMode && ui.sessionPhase === 'settling' && <progress className="settle-progress" max={1} value={ui.progress} aria-label="Recalibrating" />}
        </div></div>}
        {showDebug && <CalibrationDebug snapshot={ui.debug} phase={ui.sessionPhase} cameraReady={ui.cameraReady} />}
      </div>
      <p className="game-instructions"><span>MOVE LEFT &amp; RIGHT</span><span>JUMP &amp; DUCK</span></p>
    </section>
    <section className="camera-panel" aria-label="Live mirrored camera and pose tracking">
      <video ref={videoRef} autoPlay playsInline muted className="camera-image" />
      <canvas ref={overlayRef} className="camera-image camera-overlay" />
      {!ui.cameraReady && <div className="camera-placeholder">
        {cameraMode ? <><span className="camera-symbol" aria-hidden="true">◎</span><p>YOUR CAMERA VIEW</p><span>Enable the camera above to see yourself here.</span></>
          : <div className="runner-keyboard-panel"><span className="runner-kicker">KEYBOARD MODE</span><h2>TAKE IT FOR A RUN</h2><p>← → change lanes<br/>Space / ↑ jump<br/>Hold ↓ to duck</p>
            <div className="runner-touch-controls"><button aria-label="Move left" onClick={() => actionRef.current?.lane(Math.max(-1, ui.lane - 1))}>←</button><button onClick={() => actionRef.current?.jump()}>JUMP</button><button onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); actionRef.current?.duck(true); }} onPointerUp={() => actionRef.current?.duck(false)} onPointerCancel={() => actionRef.current?.duck(false)} onLostPointerCapture={() => actionRef.current?.duck(false)}>DUCK</button><button aria-label="Move right" onClick={() => actionRef.current?.lane(Math.min(1, ui.lane + 1))}>→</button></div>
            <button className="recalibrate-button" onClick={() => void actionRef.current?.camera()}>SWITCH TO CAMERA</button>
          </div>}
      </div>}
      <div className="camera-heading"><span className="camera-label">{cameraMode ? ui.cameraReady ? 'LIVE CAMERA' : 'CAMERA' : 'KEYBOARD'}</span><p className="pose-status" role="status">{ui.status}</p></div>
      <div className="camera-footer">
        <div className="pose-signals" aria-label="Movement indicators">
          <span><span className={`pose-light lane-light ${ui.lane === -1 ? 'active' : ''}`} />LEFT</span>
          <span><span className={`pose-light jump-light ${ui.jumping ? 'active' : ''}`} />JUMP</span>
          <span><span className={`pose-light duck-light ${ui.duck ? 'active' : ''}`} />DUCK</span>
          <span><span className={`pose-light lane-light ${ui.lane === 1 ? 'active' : ''}`} />RIGHT</span>
        </div>
        <div className="runner-camera-controls">
          {ui.cameraReady && ui.devices.length > 1 && <select aria-label="Choose camera" value={ui.device} onChange={e => void actionRef.current?.camera(e.target.value)}>{ui.devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select>}
          <button onClick={() => actionRef.current?.reset()} disabled={cameraMode && !ui.cameraReady} className="recalibrate-button">RESET PLAYER</button>
        </div>
      </div>
    </section>
  </div>;
}
