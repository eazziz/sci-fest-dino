import React from 'react';

// Shared walk-up guide for both games. Mirrors the camera box: orange → green → jump.
export default function SetupSteps({ phase, progress, ready, hint }: {
  phase: string; progress: number; ready: boolean; hint?: string;
}) {
  const step = ready ? 3 : phase === 'settling' ? 2 : 1;
  const steps = [
    { n: 1, label: 'STAND IN THE ORANGE BOX', short: 'STAND IN BOX' },
    { n: 2, label: 'HOLD STILL UNTIL IT TURNS GREEN', short: 'TURN GREEN' },
    { n: 3, label: 'JUMP TO START', short: 'JUMP!' }
  ];
  return <div className="setup-guide" role="status">
    <ol className="setup-steps" aria-label="How to start">
      {steps.map(s => <li key={s.n} className={s.n < step ? 'done' : s.n === step ? 'current' : ''}
        data-step={s.n}><span className="setup-num">{s.n < step ? '✓' : s.n}</span><span>{s.short}</span></li>)}
    </ol>
    {ready ? <div className="jump-cta">
        <span className="jump-cta-arrow" aria-hidden="true">▲</span>
        <strong>JUMP TO START!</strong>
        <span className="jump-cta-arrow" aria-hidden="true">▲</span>
      </div>
      : <div className="setup-current">
        <p className="setup-title">{step === 1 ? <>STAND IN THE <span className="setup-orange">ORANGE BOX</span></>
          : <>HOLD STILL… <span className="setup-green">TURNING GREEN</span></>}</p>
        <p className="setup-hint">{hint ?? (step === 1
          ? 'Look at the camera view below. Step in so your whole body fills the box.'
          : 'Stand naturally and face the screen.')}</p>
        {step === 2 && <div className="setup-meter" aria-label="Getting ready"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
        {step === 1 && <span className="setup-down" aria-hidden="true">▼</span>}
      </div>}
  </div>;
}
