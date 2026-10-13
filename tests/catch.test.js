import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../js/games/catch.js';

function deterministic(run, value = 0.5) {
  const original = Math.random;
  Math.random = () => value;
  try { run(); } finally { Math.random = original; }
}

function harness() {
  const results = [];
  const scores = [];
  const sounds = [];
  const draws = [];
  const noop = () => {};
  const ctx = new Proxy({
    createLinearGradient: () => ({ addColorStop: noop }),
    measureText: text => ({ width: String(text).length * 10 }),
  }, {
    get: (target, key) => key in target ? target[key] : noop,
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const game = createGame({
    ctx, canvas: {}, width: 960, height: 560,
    drawFrog: (...args) => draws.push(args),
    audio: { play: kind => sounds.push(kind) },
    onScore: score => scores.push(score),
    onStatus() {},
    onEnd: result => results.push(result),
  });
  return { game, results, scores, sounds, draws };
}

function advance(game, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 120); i += 1) game.update(1 / 120);
}

function drive(game, predicate, { seconds = 150, avoidBombs = true, keyboard = false } = {}) {
  for (let i = 0; i <= seconds * 120; i += 1) {
    const state = game.getState();
    if (predicate(state)) return state;
    if (state.phase === 'ended') break;
    const next = state.objects.filter(item => !item.checked).sort((a, b) => b.y - a.y)[0];
    if (next) {
      const x = next.kind === 'bomb' && avoidBombs
        ? next.x + (next.x > 480 ? -190 : 190)
        : next.x;
      if (keyboard) {
        game.keyUp({ code: 'ArrowLeft' });
        game.keyUp({ code: 'ArrowRight' });
        if (x < state.basket.x - 5) game.keyDown({ code: 'ArrowLeft' });
        if (x > state.basket.x + 5) game.keyDown({ code: 'ArrowRight' });
      } else game.pointerMove({ x, y: state.basket.y });
    }
    game.update(1 / 120);
  }
  assert.fail(`Expected condition within ${seconds}s; state=${JSON.stringify(game.getState())}`);
}

test('catch: idle preview, first catch, and snapshots cannot mutate game state', () => deterministic(() => {
  const { game, scores, draws } = harness();
  game.render(0);
  assert.ok(draws.length >= 2, 'idle attract scene includes actual milk frog art');
  game.pointerDown({ x: 200, y: 450 });
  game.keyDown({ key: 'a', code: 'KeyA' });
  advance(game, 1);
  assert.equal(game.getState().phase, 'idle');
  assert.equal(game.getState().basket.x, 480);

  game.start();
  const first = drive(game, state => state.caught === 1, { seconds: 6 });
  assert.equal(first.score, 10);
  assert.equal(first.lives, 3);
  assert.equal(first.combo, 1);
  assert.equal(scores.at(-1), 10);
  const snapshot = game.getState();
  snapshot.basket.x = 0;
  snapshot.held.left = true;
  if (snapshot.objects.length) snapshot.objects[0].y = 10000;
  assert.equal(game.getState().basket.x, first.basket.x);
  assert.equal(game.getState().held.left, false);
  assert.ok(game.getState().objects.every(item => item.y < 560));
  game.render(first.elapsed);
}));

test('catch: three missed frogs remove three lives and end exactly once', () => deterministic(() => {
  const { game, results, sounds } = harness();
  game.start();
  game.pointerDown({ x: 88, y: 460 });
  advance(game, 15);
  const state = game.getState();
  assert.equal(state.phase, 'ended');
  assert.equal(state.lives, 0);
  assert.equal(state.missed, 3);
  assert.equal(state.score, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0].won, false);
  assert.ok(sounds.includes('laugh'));
  advance(game, 20);
  assert.equal(results.length, 1);
  assert.equal(game.getState().elapsed, state.elapsed);
}));

test('catch: catching a bomb costs a life and breaks the combo without awarding points', () => deterministic(() => {
  const { game } = harness();
  game.start();
  drive(game, state => state.wave === 2 && state.objects.some(item => item.kind === 'bomb'), { seconds: 24 });
  let scoreBeforeBomb = game.getState().score;
  let previousHits = 0;
  for (let i = 0; i < 8 * 120; i += 1) {
    const state = game.getState();
    if (state.bombsHit > previousHits) break;
    const next = state.objects.filter(item => !item.checked).sort((a, b) => b.y - a.y)[0];
    if (next) game.pointerMove({ x: next.x });
    scoreBeforeBomb = state.score;
    previousHits = state.bombsHit;
    game.update(1 / 120);
  }
  const hit = game.getState();
  assert.equal(hit.bombsHit, 1);
  assert.equal(hit.lives, 2);
  assert.equal(hit.combo, 0);
  assert.equal(hit.score, scoreBeforeBomb);
}));

test('catch: arrows and A/D hold movement; key-up and pause cancellation stop it', () => deterministic(() => {
  const { game } = harness();
  game.start();
  assert.equal(game.keyDown({ key: 'd', code: 'KeyD' }), true);
  advance(game, 0.2);
  assert.ok(game.getState().basket.x > 600);
  game.keyUp({ key: 'd', code: 'KeyD' });
  const stoppedX = game.getState().basket.x;
  advance(game, 0.2);
  assert.equal(game.getState().basket.x, stoppedX);
  game.keyDown({ key: 'ArrowLeft', code: 'ArrowLeft' });
  advance(game, 0.1);
  game.cancelInput();
  const paused = game.getState();
  game.render(1);
  game.render(5);
  assert.equal(game.getState().elapsed, paused.elapsed, 'render-only frames do not advance a paused game');
  advance(game, 0.2);
  assert.equal(game.getState().basket.x, paused.basket.x, 'resuming does not retain a held movement key');
  game.keyDown({ key: 'a' });
  game.pointerUp({ cancelled: true });
  assert.equal(game.getState().held.left, false);
  assert.equal(game.keyDown({ key: 'q' }), false);
  game.pointerMove({ x: -500 });
  assert.equal(game.getState().basket.x, 88);
  game.pointerMove({ x: 5000 });
  assert.equal(game.getState().basket.x, 872);
}));

test('catch: eight waves are winnable using held keyboard inputs, with gold and combo bonuses', () => deterministic(() => {
  const { game, results, scores } = harness();
  game.start();
  let goldenCaught = false;
  let previousScore = 0;
  const final = drive(game, state => {
    if (state.phase !== 'ending' && state.phase !== 'ended' && state.score - previousScore >= 30) goldenCaught = true;
    previousScore = state.score;
    return state.phase === 'ended';
  }, { keyboard: true });
  assert.equal(final.won, true);
  assert.equal(final.wave, 8);
  assert.equal(final.lives, 3, 'spawn geometry must allow keyboard-only play without forced damage');
  assert.equal(final.missed, 0);
  assert.equal(final.bombsHit, 0);
  assert.equal(final.bombsDodged, 11);
  assert.equal(final.caught, 65);
  assert.equal(final.bestCombo, 65);
  assert.ok(goldenCaught, 'golden frog or high-combo catches have visible bonus points');
  assert.ok(final.score > final.caught * 10 + 350);
  assert.equal(results.length, 1);
  assert.equal(results[0].won, true);
  assert.equal(results[0].score, final.score);
  assert.equal(scores.at(-1), final.score);
  advance(game, 10);
  assert.equal(results.length, 1);
}));

for (const random of [0.05, 0.95]) {
  test(`catch: extreme spawn direction ${random} remains fair and inside the board`, () => deterministic(() => {
    const { game } = harness();
    game.start();
    const final = drive(game, state => {
      assert.ok(state.objects.every(item => item.x >= 88 && item.x <= 872));
      return state.phase === 'ended';
    }, { keyboard: true });
    assert.equal(final.won, true);
    assert.equal(final.lives, 3);
  }, random));
}

test('catch: restarting after damage resets lives, score, objects, waves, and held input', () => deterministic(() => {
  const { game, results } = harness();
  game.start();
  game.pointerMove({ x: 88 });
  advance(game, 15);
  assert.equal(results.length, 1);
  game.start();
  const reset = game.getState();
  assert.equal(reset.phase, 'playing');
  assert.equal(reset.score, 0);
  assert.equal(reset.wave, 1);
  assert.equal(reset.lives, 3);
  assert.equal(reset.elapsed, 0);
  assert.equal(reset.missed, 0);
  assert.equal(reset.caught, 0);
  assert.equal(reset.combo, 0);
  assert.equal(reset.objects.length, 0);
  assert.deepEqual(reset.held, { left: false, right: false });
  drive(game, state => state.caught === 1, { seconds: 6 });
  assert.equal(game.getState().score, 10);
  game.destroy();
  assert.equal(game.getState().phase, 'idle');
  assert.equal(game.getState().objects.length, 0);
  assert.deepEqual(game.getState().held, { left: false, right: false });
}));
