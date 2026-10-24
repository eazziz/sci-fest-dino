import { PLAY_AREA } from './playerSession.mjs';

// MediaPipe Pose's 33-landmark topology (face, arms, hands, torso, legs, feet).
export const FULL_BODY_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32]
];
const FACE = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

type Point = { x: number; y: number; visibility?: number };
const visible = (p?: Point) => Boolean(p) && Number.isFinite(p!.x) && Number.isFinite(p!.y)
  && p!.x >= -0.05 && p!.x <= 1.05 && p!.y >= -0.05 && p!.y <= 1.05
  && (!Number.isFinite(p!.visibility) || p!.visibility! > 0.5);

// Draw the full skeleton on a camera-sized canvas (normalized landmark coordinates).
export function drawSkeleton(ctx: CanvasRenderingContext2D, points: Point[] | null | undefined) {
  if (!points) return;
  const w = ctx.canvas.width, h = ctx.canvas.height, scale = h / 480;
  ctx.save();
  ctx.lineCap = 'round';
  for (const [a, b] of FULL_BODY_CONNECTIONS) {
    if (!visible(points[a]) || !visible(points[b])) continue;
    const face = FACE.has(a) && FACE.has(b);
    ctx.strokeStyle = face ? '#c8ffe3cc' : '#5dffac';
    ctx.lineWidth = (face ? 1.5 : 3.5) * scale;
    ctx.beginPath(); ctx.moveTo(points[a].x * w, points[a].y * h); ctx.lineTo(points[b].x * w, points[b].y * h); ctx.stroke();
  }
  for (let i = 0; i < points.length; i++) {
    if (!visible(points[i])) continue;
    ctx.fillStyle = i === 11 || i === 12 ? '#00ff66' : FACE.has(i) ? '#e6fff2' : '#a4ffd0';
    ctx.beginPath(); ctx.arc(points[i].x * w, points[i].y * h, (FACE.has(i) ? 2.5 : i === 11 || i === 12 ? 6 : 4) * scale, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export const SETUP_COLORS = { waiting: '#ff9f1a', ready: '#00d68f' };
export const BOX_TOP = 0.08, BOX_BOTTOM = 0.92;

// The entry box players must stand in. Orange while waiting, fills green while the
// game measures them, solid green once ready. Text is un-mirrored for the CSS flip.
export function drawSetupBox(ctx: CanvasRenderingContext2D, phase: string, progress: number, time: number) {
  const w = ctx.canvas.width, h = ctx.canvas.height, scale = h / 480;
  const x = PLAY_AREA.left * w, bw = (PLAY_AREA.right - PLAY_AREA.left) * w;
  const y = BOX_TOP * h, bh = (BOX_BOTTOM - BOX_TOP) * h;
  const ready = phase === 'ready';
  const fill = ready ? 1 : phase === 'settling' ? Math.max(0, Math.min(1, progress)) : 0;
  ctx.save();
  // Dim everything outside the box so the box reads as "the spot".
  ctx.fillStyle = '#0008';
  ctx.fillRect(0, 0, x, h); ctx.fillRect(x + bw, 0, w - x - bw, h);
  ctx.fillRect(x, 0, bw, y); ctx.fillRect(x, y + bh, bw, h - y - bh);
  if (fill > 0) {
    ctx.fillStyle = ready ? '#00d68f33' : '#00d68f40';
    ctx.fillRect(x, y + bh * (1 - fill), bw, bh * fill);
  }
  if (phase === 'waiting' || phase === 'lost') {
    // Faint body outline: "put yourself here, filling the box".
    ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 3 * scale; ctx.setLineDash([]);
    const cx = x + bw / 2, head = bh * 0.07;
    ctx.beginPath(); ctx.arc(cx, y + bh * 0.16, head, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - bw * 0.26, y + bh * 0.24); ctx.lineTo(cx + bw * 0.26, y + bh * 0.24); // shoulders
    ctx.moveTo(cx - bw * 0.26, y + bh * 0.24); ctx.lineTo(cx - bw * 0.32, y + bh * 0.55);
    ctx.moveTo(cx + bw * 0.26, y + bh * 0.24); ctx.lineTo(cx + bw * 0.32, y + bh * 0.55);
    ctx.moveTo(cx - bw * 0.18, y + bh * 0.24); ctx.lineTo(cx - bw * 0.16, y + bh * 0.56); // torso
    ctx.moveTo(cx + bw * 0.18, y + bh * 0.24); ctx.lineTo(cx + bw * 0.16, y + bh * 0.56);
    ctx.moveTo(cx - bw * 0.16, y + bh * 0.56); ctx.lineTo(cx + bw * 0.16, y + bh * 0.56);
    ctx.moveTo(cx - bw * 0.12, y + bh * 0.56); ctx.lineTo(cx - bw * 0.14, y + bh * 0.97); // legs
    ctx.moveTo(cx + bw * 0.12, y + bh * 0.56); ctx.lineTo(cx + bw * 0.14, y + bh * 0.97);
    ctx.stroke();
  }
  const pulse = ready ? 1 + 0.35 * Math.sin(time * 6) : 1;
  ctx.strokeStyle = fill > 0 ? SETUP_COLORS.ready : SETUP_COLORS.waiting;
  ctx.lineWidth = Math.max(3, h / 90) * pulse;
  ctx.setLineDash(ready ? [] : [h / 40, h / 70]);
  ctx.strokeRect(x, y, bw, bh);
  // Label pinned to the top of the box, drawn in display (unmirrored) coordinates.
  const label = ready ? 'JUMP TO START!' : phase === 'settling' ? 'HOLD STILL…' : 'STAND IN THE BOX';
  ctx.setLineDash([]);
  ctx.translate(w, 0); ctx.scale(-1, 1);
  const fontPx = Math.round(Math.min(bw / (label.length * 0.62), 30 * scale));
  ctx.font = `900 ${fontPx}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lx = w - (x + bw / 2), ly = y + fontPx * 0.95;
  const tw = ctx.measureText(label).width + fontPx;
  ctx.fillStyle = ready || fill > 0 ? SETUP_COLORS.ready : SETUP_COLORS.waiting;
  ctx.fillRect(lx - tw / 2, ly - fontPx * 0.8, tw, fontPx * 1.6);
  ctx.fillStyle = '#101719';
  ctx.fillText(label, lx, ly);
  ctx.restore();
}
