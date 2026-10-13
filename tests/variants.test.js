import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame as createFlappy } from '../js/games/flappy.js';
import { createGame as createWhack } from '../js/games/whack.js';

function deterministic(run) {
  const original = Math.random;
  Math.random = () => 0.5;
  try { return run(); } finally { Math.random = original; }
}

function harness(factory, difficulty) {
  const results = [], frogs = [], palettes = [];
  const noop = () => {};
  const ctx = new Proxy({
    createLinearGradient() {
      const colors = [];
      palettes.push(colors);
      return { addColorStop(_stop, color) { colors.push(color); } };
    },
    measureText: value => ({ width: String(value).length * 10 }),
  }, {
    get: (target, key) => key in target ? target[key] : noop,
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const game = factory({ ctx, difficulty,
    drawFrog(_ctx, _x, _y, _size, options) { frogs.push(options); },
    onEnd: result => results.push(result),
  });
  return { game, results, frogs, palettes };
}

function advance(game, seconds, dt = 1 / 120) {
  for (let i = 0; i < Math.ceil(seconds / dt); i++) game.update(dt);
}

function until(game, predicate, seconds = 35) {
  for (let i = 0; i < seconds * 120; i++) {
    const state = game.getState();
    if (predicate(state)) return state;
    game.update(1 / 120);
  }
  assert.fail(`Expected game state: ${JSON.stringify(game.getState())}`);
}

function flyTo(game, score) {
  for (let i = 0; i < 10000 && game.getState().score < score; i++) {
    const state = game.getState();
    assert.equal(state.phase, 'running');
    const next = state.pipes.find(pipe => pipe.x + pipe.width + state.player.radius >= state.player.x);
    if (state.player.y > next.center + 20 && state.player.velocity > 0) game.pointerDown();
    game.update(1 / 120);
  }
  assert.equal(game.getState().score, score);
}

for (const [name, factory] of [['flappy', createFlappy], ['whack', createWhack]]) {
  test(`${name} variants: the implicit default and explicit normal follow identical input traces`, () => deterministic(() => {
    const implicit = harness(factory).game;
    const explicit = harness(factory, 'normal').game;
    implicit.start(); explicit.start();
    for (let frame = 0; frame < 180; frame++) {
      if (frame % 36 === 0) {
        implicit.pointerDown({ x: 212, y: 178 });
        explicit.pointerDown({ x: 212, y: 178 });
      }
      implicit.update(1 / 120); explicit.update(1 / 120);
      assert.deepEqual(implicit.getState(), explicit.getState());
    }
  }));

  test(`${name} variants: mode selection persists on retry and invalid modes fall back safely`, () => deterministic(() => {
    const { game } = harness(factory, 'easy');
    game.start(); assert.equal(game.getState().difficulty, 'easy');
    game.start({ difficulty: 'hard' }); assert.equal(game.getState().difficulty, 'hard');
    game.start(); assert.equal(game.getState().difficulty, 'hard');
    game.start({ difficulty: 'unknown' }); assert.equal(game.getState().difficulty, 'normal');
  }));
}

test('flappy variants: easy gives wider gaps, slower pipes and gentler falling acceleration', () => deterministic(() => {
  const easy = harness(createFlappy, 'easy').game;
  const normal = harness(createFlappy).game;
  const hard = harness(createFlappy, 'hard').game;
  for (const game of [easy, normal, hard]) { game.start(); game.pointerDown(); }
  const initial = [easy, normal, hard].map(game => game.getState());
  for (const game of [easy, normal, hard]) advance(game, 0.25);
  const later = [easy, normal, hard].map(game => game.getState());
  assert.ok(initial[0].pipes[0].gap > initial[1].pipes[0].gap);
  assert.ok(initial[1].pipes[0].gap > initial[2].pipes[0].gap);
  const movements = later.map((state, i) => initial[i].pipes[0].x - state.pipes[0].x);
  assert.ok(movements[0] < movements[1] && movements[1] < movements[2]);
  const accelerations = later.map((state, i) => state.player.velocity - initial[i].player.velocity);
  assert.ok(accelerations[0] < accelerations[1] && accelerations[1] < accelerations[2]);
  assert.equal(initial[1].pipes[0].gap, 204, 'the original normal opening remains unchanged');
  assert.equal(initial[1].pipes[1].x - initial[1].pipes[0].x, 335);
  assert.equal(initial[1].player.velocity, -355);
}));

test('flappy chapters: actual flights visit sunny, sunset and starry scenes, then cycle', () => deterministic(() => {
  const { game, palettes } = harness(createFlappy);
  game.start();
  const names = [];
  for (const score of [0, 5, 10, 15]) {
    flyTo(game, score);
    names.push(game.getState().chapterName);
    assert.equal(game.getState().chapter, score / 5 + 1);
    game.render(score);
  }
  assert.deepEqual(names, ['晴空', '晚霞', '星夜', '晴空']);
  assert.notDeepEqual(palettes[0], palettes[1]);
  assert.notDeepEqual(palettes[1], palettes[2]);
  assert.deepEqual(palettes[0], palettes[3]);
}));

test('flappy variants: all modes are playable and retain mode-aware results and fresh retry statistics', () => deterministic(() => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const { game, results } = harness(createFlappy, difficulty);
    game.start();
    flyTo(game, 3);
    assert.equal(game.getState().stats.pipesPassed, 3);
    assert.ok(game.getState().stats.flaps > 0);
    until(game, state => state.phase === 'ended', 5);
    advance(game, 1);
    assert.equal(results.length, 1);
    assert.equal(results[0].difficulty, difficulty);
    assert.equal(results[0].score, 3);
    assert.ok(results[0].stats.flightSeconds > 0);
    game.start();
    assert.equal(game.getState().difficulty, difficulty);
    assert.deepEqual(game.getState().stats, { flaps: 0, flightSeconds: 0, distance: 0, pipesPassed: 0 });
    assert.equal(game.getState().chapter, 1);
  }
}));

test('whack variants: easy frogs stay available longer while hard mode sends them more frequently', () => deterministic(() => {
  const games = ['easy', 'normal', 'hard'].map(difficulty => harness(createWhack, difficulty).game);
  const durations = games.map(game => {
    game.start();
    const state = until(game, value => value.holes.some(hole => hole.state === 'up'), 2);
    return state.holes.find(hole => hole.state === 'up').duration;
  });
  assert.ok(durations[0] > durations[1] && durations[1] > durations[2]);
  for (const game of games) advance(game, 10);
  const spawned = games.map(game => game.getState().spawned);
  assert.ok(spawned[0] < spawned[1] && spawned[1] < spawned[2]);
  assert.ok(games.every(game => game.getState().phase === 'playing'));
}));

test('whack golden frogs: every seventh spawn wears a crown and grants an extra 30 points', () => deterministic(() => {
  const { game, frogs } = harness(createWhack);
  game.start();
  const bonuses = [], golden = [];
  for (let hit = 1; hit <= 14; hit++) {
    const state = until(game, value => value.holes.some(hole => hole.state === 'up'), 2);
    const hole = state.holes.find(value => value.state === 'up');
    golden.push(hole.golden);
    const before = state.score;
    game.render(hit);
    game.keyDown({ key: String(hole.key), repeat: false });
    bonuses.push(game.getState().score - before);
    if (hit === 6) assert.equal(game.getState().score, 85, 'the first six normal hits keep their original scoring');
  }
  assert.deepEqual(golden.map((value, i) => value ? i + 1 : null).filter(Boolean), [7, 14]);
  assert.equal(bonuses[6] - bonuses[5], 30);
  assert.equal(bonuses[13] - bonuses[12], 30);
  assert.equal(game.getState().goldenHits, 2);
  assert.ok(frogs.some(options => options.crown === true));
  assert.equal(game.getState().accuracy, 100);
}));

test('whack accuracy: empty swings count once, results report accuracy, and retry clears every statistic', () => deterministic(() => {
  const { game, results } = harness(createWhack, 'hard');
  game.start();
  const state = until(game, value => value.holes.some(hole => hole.state === 'up'), 2);
  const hole = state.holes.find(value => value.state === 'up');
  game.pointerDown({ x: hole.x, y: hole.y - 50 });
  game.pointerDown({ x: 0, y: 0 });
  game.keyDown({ key: String(hole.key), repeat: true });
  assert.equal(game.getState().hits, 1);
  assert.equal(game.getState().misses, 1, 'held keys do not add attempts');
  assert.equal(game.getState().accuracy, 50);
  until(game, value => value.phase === 'ended');
  advance(game, 2);
  assert.equal(results.length, 1);
  assert.equal(results[0].difficulty, 'hard');
  assert.equal(results[0].stats.accuracy, 50);
  assert.match(results[0].message, /命中率 50%.*空锤 1 次/);
  game.start();
  const reset = game.getState();
  assert.equal(reset.difficulty, 'hard');
  assert.deepEqual(reset.stats, { hits: 0, misses: 0, escaped: 0, spawned: 0, goldenHits: 0, bestCombo: 0, accuracy: 0, attempts: 0 });
  assert.ok(reset.holes.every(value => !value.golden && value.state === 'hidden'));
}));
