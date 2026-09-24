/**
 * Playback clock shared by the 3D scene (read every frame, no React) and the HUD.
 * `t` is in sitting days: floor(t) = day index, fract(t) = time of day (0 = dawn, 1 = night).
 * It is a mutable object on purpose: the frame loop must not wait for React.
 */
export type Focus =
  | { kind: "person"; idx: number; dist?: number }
  | { kind: "dispute"; idx: number; dist?: number }
  | { kind: "court"; dist?: number }
  | { kind: "overview" };

export class WorldClock {
  t = 0;
  playing = false;
  speed = 1; // 1 | 4 | 16
  secondsPerDay = 3.2; // at 1x
  maxT = 0;
  /** extra multiplier the director sets (slow on story beats, fast between them) */
  directorRate = 1;
  focus: Focus | null = { kind: "overview" };
  reducedMotion = false;
  selectedDispute = -1;
  selectedPerson = -1;
  hoverPerson = -1;

  constructor(days: number) {
    this.maxT = Math.max(0, days - 0.001);
  }
  setDays(days: number) { this.maxT = Math.max(0, days - 0.001); }
  seek(t: number) { this.t = Math.min(this.maxT, Math.max(0, t)); }
  advance(dtSeconds: number) {
    if (!this.playing) return false;
    this.seek(this.t + (dtSeconds * this.speed * this.directorRate) / this.secondsPerDay);
    if (this.t >= this.maxT) { this.playing = false; return true; }
    return false;
  }
  setPlaying(v: boolean) { this.playing = v; }
  setSpeed(v: number) { this.speed = v; }
  setSecondsPerDay(v: number) { this.secondsPerDay = v; }
  setRate(v: number) { this.directorRate = v; }
  setFocus(f: Focus | null) { this.focus = f; }
  setReducedMotion(v: boolean) { this.reducedMotion = v; }
  select(dispute: number, person: number) { this.selectedDispute = dispute; this.selectedPerson = person; }
  setHover(i: number) { this.hoverPerson = i; }
  get day() { return Math.floor(this.t); }
  get phase() { return this.t - Math.floor(this.t); }
}

// time-of-day phases for a hearing day
export const PHASE = { leave: 0.08, arrive: 0.4, verdict: 0.5, depart: 0.62, home: 0.94 };

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
