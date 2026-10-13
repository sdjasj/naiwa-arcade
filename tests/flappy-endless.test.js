import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../js/games/flappy.js';

function deterministic(run) {
  const original = Math.random;
  Math.random = () => 0.5;
  try { run(); } finally { Math.random = original; }
}

function harness(options = {}) {
  const results = [], scores = [], labels = [];
  const noop = () => {};
  const ctx = new Proxy({
    createLinearGradient: () => ({ addColorStop: noop }),
    fillText: text => labels.push(text),
  }, { get: (target, key) => key in target ? target[key] : noop, set: () => true });
  const game = createGame({ ctx, drawFrog: noop, audio: { play() {} }, width: 960, height: 560,
    onScore: score => scores.push(score), onEnd: result => results.push(result), onStatus() {}, ...options,
  });
  return { game, results, scores, labels };
}

function advance(game, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 120); i += 1) game.update(1 / 120);
}

function until(game, predicate, { seconds = 30, fly = false } = {}) {
  for (let i = 0; i <= seconds * 120; i += 1) {
    const state = game.getState();
    if (predicate(state)) return state;
    if (fly && state.phase === 'running') {
      const pipe = state.pipes.find(p => p.x + p.width + state.player.radius >= state.player.x);
      const target = pipe?.center ?? 240;
      if (state.player.y > target + 31 && state.player.velocity > 20) game.pointerDown({});
    }
    game.update(1 / 120);
  }
  assert.fail(`Timed out waiting for state: ${JSON.stringify(game.getState())}`);
}

test('flappy infinite: collision spends one of three hearts, safely restores, then shields the player', () => deterministic(() => {
  const { game, results, labels } = harness({ endless: true });
  game.start();
  assert.equal(game.getState().endless, true);
  assert.equal(game.getState().lives, 3);
  assert.equal(game.getState().invulnerable, false);
  const hit = until(game, state => state.phase === 'crashed');
  assert.equal(hit.lives, 2);
  assert.equal(results.length, 0);
  advance(game, 0.4);
  assert.equal(game.getState().lives, 2, 'one collision cannot deduct hearts repeatedly');
  const recovered = until(game, state => state.phase === 'running');
  assert.equal(recovered.lives, 2);
  assert.equal(recovered.invulnerable, true);
  assert.equal(recovered.invulnerabilityTime, 1.8);
  assert.ok(recovered.player.y > recovered.player.radius);
  assert.ok(recovered.player.y < 512 - recovered.player.radius);
  assert.ok(recovered.pipes[0].x >= 880, 'recovery cannot place the frog inside an approaching pipe');
  game.render(2);
  assert.ok(labels.some(label => label.includes('无限飞行')));
  assert.ok(labels.some(label => label.includes('护盾保护中')));
  const clockBeforeRender = game.getState().invulnerabilityTime;
  game.render(10); game.render(20);
  assert.equal(game.getState().invulnerabilityTime, clockBeforeRender, 'paused rendering cannot consume the shield');
  advance(game, 1.5);
  const protectedState = game.getState();
  assert.equal(protectedState.lives, 2);
  assert.equal(protectedState.phase, 'running');
  assert.equal(protectedState.invulnerable, true);
  assert.ok(protectedState.player.y <= 512 - protectedState.player.radius);
  assert.equal(results.length, 0);
}));

test('flappy infinite: three collisions exhaust hearts and send exactly one mode-tagged result', () => deterministic(() => {
  const { game, results } = harness({ endless: true });
  game.start();
  const first = until(game, state => state.lives === 2 && state.phase === 'crashed');
  assert.equal(first.lives, 2);
  until(game, state => state.lives === 1 && state.phase === 'crashed');
  assert.equal(results.length, 0);
  until(game, state => state.phase === 'ended');
  assert.equal(game.getState().lives, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0].endless, true);
  assert.match(results[0].message, /无限模式/);
  advance(game, 30);
  assert.equal(results.length, 1);
}));

test('flappy infinite: a recovery preserves earned points and scenery, and play can continue indefinitely', () => deterministic(() => {
  const { game, scores, results } = harness({ endless: true });
  game.start();
  until(game, state => state.score >= 6, { fly: true });
  const hit = until(game, state => state.phase === 'crashed');
  assert.equal(hit.lives, 2);
  const recovered = until(game, state => state.phase === 'running');
  assert.equal(recovered.score, hit.score);
  assert.equal(recovered.chapter, hit.chapter);
  assert.equal(recovered.chapterName, hit.chapterName);
  assert.equal(recovered.stats.pipesPassed, hit.score);
  const continued = until(game, state => state.score >= hit.score + 20, { fly: true, seconds: 45 });
  assert.equal(continued.phase, 'running');
  assert.equal(continued.lives, 2);
  assert.equal(results.length, 0);
  assert.equal(scores.at(-1), continued.score);
  assert.ok(scores.every((score, i) => i === 0 || score >= scores[i - 1]));
}));

test('flappy modes: normal remains one-hit game over; explicit options reset hearts and mode', () => deterministic(() => {
  const { game, results } = harness();
  game.start();
  assert.equal(game.getState().endless, false);
  assert.equal(game.getState().lives, 1);
  until(game, state => state.phase === 'ended');
  assert.equal(results.length, 1);
  assert.equal(results[0].endless, false);
  game.start({ endless: true, difficulty: 'easy' });
  assert.equal(game.getState().endless, true);
  assert.equal(game.getState().difficulty, 'easy');
  assert.equal(game.getState().lives, 3);
  until(game, state => state.phase === 'crashed');
  until(game, state => state.invulnerable);
  game.start({ endless: false, difficulty: 'hard' });
  const reset = game.getState();
  assert.equal(reset.endless, false);
  assert.equal(reset.lives, 1);
  assert.equal(reset.invulnerable, false);
  assert.equal(reset.invulnerabilityTime, 0);
  assert.equal(reset.score, 0);
  assert.equal(reset.chapter, 1);
  assert.equal(reset.difficulty, 'hard');
}));
