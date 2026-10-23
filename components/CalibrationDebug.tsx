import React from 'react';
import { updatePlayerSession } from './playerSession.mjs';
import { RISE } from './poseControls.mjs';

export interface DebugSnapshot {
    session: ReturnType<typeof updatePlayerSession>['debug'];
    freshFrame: boolean;
    inferenceMs: number | null;
    inferenceGapMs: number | null;
    frameAgeMs: number;
    inferenceError: string | null;
}

const ms = (value: number | null) => value === null ? '—' : `${Math.round(value)} ms`;
const value = (n: number) => Number.isFinite(n) ? n.toFixed(3) : '—';

function CheckTable({ checks }: { checks: DebugSnapshot['session']['checks'] }) {
    return (
        <table className="debug-checks">
            <thead><tr><th>Check</th><th>Result</th><th>Measured / required</th></tr></thead>
            <tbody>{checks.map(c => (
                <tr key={c.id} data-check={c.id} data-result={c.status}>
                    <td>{c.label}</td>
                    <td className={`debug-${c.status}`}>{c.status.toUpperCase()}</td>
                    <td>{c.detail}</td>
                </tr>
            ))}</tbody>
        </table>
    );
}

export default function CalibrationDebug({ snapshot, phase, cameraReady }: {
    snapshot: DebugSnapshot | null; phase: string; cameraReady: boolean;
}) {
    const debug = snapshot?.session;
    const failures = debug?.checks.filter(c => c.status === 'fail') ?? [];
    const blocker = !cameraReady ? 'Enable the camera to begin'
        : !snapshot ? 'Waiting for the first pose update'
        : snapshot.inferenceError ? `Pose inference error: ${snapshot.inferenceError}`
        : !snapshot.freshFrame ? 'No fresh camera frame — tracking is waiting'
        : phase === 'playing' ? 'Playing — calibration is locked'
        : phase === 'ready' && debug?.calibrated ? 'READY — jump to play'
        : failures.length ? `Waiting on: ${failures.map(c => c.label).join(', ')}`
        : 'Collecting a stable standing pose';

    return (
        <aside id="calibration-debug" className="calibration-debug" aria-label="Calibration diagnostics">
            <h2>CALIBRATION DEBUG <span>{phase.toUpperCase()}</span></h2>
            <p className="debug-blocker">{blocker}</p>
            {debug && snapshot && <>
                <div className="debug-metrics">
                    <span>Poses: <b>{debug.detected}</b></span>
                    <span>Inspecting: <b>{debug.focusedIndex === null ? 'none' : `pose ${debug.focusedIndex + 1}`}</b></span>
                    <span>Inference: <b>{ms(snapshot.inferenceMs)}</b></span>
                    <span>Detection interval: <b>{ms(snapshot.inferenceGapMs)}</b></span>
                    <span>Frame age: <b>{ms(snapshot.frameAgeMs)}</b></span>
                    <span>Samples: <b>{debug.sampleCount} / 15</b></span>
                    <span>Standing time: <b>{ms(debug.elapsedMs)} / 1000 ms</b></span>
                    <span>Jump armed: <b>{debug.armed ? 'yes' : 'no'}</b></span>
                </div>
                <p className="debug-reset">Last reset: <b>{debug.lastReset?.reason ?? 'none'}</b>
                    {debug.lastReset && ` (${ms(debug.time - debug.lastReset.time)} ago)`}</p>
                <p className="debug-note">Setup checks apply while calibrating. SKIP means an optional body part is out of view.
                    Values use camera coordinates; X=0.5 is the center. Scroll for all checks.</p>
                <CheckTable checks={debug.checks} />
                <p className="debug-note">Baseline Y: {value(debug.baseline)} · Shoulder scale: {value(debug.width)}
                    {' '}· Movement offset: {value(debug.offset)}
                    {' '}· Rise speed: {value(debug.riseSpeed)} widths/s (jump at ≥ {RISE.minSpeed.toFixed(1)})</p>
                <details>
                    <summary>Inspect all detected poses ({debug.candidates.length})</summary>
                    {debug.candidates.map(candidate => <section key={candidate.index}>
                        <h3>Pose {candidate.index + 1}{candidate.index === debug.focusedIndex ? ' (inspected above)' : ''}</h3>
                        <CheckTable checks={candidate.checks} />
                    </section>)}
                </details>
            </>}
        </aside>
    );
}
