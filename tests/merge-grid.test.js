import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, slideBoard, canMove, validSave, FORMS } from '../js/games/merge.js';

const pad = (values, size = 6) => [...values, ...Array(size * size - values.length).fill(0)];
const settle = game => { for (let i = 0; i < 12; i += 1) game.update(1 / 60); };

function harness(gridSize = 6, savedGame) {
  const results = [], saves = [], draws = [], labels = [];
  const noop = () => {};
  const ctx = new Proxy({ fillText: value => labels.push(String(value)) }, { get: (target, key) => key in target ? target[key] : noop, set: () => true });
  const game = createGame({ width: 560, height: 640, gridSize, savedGame, ctx,
    drawFrog: (...args) => draws.push(args), audio: { play() {} },
    onScore() {}, onStatus() {}, onEnd: result => results.push(result), onSave: save => saves.push(save),
  });
  return { game, results, saves, draws, labels };
}

test('2048 6×6: horizontal slides pair once, preserve mass, and respect all six columns', () => {
  const board = pad([2, 2, 2, 2, 4, 4]);
  const original = [...board];
  const left = slideBoard(board, 'left');
  const right = slideBoard(board, 'right', 6);
  assert.deepEqual(left.board, pad([4, 4, 8, 0, 0, 0]));
  assert.deepEqual(right.board, pad([0, 0, 0, 4, 4, 8]));
  assert.equal(left.score, 16);
  assert.equal(right.score, 16);
  assert.equal(left.merges.length, 3);
  assert.equal(left.board.reduce((sum, value) => sum + value), board.reduce((sum, value) => sum + value));
  assert.deepEqual(board, original);
  assert.deepEqual(slideBoard(pad([2, 2, 4, 4, 8, 8]), 'left').board, pad([4, 8, 16]));
  const boundaries = Array(36).fill(0); boundaries[5] = 2; boundaries[6] = 2;
  const moved = slideBoard(boundaries, 'left');
  assert.equal(moved.score, 0, 'the end of one row cannot merge with the start of the next');
  assert.equal(moved.board[0], 2);
  assert.equal(moved.board[6], 2);
});

test('2048 6×6: vertical slides include the bottom row and keep columns separate', () => {
  const board = Array(36).fill(0);
  [2, 2, 2, 2, 4, 4].forEach((value, row) => { board[row * 6 + 5] = value; });
  const up = slideBoard(board, 'up', 6);
  const down = slideBoard(board, 'down');
  assert.deepEqual(Array.from({ length: 6 }, (_, row) => up.board[row * 6 + 5]), [4, 4, 8, 0, 0, 0]);
  assert.deepEqual(Array.from({ length: 6 }, (_, row) => down.board[row * 6 + 5]), [0, 0, 0, 4, 4, 8]);
  assert.equal(up.score, 16); assert.equal(down.score, 16);
  assert.ok(up.board.every((value, index) => index % 6 === 5 || value === 0));
  assert.ok(down.board.every((value, index) => index % 6 === 5 || value === 0));
  assert.deepEqual(slideBoard(board, 'down', 4).board, board, 'an explicit mismatched size must not truncate the board');
  assert.equal(slideBoard(board, 'down', 4).moved, false);
});

test('2048 6×6: move detection does not wrap rows and recognizes every boundary neighbor', () => {
  const full = Array.from({ length: 36 }, (_, i) => 2 ** ((Math.floor(i / 6) + i % 6) % 7 + 1));
  full[6] = full[5];
  assert.equal(canMove(full), false, 'equal entries across a row boundary are not adjacent');
  assert.equal(canMove(full, 6), false);
  const horizontal = [...full]; horizontal[35] = horizontal[34];
  assert.equal(canMove(horizontal), true);
  const vertical = [...full]; vertical[35] = vertical[29];
  assert.equal(canMove(vertical), true);
  const empty = [...full]; empty[35] = 0;
  assert.equal(canMove(empty), true);
  assert.equal(canMove(full, 4), false);
});

test('2048 grid saves: keep legacy 4×4 compatibility and reject cross-size restoration', () => {
  const legacy = { board: pad([2, 4], 4), score: 4, moves: 3 };
  const large = { board: pad([2, 4]), score: 4, moves: 3, gridSize: 6 };
  assert.equal(validSave(legacy), true);
  assert.equal(validSave(legacy, 4), true);
  assert.equal(validSave(legacy, 6), false);
  assert.equal(validSave({ ...legacy, gridSize: 4 }, 4), true);
  assert.equal(validSave(large, 6), true);
  assert.equal(validSave(large), false);
  assert.equal(validSave({ ...large, gridSize: undefined }, 6), false);
  for (const gridSize of [4, '6', null, 5]) assert.equal(validSave({ ...large, gridSize }, 6), false);
  assert.equal(validSave({ ...legacy, gridSize: 6 }, 4), false);
  assert.equal(validSave(large, 5), false);
  const a = harness(6, legacy), b = harness(4, large);
  assert.equal(a.game.getState().savedAvailable, false);
  assert.equal(b.game.getState().savedAvailable, false);
  a.game.start(); b.game.start();
  assert.equal(a.game.getState().board.length, 36);
  assert.equal(b.game.getState().board.length, 16);
  assert.equal(a.game.getState().board.filter(Boolean).length, 2);
  assert.equal(b.game.getState().board.filter(Boolean).length, 2);
  assert.equal(a.saves.at(-1).gridSize, 6);
  assert.equal(b.saves.at(-1).gridSize, 4);
});

test('2048 6×6: no-op, spawn, one-use undo, and autosave preserve all 36 cells', () => {
  const saved = { board: pad([2, 4, 8, 16, 32, 64]), score: 124, moves: 12, gridSize: 6 };
  const { game, saves } = harness(6, JSON.parse(JSON.stringify(saved)));
  game.start();
  const initial = game.getState();
  game.keyDown({ key: 'ArrowLeft' }); settle(game);
  assert.deepEqual(game.getState().board, saved.board);
  assert.equal(game.getState().moves, 12);
  game.keyDown({ key: 'ArrowDown' }); settle(game);
  assert.equal(game.getState().board.filter(Boolean).length, 7);
  assert.equal(game.getState().moves, 13);
  assert.equal(saves.at(-1).board.length, 36);
  assert.equal(saves.at(-1).gridSize, 6);
  assert.equal(validSave(saves.at(-1), 6), true);
  assert.equal(game.undo(), true);
  assert.deepEqual(game.getState().board, initial.board);
  assert.equal(game.getState().score, initial.score);
  assert.equal(game.getState().moves, initial.moves);
  assert.equal(game.undo(), false);
});

test('2048 6×6: 2048 milestone, continue, reload, and fresh restart retain the selected size', () => {
  const { game, saves, results } = harness(6, { board: pad([1024, 1024]), score: 0, moves: 0, gridSize: 6 });
  game.start(); game.keyDown({ key: 'ArrowLeft' }); settle(game);
  assert.equal(game.getState().phase, 'won');
  assert.equal(game.getState().gridSize, 6);
  assert.equal(game.getState().maxTile, 2048);
  assert.equal(results.length, 1);
  assert.equal(results[0].canContinue, true);
  assert.equal(results[0].gridSize, 6);
  assert.equal(game.continueGame(), true);
  settle(game); assert.equal(results.length, 1);
  const restored = harness(6, JSON.parse(JSON.stringify(saves.at(-1))));
  restored.game.start(); settle(restored.game);
  assert.equal(restored.game.getState().phase, 'playing');
  assert.equal(restored.results.length, 0, 'a previously acknowledged milestone must not repeat on reload');
  assert.deepEqual(restored.game.getState().board, game.getState().board);
  restored.game.start({ fresh: true });
  assert.equal(restored.game.getState().board.length, 36);
  assert.equal(restored.game.getState().score, 0);
  assert.equal(restored.game.getState().board.filter(Boolean).length, 2);
});

test('2048 6×6: compact tiles render every form and a restored full board ends only once', () => {
  const board = Array.from({ length: 36 }, (_, i) => FORMS[i % FORMS.length].value);
  const { game, draws, labels, results } = harness(6, { board, score: 10000, moves: 80, gridSize: 6, won: true });
  game.start(); game.render(0);
  assert.equal(draws.length, 36);
  for (const form of FORMS) assert.ok(labels.includes(String(form.value)));
  const rect = game.getState().boardRect;
  assert.ok(rect.x + rect.side <= 560);
  assert.ok(rect.y + rect.side <= 640);
  assert.ok(rect.cell > 70 && rect.cell < 80);
  settle(game);
  assert.equal(game.getState().phase, 'ended');
  assert.equal(results.length, 1);
  assert.equal(results[0].gridSize, 6);
  settle(game); assert.equal(results.length, 1);
});
