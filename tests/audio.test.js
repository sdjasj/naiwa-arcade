import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../js/audio.js';

const variants = ['attack', 'hurt', 'guard', 'special', 'combo', 'victory', 'start', 'dash', 'upgrade', 'boss'];

class Param {
  constructor() { this.value = 0; this.events = []; }
  setValueAtTime(value, time) { this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value, time) { this.events.push(['linear', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.events.push(['exponential', value, time]); }
}
class Node {
  constructor(type) {
    this.type = type; this.gain = new Param(); this.frequency = new Param(); this.Q = new Param();
    this.playbackRate = new Param(); this.starts = []; this.stops = []; this.disconnected = false;
  }
  connect(target) { this.target = target; }
  disconnect() { this.disconnected = true; }
  start(...args) {
    if (this.failStart) throw new Error('unsupported sample');
    this.starts.push(args);
  }
  stop(time) { this.stops.push(time); }
}
class Context {
  constructor() { this.currentTime = 10; this.state = 'running'; this.destination = {}; this.sampleRate = 8000; this.nodes = []; }
  createGain() { return new Node('gain'); }
  createBiquadFilter() { return new Node('filter'); }
  createOscillator() { const node = new Node('oscillator'); this.nodes.push(node); return node; }
  createBufferSource() {
    const node = new Node('buffer'); node.failStart = this.failSampleStart;
    this.nodes.push(node); return node;
  }
  createBuffer(_channels, frames, rate) { return { duration: frames / rate, getChannelData: () => new Float32Array(frames) }; }
  decodeAudioData(_data, success) { const buffer = { duration: 15.696 }; success(buffer); return Promise.resolve(buffer); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  advance(seconds) {
    this.currentTime += seconds;
    for (const node of this.nodes) {
      if (node.onended && node.stops.some(time => time === undefined || time <= this.currentTime)) node.onended();
    }
  }
}
function harness({ sample = true } = {}) {
  const audio = new GameAudio();
  const context = new Context();
  audio.context = context; audio.master = context.createGain();
  if (sample) audio.laughBuffer = { duration: 15.696 };
  return { audio, context };
}
const laughs = audio => [...audio.sources].filter(voice => voice.kind === 'laugh');

test('audio stays silent before unlock, while muted/suspended, and for unknown events', () => {
  const virgin = new GameAudio();
  assert.equal(virgin.context, null);
  for (const kind of ['laugh', 'laugh:victory', 'hit']) assert.equal(virgin.play(kind), false);
  assert.equal(virgin.laugh(), false);
  const { audio, context } = harness();
  audio.setEnabled(false);
  assert.equal(audio.play('laugh:attack'), false);
  audio.setEnabled(true); context.state = 'suspended';
  assert.equal(audio.play('laugh:victory'), false);
  context.state = 'running';
  assert.equal(audio.play('laugh:typo'), false);
  assert.equal(audio.play('toString'), false);
  assert.equal(context.nodes.length, 0);
});

test('all ten event laughs have distinct bounded sample clips and the legacy laugh remains supported', () => {
  const { audio, context } = harness();
  const signatures = new Set();
  const durations = {};
  for (const kind of [...variants.map(name => `laugh:${name}`), 'laugh']) {
    assert.equal(audio.play(kind), true, kind);
    const voice = audio.laughSource;
    const [at, offset, sourceDuration] = voice.source.starts[0];
    const rate = voice.source.playbackRate.value;
    const duration = voice.endsAt - at;
    assert.equal(at, context.currentTime);
    assert.ok(rate > .85 && rate < 1.15, 'pitch changes stay gentle');
    assert.ok(offset >= 0 && offset + sourceDuration <= audio.laughBuffer.duration + 1e-9);
    assert.ok(Math.abs(sourceDuration / rate - duration) < 1e-9);
    signatures.add(`${offset}/${sourceDuration}/${rate}`);
    durations[kind] = duration;
    assert.equal(laughs(audio).length, 1);
    audio.stopAll();
  }
  assert.equal(signatures.size, 11);
  assert.ok(durations['laugh:attack'] < .5);
  assert.ok(durations['laugh:victory'] > durations['laugh:attack'] * 4);
  assert.ok(durations['laugh:upgrade'] > 1);
});

test('high-priority events interrupt small laughs immediately; victory and upgrades survive attack floods', () => {
  const { audio } = harness();
  assert.equal(audio.play('laugh:attack'), true);
  const attack = audio.laughSource;
  const staleEndCallback = attack.source.onended;
  assert.equal(audio.play('laugh:hurt'), true);
  assert.ok(attack.source.stops.includes(undefined), 'old source stops on preemption');
  assert.equal(attack.source.disconnected, true);
  assert.equal(audio.play('laugh:upgrade'), true);
  const upgrade = audio.laughSource;
  for (let i = 0; i < 500; i++) {
    assert.equal(audio.play('laugh:attack'), false);
    assert.equal(audio.play('laugh'), false);
    assert.equal(audio.play('laugh:boss'), false);
  }
  assert.equal(audio.laughSource, upgrade);
  assert.equal(audio.play('laugh:victory'), true);
  const victory = audio.laughSource;
  assert.equal(audio.play('laugh:upgrade'), false);
  staleEndCallback();
  assert.equal(audio.laughSource, victory, 'late old callbacks cannot clear the new voice');
  assert.equal(laughs(audio).length, 1);
});

test('cooldowns use audio time, apply across variants, and never queue delayed laughs', () => {
  const { audio, context } = harness();
  audio.laughBuffer = { duration: .06 }; // Force a clip shorter than the global cooldown.
  assert.equal(audio.play('laugh:attack'), true);
  context.advance(.1);
  assert.equal(audio.laughSource, null);
  assert.equal(audio.play('laugh:dash'), false, 'global limiter applies after a short clip ends');
  context.advance(.15);
  assert.equal(audio.play('laugh:dash'), true);
  context.advance(.1);
  assert.equal(audio.play('laugh:attack'), false, 'same event also has its own cooldown');
  context.advance(.16);
  assert.equal(audio.play('laugh:attack'), true);
  const started = context.nodes.length;
  for (let i = 0; i < 100; i++) assert.equal(audio.play('laugh:attack'), false);
  context.advance(100);
  assert.equal(context.nodes.length, started, 'rejected requests never play later');
  assert.equal(audio.sources.size, 0);
});

test('an ended source whose callback has not fired does not block the next eligible laugh', () => {
  const { audio, context } = harness();
  audio.play('laugh:attack');
  const first = audio.laughSource;
  context.currentTime += 1; // Model a delayed onended task after returning from the background.
  assert.equal(audio.play('laugh:attack'), true);
  assert.equal(first.source.disconnected, true);
  assert.equal(laughs(audio).length, 1);
  assert.notDeepEqual(audio.laughSource.source.starts[0], first.source.starts[0], 'accepted repetitions rotate sample segments');
});

test('synthetic fallback provides every event, a single voice, different rhythms, and correct interruption', () => {
  const { audio, context } = harness({ sample: false });
  const beats = new Set();
  for (const kind of variants) {
    assert.equal(audio.play(`laugh:${kind}`), true);
    const voice = audio.laughSource;
    assert.equal(voice.source.type, 'sawtooth');
    beats.add(voice.source.frequency.events.length);
    assert.ok(voice.endsAt > context.currentTime);
    assert.equal(laughs(audio).length, 1);
    audio.stopAll();
  }
  assert.ok(beats.size >= 5, 'short and long fallback cues have different ha-ha rhythms');
  audio.play('laugh:attack');
  assert.equal(audio.play('laugh:victory'), true);
  assert.equal(laughs(audio).length, 1);
  context.advance(3);
  assert.equal(audio.sources.size, 0);
});

test('failed sample playback falls back to synthesis and tiny buffers stay within their bounds', () => {
  const { audio, context } = harness();
  context.failSampleStart = true;
  assert.equal(audio.play('laugh:upgrade'), true);
  assert.equal(context.nodes[0].disconnected, true);
  assert.equal(audio.laughSource.source.type, 'sawtooth');
  assert.equal(laughs(audio).length, 1);
  audio.stopAll(); context.failSampleStart = false;
  audio.laughBuffer = { duration: .061 };
  assert.equal(audio.play('laugh:victory'), true);
  const [, offset, duration] = audio.laughSource.source.starts[0];
  assert.ok(offset >= 0 && offset + duration <= .061 + 1e-9);
});

test('effects continue alongside laughs, voice count remains bounded, and mute/stopAll releases every node', () => {
  const { audio, context } = harness();
  assert.equal(audio.play('laugh:victory'), true);
  const laugh = audio.laughSource;
  for (const effect of ['flap', 'hit', 'score', 'pop', 'launch', 'win', 'miss']) assert.equal(audio.play(effect), true, effect);
  assert.equal(audio.laughSource, laugh);
  for (let i = 0; i < 100; i++) audio.play('hit');
  assert.ok(audio.sources.size <= 32);
  assert.equal(laughs(audio).length, 1);
  const nodes = [...audio.sources].flatMap(voice => [voice.source, ...voice.extraNodes]);
  audio.setEnabled(false);
  assert.equal(audio.sources.size, 0);
  assert.equal(audio.laughSource, null);
  assert.ok(nodes.every(node => node.disconnected));
  assert.equal(audio.play('laugh:victory'), false);
  audio.setEnabled(true);
  assert.equal(audio.play('laugh:victory'), true, 'a new session can sound immediately after stopAll');
  audio.stopAll(); audio.stopAll();
  context.advance(5);
  assert.equal(audio.sources.size, 0);
});

test('unlock creates audio only on demand, decodes the local sample, and recovers after a closed context', async () => {
  const originalAudioContext = globalThis.AudioContext, originalFetch = globalThis.fetch;
  const requests = [];
  let created = 0;
  globalThis.AudioContext = class extends Context {
    constructor() { super(); created++; this.state = 'suspended'; }
  };
  globalThis.fetch = async url => { requests.push(String(url)); return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) }; };
  try {
    const audio = new GameAudio();
    assert.equal(created, 0);
    assert.equal(await audio.unlock(), true);
    await audio.loadPromise;
    assert.equal(created, 1);
    assert.equal(requests.length, 1);
    assert.ok(requests[0].endsWith('/assets/nailong_laugh.mp3'));
    assert.equal(audio.laughBuffer.duration, 15.696);
    assert.equal(audio.play('laugh:start'), true);
    audio.context.state = 'closed';
    assert.equal(await audio.unlock(), true);
    assert.equal(created, 2);
    assert.equal(audio.sources.size, 0);
    assert.equal(audio.play('laugh:start'), true);
    audio.stopAll();
  } finally { globalThis.AudioContext = originalAudioContext; globalThis.fetch = originalFetch; }
});

test('missing local audio keeps playback functional through synthesis without repeatedly fetching', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('offline'); };
  try {
    const { audio } = harness({ sample: false });
    audio.loadLaugh(); await audio.loadPromise;
    audio.loadLaugh();
    assert.equal(requests, 1);
    assert.equal(audio.play('laugh:boss'), true);
    assert.equal(audio.laughSource.source.type, 'sawtooth');
  } finally { globalThis.fetch = originalFetch; }
});
