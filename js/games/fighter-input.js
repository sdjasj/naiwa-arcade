// Original, forgiving keyboard/touch input timing. These windows are chosen for
// this game; they are not claimed to reproduce SNK's internal frame tables.
const ACTIONS = ['left', 'right', 'jump', 'crouch', 'light', 'heavy', 'lightKick', 'heavyKick', 'block', 'special', 'roll', 'throw', 'max'];
const ATTACKS = ['heavy', 'heavyKick', 'light', 'lightKick'];
const DIRECTIONS = ['left', 'right', 'jump', 'crouch'];
const EPSILON = 1e-7;
const emptyHeld = () => Object.fromEntries(ACTIONS.map(action => [action, false]));

/** One independent instance per fighter. All times are simulation seconds.
 * sample() consumes commands once. Core combat may retain them until expiresAt
 * while waiting for recovery; reset() discards everything on pause/round reset.
 * Facing is normalized at each input edge, never retroactively during matching.
 */
export function createFighterInput(options = {}) {
  const setting = (name, fallback, low, high) => Number.isFinite(options[name])
    ? Math.min(high, Math.max(low, options[name])) : fallback;
  const timing = {
    motionWindow: setting('motionWindow', .5, .15, 1),
    superWindow: setting('superWindow', .85, .3, 1.5),
    stepWindow: setting('stepWindow', .22, .05, .5),
    finishWindow: setting('finishWindow', .16, .03, .3),
    doubleTapWindow: setting('doubleTapWindow', .25, .08, .5),
    buttonBuffer: setting('buttonBuffer', .14, .03, .4),
    coalesceWindow: setting('coalesceWindow', 1 / 120, 0, .03),
  };
  const historyLimit = Math.floor(setting('historyLimit', 48, 12, 96));
  const historyAge = Math.max(timing.superWindow, timing.motionWindow) + timing.buttonBuffer;
  let held, facing, direction, time, epoch, serial, history, log, pending, commands, lastTap;

  function reset() {
    held = emptyHeld(); facing = 1; direction = 5; time = 0; epoch = 0; serial = 0;
    history = []; log = []; pending = []; commands = []; lastTap = null;
  }
  reset();
  function relativeDirection() {
    return 5 + (Number(held.right) - Number(held.left)) * facing
      + (Number(held.jump) - Number(held.crouch)) * 3;
  }
  function prune() {
    const active = history.at(-1);
    history = history.filter(item => item === active || time - (item.endTime ?? item.time) <= historyAge + EPSILON).slice(-historyLimit);
    log = log.filter(item => time - item.time <= 2 + EPSILON).slice(-historyLimit);
    pending = pending.filter(item => time <= item.expiresAt + EPSILON).slice(-16);
    commands = commands.filter(item => time <= item.expiresAt + EPSILON).slice(-16);
    if (lastTap && time - lastTap.time > timing.doubleTapWindow + EPSILON) lastTap = null;
  }
  function sync(nextTime, nextFacing) {
    if (!Number.isFinite(nextTime) || nextTime < 0 || nextTime + EPSILON < time) return false;
    time = Math.max(time, nextTime);
    const side = nextFacing === -1 ? -1 : nextFacing === 1 ? 1 : facing;
    if (side !== facing) {
      facing = side; epoch++; history = []; lastTap = null;
      commands = commands.filter(item => item.type !== 'run' && item.type !== 'backstep');
      // Held movement changes its relative meaning, but a cross-up is not a
      // newly pressed direction and cannot complete a motion or double tap.
      direction = relativeDirection();
    }
    prune();
    return true;
  }
  function appendLog(item) {
    log.push({ ...item, time, facing, epoch });
    if (log.length > historyLimit) log.shift();
  }
  function recordDirection() {
    const next = relativeDirection();
    if (next === direction) return;
    if (history.at(-1)?.direction === direction) history[history.length - 1].endTime = time;
    direction = next;
    const entry = { direction, time, facing, epoch, serial: ++serial };
    // DOM key/pointer callbacks can report two simultaneous releases in either
    // order. Store that simulation instant's final stick position, not a fake
    // intermediate diagonal/cardinal that the player never held for a frame.
    if (history.at(-1)?.epoch === epoch && Math.abs(history.at(-1).time - time) < EPSILON) history[history.length - 1] = entry;
    else history.push(entry);
    if (history.length > historyLimit) history.shift();
    appendLog({ kind: 'direction', direction });
    if (lastTap && next !== 5 && next !== lastTap.direction) lastTap = null;
  }
  function enqueue(command) {
    commands.push({ ...command, time, expiresAt: time + timing.buttonBuffer });
    if (commands.length > 16) commands.shift();
  }
  function down(action, nextTime, nextFacing) {
    if (!Object.hasOwn(held, action) || !sync(nextTime, nextFacing) || held[action]) return false;
    const previousDirection = direction;
    held[action] = true;
    if (DIRECTIONS.includes(action)) recordDirection();
    else appendLog({ kind: 'button', action, pressed: true, direction });
    if (ATTACKS.includes(action)) {
      pending.push({ action, time, expiresAt: time + timing.buttonBuffer, epoch });
      if (pending.length > 16) pending.shift();
    }
    if ((action === 'left' || action === 'right') && previousDirection === 5 && (direction === 4 || direction === 6)) {
      if (lastTap?.released && lastTap.direction === direction && time - lastTap.time <= timing.doubleTapWindow + EPSILON) {
        enqueue({ type: direction === 6 ? 'run' : 'backstep', direction: direction === 6 ? facing : -facing });
        lastTap = null;
      } else lastTap = { direction, time, released: false };
    }
    return true;
  }
  function up(action, nextTime, nextFacing) {
    if (!Object.hasOwn(held, action) || !sync(nextTime, nextFacing) || !held[action]) return false;
    held[action] = false;
    if (DIRECTIONS.includes(action)) {
      recordDirection();
      if (lastTap && direction === 5 && (action === 'left' || action === 'right')) lastTap.released = true;
    } else appendLog({ kind: 'button', action, pressed: false, direction });
    return true;
  }

  function findMotion(pattern, attack, cutoff) {
    if (attack.epoch !== epoch) return null;
    const points = [];
    for (const point of history) {
      if (point.epoch !== epoch || point.time > cutoff + EPSILON || point.direction === 5) continue;
      if (points.at(-1)?.direction === point.direction) {
        // Same-frame combinations can return to the previous direction. Keep
        // its original entry time, but retain the actual end of the later hold.
        points[points.length - 1] = { ...points.at(-1), endTime: point.endTime ?? point.time, serial: point.serial };
        continue;
      }
      points.push(point);
    }
    if (!points.length) return null;
    let cursor = points.length - 1;
    const finish = points[cursor];
    // A Z-motion may finish by relaxing its down-forward into forward.
    if (pattern === '623' && finish.direction === 6 && points[cursor - 1]?.direction === 3
      && finish.time - points[cursor - 1].time <= .1 + EPSILON) cursor--;
    const expected = [...pattern].map(Number);
    if (points[cursor]?.direction !== expected.at(-1)) return null;
    const end = points[cursor];
    if (attack.time - finish.time > timing.finishWindow + EPSILON) return null;
    let newer = end;
    for (let index = expected.length - 2; index >= 0; index--) {
      cursor--;
      // Returning from forward to down can pass through down-forward; this
      // permits a natural stick roll for 623 and the middle of 236236.
      if (expected[index] === 6 && expected[index + 1] === 2 && points[cursor]?.direction === 3) cursor--;
      const point = points[cursor];
      if (!point || point.direction !== expected[index]) return null;
      // Holding the *first* direction (for example crouching before 236) is
      // valid. Later steps still have to complete promptly; holding a diagonal
      // indefinitely must not preserve an otherwise stale motion.
      const at = index === 0 ? Math.min(point.endTime ?? point.time, newer.time, cutoff) : point.time;
      if (newer.time - at > timing.stepWindow + EPSILON) return null;
      newer = { ...point, time: at };
    }
    const window = pattern.length > 3 ? timing.superWindow : timing.motionWindow;
    if (finish.time - newer.time > window + EPSILON) return null;
    return { direction: pattern, lastSerial: finish.serial };
  }

  function resolveAttacks() {
    while (pending.length && time - pending[0].time + EPSILON >= timing.coalesceWindow) {
      const first = pending.shift();
      const simultaneous = [first];
      while (pending.length && pending[0].time - first.time <= timing.coalesceWindow + EPSILON) simultaneous.push(pending.shift());
      // Core handles AB/ABC/CD actions first. Remaining simultaneous attack
      // edges produce one strongest normal/motion, independent of DOM order.
      simultaneous.sort((a, b) => ATTACKS.indexOf(a.action) - ATTACKS.indexOf(b.action));
      const attack = simultaneous[0];
      const cutoff = Math.min(time, first.time + timing.coalesceWindow);
      let motion = null;
      for (const pattern of ['236236', '623', '236', '214']) {
        motion = findMotion(pattern, attack, cutoff);
        if (motion) break;
      }
      commands.push({ type: motion?.direction === '236236' ? 'super' : motion ? 'command' : 'attack',
        ...(motion ? { direction: motion.direction } : {}), attack: attack.action,
        strength: attack.action.startsWith('heavy') ? 'heavy' : 'light',
        time: first.time, expiresAt: first.expiresAt });
      if (motion) history = history.filter(point => point.serial > motion.lastSerial);
    }
  }
  function getState() {
    return { held: { ...held }, facing, direction, time, timing: { ...timing },
      history: history.map(item => ({ ...item })), log: log.map(item => ({ ...item })),
      pending: pending.map(item => ({ ...item })), commands: commands.map(item => ({ ...item })) };
  }
  function sample(nextTime, nextFacing) {
    if (!sync(nextTime, nextFacing)) return { commands: [], held: { ...held }, log: log.map(item => ({ ...item })), facing, direction };
    resolveAttacks();
    const ready = commands.splice(0).map(item => ({ ...item }));
    return { commands: ready, held: { ...held }, log: log.map(item => ({ ...item })), facing, direction };
  }
  return { down, up, sample, reset, getState };
}
