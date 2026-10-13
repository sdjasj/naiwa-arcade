import test from 'node:test';
import assert from 'node:assert/strict';
import { slideBoard, canMove, validSave, createGame, FORMS } from '../js/games/merge.js';

const pad = row => [...row, ...Array(16 - row.length).fill(0)];
test('2048: one move merges each tile only once and preserves the input', () => {
  const board = pad([2, 2, 2, 2]);
  const result = slideBoard(board, 'left');
  assert.deepEqual(result.board, pad([4, 4, 0, 0]));
  assert.equal(result.score, 8); assert.equal(result.merges.length, 2);
  assert.deepEqual(board, pad([2, 2, 2, 2]));
  assert.deepEqual(slideBoard(pad([2, 2, 4, 0]), 'left').board, pad([4, 4, 0, 0]));
});
test('2048: all four directions respect row/column boundaries and merge priority', () => {
  assert.deepEqual(slideBoard(pad([2, 2, 4, 4]), 'right').board, pad([0, 0, 4, 8]));
  const vertical = [2, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0];
  assert.deepEqual(slideBoard(vertical, 'up').board, [4,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0]);
  assert.deepEqual(slideBoard(vertical, 'down').board, [0,0,0,0,0,0,0,0,4,0,0,0,8,0,0,0]);
  assert.deepEqual(slideBoard(pad([2,0,2,2]), 'left').board, pad([4,2,0,0]));
});
test('2048: recognizes stuck boards and rejects malformed saves', () => {
  const full = [2,4,8,16,4,8,16,32,8,16,32,64,16,32,64,128];
  assert.equal(canMove(full), false); assert.equal(canMove([...full.slice(0,15),0]), true);
  assert.equal(canMove([2,2,...full.slice(2)]), true);
  assert.equal(validSave({board:full,score:500,moves:30}), true);
  for (const board of [[], Array(16).fill(0), Array(16).fill(-2), Array(16).fill(3), Array(16).fill(Infinity)]) assert.equal(validSave({board,score:0,moves:0}), false);
  assert.equal(validSave({board:full,score:NaN,moves:0}), false);
  assert.equal(new Set(FORMS.map(f => `${f.pose}:${f.wings || ''}:${f.crown || ''}`)).size, FORMS.length);
});
function harness(board = pad([2,2,4]), score = 0, saveExtras = {}) {
  const results = [], scores = [], saves = [], draws = [];
  const noop = () => {};
  const ctx = new Proxy({}, {get: () => noop, set: () => true});
  const game = createGame({ ctx, drawFrog: (...args) => draws.push(args), audio: {play:noop}, width:560,height:640, savedGame:{board,score,moves:0,...saveExtras},onScore:v=>scores.push(v),onSave:v=>saves.push(v),onEnd:v=>results.push(v) });
  const settle = () => { for(let i=0;i<25;i++)game.update(1/60); };
  return {game,results,scores,saves,draws,settle};
}
test('2048: valid moves save, undo restores exactly once, no-op moves spawn nothing', () => {
  const {game,saves,settle}=harness(pad([2,4,8]));game.start();
  const initial=game.getState();game.keyDown({key:'ArrowLeft'});settle();
  assert.deepEqual(game.getState().board,initial.board);assert.equal(game.getState().moves,0);
  game.keyDown({key:'ArrowRight'});settle();assert.equal(game.getState().moves,1);
  assert.equal(game.getState().board.filter(Boolean).length,4);assert.equal(saves.at(-1).moves,1);
  assert.equal(game.undo(),true);assert.deepEqual(game.getState().board,initial.board);assert.equal(game.undo(),false);
});
test('2048: short taps and cancelled swipes do nothing; swipes and keys merge', () => {
  const {game,settle}=harness();game.start();
  game.pointerDown({x:250,y:250});game.pointerUp({x:255,y:252});assert.equal(game.getState().moves,0);
  game.pointerDown({x:250,y:250});game.cancelInput();game.pointerUp({x:100,y:250});assert.equal(game.getState().moves,0);
  game.pointerDown({x:250,y:250});game.pointerUp({x:100,y:250});settle();assert.equal(game.getState().score,4);
  game.render(1);game.keyDown({key:'ArrowDown',repeat:true});assert.equal(game.getState().moves,1);
});
test('2048: 2048 milestone can continue and does not trigger repeatedly', () => {
  const {game,results,settle}=harness(pad([1024,1024]));game.start();game.keyDown({key:'ArrowLeft'});settle();
  assert.equal(results.length,1);assert.equal(results[0].canContinue,true);assert.equal(game.getState().phase,'won');assert.equal(game.getState().maxTile,2048);
  game.continueGame();assert.equal(game.getState().phase,'playing');settle();assert.equal(results.length,1);
  game.keyDown({key:'ArrowDown'});settle();assert.equal(results.length,1);
});
test('2048: full board with no legal move ends once; fresh restart resets saved score', () => {
  const original=Math.random;Math.random=()=>0;
  try {
    const initial = [2,4,8,16,4,8,16,32,8,16,32,64,32,64,128,0];
    const afterSlide = slideBoard(initial, 'right').board;
    assert.deepEqual(afterSlide, [2,4,8,16,4,8,16,32,8,16,32,64,0,32,64,128]);
    assert.equal(canMove(afterSlide), true, 'the empty cell still allows a move before spawning');
    const afterSpawn = [...afterSlide]; afterSpawn[12] = 2;
    assert.equal(canMove(afterSpawn), false, 'the deterministic 2 leaves no equal neighbors');
    const {game,results,saves,settle}=harness(initial,100);
    game.start();game.keyDown({key:'ArrowRight'});settle();
    assert.deepEqual(game.getState().board, afterSpawn);
    assert.equal(game.getState().phase,'ended');assert.equal(results.length,1);assert.equal(saves.at(-1),null);
    game.keyDown({key:'ArrowLeft'});settle();assert.equal(results.length,1);
    game.start({fresh:true});assert.equal(game.getState().score,0);assert.equal(game.getState().moves,0);assert.equal(game.getState().board.filter(Boolean).length,2);
  } finally {Math.random=original;}
});

test('2048: rejects sparse boards, invalid save field types, and inconsistent win flags', () => {
  const save = { board: pad([2,4]), score: 0, moves: 0 };
  const sparse = Array(16); sparse[0] = 2;
  assert.equal(validSave({ ...save, board: sparse }), false);
  for (const value of ['0', null, undefined, NaN, Infinity, -1, 0.5]) {
    assert.equal(validSave({ ...save, score: value }), false);
    assert.equal(validSave({ ...save, moves: value }), false);
  }
  for (const won of ['false', 'true', 0, 1, null, {}, []]) assert.equal(validSave({ ...save, won }), false);
  assert.equal(validSave({ ...save, won: true }), false);
  assert.equal(validSave({ ...save, won: false }), true);
  assert.equal(validSave({ ...save, board: pad([2048]), won: true }), true);
  assert.equal(validSave(JSON.parse(JSON.stringify({ ...save, board: pad([2048]), won: false }))), true);
  assert.equal(validSave({ ...save, board: [2, ...Array(15).fill(null)] }), false);
});

test('2048: initial save and inspection snapshots are copied rather than retained by reference', () => {
  const original = pad([2,4,8]);
  const { game } = harness(original, 24, { moves: 6 });
  original.fill(3);
  game.start();
  assert.deepEqual(game.getState().board, pad([2,4,8]));
  assert.equal(game.getState().score, 24);
  assert.equal(game.getState().moves, 6);
  game.getState().board.fill(1024);
  assert.deepEqual(game.getState().board, pad([2,4,8]));
});

test('2048: restoring a pending milestone settles on update without losing the achievement', () => {
  const { game, results, saves, settle } = harness(pad([2048,2]), 2048, { moves: 20, won: false });
  game.start();
  assert.equal(results.length, 0, 'start must let the parent finish its UI transition before onEnd');
  assert.deepEqual(game.getState().board, pad([2048,2]));
  settle();
  assert.equal(results.length, 1);
  assert.equal(results[0].canContinue, true);
  assert.equal(saves.at(-1).won, true);
  assert.equal(game.continueGame(), true);
  settle();
  assert.equal(results.length, 1);
  assert.equal(game.getState().phase, 'playing');
});

test('2048: a saved terminal board is preserved and settles once instead of silently restarting', () => {
  const terminal = [2,4,8,16,4,8,16,32,8,16,32,64,16,32,64,128];
  const { game, results, saves, settle } = harness(terminal, 500, { moves: 30 });
  game.start();
  assert.deepEqual(game.getState().board, terminal);
  assert.equal(results.length, 0);
  settle();
  assert.equal(game.getState().phase, 'ended');
  assert.equal(results.length, 1);
  assert.equal(results[0].score, 500);
  assert.equal(saves.at(-1), null);
  settle();
  assert.equal(results.length, 1);
});

test('2048: a terminal 2048 board celebrates once, then continuing reports game over', () => {
  const terminal = [2048,4,8,16,4,8,16,32,8,16,32,64,16,32,64,128];
  const { game, results, settle } = harness(terminal, 4096, { moves: 70 });
  game.start(); settle();
  assert.equal(results.length, 1);
  assert.equal(results[0].won, true);
  assert.equal(game.continueGame(), true);
  assert.equal(game.getState().phase, 'ended');
  assert.equal(results.length, 2);
  assert.equal(results[1].won, false);
  settle();
  assert.equal(results.length, 2);
});

test('2048: all twelve forms render in portrait bounds and malformed releases cannot swipe', () => {
  const { game, draws, settle } = harness(pad(FORMS.map(form => form.value)), 4096, { won: true });
  game.start(); game.render(0);
  assert.equal(draws.length, FORMS.length);
  assert.equal(draws.filter(args => args[4].crown).length, 1);
  assert.equal(draws.filter(args => args[4].wings).length, 1);
  const rect = game.getState().boardRect;
  assert.ok(rect.x >= 0 && rect.x + rect.side <= 560);
  assert.ok(rect.y >= 0 && rect.y + rect.side <= 640);
  const initial = game.getState();
  for (const point of [{}, { x: NaN, y: 1 }, { x: 1, y: Infinity }, { x: 1, y: 1, cancelled: true }]) {
    game.pointerDown({ x: 250, y: 250 }); game.pointerUp(point); settle();
  }
  assert.equal(game.getState().moves, initial.moves);
  assert.deepEqual(game.getState().board, initial.board);
});
