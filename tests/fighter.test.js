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

function quarterCircle(game, attack = 'light', player = 0) {
  const forward = game.getState().players[player].facing > 0 ? 'right' : 'left';
  game.controlDown('crouch', player); advance(game, .04);
  game.controlDown(forward, player); advance(game, .04);
  game.controlUp('crouch', player); advance(game, .04);
  tap(game, attack, player); game.controlUp(forward, player);
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
  until(game, state => state.phase !== 'fighting' || state.players[player].attack, 1);
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

test('fighter characters: belly has more health, speed moves and punches faster, laugh reserves projectiles for command moves', () => {
  const games = Object.keys(CHARACTERS).map(character => harness({ character, multiplayer: true }).game);
  for (const game of games) { game.start(); game.controlDown('right'); advance(game, 0.3); game.controlUp('right'); }
  const [belly, speed, laugh] = games.map(game => game.getState());
  assert.ok(belly.players[0].maxHp > speed.players[0].maxHp);
  assert.ok(speed.players[0].x > belly.players[0].x && speed.players[0].x > laugh.players[0].x);
  tap(games[0], 'light'); tap(games[1], 'light');
  games[0].update(1 / 120); games[1].update(1 / 120);
  assert.ok(games[1].getState().players[0].attack.startup < games[0].getState().players[0].attack.startup);
  tap(games[2], 'heavy');
  advance(games[2], .8);
  assert.equal(games[2].getState().projectiles.length, 0, 'a heavy punch is a normal close-range attack');
  quarterCircle(games[2]);
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

test('fighter guarding: normals deal zero chip, heavy pressure eventually breaks guard, blocked hits generate meter', () => {
  const { game } = harness({ multiplayer: true });
  game.start(); approach(game); game.controlDown('block', 1);
  strikeAndRecover(game, 'heavy');
  const blocked = game.getState();
  assert.equal(blocked.stats.blockedHits[0], 1);
  assert.equal(blocked.stats.hits[0], 0);
  assert.equal(blocked.players[1].hp, blocked.players[1].maxHp);
  assert.ok(blocked.players[0].rage > 0 && blocked.players[1].rage > 0);
  strikeAndRecover(game, 'heavy');
  strikeAndRecover(game, 'heavy');
  strikeAndRecover(game, 'heavy');
  const broken = game.getState();
  assert.equal(broken.stats.blockedHits[0], 3);
  assert.equal(broken.stats.hits[0], 1, 'the fourth heavy cracks a held guard');
  assert.ok(broken.players[1].hp < blocked.players[1].hp - 20);
});

test('fighter crouching and jumping: crouch ducks standing laugh shots, jumps rise and return to the floor', () => {
  for (const crouch of [false, true]) {
    const { game } = harness({ multiplayer: true, character: 'laugh' });
    game.start();
    if (crouch) game.controlDown('crouch', 1);
    quarterCircle(game); advance(game, 2);
    const target = game.getState().players[1];
    if (crouch) assert.equal(target.hp, target.maxHp);
    else assert.ok(target.hp < target.maxHp);
  }
  const { game } = harness({ multiplayer: true });
  game.start(); const floor = game.getState().players[0].y;
  game.controlDown('jump'); advance(game, 0.2); game.controlUp('jump'); advance(game, .05);
  assert.ok(game.getState().players[0].y < floor - 85);
  assert.equal(game.getState().players[0].grounded, false);
  until(game, state => state.players[0].grounded, 2);
  assert.equal(game.getState().players[0].y, floor);
});

test('fighter meter: real punches earn a stock, separated hits are not a combo, and a super spends one stock', () => {
  const { game, sounds } = harness({ multiplayer: true });
  game.start(); tap(game, 'special');
  assert.equal(game.getState().players[0].attack, null);
  for (let i = 0; i < 7 && game.getState().players[0].rage < 100; i++) strikeAndRecover(game);
  const charged = game.getState();
  assert.equal(charged.players[0].rage, 100);
  assert.equal(charged.players[0].stocks, 1);
  assert.equal(charged.stats.bestCombo[0], 1, 'waiting through full recovery gives the opponent time to act');
  approach(game); const before = game.getState().players[1].hp;
  tap(game, 'special');
  assert.equal(game.getState().players[0].attack.type, 'special');
  const hit = until(game, state => state.players[1].hp < before, 2);
  assert.ok(before - hit.players[1].hp >= 40);
  assert.equal(hit.stats.specials[0], 1);
  assert.equal(hit.players[0].stocks, 0);
  assert.ok(hit.players[0].meter < 100);
  game.controlDown('special'); game.controlDown('special'); game.controlUp('special');
  advance(game, 1);
  assert.equal(game.getState().stats.specials[0], 1);
  assert.equal(sounds.filter(sound => sound === 'laugh:special').length, 1);
  assert.ok(!sounds.includes('laugh:combo'), 'isolated pokes do not announce a combo');
});

test('fighter meter: empty command moves grant the same energy for melee and projectile characters', () => {
  for (const character of ['belly', 'laugh']) {
    const { game } = harness({ multiplayer: true, character });
    game.start(); game.controlDown('crouch', 1);
    quarterCircle(game); advance(game, 2);
    const state = game.getState();
    assert.equal(state.stats.hits[0], 0);
    assert.equal(state.stats.whiffs[0], 1, character);
    assert.equal(state.players[0].meter, 2, character);
    assert.equal(state.projectiles.length, 0);
  }
});

test('fighter meter: three stocks are a real cap, without a hidden fourth stock refilling after MAX', () => {
  const { game } = harness({ multiplayer: true });
  game.start();
  for (let index = 0; index < 160; index++) {
    tap(game, 'light');
    until(game, state => state.players[0].attack, 1);
    until(game, state => !state.players[0].attack, 1);
  }
  const full = game.getState();
  assert.equal(full.phase, 'fighting');
  assert.equal(full.players[0].stocks, 3);
  assert.equal(full.players[0].meter, 0);
  assert.equal(full.stats.whiffs[0], 160);
  tap(game, 'max'); game.update(1 / 120);
  assert.equal(game.getState().players[0].stocks, 2);
  assert.equal(game.getState().players[0].meter, 0);
  assert.ok(game.getState().players[0].maxTime > 0);
});

test('fighter throws: a connected throw must recover and cannot cancel into a buffered super', () => {
  const { game } = harness({ multiplayer: true, training: true });
  game.start(); approach(game); tap(game, 'throw');
  until(game, state => state.stats.throws[0] === 1, 1);
  assert.equal(game.getState().players[0].attack.contact, 'hit');
  tap(game, 'special');
  assert.equal(game.getState().players[0].attack.type, 'throw');
  assert.equal(game.getState().stats.cancels[0], 0);
  advance(game, .2);
  assert.equal(game.getState().players[0].attack.type, 'throw', 'the throw still has recovery after the command buffer expires');
  until(game, state => !state.players[0].attack, 1);
  assert.equal(game.getState().stats.specials[0], 0, 'expired buffered super never appears later');
  tap(game, 'special');
  assert.equal(game.getState().players[0].attack.type, 'special');
  assert.equal(game.getState().stats.cancels[0], 0);
});

test('fighter rolls: a hit during roll startup interrupts it instead of carrying the defender into invulnerability', () => {
  const { game } = harness({ multiplayer: true, training: true });
  game.start(); approach(game); tap(game, 'light');
  until(game, state => state.players[0].attack?.age >= state.players[0].attack?.startup - .02, 1);
  tap(game, 'roll', 1);
  assert.ok(game.getState().players[1].rollTime > .5);
  const contact = until(game, state => state.stats.hits[0] === 1, 1);
  assert.ok(contact.players[1].hurtTime > 0);
  assert.equal(contact.players[1].rollTime, 0);
  until(game, state => state.hitStop === 0, 1); game.update(1 / 120);
  assert.equal(game.getState().players[1].movement, 'stunned');
  assert.equal(game.getState().players[1].rollTime, 0);
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
  game.update(1 / 120);
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

test('fighter animation: continuous movement clocks, isolated transitions, and render-only frames have no side effects', () => {
  const { game, sounds, frogs } = harness({ multiplayer: true });
  game.start();
  assert.equal(sounds.filter(sound => sound === 'laugh:start').length, 1);
  advance(game, 0.1);
  assert.equal(game.getState().players[0].animation.name, 'idle');
  game.controlDown('right');
  advance(game, 0.18);
  const running = game.getState().players[0].animation;
  assert.equal(running.name, 'run');
  assert.ok(running.time > 0.12);
  advance(game, 0.1);
  assert.ok(Math.abs(game.getState().players[0].animation.time - running.time - 0.1) < 1e-8);

  tap(game, 'heavy');
  game.update(1 / 120);
  const transition = game.getState().players[0].animation;
  assert.equal(transition.name, 'heavy');
  assert.equal(transition.previous.name, 'run');
  assert.ok(transition.time > 0 && transition.time <= 1 / 120);
  transition.previous.name = 'corrupted';
  assert.equal(game.getState().players[0].animation.previous.name, 'run');
  const beforeRender = game.getState(), beforeSounds = [...sounds];
  game.render(10); game.render(500);
  assert.deepEqual(game.getState(), beforeRender, 'render cannot advance a fighter animation');
  assert.deepEqual(sounds, beforeSounds, 'drawing must not trigger audio');
  const sprite = frogs.filter(frog => frog.size > 70).at(-2);
  assert.equal(sprite.pose.animation, 'heavy');
  assert.equal(sprite.pose.animationFrom.name, 'run');
  assert.equal(sprite.pose.animationProgress, transition.progress);
  assert.equal(sprite.pose.animationMix, transition.blend);
  assert.ok(Math.abs(sprite.y + sprite.size * 0.64 * sprite.pose.scaleY) < 1e-8, 'the sprite is aligned to its local foot anchor');
  assert.ok(frogs.filter(frog => frog.size > 70).at(-1).pose.scaleX < 0, 'player two faces left');
  game.cancelInput();
  advance(game, 1);
  assert.equal(game.getState().players[0].animation.name, 'idle');
});

test('fighter animation: light and heavy frame progress matches windup, contact and recovery without changing the move', () => {
  for (const action of ['light', 'heavy']) {
    const { game, sounds } = harness({ multiplayer: true });
    game.start();
    tap(game, action);
    game.update(1 / 120);
    let a = game.getState().players[0].animation;
    assert.equal(a.name, action);
    assert.equal(a.phase, 'startup');
    assert.ok(a.progress > 0 && a.progress < .05, 'the buffered attack begins in its first startup frame');
    advance(game, 0.05);
    a = game.getState().players[0].animation;
    assert.ok(a.progress > 0 && a.progress < 0.4);
    assert.ok(a.blend > 0.999);
    const active = until(game, state => state.players[0].animation.phase === 'active', 1);
    a = active.players[0].animation;
    assert.ok(a.progress >= 0.4 && a.progress < 0.65);
    assert.ok(Math.abs(a.time - active.players[0].attack.age) < 1e-8);
    const recovery = until(game, state => state.players[0].animation.phase === 'recovery', 1);
    assert.ok(recovery.players[0].animation.progress >= 0.65);
    until(game, state => !state.players[0].attack, 1);
    assert.equal(game.getState().stats.whiffs[0], 1);
    assert.ok(!sounds.includes('laugh:hurt'), 'an empty swing has no hurt laugh');
    assert.equal(sounds.filter(sound => sound === 'laugh:attack').length, 1);
    tap(game, action);
    game.update(1 / 120);
    assert.ok(game.getState().players[0].animation.time <= 1 / 120, 'a new punch starts at its first simulation frame');
    assert.ok(game.getState().players[0].animation.progress < .05);
  }
});

test('fighter animation: contact selects hurt immediately and freezes both sprite clocks during hit-stop', () => {
  const { game, sounds } = harness({ multiplayer: true });
  game.start(); approach(game); tap(game, 'light');
  const contact = until(game, state => state.hitStop > 0, 1);
  assert.equal(contact.players[1].animation.name, 'hurt');
  assert.equal(contact.players[1].animation.phase, 'impact');
  assert.ok(contact.players[1].animation.blend >= 0.8, 'the hit reaction is visible on the impact frame');
  assert.ok(sounds.includes('laugh:hurt'));
  const clocks = contact.players.map(player => player.animation.time);
  advance(game, 0.025);
  assert.deepEqual(game.getState().players.map(player => player.animation.time), clocks);
  until(game, state => state.hitStop === 0, 1);
  advance(game, 0.025);
  const resumed = game.getState();
  assert.ok(resumed.players[1].animation.time > clocks[1]);
  assert.notEqual(resumed.players[1].animation.offsetX, contact.players[1].animation.offsetX, 'recoil settles after the frozen contact frame');
  until(game, state => state.players[1].animation.name === 'idle', 2);
  assert.ok(Math.abs(game.getState().players[1].animation.scaleY - 1) < 0.04, 'hurt uses authored frames instead of prolonged vertical squashing');
});

test('fighter animation: guard, crouch, jump and landing share stable foot placement and pause clears held poses', () => {
  const { game, sounds, frogs } = harness({ multiplayer: true });
  game.start(); approach(game); game.controlDown('block', 1);
  assert.equal(game.getState().players[1].animation.name, 'guard');
  tap(game, 'light');
  until(game, state => state.stats.blockedHits[0] === 1, 1);
  assert.equal(game.getState().players[1].animation.state, 'guard-impact');
  assert.ok(sounds.includes('laugh:guard'));
  assert.ok(!sounds.includes('laugh:hurt'));
  advance(game, 0.6);
  assert.equal(game.getState().players[1].animation.state, 'guard');
  game.cancelInput();
  assert.notEqual(game.getState().players[1].animation.state, 'guard');
  advance(game, 0.3);
  game.controlDown('crouch'); advance(game, 0.2);
  let a = game.getState().players[0].animation;
  assert.equal(a.state, 'crouch');
  assert.ok(a.scaleY < 0.85);
  game.render(2);
  const crouched = frogs.filter(frog => frog.size > 70).at(-2);
  assert.ok(Math.abs(crouched.y + crouched.size * 0.64 * crouched.pose.scaleY) < 1e-8);
  game.controlUp('crouch'); tap(game, 'jump');
  assert.equal(game.getState().players[0].animation.name, 'jump');
  assert.equal(game.getState().players[0].animation.phase, 'ascent');
  until(game, state => state.players[0].animation.phase === 'descent', 1);
  until(game, state => state.players[0].grounded, 1);
  advance(game, 0.5);
  a = game.getState().players[0].animation;
  assert.equal(a.name, 'idle');
  assert.equal(a.footY, game.getState().players[0].y);
  assert.ok(Math.abs(a.scaleY - 1) < 0.02);
});

test('fighter animation: a real knockout starts winner laughter once and the next round resets animation state', () => {
  const { game, sounds } = harness({ multiplayer: true });
  game.start();
  const finished = defeatPassivePlayer(game, 0);
  assert.equal(finished.players[0].animation.name, 'laugh');
  assert.equal(finished.players[0].animation.state, 'victory');
  assert.equal(finished.players[1].animation.state, 'knockout');
  assert.equal(sounds.filter(sound => sound === 'laugh:victory').length, 1);
  advance(game, 0.5);
  assert.ok(game.getState().players[0].animation.time >= 0.49);
  game.render(1); game.render(2);
  assert.equal(sounds.filter(sound => sound === 'laugh:victory').length, 1);
  until(game, state => state.phase === 'fighting', 3);
  assert.ok(game.getState().players.every(player => player.animation.name === 'idle' && player.animation.time === 0));
  assert.equal(sounds.filter(sound => sound === 'laugh:start').length, 2);
  game.start();
  assert.ok(game.getState().players.every(player => player.animation.transitions === 0 && player.animation.previous === null));
});

test('fighter animation: the three charged specials use their own authored movement, punch or laughter frames', () => {
  for (const [character, name] of [['belly', 'heavy'], ['speed', 'dash'], ['laugh', 'laugh']]) {
    const { game, sounds } = harness({ multiplayer: true, character });
    game.start();
    for (let i = 0; i < 10 && game.getState().players[0].rage < 100; i++) strikeAndRecover(game);
    assert.equal(game.getState().players[0].rage, 100);
    const backward = game.getState().players[0].facing > 0 ? 'left' : 'right';
    game.controlDown(backward);
    until(game, state => Math.abs(state.players[0].x - state.players[1].x) > 250, 3);
    game.controlUp(backward); advance(game, .2);
    tap(game, 'special');
    const animation = game.getState().players[0].animation;
    assert.equal(animation.name, name);
    assert.equal(animation.state, 'special');
    assert.equal(animation.phase, 'startup');
    assert.equal(animation.progress, 0);
    assert.equal(sounds.filter(sound => sound === 'laugh:special').length, 1);
    const active = until(game, state => state.players[0].animation.phase === 'active', 1);
    assert.equal(active.players[0].animation.name, name);
    assert.ok(active.players[0].animation.progress >= 0.4);
  }
});
