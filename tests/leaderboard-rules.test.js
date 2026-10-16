import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAMES, MAX_SCORE, makeBoard, parseBoard, boardLabel, getBoardChoices, validateScore } from '../js/leaderboard-rules.js';

test('leaderboards enumerate all ten games and 77 distinct, reversible board keys', () => {
  assert.equal(GAMES.length, 10);
  const counts = [6, 13, 6, 2, 2, 2, 6, 2, 2, 36];
  const keys = [];
  GAMES.forEach(({ id, name }, index) => {
    assert.ok(name.includes('奶蛙'));
    const choices = getBoardChoices(id);
    assert.equal(choices.length, counts[index]);
    for (const { value, label } of choices) {
      const config = parseBoard(value);
      assert.equal(config.game, id);
      assert.equal(makeBoard(config), value);
      assert.equal(boardLabel(value), label);
      assert.ok(label.includes(name));
      keys.push(value);
    }
  });
  assert.equal(new Set(keys).size, 77);
});

test('the original 41 board keys remain available unchanged and front/back rules stay identical', () => {
  const legacy = `v1:flappy:classic:easy v1:flappy:classic:normal v1:flappy:classic:hard
    v1:flappy:endless:easy v1:flappy:endless:normal v1:flappy:endless:hard
    v1:angry:classic:1 v1:angry:classic:2 v1:angry:classic:3 v1:angry:classic:4
    v1:angry:classic:5 v1:angry:classic:6 v1:angry:classic:7 v1:angry:classic:8
    v1:angry:classic:9 v1:angry:classic:10 v1:angry:classic:11 v1:angry:classic:12 v1:angry:endless
    v1:whack:classic:easy v1:whack:classic:normal v1:whack:classic:hard
    v1:whack:endless:easy v1:whack:endless:normal v1:whack:endless:hard
    v1:catch:classic v1:catch:endless v1:jump:classic v1:jump:endless
    v1:merge:classic:4 v1:merge:classic:6
    v1:fighter:classic:belly v1:fighter:classic:speed v1:fighter:classic:laugh
    v1:fighter:endless:belly v1:fighter:endless:speed v1:fighter:endless:laugh
    v1:survivor:classic v1:survivor:endless v1:bomber:classic v1:bomber:endless`.trim().split(/\s+/);
  assert.equal(legacy.length, 41);
  assert.deepEqual(GAMES.filter(game => game.id !== 'aim').flatMap(game => getBoardChoices(game.id).map(choice => choice.value)).sort(), legacy.sort());
  for (const key of legacy) assert.equal(makeBoard(parseBoard(key)), key);
  assert.equal(readFileSync(new URL('../js/leaderboard-rules.js', import.meta.url), 'utf8'),
    readFileSync(new URL('../server/lib/leaderboard-rules.js', import.meta.url), 'utf8'));
});

test('aim has 36 distinct mode/difficulty/drill/input boards with explicit control labels', () => {
  assert.equal(makeBoard({ game: 'aim' }), 'v1:aim:classic:normal:grid:cursor');
  assert.deepEqual(parseBoard('v1:aim:endless:hard:precision:fps'), {
    game: 'aim', mode: 'endless', difficulty: 'hard', aimDrill: 'precision', aimInput: 'fps',
  });
  assert.equal(boardLabel('v1:aim:classic:normal:grid:cursor'), '奶蛙瞄准实验室 · 经典60秒 · 标准 · 三球速点 · 点击触屏');
  assert.equal(boardLabel('v1:aim:endless:hard:precision:fps'), '奶蛙瞄准实验室 · 无限 · 挑战 · 精准甩枪 · 鼠标FPS');
  assert.match(boardLabel('v1:aim:classic:easy:track:fps'), /跟枪追踪.*鼠标FPS/);
  assert.notEqual(makeBoard({ game: 'aim', aimInput: 'fps' }), makeBoard({ game: 'aim', aimInput: 'cursor' }));
  for (const mode of ['classic', 'endless']) for (const difficulty of ['easy', 'normal', 'hard']) {
    for (const aimDrill of ['grid', 'precision', 'track']) for (const aimInput of ['fps', 'cursor']) {
      const options = { game: 'aim', mode, difficulty, aimDrill, aimInput };
      assert.deepEqual(parseBoard(makeBoard(options)), options);
    }
  }
  for (const key of ['v1:aim:classic:normal', 'v1:aim:classic:normal:grid', 'v1:aim:classic:normal:grid:touch',
    'v1:aim:classic:normal:unknown:fps', 'v1:aim:classic:normal:grid:FPS', 'v1:aim:classic:normal:grid:cursor:extra',
    'v1:aim:classic:normal:grid:cursor\n', 'v1:aim:training:normal:grid:cursor']) assert.equal(parseBoard(key), null, key);
  for (const options of [{ aimInput: 'touch' }, { aimDrill: 'tracking' }, { difficulty: 'expert' }, { aimInput: null }, { aimDrill: null }]) {
    assert.equal(makeBoard({ game: 'aim', ...options }), null);
  }
});

test('leaderboards keep difficulty, grid size, chosen fighter and actual campaign starting level separate', () => {
  assert.equal(makeBoard({ game: 'flappy' }), 'v1:flappy:classic:normal');
  assert.equal(makeBoard({ game: 'whack', mode: 'endless', difficulty: 'hard' }), 'v1:whack:endless:hard');
  assert.equal(makeBoard({ game: 'angry', startLevel: 12 }), 'v1:angry:classic:12');
  assert.equal(makeBoard({ game: 'angry', mode: 'endless', startLevel: 12 }), 'v1:angry:endless', 'endless board has a fixed start at level one; start validation belongs to the run service');
  assert.equal(makeBoard({ game: 'merge', gridSize: 6 }), 'v1:merge:classic:6');
  assert.equal(makeBoard({ game: 'fighter', mode: 'endless', character: 'laugh' }), 'v1:fighter:endless:laugh');
  assert.notEqual(makeBoard({ game: 'fighter', character: 'belly' }), makeBoard({ game: 'fighter', character: 'speed' }));
  assert.deepEqual(parseBoard('v1:angry:classic:10'), { game: 'angry', mode: 'classic', startLevel: 10 });
  assert.deepEqual(parseBoard('v1:catch:endless'), { game: 'catch', mode: 'endless' });
  assert.match(boardLabel('v1:merge:classic:4'), /4×4.*可撤销/);
});

test('leaderboards reject all local duel and practice modes, including P2-winning contexts', () => {
  for (const game of ['fighter', 'bomber']) {
    assert.equal(makeBoard({ game, mode: 'duel', winnerPlayer: 1, score: 999 }), null);
    assert.equal(parseBoard(`v1:${game}:duel`), null);
  }
  assert.equal(makeBoard({ game: 'fighter', mode: 'training', character: 'belly' }), null);
  assert.equal(parseBoard('v1:fighter:training:belly'), null);
  assert.equal(makeBoard({ game: 'merge', mode: 'endless' }), null);
});

test('leaderboards reject aliases, missing dimensions, coercible values and hostile board strings', () => {
  for (const key of [null, 12, {}, '', 'v2:catch:classic', 'v1:catch:classic:normal', 'v1:catch:classic ',
    'v1:flappy:classic', 'v1:flappy:classic:NORMAL', 'v1:angry:classic:01', 'v1:angry:classic:1.0',
    'v1:angry:classic:0', 'v1:angry:classic:13', 'v1:angry:classic:1\n', 'v1:angry:endless:1', 'v1:merge:endless:4',
    'v1:merge:classic:5', 'v1:fighter:classic:__proto__', 'v1:__proto__:classic', 'v1:constructor:classic',
    'v1:survivor:classic\n', 'v1:jump:classic:../../other']) {
    assert.equal(parseBoard(key), null, String(key));
    assert.equal(boardLabel(key), '');
  }
  for (const config of [null, [], 'flappy', {}, { game: '__proto__' }, { game: 'flappy', difficulty: null },
    { game: 'merge', gridSize: '4' }, { game: 'angry', startLevel: '1' }, { game: 'angry', startLevel: 1.5 },
    { game: 'fighter', character: 'unknown' }, { game: 'catch', mode: null }]) assert.equal(makeBoard(config), null);
  assert.deepEqual(getBoardChoices('unknown'), []);
});

test('leaderboard shared context ignores irrelevant settings and returned UI choices cannot corrupt future calls', () => {
  assert.equal(makeBoard({ game: 'catch', difficulty: 'hard', startLevel: 12, gridSize: 6, character: 'speed', aimDrill: 'track', aimInput: 'fps' }), 'v1:catch:classic');
  const choices = getBoardChoices('merge');
  choices[0].value = 'corrupted'; choices.length = 0;
  assert.equal(getBoardChoices('merge')[0].value, 'v1:merge:classic:4');
  const config = parseBoard('v1:fighter:classic:belly'); config.character = 'changed';
  assert.equal(parseBoard('v1:fighter:classic:belly').character, 'belly');
});

test('aim permits real 60-second scores, countdown and pauses, but bounds extreme instantaneous reports', () => {
  for (const { value: board } of getBoardChoices('aim')) {
    assert.equal(validateScore(board, 0, 0).ok, true);
    assert.equal(validateScore(board, 1000, 0).ok, true);
    assert.equal(validateScore(board, 1001, 0).code, 'score_too_fast');
    assert.equal(validateScore(board, 150_000, 63_000).ok, true, '200 points every 80ms remains below the generous envelope');
    assert.equal(validateScore(board, 7200, 60_000).ok, true, 'tracking gives 120 points per second');
    assert.equal(validateScore(board, 301_001, 60_000).code, 'score_too_fast');
    assert.equal(validateScore(board, 150_000, 3_600_000).ok, true, 'pause time is included in server wall time');
  }
  const classic = 'v1:aim:classic:hard:precision:fps';
  const endless = 'v1:aim:endless:hard:precision:fps';
  assert.equal(validateScore(classic, 2_000_000, 400_000).ok, true);
  assert.equal(validateScore(classic, 2_000_001, 400_000).code, 'score_limit');
  assert.equal(validateScore(endless, 2_000_001, 400_000).ok, true);
  assert.equal(validateScore(endless, MAX_SCORE, 30 * 365 * 24 * 3600 * 1000).ok, true);
});

test('score validation is strict about integer data and permits legitimate zero-score runs', () => {
  const board = 'v1:flappy:classic:normal';
  assert.deepEqual(validateScore(board, 0, 0), { ok: true });
  assert.deepEqual(validateScore(board, 12, { elapsedMs: 30_000 }), { ok: true });
  for (const score of [-1, 1.2, '12', NaN, Infinity, MAX_SCORE + 1, null]) assert.equal(validateScore(board, score, 60_000).code, 'invalid_score');
  for (const duration of [-1, 0.1, '1000', NaN, Infinity, {}, [], null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validateScore(board, 0, duration).code, 'invalid_duration');
  }
  assert.equal(validateScore('v1:fighter:training:belly', 0, 1000).code, 'invalid_board');
});

test('bounded classic games have generous caps while endless and survivor classic remain open for long runs', () => {
  for (const [board, cap] of [['v1:whack:classic:hard', 20_000], ['v1:catch:classic', 10_000], ['v1:jump:classic', 2000],
    ['v1:angry:classic:1', 100_000], ['v1:fighter:classic:belly', 100_000], ['v1:bomber:classic', 100_000]]) {
    assert.equal(validateScore(board, cap, 1_000_000_000).ok, true);
    assert.equal(validateScore(board, cap + 1, 1_000_000_000).code, 'score_limit');
  }
  const month = 30 * 24 * 60 * 60 * 1000;
  for (const board of ['v1:angry:endless', 'v1:fighter:endless:speed', 'v1:bomber:endless', 'v1:survivor:classic']) {
    assert.equal(validateScore(board, 20_000_000, month).ok, true, board);
  }
  assert.equal(validateScore('v1:flappy:endless:hard', 5_000_000, month).ok, true);
});

test('elapsed checks reject conspicuous instant scores without treating pause or saved 2048 progress as cheats', () => {
  assert.equal(validateScore('v1:flappy:classic:normal', 100, 1000).code, 'score_too_fast');
  assert.equal(validateScore('v1:whack:endless:normal', 1_000_000, 1000).code, 'score_too_fast');
  assert.equal(validateScore('v1:survivor:endless', 1_000_000, 1000).code, 'score_too_fast');
  assert.equal(validateScore('v1:flappy:classic:normal', 100, 3_600_000).ok, true, 'server wall time may include pauses');
  assert.equal(validateScore('v1:jump:classic', 1170, 90_000).ok, true);
  assert.equal(validateScore('v1:whack:classic:hard', 5000, 30_000).ok, true);
  assert.equal(validateScore('v1:merge:classic:6', MAX_SCORE, 0).ok, true, 'merge resumes are governed by run ownership, not a speed heuristic');
});
