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
  audio.setVoicePack('classic');
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
    audio.setVoicePack('classic');
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

function memeHarness() {
  const { audio, context } = harness();
  audio.voiceBuffers.set('kakatte', { duration: 1.18 });
  audio.voiceBuffers.set('andy', { duration: 1.55 });
  audio.setVoicePack('meme');
  return { audio, context };
}

test('meme is the default pack; mapped speech plays whole files and accepted repeats alternate with laughter', () => {
  assert.equal(new GameAudio().voicePack, 'meme');
  const { audio, context } = memeHarness();
  assert.equal(audio.setVoicePack('invalid'), 'meme');
  assert.equal(audio.play('laugh:start'), true);
  const voice = audio.laughSource;
  assert.equal(voice.voiceId, 'kakatte');
  assert.equal(voice.kind, 'voice');
  assert.deepEqual(voice.source.starts[0], [context.currentTime, 0, 1.18]);
  assert.equal(voice.source.playbackRate.value, 1);
  assert.ok(Math.abs(voice.endsAt - context.currentTime - 1.18) < 1e-10);
  for (let i = 0; i < 500; i++) assert.equal(audio.play('laugh:attack'), false);
  assert.equal(audio.laughSource, voice, 'compact attack laughs cannot cut off a phrase');
  context.advance(3);
  assert.equal(audio.play('laugh:start'), true);
  assert.equal(audio.laughSource.kind, 'laugh');
  context.advance(3);
  assert.equal(audio.play('laugh:start'), true);
  assert.equal(audio.laughSource.voiceId, 'kakatte');
  audio.stopAll();
  assert.equal(audio.play('laugh:hurt'), true);
  assert.equal(audio.laughSource.voiceId, 'andy');
  assert.equal(audio.play('laugh:victory'), true);
  assert.equal(audio.laughSource.kind, 'laugh', 'victory retains the real familiar laugh');
});

test('meme lines share priority and cooling with laughs; effects cannot chatter on every click', () => {
  const { audio, context } = memeHarness();
  assert.equal(audio.play('launch'), true);
  assert.equal(audio.laughSource.voiceId, 'kakatte');
  context.advance(2);
  audio.play('miss');
  assert.equal(audio.laughSource, null, 'effect comments have a six-second global cooldown');
  context.advance(4.1);
  audio.play('miss');
  assert.equal(audio.laughSource.voiceId, 'andy');
  assert.equal([...audio.sources].filter(v => ['voice', 'laugh'].includes(v.kind)).length, 1);
  audio.stopAll();
  audio.play('laugh:upgrade');
  assert.equal(audio.play('voice:andy'), false);
  assert.equal(audio.laughSource.event, 'laugh:upgrade');
  const old = audio.laughSource;
  assert.equal(audio.setVoicePack('classic'), 'classic');
  assert.ok(old.source.stops.includes(undefined));
  assert.equal(audio.sources.size, 0);
  audio.play('laugh:start');
  assert.equal(audio.laughSource.kind, 'laugh');
});

test('preview uses recorded voices, respects mute/running state and releases immediately on stop', async () => {
  const { audio, context } = memeHarness();
  assert.equal(await audio.previewVoice('unknown'), false);
  assert.equal(await audio.previewVoice('andy'), true);
  assert.equal(audio.laughSource.voiceId, 'andy');
  assert.equal(audio.laughSource.priority, 9);
  assert.equal(audio.play('laugh:victory'), false, 'explicit preview stays audible');
  const voice = audio.laughSource;
  audio.setEnabled(false);
  assert.ok(voice.source.stops.includes(undefined));
  assert.equal(await audio.previewVoice('andy'), false);
  audio.setEnabled(true); context.state = 'closed';
  assert.equal(await audio.previewVoice('andy'), false);
});

test('slow preview decoding never plays after pause, mute, pack changes, or a newer preview request', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const cancel of ['stop', 'mute', 'pack', 'supersede']) {
      const { audio, context } = harness();
      audio.voicePack = 'meme';
      const decoders = [];
      context.decodeAudioData = () => new Promise(resolve => { decoders.push(resolve); });
      globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
      const pending = audio.previewVoice('kakatte');
      while (decoders.length < 2) await Promise.resolve();
      if (cancel === 'stop') audio.stopAll();
      if (cancel === 'mute') audio.setEnabled(false);
      if (cancel === 'pack') audio.setVoicePack('classic');
      if (cancel === 'supersede') {
        audio.voiceBuffers.set('andy', { duration: 1.2 });
        assert.equal(await audio.previewVoice('andy'), true);
      }
      for (const finishDecode of decoders) finishDecode({ duration: 1.18 });
      assert.equal(await pending, false, cancel);
      assert.equal(audio.laughSource?.voiceId || null, cancel === 'supersede' ? 'andy' : null);
      assert.equal(context.nodes.filter(n => n.type === 'buffer').length, cancel === 'supersede' ? 1 : 0);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('first-gesture preview creates and unlocks a context, loads once, and does not fetch on construction', async () => {
  const originalAudioContext = globalThis.AudioContext, originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.AudioContext = class extends Context {
    constructor() { super(); this.state = 'suspended'; }
    decodeAudioData(_data, success) { const buffer = { duration: 1.3 }; success(buffer); return Promise.resolve(buffer); }
  };
  globalThis.fetch = async url => { requests.push(String(url)); return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) }; };
  try {
    const audio = new GameAudio();
    assert.equal(requests.length, 0);
    assert.equal(await audio.previewVoice('kakatte'), true);
    assert.equal(audio.context.state, 'running');
    assert.equal(audio.laughSource.voiceId, 'kakatte');
    assert.equal(requests.filter(url => url.endsWith('/voices/kakatte.mp3')).length, 1);
    assert.equal(requests.filter(url => url.endsWith('/voices/andy.mp3')).length, 1);
    audio.stopAll();
    assert.equal(await audio.previewVoice('andy'), true);
    assert.equal(requests.length, 3, 'laugh and two lines are each loaded once');
  } finally { globalThis.AudioContext = originalAudioContext; globalThis.fetch = originalFetch; }
});

test('bad or unavailable speech files preserve laughter without queued playback or invented speech', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const duration of [0, 15.7, Infinity, NaN]) {
      const { audio, context } = harness(); audio.voicePack = 'meme';
      globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
      context.decodeAudioData = (_data, success) => { const buffer = { duration }; success(buffer); return Promise.resolve(buffer); };
      assert.equal(await audio.previewVoice('kakatte'), false);
      assert.equal(audio.play('laugh:start'), true);
      assert.equal(audio.laughSource.kind, 'laugh');
      audio.stopAll();
    }
    const { audio } = harness(); audio.voicePack = 'meme';
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error('offline'); };
    assert.equal(await audio.previewVoice('andy'), false);
    assert.equal(await audio.previewVoice('andy'), false);
    assert.equal(requests, 3, 'one automatic attempt per file, then one explicit retry of the requested line');
    assert.equal(audio.play('laugh:hurt'), true);
    assert.equal(audio.laughSource.kind, 'laugh');
  } finally { globalThis.fetch = originalFetch; }
});

test('generic game laughs and combos can speak without allowing launch or attack noises to truncate them', () => {
  const { audio, context } = memeHarness();
  assert.equal(audio.play('laugh'), true);
  const andy = audio.laughSource;
  assert.equal(andy.voiceId, 'andy');
  assert.equal(audio.play('laugh:attack'), false);
  audio.play('launch');
  assert.equal(audio.laughSource, andy);
  context.advance(3);
  assert.equal(audio.play('laugh:combo'), true);
  assert.equal(audio.laughSource.voiceId, 'kakatte');
});

test('a current different preview interrupts the previous preview immediately without opening automatic-event preemption', async () => {
  const { audio } = memeHarness();
  assert.equal(await audio.previewVoice('kakatte'), true);
  const first = audio.laughSource;
  assert.equal(await audio.previewVoice('andy'), true, 'a different button takes over even at the same audio time');
  assert.ok(first.source.stops.includes(undefined));
  assert.equal(first.source.disconnected, true);
  assert.equal(audio.laughSource.voiceId, 'andy');
  assert.equal([...audio.sources].filter(v => ['voice', 'laugh'].includes(v.kind)).length, 1);
  assert.equal(await audio.previewVoice('andy'), false, 'repeated identical taps still respect their short cooldown');
  assert.equal(audio.play('laugh:victory'), false);
});

test('an explicit preview recovers after transient loading failure while automatic preloads stay bounded', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const { audio, context } = harness(); audio.voicePack = 'meme';
    const requests = [];
    let online = false;
    globalThis.fetch = async url => {
      requests.push(String(url));
      return online ? { ok: true, arrayBuffer: async () => new ArrayBuffer(1) } : { ok: false };
    };
    context.decodeAudioData = (_data, success) => {
      const buffer = { duration: 1.3 }; success(buffer); return Promise.resolve(buffer);
    };
    assert.equal(await audio.previewVoice('andy'), false);
    assert.equal(requests.length, 2, 'initial unlock preloads each line once');
    assert.equal(audio.voiceLoads.size, 0, 'failed settled promises are removed');
    for (let i = 0; i < 30; i++) {
      await audio.unlock();
      audio.preloadVoices();
      audio.play('laugh:hurt');
    }
    assert.equal(requests.length, 2, 'input and preload calls do not repeatedly retry a failed asset');
    online = true;
    assert.equal(await audio.previewVoice('andy'), true, 'a new user request retries and plays the recovered recording');
    assert.equal(requests.length, 3);
    assert.ok(requests[2].endsWith('/voices/andy.mp3'));
    assert.equal(audio.voiceLoads.size, 0, 'successful settled promises are also removed');
    assert.equal(audio.laughSource.voiceId, 'andy');
    assert.ok(audio.voiceBuffers.has('andy'));
    audio.stopAll();
    assert.equal(await audio.previewVoice('andy'), true);
    assert.equal(requests.length, 3, 'decoded successes remain cached');
  } finally { globalThis.fetch = originalFetch; }
});
