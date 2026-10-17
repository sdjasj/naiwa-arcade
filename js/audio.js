import { VOICE_LINES, voiceForEvent } from './voice-lines.js?v=13a5c1ec0c6e';

// All sounds stay local. No AudioContext is created before unlock(), which is
// called by the application from a click, touch, or keyboard interaction.
// Durations are wall-clock seconds; offsets refer to our bundled 15.7s laugh.
// One human-voice channel is shared across games, with no delayed playback queue.
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
    this.voicePack = 'meme';
    this.voiceBuffers = new Map();
    this.voiceLoads = new Map();
    this.voiceFailures = new Set();
    this.playbackGeneration = 0;
    this.previewRequest = 0;
    this.lastEffectVoice = -Infinity;
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
      if (this.voicePack === 'meme') this.preloadVoices();
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

  setVoicePack(pack) {
    if (!['classic', 'meme'].includes(pack)) return this.voicePack;
    if (pack !== this.voicePack) {
      this.stopAll();
      this.voicePack = pack;
    }
    if (pack === 'meme' && this.enabled && this.context) this.preloadVoices();
    return this.voicePack;
  }

  preloadVoices() {
    for (const id of Object.keys(VOICE_LINES)) this.loadVoice(id);
  }

  loadVoice(id, { retry = false } = {}) {
    if (!Object.hasOwn(VOICE_LINES, id) || !this.context) return Promise.resolve(null);
    if (this.voiceBuffers.has(id)) return Promise.resolve(this.voiceBuffers.get(id));
    if (this.voiceLoads.has(id)) return this.voiceLoads.get(id);
    if (!retry && this.voiceFailures.has(id)) return Promise.resolve(null);
    const context = this.context;
    const promise = (async () => {
      const response = await fetch(new URL(VOICE_LINES[id].file, import.meta.url));
      if (!response.ok) return null;
      const data = await response.arrayBuffer();
      if (data.byteLength > 500_000) return null;
      const buffer = await new Promise((resolve, reject) => {
        const result = context.decodeAudioData(data, resolve, reject);
        if (result && typeof result.then === 'function') result.then(resolve, reject);
      });
      // A damaged or accidentally replaced full recording must never become an
      // unbounded in-game voice. Rejected assets leave the original laugh usable.
      if (!Number.isFinite(buffer?.duration) || buffer.duration < .1 || buffer.duration > 4.5) return null;
      this.voiceBuffers.set(id, buffer);
      return buffer;
    })().catch(() => null).then(buffer => {
      if (buffer) this.voiceFailures.delete(id);
      else this.voiceFailures.add(id);
      return buffer;
    }).finally(() => {
      // Keep only in-flight work here. Explicit previews may retry a transient
      // failure; automatic preloads stay quiet until a user asks again.
      if (this.voiceLoads.get(id) === promise) this.voiceLoads.delete(id);
    });
    this.voiceLoads.set(id, promise);
    return promise;
  }

  async previewVoice(id) {
    if (!Object.hasOwn(VOICE_LINES, id) || !this.enabled) return false;
    // unlock() can create a context and invalidate old voices. Capture the
    // generation after that synchronous setup, before waiting on any promise.
    const unlocking = this.unlock();
    const generation = this.playbackGeneration;
    const request = ++this.previewRequest;
    // Capture an already-started preload before yielding so the same click
    // cannot turn a fast failed preload into two download attempts.
    const loading = this.loadVoice(id, { retry: true });
    if (!await unlocking || generation !== this.playbackGeneration || request !== this.previewRequest) return false;
    const buffer = await loading;
    if (!buffer || generation !== this.playbackGeneration || request !== this.previewRequest
      || !this.enabled || this.context?.state !== 'running') return false;
    return this.voiceLine(id, { priority: 9, cooldown: .4, event: `preview:${id}`, replace: true });
  }

  voiceLine(id, { priority = 4, cooldown = 2.5, event = `voice:${id}`, replace = false } = {}) {
    const context = this.context, buffer = this.voiceBuffers.get(id);
    if (!buffer || !this.enabled || !context || context.state !== 'running' || !this.master) return false;
    const at = context.currentTime;
    if (this.laughSource && at >= this.laughSource.endsAt) this.release(this.laughSource);
    const active = this.laughSource;
    if (at - (this.laughHistory.get(event) ?? -Infinity) < cooldown) return false;
    // An explicit, current preview can replace another preview immediately;
    // automatic events still share the priority and global cooling rules.
    if (!replace && active && priority <= active.priority) return false;
    if (!replace && at - this.lastLaugh < .24 && (!active || priority <= active.priority)) return false;
    if (active) this.release(active);
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = 1;
    const duration = buffer.duration;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(.68, at + .012);
    gain.gain.setValueAtTime(.68, at + Math.max(.012, duration - .025));
    gain.gain.linearRampToValueAtTime(0.0001, at + duration);
    source.connect(gain); gain.connect(this.master);
    const voice = this.track(source, [gain], 'voice');
    Object.assign(voice, { priority, event, voiceId: id, endsAt: at + duration });
    try {
      // Play the complete short file. The old laugh profiles' attack lengths
      // and pulse envelopes must never chop a spoken syllable into 0.32s.
      source.start(at, 0, duration);
      source.stop(at + duration + .02);
    } catch { this.release(voice); return false; }
    this.laughSource = voice;
    this.lastLaugh = at;
    this.laughHistory.set(event, at);
    return true;
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
    this.playbackGeneration++;
    this.previewRequest++;
    this.lastEffectVoice = -Infinity;
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
    const variation = this.laughVariations.get(kind) || 0;
    const voiceId = this.voicePack === 'meme' ? voiceForEvent(kind, variation) : null;
    if (voiceId && this.voiceBuffers.has(voiceId)) {
      const accepted = this.voiceLine(voiceId, { priority: Math.max(3, profile.priority), cooldown: Math.max(2.5, profile.cooldown), event: kind });
      if (accepted) this.laughVariations.set(kind, variation + 1);
      return accepted;
    }
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
      if (kind === 'voice:kakatte' || kind === 'voice:andy') {
        if (this.voicePack !== 'meme') return this.laugh('laugh');
        return this.voiceLine(kind.slice(6));
      }
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
      // Launches and mistakes also reach the simpler games. These optional
      // comments share the voice channel and are globally limited to one / 6s.
      if (this.voicePack === 'meme' && ['launch', 'miss'].includes(kind)
        && this.context.currentTime - this.lastEffectVoice >= 6) {
        const id = kind === 'launch' ? 'kakatte' : 'andy';
        if (this.voiceLine(id, { priority: 2, cooldown: 6, event: `effect:${kind}` })) this.lastEffectVoice = this.context.currentTime;
      }
      return true;
    } catch {
      // Audio is optional: suspended/unsupported devices must never stop a game.
      return false;
    }
  }
}
