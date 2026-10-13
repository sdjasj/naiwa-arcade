import test from 'node:test';
import assert from 'node:assert/strict';
import { createFighterInput } from '../js/games/fighter-input.js';

const STEP = 1 / 120;
function stick(input, value, time, facing = 1) {
  const x = ((value - 1) % 3 - 1) * facing;
  const y = Math.floor((value - 1) / 3) - 1;
  const wanted = { left: x < 0, right: x > 0, jump: y > 0, crouch: y < 0 };
  const held = input.getState().held;
  for (const action of Object.keys(wanted)) if (held[action] && !wanted[action]) input.up(action, time, facing);
  for (const action of Object.keys(wanted)) if (!held[action] && wanted[action]) input.down(action, time, facing);
}
function motion(input, sequence, { start = 0, step = .06, facing = 1 } = {}) {
  for (let i = 0; i < sequence.length; i++) {
    stick(input, Number(sequence[i]), start + step * i, facing);
    input.sample(start + step * i, facing);
  }
  return start + step * (sequence.length - 1);
}
function press(input, attack, time, facing = 1) {
  input.down(attack, time, facing);
  return input.sample(time + STEP, facing).commands;
}

test('fighter input: neutral and all eight directions normalize at input time for either facing', () => {
  for (const facing of [1, -1]) {
    const input = createFighterInput();
    for (let value = 1; value <= 9; value++) {
      stick(input, value, value * .1, facing);
      assert.equal(input.sample(value * .1, facing).direction, value);
    }
    const log = input.getState().history;
    assert.ok(log.length > 0);
    assert.ok(log.every(item => item.facing === facing));
  }
});

test('fighter input: conflicting directions neutralize, repeated down edges and button releases never attack', () => {
  const input = createFighterInput();
  input.down('left', 0, 1); input.down('right', 0, 1);
  input.down('jump', 0, 1); input.down('crouch', 0, 1);
  assert.equal(input.sample(0, 1).direction, 5);
  assert.equal(input.down('light', .01, 1), true);
  assert.equal(input.down('light', .01, 1), false);
  assert.deepEqual(input.sample(.01, 1).commands, [], 'same-frame attacks wait one simulation step');
  input.up('light', .01, 1);
  assert.deepEqual(input.sample(.02, 1).commands.map(item => item.type), ['attack']);
  assert.deepEqual(input.sample(.03, 1).commands, []);
  assert.equal(input.up('light', .04, 1), false);
  assert.deepEqual(input.sample(.05, 1).commands, []);
});

test('fighter input: true double taps run forward and backstep backward, with mirrored world direction', () => {
  for (const facing of [1, -1]) for (const direction of [4, 6]) {
    const input = createFighterInput();
    stick(input, direction, 0, facing);
    assert.deepEqual(input.sample(0, facing).commands, []);
    stick(input, 5, .07, facing);
    stick(input, direction, .14, facing);
    const [command] = input.sample(.14, facing).commands;
    assert.equal(command.type, direction === 6 ? 'run' : 'backstep');
    assert.equal(command.direction, (direction === 6 ? 1 : -1) * facing);
    assert.equal(command.expiresAt, .14 + input.getState().timing.buttonBuffer);
    assert.deepEqual(input.sample(.15, facing).commands, [], 'double tap emits once');
  }
});

test('fighter input: holds, expired taps, intervening crouches and release-generated directions cannot dash', () => {
  const input = createFighterInput();
  input.down('right', 0, 1);
  for (let i = 1; i <= 10; i++) input.down('right', i * .01, 1);
  assert.deepEqual(input.sample(.1, 1).commands, []);
  input.up('right', .11, 1); input.down('right', .4, 1);
  assert.deepEqual(input.sample(.4, 1).commands, []);
  input.up('right', .42, 1); input.down('crouch', .44, 1); input.up('crouch', .46, 1); input.down('right', .48, 1);
  assert.deepEqual(input.sample(.48, 1).commands, []);
  input.down('crouch', .5, 1); input.up('crouch', .52, 1);
  assert.deepEqual(input.sample(.52, 1).commands, [], 'releasing crouch into forward does not count as a tap');
});

test('fighter input: 236/214/623 recognize all punch/kick strengths on both sides', () => {
  for (const facing of [1, -1]) for (const direction of ['236', '214', '623']) {
    for (const attack of ['light', 'heavy', 'lightKick', 'heavyKick']) {
      const input = createFighterInput();
      const end = motion(input, direction, { facing });
      const commands = press(input, attack, end + .01, facing);
      assert.equal(commands.length, 1);
      assert.equal(commands[0].type, 'command');
      assert.equal(commands[0].direction, direction);
      assert.equal(commands[0].attack, attack);
      assert.equal(commands[0].strength, attack.startsWith('heavy') ? 'heavy' : 'light');
    }
  }
});

test('fighter input: double quarter-circle has priority over its final quarter-circle and Z-motion suffix', () => {
  for (const facing of [1, -1]) {
    const input = createFighterInput();
    const end = motion(input, '236236', { facing });
    const [command] = press(input, 'heavyKick', end + .01, facing);
    assert.equal(command.type, 'super');
    assert.equal(command.direction, '236236');
    assert.equal(command.strength, 'heavy');
    assert.deepEqual(input.sample(end + .05, facing).commands, []);
  }
});

test('fighter input: natural diagonal transitions and a brief neutral finish retain valid motions', () => {
  for (const [sequence, expected] of [['6323', '623'], ['6236', '623'], ['2363236', '236236'], ['2356', '236']]) {
    const input = createFighterInput();
    const end = motion(input, sequence, { step: .04 });
    stick(input, 5, end + .01);
    const [command] = press(input, 'light', end + .07);
    assert.equal(command.direction, expected, sequence);
  }
});

test('fighter input: incomplete, polluted, slow and stale directional sequences remain normal attacks', () => {
  for (const [sequence, step, delay] of [['26', .06, .01], ['2136', .06, .01], ['236', .3, .01], ['236', .06, .3]]) {
    const input = createFighterInput();
    const end = motion(input, sequence, { step });
    const [command] = press(input, 'light', end + delay);
    assert.equal(command.type, 'attack', `${sequence} step=${step} delay=${delay}`);
    assert.equal(command.direction, undefined);
  }
});

test('fighter input: a held initial crouch can begin a motion, but a held middle diagonal cannot preserve it', () => {
  const input = createFighterInput();
  stick(input, 2, 0);
  input.sample(5, 1);
  stick(input, 3, 5.02);
  stick(input, 6, 5.08);
  assert.equal(press(input, 'light', 5.09)[0].direction, '236');
  input.reset();
  stick(input, 2, 0);
  input.down('right', .1, 1); input.up('right', .1, 1);
  stick(input, 3, .4); stick(input, 6, .46);
  assert.equal(press(input, 'light', .47)[0].direction, '236', 'a same-frame direction flicker does not shorten a held initial crouch');
  input.reset();
  stick(input, 2, 0); stick(input, 3, .06);
  input.sample(5, 1);
  stick(input, 6, 5.02);
  assert.equal(press(input, 'light', 5.03)[0].type, 'attack');
});

test('fighter input: same-frame attack/direction order resolves identically without emitting an early normal', () => {
  const results = [];
  for (const attackFirst of [true, false]) {
    const input = createFighterInput();
    motion(input, '23');
    if (attackFirst) { input.down('heavy', .12, 1); assert.deepEqual(input.sample(.12, 1).commands, []); }
    input.up('crouch', .12, 1);
    if (!attackFirst) input.down('heavy', .12, 1);
    assert.deepEqual(input.sample(.12, 1).commands, []);
    results.push(input.sample(.12 + STEP, 1).commands);
  }
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0][0].direction, '236');
});

test('fighter input: simultaneous buttons coalesce independently of order and preserve held state for core chords', () => {
  const results = [];
  for (const actions of [['lightKick', 'heavy', 'light'], ['light', 'heavy', 'lightKick']]) {
    const input = createFighterInput();
    actions.forEach(action => input.down(action, .1, 1));
    const state = input.sample(.1 + STEP, 1);
    assert.equal(state.held.light, true); assert.equal(state.held.lightKick, true); assert.equal(state.held.heavy, true);
    assert.equal(state.commands.length, 1);
    results.push(state.commands[0]);
  }
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].attack, 'heavy');
});

test('fighter input: directional motions are consumed once and cannot be recycled by another attack button', () => {
  const input = createFighterInput();
  const end = motion(input, '236');
  assert.equal(press(input, 'light', end + .01)[0].type, 'command');
  input.up('light', end + .03, 1);
  assert.equal(press(input, 'heavy', end + .04)[0].type, 'attack');
});

test('fighter input: facing changes cannot reinterpret an old motion or tap; fresh mirrored motions work', () => {
  const input = createFighterInput();
  motion(input, '236');
  input.sample(.13, -1);
  assert.equal(press(input, 'light', .14, -1)[0].type, 'attack');
  input.up('light', .16, -1);
  const end = motion(input, '236', { start: .2, facing: -1 });
  assert.equal(press(input, 'heavy', end + .01, -1)[0].direction, '236');
  input.reset();
  input.down('right', 0, 1); input.up('right', .03, 1);
  input.down('left', .08, -1);
  assert.deepEqual(input.sample(.08, -1).commands, []);
});

test('fighter input: pending attacks have a finite buffer; reset clears paused/restarted input and tap history', () => {
  const input = createFighterInput();
  input.down('light', 0, 1); input.up('light', .001, 1);
  const [buffered] = input.sample(.1, 1).commands;
  assert.equal(buffered.type, 'attack');
  assert.equal(buffered.time, 0);
  assert.equal(buffered.expiresAt, .14);
  input.down('heavy', .2, 1);
  assert.deepEqual(input.sample(.4, 1).commands, [], 'expired input does not fire after a long recovery');
  input.down('right', .5, 1); input.up('right', .55, 1);
  input.down('lightKick', .56, 1);
  input.reset();
  assert.ok(Object.values(input.getState().held).every(value => !value));
  assert.deepEqual(input.getState().pending, []);
  assert.deepEqual(input.getState().history, []);
  input.down('right', .6, 1);
  assert.deepEqual(input.sample(.6, 1).commands, [], 'first forward after pause is a walk');
});

test('fighter input: snapshots cannot mutate state; two players stay independent and history stays bounded', () => {
  const a = createFighterInput(), b = createFighterInput();
  for (let i = 0; i < 500; i++) {
    stick(a, i % 2 ? 2 : 6, i * .001);
    a.down('light', i * .001, 1); a.up('light', i * .001, 1);
  }
  const state = a.getState();
  assert.ok(state.history.length <= 48); assert.ok(state.log.length <= 48); assert.ok(state.pending.length <= 16);
  state.held.left = true; state.history[0].direction = 99; state.log[0].kind = 'bad'; state.pending[0].action = 'bad';
  assert.equal(a.getState().held.left, false);
  assert.ok(a.getState().history.every(point => point.direction <= 9));
  assert.ok(a.getState().log.every(item => item.kind !== 'bad'));
  assert.ok(a.getState().pending.every(item => item.action !== 'bad'));
  assert.equal(b.getState().history.length, 0);
  assert.ok(Object.values(b.getState().held).every(value => !value));
});

test('fighter input: invalid actions/timestamps and backward clocks cannot mutate or release live input', () => {
  const input = createFighterInput();
  input.down('right', 1, 1);
  for (const time of [NaN, Infinity, -1, .5]) {
    assert.equal(input.down('light', time, 1), false);
    assert.equal(input.up('right', time, 1), false);
    assert.deepEqual(input.sample(time, 1).commands, []);
  }
  assert.equal(input.down('toString', 1, 1), false);
  assert.equal(input.down('unknown', 1, 1), false);
  assert.equal(input.getState().held.right, true);
  assert.equal(input.getState().held.light, false);
});
