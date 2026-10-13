import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../js/games/fighter.js';

const STEP = 1 / 120;

function harness(options = {}) {
  const config = { training: true, multiplayer: true, character: 'belly', opponentCharacter: 'belly', ...options };
  const results = [], sounds = [], draws = [];
  const noop = () => {};
  const ctx = new Proxy({ measureText: value => ({ width: String(value).length * 10 }) }, {
    get: (target, key) => key in target ? target[key] : noop,
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const game = createGame({ ctx, ...config, drawFrog: (...args) => draws.push(args),
    audio: { play: kind => sounds.push(kind) }, onEnd: result => results.push(result) });
  game.start(config);
  return { game, results, sounds, draws };
}

function advance(game, seconds) {
  for (let index = 0; index < Math.round(seconds / STEP); index += 1) game.update(STEP);
}

function until(game, predicate, seconds = 3, drive = () => {}) {
  for (let frame = 0; frame <= Math.ceil(seconds / STEP); frame += 1) {
    const state = game.getState();
    if (predicate(state)) return state;
    drive(game, state);
    game.update(STEP);
  }
  assert.fail(`Public-input condition timed out: ${JSON.stringify(game.getState())}`);
}

function tap(game, action, player = 0) {
  game.controlDown(action, player); game.controlUp(action, player);
}

function approach(game, player = 0, range = 80) {
  const origin = game.getState(), actor = origin.players[player], target = origin.players[1 - player];
  const forward = actor.x < target.x ? 'right' : 'left';
  game.controlDown(forward, player);
  until(game, state => Math.abs(state.players[player].x - state.players[1 - player].x) <= range, 4);
  game.controlUp(forward, player);
  advance(game, 0.075);
}

function recover(game, player = 0) {
  return until(game, state => !state.players[player].attack && !state.players[player].airborne
    && state.players[player].hurtTime <= 0 && !state.players[player].knockdown, 4);
}

function quarterCircle(game, attack = 'light', player = 0) {
  const forward = game.getState().players[player].facing > 0 ? 'right' : 'left';
  game.controlDown('crouch', player); advance(game, 0.025);
  game.controlDown(forward, player); advance(game, 0.025);
  game.controlUp('crouch', player); tap(game, attack, player); game.update(STEP);
  game.controlUp(forward, player);
}

function jumpFlight({ hold = 0.025, running = false, crouched = false } = {}) {
  const { game } = harness();
  const initial = game.getState().players[0];
  if (crouched) { game.controlDown('crouch'); advance(game, 0.08); game.controlUp('crouch'); }
  if (running) { tap(game, 'right'); advance(game, 0.06); game.controlDown('right'); advance(game, 0.14); }
  else { game.controlDown('right'); advance(game, 0.14); }
  const startX = game.getState().players[0].x;
  game.controlDown('jump');
  let highest = initial.y, elapsed = 0, launched = false, launchVx = 0;
  for (let frame = 0; frame < 3 / STEP; frame += 1) {
    if (elapsed >= hold) game.controlUp('jump');
    game.update(STEP); elapsed += STEP;
    const state = game.getState().players[0];
    highest = Math.min(highest, state.y);
    if (state.airborne && !launched) { launched = true; launchVx = Math.abs(state.vx); }
    if (launched && !state.airborne) return { height: initial.y - highest, duration: elapsed, distance: state.x - startX, launchVx };
  }
  assert.fail('A legal jump did not land');
}

test('fighter98: backward walking keeps opponent-facing posture and is symmetric for both players', () => {
  const { game } = harness();
  const before = game.getState();
  game.controlDown('left', 0); game.controlDown('right', 1); advance(game, 0.24);
  const after = game.getState();
  for (const player of after.players) assert.equal(player.movement, 'backwalk');
  assert.equal(after.players[0].facing, 1);
  assert.equal(after.players[1].facing, -1);
  const leftDistance = before.players[0].x - after.players[0].x;
  const rightDistance = after.players[1].x - before.players[1].x;
  assert.ok(leftDistance > 15 && rightDistance > 15);
  assert.ok(Math.abs(leftDistance - rightDistance) < 0.01, 'equal characters retreat equally on either side');
  const forward = harness().game, forwardStart = forward.getState();
  forward.controlDown('right', 0); forward.controlDown('left', 1); advance(forward, 0.24);
  assert.ok(forward.getState().players[0].x - forwardStart.players[0].x > leftDistance, 'forward walk is faster than retreat');
});

test('fighter98: jump and either punch accept both same-frame input orders on both sides', () => {
  for (const player of [0, 1]) for (const attack of ['light', 'heavy']) for (const order of [['jump', attack], [attack, 'jump']]) {
    const { game } = harness();
    for (const action of order) game.controlDown(action, player);
    game.update(STEP); // One simulation tick coalesces simultaneous direction/attack edges.
    const state = until(game, value => value.players[player].airborne, 0.2);
    const actor = state.players[player];
    assert.ok(actor.attack, `${player + 1}P ${order.join(' → ')} must retain its attack`);
    assert.equal(actor.attack.type, attack);
    assert.equal(actor.attack.airborne, true);
    assert.equal(actor.attack.context, 'air');
    assert.equal(actor.attack.height, 'high');
    assert.equal(actor.facing, player === 0 ? 1 : -1);
  }
});

test('fighter98: jump punches really hit before landing, rather than only changing the displayed pose', () => {
  for (const attack of ['light', 'heavy']) {
    const { game } = harness(); approach(game);
    const before = game.getState();
    game.controlDown('jump'); game.controlDown(attack); game.controlUp(attack);
    advance(game, 0.025); game.controlUp('jump');
    const hit = until(game, state => state.stats.hits[0] > before.stats.hits[0], 1.2);
    assert.equal(hit.players[0].airborne, true, `${attack}: damage must occur while the attacker is airborne`);
    assert.equal(hit.players[0].attack?.context, 'air');
    assert.ok(hit.stats.damage[0] > before.stats.damage[0], `${attack}: training damage counter proves contact`);
    assert.ok(hit.players[1].hurtTime > 0);
    assert.ok(hit.hitStop > 0);
    assert.equal(hit.players[1].hp, hit.players[1].maxHp, 'training preserves health while still recording the hit');
  }
});

test('fighter98: attacks and released directions preserve horizontal air momentum', () => {
  for (const player of [0, 1]) {
    const { game } = harness();
    const forward = player === 0 ? 'right' : 'left';
    game.controlDown(forward, player); advance(game, 0.18);
    game.controlDown('jump', player); advance(game, 0.08);
    game.controlUp(forward, player);
    const airborne = game.getState().players[player];
    assert.equal(airborne.airborne, true);
    assert.ok(Math.abs(airborne.vx) > 60);
    tap(game, 'heavy', player);
    game.update(STEP);
    const attacking = game.getState().players[player];
    assert.equal(attacking.attack?.context, 'air');
    assert.ok(Math.abs(attacking.vx) >= Math.abs(airborne.vx) * 0.9, 'starting an aerial attack does not zero vx');
    advance(game, 0.12);
    const later = game.getState().players[player];
    assert.ok((later.x - airborne.x) * (player === 0 ? 1 : -1) > 6);
    assert.equal(later.airborne, true);
  }
});

test('fighter98: crossing overhead retains takeoff facing and turns toward the opponent upon landing', () => {
  const { game } = harness(); approach(game, 0, 95);
  const originalFacing = game.getState().players[0].facing;
  game.controlDown('right'); game.controlDown('jump');
  const crossed = until(game, state => state.players[0].airborne && state.players[0].x > state.players[1].x + 12, 1.5,
    (_game, state) => { if (state.players[0].airborne) assert.equal(state.players[0].facing, originalFacing); });
  assert.equal(crossed.players[0].facing, originalFacing);
  game.controlUp('right'); game.controlUp('jump');
  const landed = until(game, state => !state.players[0].airborne, 2);
  assert.ok(landed.players[0].x > landed.players[1].x);
  assert.equal(landed.players[0].facing, -1);
  assert.equal(landed.players[1].facing, 1);
});

test('fighter98: taps, held jumps, crouch-loaded jumps and running jumps have distinct real trajectories', () => {
  const hop = jumpFlight({ hold: 0.025 });
  const normal = jumpFlight({ hold: 0.5 });
  const high = jumpFlight({ hold: 0.5, crouched: true });
  const running = jumpFlight({ hold: 0.5, running: true });
  assert.ok(normal.height > hop.height * 1.25, 'holding jump rises higher than a short tap');
  assert.ok(normal.duration > hop.duration);
  assert.ok(high.height > normal.height * 1.08, 'crouch input loads a higher jump');
  assert.ok(running.launchVx > normal.launchVx * 1.15, 'forward-forward gives a faster takeoff');
  assert.ok(running.distance > normal.distance * 1.15);
});

test('fighter98: standing and crouching guards block mid attacks, but low kicks open a standing guard', () => {
  for (const crouching of [false, true]) for (const attack of ['light', 'lightKick']) {
    const { game } = harness(); approach(game);
    game.controlDown('block', 1);
    if (crouching) game.controlDown('crouch', 1);
    if (attack === 'lightKick') game.controlDown('crouch', 0);
    tap(game, attack);
    const contact = until(game, state => state.stats.hits[0] + state.stats.blockedHits[0] > 0, 2);
    const shouldBlock = attack === 'light' || crouching;
    assert.equal(contact.stats.blockedHits[0] > 0, shouldBlock, `${crouching ? 'crouch' : 'stand'} guard versus ${attack}`);
    assert.equal(contact.stats.hits[0] > 0, !shouldBlock);
  }
});

test('fighter98: retreat guards facing attacks without changing the facing direction', () => {
  const { game } = harness(); approach(game, 0, 74);
  game.controlDown('right', 1);
  assert.equal(game.getState().players[1].facing, -1);
  tap(game, 'light');
  const contact = until(game, state => state.stats.blockedHits[0] > 0, 1);
  assert.equal(contact.players[1].facing, -1);
  assert.equal(contact.stats.hits[0], 0);
});

test('fighter98: a descending jump attack is blocked standing and opens a crouching guard', () => {
  for (const crouching of [false, true]) {
    const { game } = harness(); approach(game);
    const floor = game.getState().players[0].y;
    game.controlDown('block', 1);
    if (crouching) game.controlDown('crouch', 1);
    game.controlDown('jump'); advance(game, 0.025); game.controlUp('jump');
    until(game, state => state.players[0].airborne && state.players[0].vy > 0 && state.players[0].y >= floor - 55, 1.5);
    tap(game, 'light');
    const contact = until(game, state => state.stats.hits[0] + state.stats.blockedHits[0] > 0, 1);
    assert.equal(contact.players[0].airborne, true, 'guard classification is exercised by a real airborne hit');
    assert.equal(contact.players[0].attack?.height, 'high');
    assert.equal(contact.stats.blockedHits[0] > 0, !crouching);
    assert.equal(contact.stats.hits[0] > 0, crouching);
  }
});

test('fighter98: forward-forward runs, back-back retreats quickly, and cancelling clears tap history', () => {
  for (const player of [0, 1]) {
    const { game } = harness();
    const forward = player === 0 ? 'right' : 'left', back = player === 0 ? 'left' : 'right';
    tap(game, forward, player); advance(game, 0.05); game.controlDown(forward, player); advance(game, 0.08);
    assert.equal(game.getState().players[player].movement, 'run');
    game.cancelInput(); advance(game, 0.25);
    tap(game, back, player); advance(game, 0.05); game.controlDown(back, player); advance(game, 0.025);
    assert.equal(game.getState().players[player].movement, 'backstep');
    game.cancelInput(); advance(game, 0.75);
    // A tap before opening pause must not turn the first post-pause press into
    // a run/backstep: cancelInput clears the gesture history as well as holds.
    tap(game, forward, player); game.cancelInput();
    game.controlDown(forward, player); advance(game, 0.1);
    assert.equal(game.getState().players[player].movement, 'walk');
  }
});

test('fighter98: rolls can be thrown, while a timely throw input breaks a normal throw', () => {
  const rolling = harness().game; approach(rolling, 0, 75);
  tap(rolling, 'roll', 0);
  assert.equal(rolling.getState().players[0].movement, 'roll');
  tap(rolling, 'throw', 1);
  const thrown = until(rolling, state => state.stats.damage[1] > 0, 1.5);
  assert.ok(thrown.players[0].knockdown, 'rolling invulnerability does not protect against a throw');
  const teched = harness().game; approach(teched, 0, 75);
  tap(teched, 'throw', 0); advance(teched, 0.05); tap(teched, 'throw', 1);
  advance(teched, 0.65);
  assert.equal(teched.getState().stats.damage[0], 0);
  assert.equal(teched.getState().stats.damage[1], 0);
  assert.ok(teched.getState().players.every(player => !player.knockdown));
});

test('fighter98: a real quarter-circle cancels a connected normal and combos inside hitstun', () => {
  const { game } = harness(); approach(game);
  tap(game, 'light');
  const first = until(game, state => state.stats.hits[0] === 1);
  assert.equal(first.players[0].combo, 1);
  assert.ok(first.players[1].hurtTime > 0);
  const originalAttack = first.players[0].attack.id;
  quarterCircle(game);
  const cancel = game.getState();
  assert.equal(cancel.players[0].attack?.type, 'command');
  assert.notEqual(cancel.players[0].attack.id, originalAttack);
  assert.equal(cancel.stats.cancels[0], 1);
  const combo = until(game, state => state.stats.hits[0] >= 2, 2);
  assert.ok(combo.players[0].combo >= 2);
  assert.ok(combo.stats.bestCombo[0] >= 2);
  assert.ok(combo.stats.damage[0] > first.stats.damage[0]);
  recover(game); advance(game, 1); approach(game);
  tap(game, 'light');
  const separate = until(game, state => state.stats.hits[0] > combo.stats.hits[0], 2);
  assert.equal(separate.players[0].combo, 1, 'a hit after recovery starts a new combo, even if the previous counter was larger');
});

test('fighter98: blocked normals deal no chip damage, while a blocked command move does', () => {
  const { game } = harness({ training: false }); approach(game);
  const originalHp = game.getState().players[1].hp;
  game.controlDown('block', 1); tap(game, 'light');
  const normal = until(game, state => state.stats.blockedHits[0] === 1);
  assert.equal(normal.players[1].hp, originalHp);
  assert.equal(normal.stats.damage[0], 0);
  recover(game); approach(game);
  quarterCircle(game);
  assert.equal(game.getState().players[0].attack?.type, 'command');
  const command = until(game, state => state.stats.blockedHits[0] >= 2, 2);
  assert.ok(command.players[1].hp < originalHp);
  assert.ok(command.stats.damage[0] > 0);
  assert.equal(command.stats.hits[0], 0, 'chip damage remains a blocked hit, not a successful combo hit');
});

test('fighter98: normal play earns stocks, then MAX and its super each spend one stock', () => {
  const { game } = harness({ training: false });
  tap(game, 'max'); tap(game, 'special'); game.update(STEP);
  assert.equal(game.getState().players[0].maxTime, 0);
  assert.equal(game.getState().players[0].attack, null, 'no stock means no free super');
  for (let turn = 0; turn < 105 && game.getState().players[0].stocks < 2; turn += 1) {
    tap(game, 'light'); game.update(STEP); recover(game);
    const actor = game.getState().players[0];
    assert.ok(actor.stocks >= 0 && actor.stocks <= 3);
    assert.ok(actor.meter >= 0 && actor.meter <= 100);
  }
  const charged = game.getState();
  assert.equal(charged.players[0].stocks, 2);
  assert.ok(charged.stats.whiffs[0] > 0);
  assert.equal(charged.players[1].hp, charged.players[1].maxHp);
  tap(game, 'max');
  assert.equal(game.getState().players[0].stocks, 1);
  assert.ok(game.getState().players[0].maxTime > 7);
  tap(game, 'special'); game.update(STEP);
  const superState = game.getState();
  assert.equal(superState.players[0].attack?.type, 'special');
  assert.equal(superState.players[0].maxTime, 0);
  assert.equal(superState.players[0].stocks, 0, 'the MAX super spends another stock');
  assert.equal(superState.stats.specials[0], 1);
  recover(game);
  for (let turn = 0; turn < 55 && game.getState().players[0].stocks === 0; turn += 1) {
    tap(game, 'light'); game.update(STEP); recover(game);
  }
  assert.equal(game.getState().players[0].stocks, 1);
  tap(game, 'max'); tap(game, 'special'); game.update(STEP);
  assert.equal(game.getState().players[0].stocks, 0);
  assert.equal(game.getState().players[0].attack, null, 'MAX with no remaining stock cannot produce a free super');
  assert.ok(game.getState().players[0].maxTime > 0);
});

test('fighter98: simultaneous AB, ABC and CD resolve as roll, MAX and blowback', () => {
  const roll = harness().game;
  roll.controlDown('light'); roll.controlDown('lightKick'); roll.update(STEP);
  assert.equal(roll.getState().players[0].movement, 'roll');
  assert.equal(roll.getState().players[0].attack, null);
  assert.equal(roll.getState().stats.rolls[0], 1);
  roll.controlUp('light'); roll.controlUp('lightKick'); advance(roll, 0.8);
  assert.equal(roll.getState().stats.whiffs[0], 0, 'the chord does not leave a normal punch queued');
  const max = harness().game;
  for (const action of ['light', 'lightKick', 'heavy']) max.controlDown(action);
  max.update(STEP);
  assert.ok(max.getState().players[0].maxTime > 7);
  assert.equal(max.getState().players[0].attack, null);
  assert.equal(max.getState().stats.rolls[0], 0, 'ABC does not accidentally consume its AB prefix as a roll');
  const blowback = harness().game; approach(blowback);
  blowback.controlDown('heavy'); blowback.controlDown('heavyKick'); blowback.update(STEP);
  assert.equal(blowback.getState().players[0].attack?.type, 'blowback');
  const hit = until(blowback, state => state.stats.hits[0] > 0);
  assert.ok(hit.players[1].knockdown > 0);
});

test('fighter98: training permits MAX and supers without running out of health or stocks', () => {
  const { game, results } = harness({ multiplayer: false });
  assert.equal(game.getState().training, true);
  assert.equal(game.getState().players[0].stocks, 3);
  tap(game, 'max');
  assert.ok(game.getState().players[0].maxTime > 7);
  approach(game);
  tap(game, 'special');
  game.update(STEP);
  assert.equal(game.getState().players[0].attack?.type, 'special');
  const hit = until(game, state => state.stats.damage[0] > 0, 2);
  assert.equal(hit.players[0].maxTime, 0, 'MAX super consumes the MAX state');
  assert.ok(hit.players.every(player => player.hp === player.maxHp));
  assert.ok(hit.players.every(player => player.stocks === 3));
  recover(game);
  tap(game, 'max'); advance(game, 8.5);
  assert.equal(game.getState().players[0].maxTime, 0);
  advance(game, 100);
  assert.equal(game.getState().phase, 'fighting');
  assert.equal(results.length, 0);
});

test('fighter98: the 99-second competitive clock ends an inactive round and render cannot advance it', () => {
  const { game } = harness({ training: false });
  assert.equal(game.getState().timer, 99);
  advance(game, 0.5);
  const before = game.getState();
  game.render(10); game.render(1000);
  assert.deepEqual(game.getState(), before, 'pause/render-only time cannot alter fighter state');
  assert.ok(before.timer < 99 && before.timer > 98);
  const expired = until(game, state => state.phase !== 'fighting' || state.round > 1, 100);
  assert.ok(expired.timer <= 0 || expired.round > 1);
});

test('fighter98: expanded keyboard controls and cancellation release both players without replaying buffered attacks', () => {
  const bindings = [['KeyU', 'lightKick', 0], ['KeyI', 'heavyKick', 0], ['Digit4', 'lightKick', 1], ['Digit5', 'heavyKick', 1]];
  for (const [code, action, player] of bindings) {
    const { game } = harness();
    assert.equal(game.keyDown({ code }), true);
    game.update(STEP);
    assert.equal(game.getState().players[player].attack?.type, action);
    game.keyUp({ code });
  }
  for (const [code, player] of [['KeyO', 0], ['Digit0', 1]]) {
    const { game } = harness(); game.keyDown({ code });
    assert.equal(game.getState().players[player].movement, 'roll'); game.keyUp({ code });
  }
  for (const [code, player] of [['KeyN', 0], ['Digit9', 1]]) {
    const { game } = harness(); game.keyDown({ code });
    assert.ok(game.getState().players[player].maxTime > 0); game.keyUp({ code });
  }
  const { game } = harness();
  game.keyDown({ code: 'KeyD' }); game.keyDown({ code: 'ArrowLeft' });
  game.keyDown({ code: 'KeyL' }); game.keyDown({ code: 'Digit3' });
  game.cancelInput();
  assert.ok(game.getState().held.every(input => Object.values(input).every(value => !value)));
  advance(game, 0.6);
  assert.ok(game.getState().players.every(player => !player.blocking && !player.attack));
  const resting = game.getState().players.map(player => player.x);
  advance(game, 0.3);
  assert.deepEqual(game.getState().players.map(player => player.x), resting);
});
