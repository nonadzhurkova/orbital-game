"use client";

/** Tiny WebAudio synth — no assets, muted until enable() after a user gesture. */
class Sound {
  private ctx: AudioContext | null = null;
  enabled = false;

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on && !this.ctx && typeof window !== "undefined") {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    this.ctx?.resume();
  }

  private blip(freq: number, duration: number, type: OscillatorType, gain = 0.08, sweep = 1) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * sweep), t0 + duration);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration);
  }

  launch() {
    this.blip(160, 0.5, "sawtooth", 0.06, 0.4);
  }
  burn() {
    this.blip(220, 0.3, "square", 0.05, 0.6);
  }
  flyby(gain: boolean) {
    this.blip(gain ? 300 : 500, 0.35, "sine", 0.07, gain ? 2.2 : 0.45);
  }
  win() {
    this.blip(440, 0.15, "sine", 0.08);
    setTimeout(() => this.blip(554, 0.15, "sine", 0.08), 140);
    setTimeout(() => this.blip(659, 0.3, "sine", 0.08), 280);
  }
  lose() {
    this.blip(180, 0.6, "sawtooth", 0.07, 0.3);
  }
}

export const sound = new Sound();
