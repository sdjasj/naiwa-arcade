import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, CHARACTERS } from '../js/games/fighter.js';

function deterministic(run, value = 0.5) {
  const previous = Math.random;
  Math.random = () => value;
  try { return run(); } finally { Math.random = previous; }
}

function harness(options = {}) {
  const results = [], sounds = [], scores = [], frogs = [], labels = [];
  const noop = () => {};
  const ctx = new Proxy({
    measureText: value => ({ width: String(value).length * 10 }),
    fillText: value => labels.push(value),
  }, {
    get: (target, key) => key in target ? target[key] : noop,
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const game = createGame({ ctx, ...options,
    drawFrog: (_ctx, x, y, size, pose) => frogs.push({ x, y, size, pose }),
    audio: { play: sound => sounds.push(sound) },
    onEnd: result => results.push(result),
    onScore: score => scores.push(score),
  });
  return { game, results, sounds, scores, frogs, labels };
}

function advance(game, seconds, dt = 1 / 120) {
  for (let i = 0; i < Math.ceil(seconds / dt); i++) game.update(dt);
}

function until(game, predicate, seconds = 10) {
  for (let i = 0; i < seconds * 120; i++) {
    const state = game.getState();
    if (predicate(state)) return state;
    game.update(1 / 120);
  }
  assert.fail(`Condition not reached: ${JSON.stringify(game.getState())}`);
}

function tap(game, action, player = 0) {
  game.controlDown(action, player);
  game.controlUp(action, player);
}

function approach(game, player = 0, range = 80) {
  for (let i = 0; i < 4 * 120; i++) {
    const state = game.getState(), a = state.players[player], b = state.players[1 - player];
    if (Math.abs(a.x - b.x) <= range) { game.controlUp('left', player); game.controlUp('right', player); return; }
    game.controlDown(a.x < b.x ? 'right' : 'left', player);
    game.update(1 / 120);
  }
  assert.fail('fighters did not approach each other');
}

function strikeAndRecover(game, action = 'light', player = 0) {
  approach(game, player);
  tap(game, action, player);
  return until(game, state => state.phase !== 'fighting' || !state.players[player].attack, 3);
}

function defeatPassivePlayer(game, winner) {
  for (let i = 0; i < 120 * 45; i++) {
    const state = game.getState();
    if (state.phase === 'roundover' || state.phase === 'ended') return state;
    const a = state.players[winner], b = state.players[1 - winner], distance = Math.abs(a.x - b.x);
    game.controlUp('left', winner); game.controlUp('right', winner);
    if (distance > 81) game.controlDown(a.x < b.x ? 'right' : 'left', winner);
    if (!a.attack && a.hurtTime <= 0 && distance < 98) tap(game, a.rage >= 100 ? 'special' : 'light', winner);
    game.update(1 / 120);
  }
  assert.fail('legal duel attacks did not finish the round');
}

// A player strategy uses only visible opponent windup/projectiles and the public
// controls: approach, block danger, light-punch recovery, spend full rage.
function playCpu(game, predicate, seconds = 160, dt = 1 / 120) {
  for (let frame = 0; frame < seconds / dt; frame++) {
    const state = game.getState();
    if (predicate(state)) return state;
    assert.notEqual(state.phase, 'ended', 'the chosen input strategy should survive this challenge');
    if (state.phase === 'fighting') {
      const a = state.players[0], b = state.players[1], distance = Math.abs(a.x - b.x);
      for (const action of ['left', 'right', 'block']) game.controlUp(action);
      const danger = (b.attack && b.attack.age < b.attack.startup + 0.12 && distance < 220)
        || state.projectiles.some(p => p.owner === 1 && Math.abs(p.x - a.x) < 110);
      if (danger && !a.attack) game.controlDown('block');
      else {
        if (distance > 82) game.controlDown(a.x < b.x ? 'right' : 'left');
        if (!a.attack && a.hurtTime <= 0 && distance < (a.rage >= 100 ? 185 : 98)) tap(game, a.rage >= 100 ? 'special' : 'light');
      }
    }
    game.update(dt);
  }
  assert.fail(`CPU fight timed out: ${JSON.stringify(game.getState())}`);
}

test('fighter lifecycle: authentic sprite preview, default classic, fresh starts and isolated snapshots', () => {
  const { game, frogs, scores, results } = harness();
  assert.equal(game.getState().phase, 'idle');
  game.render(0);
  assert.ok(frogs.length >= 2);
  game.controlDown('light'); advance(game, 0.3);
  assert.equal(game.getState().phase, 'idle');
  game.start();
  const state = game.getState();
  assert.equal(state.phase, 'fighting');
  assert.equal(state.character, 'belly');
  assert.equal(state.endless, false);
  assert.equal(state.multiplayer, false);
  assert.equal(state.totalStages, 6);
  state.players[0].hp = 0;
  state.held[0].right = true;
  state.stats.hits[0] = 100;
  assert.ok(game.getState().players[0].hp > 0);
  assert.equal(game.getState().held[0].right, false);
  assert.equal(game.getState().stats.hits[0], 0);
  game.start({ multiplayer: true, character: 'laugh', opponentCharacter: 'speed' });
  assert.deepEqual(game.getState().players.map(p => p.character), ['laugh', 'speed']);
  assert.equal(scores.at(-1), 0);
  game.destroy(); advance(game, 10);
  assert.equal(results.length, 0);
  assert.equal(game.getState().phase, 'idle');
});

test('fighter characters: belly has more health, speed moves and punches faster, laugh has ranged heavy attacks', () => {
  const games = Object.keys(CHARACTERS).map(character => harness({ character, multiplayer: true }).game);
  for (const game of games) { game.start(); game.controlDown('right'); advance(game, 0.3); game.controlUp('right'); }
  const [belly, speed, laugh] = games.map(game => game.getState());
  assert.ok(belly.players[0].maxHp > speed.players[0].maxHp);
  assert.ok(speed.players[0].x > belly.players[0].x && speed.players[0].x > laugh.players[0].x);
  tap(games[0], 'light'); tap(games[1], 'light');
  assert.ok(games[1].getState().players[0].attack.startup < games[0].getState().players[0].attack.startup);
  tap(games[2], 'heavy');
  until(games[2], state => state.projectiles.length > 0, 1);
  assert.equal(games[2].getState().projectiles[0].owner, 0);
});

test('fighter contact: empty swings miss, light punches squash and knock back, heavy punches hurt more', () => {
  const empty = harness({ multiplayer: true }).game;
  empty.start(); const hp = empty.getState().players[1].hp;
  tap(empty, 'light'); advance(empty, 0.8);
  assert.equal(empty.getState().players[1].hp, hp);
  assert.equal(empty.getState().stats.hits[0], 0);
  assert.equal(empty.getState().stats.whiffs[0], 1);
  const damages = [];
  for (const action of ['light', 'heavy']) {
    const { game, frogs } = harness({ multiplayer: true });
    game.start(); approach(game);
    tap(game, action);
    const state = until(game, value => value.players[1].hp < value.players[1].maxHp, 2);
    damages.push(state.players[1].maxHp - state.players[1].hp);
    assert.ok(state.hitStop > 0);
    assert.ok(state.players[1].vx > 0);
    game.render(1);
    assert.ok(frogs.some(frog => frog.pose.expression === 'squish'));
  }
  assert.ok(damages[1] > damages[0]);
});

test('fighter guarding: block reduces damage, heavy pressure eventually breaks guard, hits generate rage', () => {
  const { game } = harness({ multiplayer: true });
  game.start(); approach(game); game.controlDown('block', 1);
  strikeAndRecover(game, 'heavy');
  const blocked = game.getState();
  assert.equal(blocked.stats.blockedHits[0], 1);
  assert.equal(blocked.stats.hits[0], 0);
  assert.ok(blocked.players[1].hp > blocked.players[1].maxHp - 10);
  assert.ok(blocked.players[0].rage > 0 && blocked.players[1].rage > 0);
  strikeAndRecover(game, 'heavy');
  strikeAndRecover(game, 'heavy');
  const broken = game.getState();
  assert.equal(broken.stats.blockedHits[0], 2);
  assert.equal(broken.stats.hits[0], 1, 'the third heavy cracks a held guard');
  assert.ok(broken.players[1].hp < blocked.players[1].hp - 20);
});

test('fighter crouching and jumping: crouch ducks standing laugh shots, jumps rise and return to the floor', () => {
  for (const crouch of [false, true]) {
    const { game } = harness({ multiplayer: true, character: 'laugh' });
    game.start();
    if (crouch) game.controlDown('crouch', 1);
    tap(game, 'heavy'); advance(game, 2);
    const target = game.getState().players[1];
    if (crouch) assert.equal(target.hp, target.maxHp);
    else assert.ok(target.hp < target.maxHp);
  }
  const { game } = harness({ multiplayer: true });
  game.start(); const floor = game.getState().players[0].y;
  tap(game, 'jump'); advance(game, 0.25);
  assert.ok(game.getState().players[0].y < floor - 85);
  assert.equal(game.getState().players[0].grounded, false);
  until(game, state => state.players[0].grounded, 2);
  assert.equal(game.getState().players[0].y, floor);
});

test('fighter rage: real punches earn a combo and unlock a powerful special once', () => {
  const { game } = harness({ multiplayer: true });
  game.start(); tap(game, 'special');
  assert.equal(game.getState().players[0].attack, null);
  for (let i = 0; i < 7 && game.getState().players[0].rage < 100; i++) strikeAndRecover(game);
  const charged = game.getState();
  assert.equal(charged.players[0].rage, 100);
  assert.ok(charged.stats.bestCombo[0] >= 2);
  approach(game); const before = game.getState().players[1].hp;
  tap(game, 'special');
  assert.equal(game.getState().players[0].attack.type, 'special');
  const hit = until(game, state => state.players[1].hp < before, 2);
  assert.ok(before - hit.players[1].hp >= 40);
  assert.equal(hit.stats.specials[0], 1);
  assert.ok(hit.players[0].rage < 5);
  game.controlDown('special'); game.controlDown('special'); game.controlUp('special');
  advance(game, 1);
  assert.equal(game.getState().stats.specials[0], 1);
});

test('fighter controls: both keyboard layouts work and pause cancellation releases all held movement and defense', () => {
  const { game } = harness({ multiplayer: true });
  game.start();
  assert.equal(game.keyDown({ code: 'KeyD' }), true);
  assert.equal(game.keyDown({ code: 'ArrowLeft' }), true);
  advance(game, 0.25);
  assert.ok(game.getState().players[0].x > 252);
  assert.ok(game.getState().players[1].x < 708);
  game.keyUp({ code: 'KeyD' }); game.keyUp({ code: 'ArrowLeft' });
  game.keyDown({ code: 'KeyL' }); game.keyDown({ code: 'Digit3' });
  assert.ok(game.getState().players.every(player => player.blocking));
  game.cancelInput();
  assert.ok(game.getState().held.every(input => Object.values(input).every(value => !value)));
  assert.ok(game.getState().players.every(player => !player.blocking));
  advance(game, 1);
  assert.ok(game.getState().players.every(player => Math.abs(player.vx) < 0.01));
  assert.equal(game.keyDown({ code: 'KeyQ' }), false);
  game.keyDown({ code: 'Digit1', repeat: true });
  assert.equal(game.getState().players[1].attack, null);
  game.keyDown({ code: 'Digit1' });
  assert.equal(game.getState().players[1].attack.type, 'light');
  game.keyUp({ code: 'Digit1' });
  game.controlDown('right'); game.pointerUp({ cancelled: true });
  assert.equal(game.getState().held[0].right, false);
});

test('fighter CPU: chases, reacts to heavy windup with guard, and cannot be controlled with player-two keys', () => deterministic(() => {
  const { game } = harness();
  game.start(); game.controlDown('right');
  until(game, state => Math.abs(state.players[0].x - state.players[1].x) < 190, 3);
  game.controlUp('right');
  assert.ok(game.getState().players[1].x < 708);
  tap(game, 'heavy');
  until(game, state => state.players[1].blocking, 1);
  assert.equal(game.controlDown('special', 1), false);
  assert.equal(game.keyDown({ code: 'Digit1' }), false);
}, 0.05));

test('fighter classic: public movement, guard, punches and specials beat all six CPU opponents', () => deterministic(() => {
  const { game, results } = harness();
  game.start();
  const visited = new Set();
  const final = playCpu(game, state => { visited.add(state.stage); return state.phase === 'ended'; });
  assert.deepEqual([...visited], [1, 2, 3, 4, 5, 6]);
  assert.equal(final.wins[0], 6);
  assert.equal(results.length, 1);
  assert.equal(results[0].won, true);
  assert.equal(results[0].endless, false);
  assert.ok(final.stats.hits[0] > 20);
  assert.ok(final.stats.specials[0] > 0);
  assert.ok(final.stats.blockedHits[1] > 0, 'winning play actually guarded CPU attacks');
  advance(game, 4);
  assert.equal(results.length, 1);
}));

test('fighter endless: the same legal controls beat opponent seven without a final victory', () => deterministic(() => {
  const { game, results } = harness({ endless: true });
  game.start();
  const state = playCpu(game, state => state.stage === 8);
  assert.equal(state.phase, 'fighting');
  assert.equal(state.endless, true);
  assert.equal(state.totalStages, null);
  assert.equal(state.wins[0], 7);
  assert.equal(state.players[0].hp, state.players[0].maxHp, 'the next opponent starts a fresh health bar');
  assert.ok(state.score > 0);
  assert.equal(results.length, 0);
}));

test('fighter CPU loss: no-input player can lose, receives one result, then restart resets the run', () => deterministic(() => {
  const { game, results } = harness({ endless: true });
  game.start();
  until(game, state => state.phase === 'ended', 40);
  assert.equal(results.length, 1);
  assert.equal(results[0].won, false);
  assert.equal(results[0].winner, 2);
  assert.equal(results[0].endless, true);
  game.start({ endless: false, multiplayer: false, character: 'speed' });
  const state = game.getState();
  assert.equal(state.stage, 1);
  assert.equal(state.score, 0);
  assert.equal(state.endless, false);
  assert.equal(state.character, 'speed');
  assert.deepEqual(state.wins, [0, 0]);
  assert.deepEqual(state.stats.specials, [0, 0]);
  assert.ok(state.players.every(player => player.hp === player.maxHp && player.rage === 0));
}));

test('fighter duel: alternating real knockouts play three rounds and award the best-of-three winner', () => {
  const { game, results } = harness({ multiplayer: true, character: 'belly', opponentCharacter: 'belly' });
  game.start();
  for (const [index, winner] of [0, 1, 0].entries()) {
    assert.equal(game.getState().round, index + 1);
    const finished = defeatPassivePlayer(game, winner);
    assert.equal(finished.roundWinner, winner);
    assert.equal(finished.players[1 - winner].hp, 0);
    if (index < 2) {
      until(game, state => state.phase === 'fighting', 3);
      assert.equal(results.length, 0);
      assert.ok(game.getState().players.every(player => player.hp === player.maxHp));
    }
  }
  until(game, state => state.phase === 'ended', 3);
  assert.equal(results.length, 1);
  assert.equal(results[0].multiplayer, true);
  assert.equal(results[0].winner, 1);
  assert.deepEqual(results[0].wins, [2, 1]);
  game.start();
  assert.equal(game.getState().multiplayer, true);
  assert.deepEqual(game.getState().wins, [0, 0]);
});

test('fighter duel: player two can win two straight rounds using the same public control API', () => {
  const { game, results } = harness({ multiplayer: true });
  game.start();
  defeatPassivePlayer(game, 1);
  until(game, state => state.phase === 'fighting', 3);
  defeatPassivePlayer(game, 1);
  until(game, state => state.phase === 'ended', 3);
  assert.equal(results[0].winner, 2);
  assert.equal(results[0].won, false);
  assert.deepEqual(results[0].wins, [0, 2]);
});
