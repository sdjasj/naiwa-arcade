// All sounds stay local. No AudioContext is created before unlock(), which is
// called by the application from a click, touch, or keyboard interaction.
// Durations are wall-clock seconds; offsets refer to our bundled 15.7s laugh.
// One laugh voice is shared across games, with no delayed playback queue.
const LAUGHS = {
  laugh:           { priority: 1, cooldown: .85, duration: 1.2, offsets: [.08, 3.3, 6.4, 9.5], rate: 1, volume: .44, beats: 5, pitch: 175 },
  'laugh:attack':  { priority: 1, cooldown: .46, duration: .32, offsets: [.08, 3.3, 9.5], rate: 1.08, volume: .32, beats: 2, pitch: 205 },
  'laugh:dash':    { priority: 1, cooldown: .75, duration: .36, offsets: [6.4, 9.5], rate: 1.12, volume: .32, beats: 2, pitch: 220 },
  'laugh:guard':   { priority: 2, cooldown: .9, duration: .43, offsets: [1.2, 4.5, 10.3], rate: .94, volume: .35, beats: 2, pitch: 150 },
  'laugh:hurt':    { priority: 3, cooldown: .95, duration: .67, offsets: [1.2, 4.4, 11.4], rate: .9, volume: .4, beats: 3, pitch: 145 },
  'laugh:start':   { priority: 4, cooldown: 2, duration: .92, offsets: [.08, 6.4], rate: 1.01, volume: .4, beats: 4, pitch: 180 },
  'laugh:combo':   { priority: 4, cooldown: 1.1, duration: .98, offsets: [3.3, 9.5], rate: 1.1, volume: .42, beats: 5, pitch: 210 },
  'laugh:special': { priority: 5, cooldown: 1.2, duration: 1.17, offsets: [6.4, 12.2], rate: .95, volume: .46, beats: 5, pitch: 165 },
  'laugh:boss':    { priority: 6, cooldown: 2.2, duration: 1.52, offsets: [9.5, 12.2], rate: .89, volume: .46, beats: 6, pitch: 130 },
  'laugh:upgrade': { priority: 7, cooldown: 1.7, duration: 1.38, offsets: [3.3, 6.4], rate: 1.08, volume: .44, beats: 6, pitch: 200 },
  'laugh:victory': { priority: 8, cooldown: 2.5, duration: 2.05, offsets: [.08, 9.5], rate: 1.01, volume: .48, beats: 8, pitch: 190 },
};

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
    this.laughHistory = new Map();
    this.laughVariations = new Map();
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
        this.stopAll();
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
    this.laughHistory.clear();
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

  laugh(kind = 'laugh') {
    const context = this.context;
    const profile = Object.hasOwn(LAUGHS, kind) ? LAUGHS[kind] : null;
    if (!profile || !this.enabled || !context || context.state !== 'running' || !this.master) return false;
    const at = context.currentTime;
    // onended may arrive late in a suspended/background tab. Audio time remains
    // the authority, and every accepted request still has at most one voice.
    if (this.laughSource && at >= this.laughSource.endsAt) this.release(this.laughSource);
    const active = this.laughSource;
    if (at - (this.laughHistory.get(kind) ?? -Infinity) < profile.cooldown) return false;
    if (active && profile.priority <= active.priority) return false;
    // A victory/upgrade can replace a small laugh immediately, even in the same
    // frame. Equal/lower priority chatter always respects the global limiter.
    if (at - this.lastLaugh < .24 && (!active || profile.priority <= active.priority)) return false;
    if (active) this.release(active);
    const variation = this.laughVariations.get(kind) || 0;
    let voice;
    try {
      voice = this.laughBuffer?.duration > .05 ? this.sampleLaugh(at, profile, variation) : null;
      if (!voice) voice = this.syntheticLaugh(at, profile, variation);
    } catch { return false; }
    if (!voice) return false;
    voice.priority = profile.priority;
    voice.event = kind;
    this.laughSource = voice;
    this.lastLaugh = at;
    this.laughHistory.set(kind, at);
    this.laughVariations.set(kind, variation + 1);
    return true;
  }

  sampleLaugh(at, profile, variation) {
    const context = this.context;
    const source = context.createBufferSource(), gain = context.createGain();
    const rate = profile.rate + (variation % 3 - 1) * .018;
    // Clamp against the *source* duration, including the playback-rate change.
    const duration = Math.min(profile.duration, this.laughBuffer.duration / rate);
    const offset = Math.min(profile.offsets[variation % profile.offsets.length], Math.max(0, this.laughBuffer.duration - duration * rate));
    source.buffer = this.laughBuffer;
    source.playbackRate.value = rate;
    gain.gain.setValueAtTime(0.0001, at);
    // Gentle volume pulses keep the sample recognizable while giving each cue
    // a different ha-ha rhythm. A single source also makes interruption exact.
    for (let i = 0; i < profile.beats; i += 1) {
      const beat = at + duration * i / profile.beats;
      const width = duration / profile.beats;
      gain.gain.linearRampToValueAtTime(profile.volume, beat + Math.min(.014, width * .2));
      gain.gain.setValueAtTime(profile.volume, beat + width * .58);
      gain.gain.linearRampToValueAtTime(profile.volume * .65, beat + width * .84);
    }
    gain.gain.linearRampToValueAtTime(0.0001, at + duration);
    source.connect(gain);
    gain.connect(this.master);
    const voice = this.track(source, [gain], 'laugh');
    voice.endsAt = at + duration;
    try {
      source.start(at, offset, duration * rate);
      source.stop(at + duration + 0.02);
    } catch {
      this.release(voice);
      return null;
    }
    return voice;
  }

  syntheticLaugh(at, profile = LAUGHS.laugh, variation = 0) {
    const context = this.context;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = 'sawtooth';
    filter.type = 'bandpass';
    filter.frequency.value = 680 * profile.rate;
    filter.Q.value = 0.9;
    gain.gain.setValueAtTime(0.0001, at);
    for (let i = 0; i < profile.beats; i += 1) {
      const width = profile.duration / profile.beats;
      const beat = at + i * width;
      const pitch = profile.pitch - i * 4 + (variation % 3 - 1) * 5;
      oscillator.frequency.setValueAtTime(pitch, beat);
      oscillator.frequency.exponentialRampToValueAtTime(pitch * .67, beat + width * .67);
      gain.gain.setValueAtTime(0.0001, beat);
      gain.gain.linearRampToValueAtTime(profile.volume * .32 * (1 - i * .025), beat + Math.min(.012, width * .15));
      gain.gain.exponentialRampToValueAtTime(0.0001, beat + width * .85);
    }
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    const voice = this.track(oscillator, [filter, gain], 'laugh');
    voice.endsAt = at + profile.duration;
    try {
      oscillator.start(at);
      oscillator.stop(at + profile.duration + .02);
    } catch {
      this.release(voice);
      return null;
    }
    return voice;
  }

  play(kind) {
    if (!this.enabled || !this.context || this.context.state !== 'running' || !this.master) return false;
    try {
      // Bound voices even if a held pointer produces a flood of input events.
      if (Object.hasOwn(LAUGHS, kind)) return this.laugh(kind);
      const cost = kind === 'win' ? 4 : ['hit', 'score', 'launch'].includes(kind) ? 2 : 1;
      if (this.sources.size + cost > 32) return false;
      switch (kind) {
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
