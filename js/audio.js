// All sounds stay local. No AudioContext is created before unlock(), which is
// called by the application from a click, touch, or keyboard interaction.
export class GameAudio {
  constructor(enabled = true) {
    this.enabled = Boolean(enabled);
    this.context = null;
    this.master = null;
    this.laughBuffer = null;
    this.noiseBuffer = null;
    this.sources = new Set();
    this.laughSource = null;
    this.lastLaugh = -Infinity;
    this.loadPromise = null;
    this.unlockPromise = null;
  }

  async unlock() {
    if (!this.enabled) return false;
    if (this.unlockPromise) return this.unlockPromise;
    try {
      if (!this.context || this.context.state === 'closed') {
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextClass) return false;
        this.context = new AudioContextClass();
        this.master = this.context.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(this.context.destination);
        this.noiseBuffer = null;
        this.lastLaugh = -Infinity;
      }

      // Begin loading immediately, but never make gameplay wait for a download.
      this.loadLaugh();
      if (this.context.state === 'running') return true;
      const resumeResult = this.context.resume();
      this.unlockPromise = Promise.resolve(resumeResult)
        .then(() => this.context?.state === 'running')
        .catch(() => false)
        .finally(() => { this.unlockPromise = null; });
      return await this.unlockPromise;
    } catch {
      return false;
    }
  }

  loadLaugh() {
    if (this.loadPromise || this.laughBuffer || !this.context) return;
    const context = this.context;
    this.loadPromise = (async () => {
      const url = new URL('../assets/nailong_laugh.mp3', import.meta.url);
      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.arrayBuffer();
      // The callback form also supports older WebKit implementations.
      const buffer = await new Promise((resolve, reject) => {
        const result = context.decodeAudioData(data, resolve, reject);
        if (result && typeof result.then === 'function') result.then(resolve, reject);
      });
      if (buffer?.duration > 0.05) this.laughBuffer = buffer;
    })().catch(() => {
      // A missing asset or unsupported codec leaves the synthesized laugh usable.
    });
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.stopAll();
  }

  track(source, extraNodes = [], kind = 'effect') {
    const voice = { source, extraNodes, kind };
    this.sources.add(voice);
    source.onended = () => this.release(voice, false);
    return voice;
  }

  release(voice, stop = true) {
    if (!voice || !this.sources.has(voice)) return;
    this.sources.delete(voice);
    voice.source.onended = null;
    if (stop) {
      try { voice.source.stop(); } catch { /* Already stopped or not started. */ }
    }
    try { voice.source.disconnect(); } catch { /* Context may be closed. */ }
    for (const node of voice.extraNodes) {
      try { node.disconnect(); } catch { /* Already disconnected. */ }
    }
    if (this.laughSource === voice) this.laughSource = null;
  }

  stopAll() {
    for (const voice of [...this.sources]) this.release(voice);
    this.laughSource = null;
    this.lastLaugh = -Infinity;
  }

  tone(startFrequency, endFrequency, duration, volume = 0.12, delay = 0, type = 'sine') {
    const context = this.context;
    const at = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(volume, at + Math.min(0.008, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    const voice = this.track(oscillator, [gain]);
    try {
      oscillator.start(at);
      oscillator.stop(at + duration + 0.02);
    } catch {
      this.release(voice);
    }
  }

  noise(duration, volume, cutoff = 1400) {
    const context = this.context;
    if (!this.noiseBuffer) {
      this.noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.35), context.sampleRate);
      const channel = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < channel.length; i += 1) channel[i] = Math.random() * 2 - 1;
    }
    const at = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    const voice = this.track(source, [filter, gain]);
    try {
      source.start(at, 0, duration);
      source.stop(at + duration + 0.02);
    } catch {
      this.release(voice);
    }
  }

  laugh() {
    const context = this.context;
    const at = context.currentTime;
    if (at - this.lastLaugh < 0.7) return false;
    this.lastLaugh = at;
    if (this.laughSource) this.release(this.laughSource);

    if (!this.laughBuffer) {
      this.syntheticLaugh(at);
      return true;
    }

    const source = context.createBufferSource();
    const gain = context.createGain();
    const rate = 0.94 + Math.random() * 0.12;
    const possibleOffsets = [0.08, 3.3, 6.4, 9.5, 12.2];
    const offset = Math.min(possibleOffsets[Math.floor(Math.random() * possibleOffsets.length)], Math.max(0, this.laughBuffer.duration - 1.65));
    const duration = Math.min(1.42, (this.laughBuffer.duration - offset) / rate);
    source.buffer = this.laughBuffer;
    source.playbackRate.value = rate;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(0.48, at + Math.min(0.016, duration / 4));
    gain.gain.setValueAtTime(0.48, at + Math.max(duration * 0.6, duration - 0.07));
    gain.gain.linearRampToValueAtTime(0.0001, at + duration);
    source.connect(gain);
    gain.connect(this.master);
    const voice = this.track(source, [gain], 'laugh');
    this.laughSource = voice;
    try {
      source.start(at, offset, duration * rate);
      source.stop(at + duration + 0.02);
    } catch {
      this.release(voice);
    }
    return true;
  }

  syntheticLaugh(at) {
    const context = this.context;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = 'sawtooth';
    filter.type = 'bandpass';
    filter.frequency.value = 740;
    filter.Q.value = 0.9;
    gain.gain.setValueAtTime(0.0001, at);
    for (let i = 0; i < 5; i += 1) {
      const beat = at + i * 0.14;
      const pitch = 175 - i * 9 + Math.random() * 20;
      oscillator.frequency.setValueAtTime(pitch, beat);
      oscillator.frequency.exponentialRampToValueAtTime(pitch * 0.67, beat + 0.095);
      gain.gain.setValueAtTime(0.0001, beat);
      gain.gain.linearRampToValueAtTime(0.15 - i * 0.012, beat + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, beat + 0.115);
    }
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    const voice = this.track(oscillator, [filter, gain], 'laugh');
    this.laughSource = voice;
    try {
      oscillator.start(at);
      oscillator.stop(at + 0.71);
    } catch {
      this.release(voice);
    }
  }

  play(kind) {
    if (!this.enabled || !this.context || this.context.state !== 'running' || !this.master) return false;
    try {
      // Bound voices even if a held pointer produces a flood of input events.
      if (kind !== 'laugh' && this.sources.size > 28) return false;
      switch (kind) {
        case 'laugh': return this.laugh();
        case 'flap': this.tone(520, 170, 0.095, 0.1); break;
        case 'hit':
          this.tone(155, 42, 0.19, 0.17, 0, 'triangle');
          this.noise(0.11, 0.09, 1000);
          break;
        case 'score':
          this.tone(660, 660, 0.11, 0.12);
          this.tone(990, 990, 0.17, 0.1, 0.075);
          break;
        case 'pop': this.tone(620, 155, 0.105, 0.11); break;
        case 'launch':
          this.tone(145, 650, 0.2, 0.12, 0, 'triangle');
          this.noise(0.16, 0.055, 2400);
          break;
        case 'win':
          [523, 659, 784, 1047].forEach((note, index) => {
            this.tone(note, note, index === 3 ? 0.3 : 0.14, 0.1, index * 0.095);
          });
          break;
        case 'miss': this.tone(225, 78, 0.19, 0.1, 0, 'triangle'); break;
        default: return false;
      }
      return true;
    } catch {
      // Audio is optional: suspended/unsupported devices must never stop a game.
      return false;
    }
  }
}
