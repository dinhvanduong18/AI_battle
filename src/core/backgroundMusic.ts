class BackgroundMusicEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private chordTimer: ReturnType<typeof setInterval> | null = null;
  private chordIndex = 0;
  private voices: OscillatorNode[] = [];
  public enabled = false;
  public volume = 0.25;

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

  setVolume(value: number) {
    this.volume = Math.min(1, Math.max(0, value));
    try {
      localStorage.setItem('ottv2-music-volume', String(this.volume));
    } catch {
      // ignore storage quota
    }
    this.updateGain();
  }

  setEnabled(value: boolean) {
    this.enabled = value;
    try {
      localStorage.setItem('ottv2-music', value ? 'on' : 'off');
    } catch {
      // ignore storage quota
    }

    if (!value) {
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
      }
      if (this.chordTimer) clearInterval(this.chordTimer);
      this.chordTimer = null;
      return;
    }

    this.start();
  }

  private start() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioContextConstructor = window.AudioContext;
      if (!AudioContextConstructor) return;

      this.ctx = new AudioContextConstructor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0;
      this.masterGain.connect(this.ctx.destination);

      const chordRoots = [110, 87.31, 98, 73.42];
      const intervals = [1, 1.5, 2, 2.5198];
      this.voices = intervals.map((interval, index) => {
        const oscillator = this.ctx!.createOscillator();
        const voiceGain = this.ctx!.createGain();
        oscillator.type = index === 1 ? 'triangle' : 'sine';
        oscillator.frequency.value = chordRoots[0] * interval;
        voiceGain.gain.value = [0.24, 0.12, 0.08, 0.1][index];
        oscillator.connect(voiceGain);
        voiceGain.connect(this.masterGain!);
        oscillator.start();
        return oscillator;
      });

      this.chordTimer = setInterval(() => {
        this.chordIndex = (this.chordIndex + 1) % chordRoots.length;
        const now = this.ctx?.currentTime;
        if (now === undefined) return;
        this.voices.forEach((voice, index) => {
          voice.frequency.setTargetAtTime(
            chordRoots[this.chordIndex] * intervals[index],
            now,
            1.4
          );
        });
      }, 5000);
    }

    this.ctx.resume().then(() => this.updateGain()).catch((error: unknown) => {
      console.error('Could not start background music:', error);
    });
  }

  private updateGain() {
    if (!this.ctx || !this.masterGain || !this.enabled) return;
    this.masterGain.gain.setTargetAtTime(
      this.volume * 0.12,
      this.ctx.currentTime,
      0.25
    );
  }
}

export const backgroundMusic = new BackgroundMusicEngine();
