import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame as createAngry } from '../js/games/angry.js';
import { createGame as createCatch } from '../js/games/catch.js';

function harness(factory, options = {}) {
  const results = [], saves = [], texts = [];
  const noop = () => {};
  const ctx = new Proxy({
    createLinearGradient: () => ({ addColorStop: noop }),
    measureText: text => ({ width: String(text).length * 10 }),
    fillText: text => texts.push(text),
  }, {
    get: (target, key) => key in target ? target[key] : noop,
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const game = factory({ ctx, drawFrog() {}, ...options,
    onEnd: result => results.push(result),
    onProgress: progress => saves.push(progress),
  });
  return { game, results, saves, texts };
}

function advance(game, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 120); i++) game.update(1 / 120);
}

function until(game, predicate, seconds = 12) {
  for (let i = 0; i < seconds * 120; i++) {
    const state = game.getState();
    if (predicate(state)) return state;
    game.update(1 / 120);
  }
  assert.fail(`Condition not reached: ${JSON.stringify(game.getState())}`);
}

function shoot(game, angle, power) {
  assert.equal(game.getState().phase, 'ready');
  const radians = angle * Math.PI / 180, pull = 112 * power;
  game.pointerDown({ x: 176, y: 342 });
  game.pointerMove({ x: 176 - Math.cos(radians) * pull, y: 342 + Math.sin(radians) * pull });
  game.pointerUp();
  return until(game, state => ['ready', 'levelclear', 'ended'].includes(state.phase));
}

function deterministic(run, value = 0.5) {
  const random = Math.random;
  Math.random = () => value;
  try { run(); } finally { Math.random = random; }
}

function driveCatch(game, predicate, seconds = 600, observe = () => {}) {
  for (let i = 0; i < seconds * 120; i++) {
    const state = game.getState();
    observe(state);
    if (predicate(state)) return state;
    assert.notEqual(state.phase, 'ended', 'keyboard play should remain possible');
    const next = state.objects.filter(item => !item.checked).sort((a, b) => b.y - a.y)[0];
    if (next) {
      const target = next.kind === 'bomb' ? next.x + (next.x > 480 ? -190 : 190) : next.x;
      game.keyUp({ code: 'ArrowLeft' });
      game.keyUp({ code: 'ArrowRight' });
      if (target < state.basket.x - 5) game.keyDown({ code: 'ArrowLeft' });
      if (target > state.basket.x + 5) game.keyDown({ code: 'ArrowRight' });
    }
    game.update(1 / 120);
  }
  assert.fail(`Catch did not advance: ${JSON.stringify(game.getState())}`);
}

test('angry endless: completing stage twelve continues into a changed, playable thirteenth stage', () => {
  const progress = { unlocked: 5, stars: { 1: 3, 3: 2 } };
  const { game, results, saves, texts } = harness(createAngry, { endless: true, progress });
  game.start({ level: 12 });
  shoot(game, 60, 0.95);
  const clear = shoot(game, 5, 0.55);
  assert.equal(clear.phase, 'levelclear');
  const continued = until(game, state => state.level === 13, 3);
  assert.equal(continued.phase, 'ready');
  assert.equal(continued.endless, true);
  assert.equal(continued.templateLevel, 1);
  assert.equal(continued.totalLevels, null);
  assert.equal(continued.loop, 2);
  assert.equal(continued.shots, continued.maxShots);
  assert.ok(continued.score >= clear.score);
  assert.ok(continued.challengeScale > 1 && continued.challengeScale <= 1.32);
  assert.equal(results.length, 0);
  game.render(40);
  assert.ok(texts.some(text => String(text).includes('无限 13')));
  const nextClear = shoot(game, 5, 0.95);
  assert.equal(nextClear.phase, 'levelclear', 'the transformed second-cycle layout can still be solved by a real shot');
  assert.ok(nextClear.score > continued.score);
  assert.equal(nextClear.stars, 0);
  assert.equal(saves.length, 0);
  assert.deepEqual(nextClear.progress, progress);
});

test('angry endless: normal progress survives mode switching and only standard clears write stars', () => {
  const progress = { unlocked: 6, stars: { 1: 3, 5: 2 } };
  const { game, saves, results } = harness(createAngry, { progress });
  game.start({ endless: true });
  shoot(game, 5, 0.95);
  assert.equal(saves.length, 0);
  assert.deepEqual(game.getState().progress, progress);
  game.start();
  assert.equal(game.getState().endless, true, 'retry preserves the selected mode');
  assert.equal(game.getState().score, 0);
  assert.equal(game.getState().level, 1);
  game.start({ endless: false, level: 12 });
  shoot(game, 60, 0.95);
  shoot(game, 5, 0.55);
  until(game, state => state.phase === 'ended', 3);
  assert.equal(results.length, 1);
  assert.equal(results[0].won, true);
  assert.equal(results[0].endless, false);
  assert.equal(results[0].level, 12);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].stars[1], 3);
  assert.equal(saves[0].stars[5], 2);
  assert.ok(saves[0].stars[12] > 0);
  assert.deepEqual(progress, { unlocked: 6, stars: { 1: 3, 5: 2 } });
});

test('angry endless: exhausting ammunition ends once without unlocking standard stages', () => {
  const { game, results, saves } = harness(createAngry, { endless: true });
  game.start();
  for (let shot = 0; shot < 3; shot++) shoot(game, 0, 0.2);
  assert.equal(game.getState().phase, 'ended');
  assert.equal(game.getState().shots, 0);
  advance(game, 3);
  assert.equal(results.length, 1);
  assert.equal(results[0].endless, true);
  assert.equal(results[0].won, false);
  assert.match(results[0].message, /无限模式闯到第 1 关/);
  assert.equal(saves.length, 0);
  assert.deepEqual(game.getState().progress, { unlocked: 1, stars: {} });
});

test('catch endless: keyboard play passes wave eight and reaches wave twenty-four with bounded challenge', () => deterministic(() => {
  const { game, results, texts } = harness(createCatch, { endless: true });
  game.start();
  let highestObjects = 0, afterEightScore = null;
  const state = driveCatch(game, value => value.wave >= 24, 600, value => {
    highestObjects = Math.max(highestObjects, value.objects.length);
    if (value.wave === 9 && afterEightScore === null) afterEightScore = value.score;
    assert.ok(value.waveCount <= 18);
    assert.ok(value.fallSpeed <= 340);
    assert.ok(value.driftLimit <= 28);
    assert.ok(value.spawnInterval >= 0.76);
  });
  assert.equal(state.endless, true);
  assert.equal(state.totalWaves, null);
  assert.equal(state.phase, 'playing');
  assert.equal(state.won, false);
  assert.equal(state.lives, 3, 'capped speed and drift remain fair with keyboard movement');
  assert.ok(afterEightScore > 0 && state.score > afterEightScore);
  assert.equal(state.waveCount, 18);
  assert.equal(state.fallSpeed, 340);
  assert.equal(state.driftLimit, 28);
  assert.ok(highestObjects <= 6, 'resolved items are discarded throughout an extended run');
  assert.equal(results.length, 0);
  game.render(state.elapsed);
  assert.ok(texts.includes('无限 · 第 24 波'));
}));

test('catch endless: three misses still end the run, and standard mode still wins at wave eight', () => deterministic(() => {
  const { game, results } = harness(createCatch);
  game.start({ endless: true });
  game.pointerMove({ x: 88 });
  until(game, state => state.phase === 'ended', 12);
  assert.equal(game.getState().lives, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0].endless, true);
  assert.equal(results[0].won, false);
  assert.match(results[0].message, /无限模式/);
  advance(game, 2);
  assert.equal(results.length, 1);
  game.start();
  assert.equal(game.getState().endless, true);
  assert.equal(game.getState().wave, 1);
  assert.equal(game.getState().score, 0);
  assert.equal(game.getState().lives, 3);
  game.start({ endless: false });
  const standard = driveCatch(game, state => state.phase === 'ended', 160);
  assert.equal(standard.endless, false);
  assert.equal(standard.wave, 8);
  assert.equal(standard.totalWaves, 8);
  assert.equal(standard.won, true);
  assert.equal(results.length, 2);
  assert.equal(results[1].endless, false);
  assert.equal(results[1].won, true);
}));
