export class RunnerGame {
  constructor({ duration = 120 } = {}) {
    this.duration = duration;
    this.elapsed = 0;
    this.distance = 0;
    this.activeTime = 0;
    this.energy = 0;
    this.speed = 0;
    this.gap = 230;
    this.status = 'running';
    this.paused = false;
  }
  step(dt, effort) {
    if (this.paused || this.status !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
    // Substeps keep the chase and energy response consistent on slower displays.
    let remaining = Math.min(dt, 0.25, this.duration - this.elapsed);
    while (remaining > 1e-9 && this.status === 'running') {
      const step = Math.min(remaining, 1 / 120);
      const movement = Number.isFinite(effort) ? Math.max(0, Math.min(1.5, effort)) : 0;
      this.energy += (Math.min(100, movement * 100) - this.energy) * (1 - Math.exp(-step / 0.7));
      this.speed = this.energy < 1 ? 0 : this.energy * 2.2;
      this.distance += this.speed * step / 20;
      this.elapsed += step;
      if (movement > 0.12) this.activeTime += step;
      if (this.elapsed > 5) this.gap = Math.min(370, this.gap + (this.speed - Math.min(100, 72 + this.elapsed * 0.08)) * step);
      remaining -= step;
      if (this.elapsed >= this.duration - 1e-8) { this.elapsed = this.duration; this.status = 'complete'; }
      else if (this.gap <= 0) { this.gap = 0; this.status = 'caught'; }
    }
  }
}
