const UPPER = [[23, 11, 13], [24, 12, 14], [11, 13, 15], [12, 14, 16]];
const LOWER = [[11, 23, 25], [12, 24, 26], [23, 25, 27], [24, 26, 28]];
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function angle(points, indices) {
  const p = indices.map(i => points[i]);
  if (p.some(v => !v || (v.visibility ?? 0) < 0.6 || !Number.isFinite(v.x) || !Number.isFinite(v.y))) return null;
  const [a, b, c] = p;
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const norm = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (norm < 1e-7) return null;
  return Math.acos(clamp((ux * vx + uy * vy) / norm, -1, 1)) * 180 / Math.PI;
}

export class MotionTracker {
  constructor(mode = 'standing') {
    this.joints = mode === 'seated' ? UPPER : [...UPPER, ...LOWER];
    this.reset();
  }
  reset() { this.previous = null; this.lastTime = null; }
  sample(points, timestamp) {
    const angles = this.joints.map(j => angle(points ?? [], j));
    const previous = this.previous;
    const dt = (timestamp - this.lastTime) / 1000;
    this.previous = angles;
    this.lastTime = timestamp;
    if (!angles.some(a => a !== null)) return null;
    if (!previous || dt <= 0 || dt > 0.5) return 0;
    const speeds = angles.flatMap((a, i) => a === null || previous[i] === null ? [] : [Math.abs(a - previous[i]) / dt]);
    if (!speeds.length) return 0;
    // Small pose-estimation fluctuations should not power the character.
    return clamp(speeds.reduce((a, b) => a + b, 0) / speeds.length - 6, 0, 600);
  }
}

export function calibrationTarget(samples) {
  const valid = samples.filter(n => Number.isFinite(n) && n > 8).sort((a, b) => a - b);
  if (valid.length === 0) return 60;
  return clamp(valid[Math.floor(valid.length / 2)], 20, 240);
}

export function effortLevel(motion, target, difficulty = 'moderate', sensitivity = 1) {
  if (!Number.isFinite(motion) || motion <= 0) return 0;
  const requirement = { gentle: 0.6, moderate: 1, active: 1.5, custom: 1 }[difficulty] ?? 1;
  const gain = difficulty === 'custom' ? clamp(Number(sensitivity) || 1, 0.5, 2) : 1;
  return clamp(motion / Math.max(20, target) / requirement * gain, 0, 1.5);
}
