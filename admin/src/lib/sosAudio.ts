// No audio asset exists anywhere in this repo (confirmed: no .mp3/.wav/.ogg
// files, no Audio/AudioContext/Howler usage before this file) and the
// brief explicitly says not to fetch one from an untrusted source or pull
// in an audio library for this. A short synthesized tone via the Web Audio
// API needs neither — it's a few dozen bytes of code, not a bundled
// binary, and gives full control over exactly how "professional, not
// startling" it sounds.
//
// Two distinct tones, both a brief two-note rise (never a continuous
// wail/siren — the brief is explicit that this is a notification sound,
// not an alarm): "new alert" is slightly brighter/louder (it's the one
// genuinely new thing that just happened), "reminder" is the same shape
// at lower volume (it's saying "still waiting", not "something new").

type ToneKind = 'new-alert' | 'reminder';

/**
 * Owns exactly one AudioContext for the whole SOS feature. Browsers start
 * every AudioContext 'suspended' until a real user gesture resumes it —
 * this class never assumes that worked; every caller gets an honest
 * boolean back, never a silently-swallowed failure.
 */
export class SosAudioManager {
  private ctx: AudioContext | null = null;
  private playing = false;

  /** True only once an AudioContext exists AND is actually 'running' —
   * the one fact the UI is allowed to call "sound is enabled" based on. */
  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Must be called synchronously from within a real user gesture (a
   * click handler) — that's the one thing that lets a browser resume an
   * AudioContext at all. Returns whether it actually ended up running,
   * never just whether the call didn't throw. */
  async unlock(): Promise<boolean> {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
        if (!Ctor) return false; // no Web Audio support at all — be honest, don't pretend
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return this.ctx.state === 'running';
    } catch (err) {
      console.error('[SosAudioManager] unlock failed:', err);
      return false;
    }
  }

  /** Never throws — a failed chime must not take the dashboard down with
   * it (brief: "Do not let audio failures crash the dashboard"). Also
   * never overlaps a tone already in flight (brief: "never play
   * overlapping copies of the same sound"); a reminder tick that lands
   * mid-chime is simply skipped, not queued, since the next tick will
   * cover it. */
  play(kind: ToneKind): boolean {
    if (!this.ctx || this.ctx.state !== 'running' || this.playing) return false;
    try {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const loud = kind === 'new-alert';
      const peak = loud ? 0.22 : 0.12;
      const notes: [freq: number, start: number, dur: number][] = [
        [880, 0, 0.14],
        [1175, 0.15, 0.22],
      ];
      this.playing = true;
      let lastEnd = now;
      for (const [freq, start, dur] of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t0 = now + start;
        const t1 = t0 + dur;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(peak, t0 + 0.02);
        gain.gain.linearRampToValueAtTime(0, t1);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t1 + 0.02);
        lastEnd = Math.max(lastEnd, t1 + 0.02);
      }
      const releaseMs = Math.max(50, (lastEnd - now) * 1000);
      window.setTimeout(() => {
        this.playing = false;
      }, releaseMs);
      return true;
    } catch (err) {
      console.error('[SosAudioManager] play failed:', err);
      this.playing = false;
      return false;
    }
  }

  /** Releases the underlying AudioContext — call on logout/unmount so no
   * audio resource outlives the session (brief, Phase 3.5). */
  dispose(): void {
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.playing = false;
  }
}
