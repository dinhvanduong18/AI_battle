class BackgroundMusicEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private chordTimer: ReturnType<typeof setInterval> | null = null;
  private melodyTimer: ReturnType<typeof setInterval> | null = null;
  private chordIndex = 0;
  private melodyIndex = 0;
  public enabled = false;
  public volume = 0.25;

  private readonly chords = [
    [220, 261.63, 329.63],
    [196, 246.94, 293.66],
    [174.61, 220, 261.63],
    [196, 246.94, 293.66],
  ];
  private readonly melody = [392, 440, 523.25, 440, 349.23, 392, 440, 329.63];

  constructor() {
    try {
      this.enabled = localStorage.getItem('ottv2-music') === 'on';
      const savedVolume = localStorage.getItem('ottv2-music-volume');
      if (savedVolume !== null && Number.isFinite(Number(savedVolume))) {
        this.volume = Math.min(1, Math.max(0, Number(savedVolume)));
      }
    } catch {
      this.enabled = false;
    }
  }

  async setEnabled(value: boolean): Promise<void> {
    this.enabled = value;
    this.saveEnabled();

    if (!value) {
      this.stopTimers();
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      }
      return;
    }

    try {
      await this.start();
    } catch (error) {
      this.enabled = false;
      this.saveEnabled();
      this.stopTimers();
      throw error;
    }
  }

  setVolume(value: number) {
    this.volume = Math.min(1, Math.max(0, value));
    try {
      localStorage.setItem('ottv2-music-volume', String(this.volume));
    } catch {
      // ignore storage quota
    }
    this.updateGain();
  }

  private saveEnabled() {
    try {
      localStorage.setItem('ottv2-music', this.enabled ? 'on' : 'off');
    } catch {
      // ignore storage quota
    }
  }

  private async start() {
    if (typeof window === 'undefined' || !window.AudioContext) {
      throw new Error('Trình duyệt này không hỗ trợ phát nhạc nền.');
    }

    if (!this.ctx) {
      this.ctx = new window.AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0;
      this.masterGain.connect(this.ctx.destination);
    }

    await this.ctx.resume();
    if (this.ctx.state !== 'running') {
      throw new Error('Trình duyệt chưa cho phép phát âm thanh. Hãy thử bật lại nhạc nền.');
    }

    this.updateGain();
    this.playChord();
    this.playMelodyNote();

    if (!this.chordTimer) {
      this.chordTimer = setInterval(() => {
        this.chordIndex = (this.chordIndex + 1) % this.chords.length;
        this.playChord();
      }, 3200);
    }
    if (!this.melodyTimer) {
      this.melodyTimer = setInterval(() => {
        this.playMelodyNote();
      }, 800);
    }
  }

  private playChord() {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    for (const frequency of this.chords[this.chordIndex]) {
      const oscillator = this.ctx.createOscillator();
      const envelope = this.ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(0.12, now + 0.45);
      envelope.gain.setValueAtTime(0.12, now + 2.2);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 3.1);
      oscillator.connect(envelope);
      envelope.connect(this.masterGain);
      oscillator.start(now);
      oscillator.stop(now + 3.15);
      oscillator.addEventListener('ended', () => {
        oscillator.disconnect();
        envelope.disconnect();
      }, { once: true });
    }
  }

  private playMelodyNote() {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const oscillator = this.ctx.createOscillator();
    const envelope = this.ctx.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = this.melody[this.melodyIndex];
    this.melodyIndex = (this.melodyIndex + 1) % this.melody.length;
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(0.22, now + 0.025);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);
    oscillator.connect(envelope);
    envelope.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + 0.65);
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      envelope.disconnect();
    }, { once: true });
  }

  private stopTimers() {
    if (this.chordTimer) clearInterval(this.chordTimer);
    if (this.melodyTimer) clearInterval(this.melodyTimer);
    this.chordTimer = null;
    this.melodyTimer = null;
  }

  private updateGain() {
    if (!this.ctx || !this.masterGain || !this.enabled) return;
    this.masterGain.gain.setTargetAtTime(
      this.volume * 0.45,
      this.ctx.currentTime,
      0.08
    );
  }
}

export const backgroundMusic = new BackgroundMusicEngine();
