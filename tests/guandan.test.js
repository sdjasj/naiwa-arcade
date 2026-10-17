import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../js/games/guandan.js';
import { beats, classify, cardStrength, legalPlays } from '../js/games/guandan-rules.js';

function harness(options = {}) {
  const scores = [], results = [], sounds = [], draws = [], messages = [];
  const noop = () => {};
  const ctx = new Proxy({ createLinearGradient: () => ({ addColorStop: noop }) }, {
    get: (target, key) => key in target ? target[key] : noop,
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const game = createGame({ ctx, width: 960, height: 560, seed: 1,
    drawFrog: (...args) => draws.push(args), audio: { play: kind => sounds.push(kind) },
    onScore: value => scores.push(value), onEnd: value => results.push(value), onStatus: text => messages.push(text), ...options });
  return { game, scores, results, sounds, draws, messages };
}
const detailed = game => game.getState({ reveal: true });
function completePlay(game, limit = 600) {
  if (!game.getState().auto) game.toggleAuto();
  for (let step = 0; step < limit && game.getState().phase === 'playing'; step++) game.update(1);
  assert.equal(game.getState().phase, 'celebrating', 'A real automatic hand must finish within a bounded number of turns');
  return detailed(game);
}
function settle(game) { game.update(2.4); return game.getState(); }
function assertCards(state) {
  const cards = [...state.players.flatMap(player => player.hand), ...state.discarded];
  assert.equal(cards.length, 108);
  assert.equal(new Set(cards.map(card => card.id)).size, 108);
  for (const player of state.players) assert.equal(player.count, player.hand.length);
}

test('guandan: idle preview, seeded 108-card deal, private opponents, and immutable snapshots', () => {
  const { game, draws, scores } = harness();
  const idle = game.getState(); game.render(0); game.render(900);
  assert.deepEqual(game.getState(), idle); assert.equal(draws.length, 8);
  assert.equal(game.playSelected(), false); assert.equal(game.pass(), false); assert.equal(game.finish(), false);
  game.start(); const state = game.getState();
  assert.equal(state.turn, 0); assert.equal(state.round, 1); assert.equal(state.level, 2);
  assert.deepEqual(state.players.map(player => player.count), [27, 27, 27, 27]);
  assert.ok(state.players.every(player => !Object.hasOwn(player, 'hand')));
  assert.equal(state.hand.length, 27); assert.deepEqual(scores, [0]);
  assertCards(detailed(game));
  const full = detailed(game); full.hand[0].rank = 99; full.players[1].hand.length = 0;
  assert.equal(game.getState().hand.some(card => card.rank === 99), false);
  assert.equal(detailed(game).players[1].hand.length, 27);
  const other = harness().game; other.start(); assert.deepEqual(other.getState().hand, state.hand);
});

test('guandan: card selection, repeated hints, legal lead, turn order, and manual score use real public actions', () => {
  const { game } = harness(); game.start();
  assert.equal(game.pass(), false, 'A lead cannot pass');
  assert.equal(game.toggleCard('missing-card'), false);
  const revision = game.getState().revision;
  assert.equal(game.hint(), true); const first = game.getState();
  assert.ok(first.canPlay); assert.ok(first.revision > revision); assert.ok(first.selected.length > 1);
  assert.equal(game.hint(), true); const second = game.getState();
  assert.notDeepEqual(second.selected, first.selected, 'Repeated hints offer another real candidate');
  assert.equal(game.clearSelection(), true); assert.equal(game.getState().canPlay, false);
  const ownCard = game.getState().hand.at(-1);
  assert.equal(game.toggleCard(ownCard.id), true); assert.equal(game.getState().canPlay, true);
  assert.equal(game.playSelected(), true);
  const played = game.getState();
  assert.equal(played.turn, 1); assert.equal(played.players[0].count, 26); assert.equal(played.score, 5);
  assert.deepEqual(played.selected, []); assert.equal(played.lastPlay.cards[0].id, ownCard.id);
  assert.equal(played.ownCanAct, false); assert.equal(game.toggleCard(played.hand[0].id), false);
  assert.equal(game.hint(), false); assert.equal(game.playSelected(), false);
  const historyLength = detailed(game).history.length;
  game.update(0.64); assert.equal(detailed(game).history.length, historyLength, 'AI has a visible thinking interval');
  game.update(0.4); assert.ok(detailed(game).history.length > historyLength); assert.equal(game.getState().turn, 2);
});

test('guandan: automatic hands conserve cards, make legal plays in seat order, and finish across varied seeds', () => {
  const observed = new Set();
  for (let seed = 1; seed <= 16; seed++) {
    const { game } = harness({ seed }); game.start(); game.toggleAuto();
    for (let step = 0; step < 600 && game.getState().phase === 'playing'; step++) {
      const before = detailed(game); game.update(1); const after = detailed(game); assertCards(after);
      const actions = after.history.slice(before.history.length), action = actions[0];
      assert.ok(action, `seed ${seed}: the waiting AI eventually acts`);
      assert.equal(action.player, before.turn);
      if (action.type === 'play') {
        const legal = classify(action.cards, before.level);
        assert.ok(legal.some(combo => combo.type === action.combo.type && combo.rank === action.combo.rank && beats(combo, before.lastPlay?.combo || null)));
        assert.equal(after.players[action.player].count, before.players[action.player].count - action.cards.length);
        assert.ok(action.cards.every(card => before.players[action.player].hand.some(own => own.id === card.id)));
      } else {
        assert.equal(action.type, 'pass'); assert.ok(before.lastPlay); assert.notEqual(before.lastPlay.player, action.player);
      }
      const restart = actions.find(entry => entry.type === 'lead' || entry.type === 'catchWind');
      if (restart) {
        assert.equal(after.lastPlay, null); assert.deepEqual(after.passed, []);
        assert.equal(after.turn, restart.player);
        if (restart.type === 'catchWind') {
          observed.add('catchWind'); assert.equal(after.players[restart.previous].count, 0);
          assert.equal(restart.player, (restart.previous + 2) % 4);
        }
      } else if (after.phase === 'playing') {
        const expected = [1, 2, 3, 4].map(offset => (before.turn + offset) % 4).find(id => after.players[id].count > 0);
        assert.equal(after.turn, expected);
      }
    }
    const final = detailed(game); assert.equal(final.phase, 'celebrating');
    const ownPlayed = final.history.filter(event => event.type === 'play' && event.player === 0).reduce((sum, event) => sum + event.cards.length, 0);
    assert.equal(final.score, ownPlayed * 5 + final.lastResult.bonus); assert.ok(final.score >= 0 && final.score <= 835);
    assert.equal(final.lastResult.winner, final.finishOrder[0] % 2);
    observed.add(final.lastResult.won ? 'won' : 'lost');
    if (final.lastResult.doubleDown) {
      observed.add('double'); assert.equal(final.finishOrder.length, 2);
      assert.equal(final.finishOrder[0] % 2, final.finishOrder[1] % 2);
      assert.ok(final.players.filter(player => player.count > 0).every(player => player.team !== final.lastResult.winner));
    } else { observed.add('normal'); assert.equal(final.finishOrder.length, 4); }
  }
  assert.deepEqual([...observed].sort(), ['catchWind', 'double', 'lost', 'normal', 'won']);
});

test('guandan: manual pass clears selection and a fresh lead cannot be skipped', () => {
  const { game } = harness({ seed: 4 }); game.start(); game.hint(); game.playSelected();
  for (let step = 0; step < 30 && game.getState().turn !== 0; step++) game.update(1);
  const state = game.getState(); assert.equal(state.turn, 0); assert.ok(state.lastPlay);
  game.toggleCard(state.hand[0].id); assert.equal(game.pass(), true);
  assert.deepEqual(game.getState().selected, []); assert.notEqual(game.getState().turn, 0);
});

test('guandan: the same dealt cards can explicitly declare a straight or straight flush, and preserve wild pair attachments', () => {
  let flushDeal, wildDeal;
  for (let seed = 1; seed <= 100 && (!flushDeal || !wildDeal); seed++) {
    const { game } = harness({ seed }); game.start(); const state = game.getState();
    for (const play of legalPlays(state.hand, state.level)) {
      if (!flushDeal && play.type === 'straightFlush') {
        const explanations = classify(play.cards, state.level);
        if (explanations.some(combo => combo.type === 'straight')) flushDeal = { seed, ids: play.cards.map(card => card.id) };
      }
      if (!wildDeal && play.type === 'fullHouse' && play.pairRank === 14) {
        const explanations = classify(play.cards, state.level).filter(combo => combo.type === 'fullHouse' && combo.naturalRank === play.naturalRank);
        if (explanations.some(combo => combo.pairRank === 13)) wildDeal = { seed, ids: play.cards.map(card => card.id), rank: play.naturalRank };
      }
    }
  }
  assert.ok(flushDeal, 'A real seeded deal contains a selectable straight flush');
  assert.ok(wildDeal, 'A real seeded deal contains ambiguous wildcard attachments');
  for (const type of ['straight', 'straightFlush']) {
    const { game } = harness({ seed: flushDeal.seed }); game.start();
    for (const id of flushDeal.ids) assert.equal(game.toggleCard(id), true);
    const state = game.getState();
    const option = state.selectionOptions.find(item => item.label.startsWith(type === 'straight' ? '顺子' : '同花顺'));
    assert.ok(option); assert.equal(game.chooseInterpretation(option.index), true);
    assert.equal(game.getState().selectionIndex, option.index);
    assert.equal(game.playSelected(), true); assert.equal(game.getState().lastPlay.combo.type, type);
    assert.equal(game.getState().lastPlay.combo.power, type === 'straight' ? 0 : 300);
    assert.deepEqual(game.getState().selectionOptions, []);
  }
  for (const [rank, label] of [[13, 'K'], [14, 'A']]) {
    const { game } = harness({ seed: wildDeal.seed }); game.start();
    for (const id of wildDeal.ids) game.toggleCard(id);
    const option = game.getState().selectionOptions.find(item => item.label.includes(`${wildDeal.rank}带${label}`));
    assert.ok(option); assert.equal(game.chooseInterpretation(option.index), true);
    assert.equal(game.playSelected(), true);
    assert.equal(game.getState().lastPlay.combo.type, 'fullHouse');
    assert.equal(game.getState().lastPlay.combo.naturalRank, wildDeal.rank);
    assert.equal(game.getState().lastPlay.combo.pairRank, rank, 'Execution must preserve the declared pair, not the first matching triple');
  }
});

test('guandan: both winning and losing hands play victory laughter and visibly celebrate for at least two seconds', () => {
  const outcomes = new Set();
  for (let seed = 1; seed <= 12 && outcomes.size < 2; seed++) {
    const { game, sounds, results, draws } = harness({ seed }); game.start(); const done = completePlay(game);
    outcomes.add(done.lastResult.won);
    assert.equal(results.length, 0); assert.ok(sounds.includes('laugh:victory'));
    for (const player of done.players) assert.equal(player.animation.name, player.team === done.lastResult.winner ? 'laugh' : 'hurt');
    game.update(1.99); assert.equal(game.getState().phase, 'celebrating'); assert.equal(results.length, 0);
    game.render(0); assert.equal(draws.slice(-4).filter(args => args[4].animation === 'laugh').length, 2);
    game.update(0.41); assert.equal(game.getState().phase, 'ended'); assert.equal(results.length, 1);
    assert.equal(results[0].won, done.lastResult.won); assert.equal(results[0].score, done.score);
    const ended = game.getState(); game.update(100); game.render(1000);
    assert.deepEqual(game.getState(), ended); assert.equal(results.length, 1);
    assert.equal(draws.slice(-4).filter(args => args[4].animation === 'laugh').length, 2);
  }
  assert.equal(outcomes.size, 2);
});

test('guandan: host pause and rendering cannot advance AI, selected cards, or animation clocks', () => {
  const { game, sounds } = harness(); game.start(); game.hint();
  const paused = game.getState(), soundCount = sounds.length;
  game.cancelInput(); game.render(1); game.render(8000);
  assert.deepEqual(game.getState(), paused); assert.equal(sounds.length, soundCount);
  game.toggleAuto(); assert.equal(game.getState().ownCanAct, false); assert.deepEqual(game.getState().selected, []);
  game.update(0.1); const after = game.getState();
  assert.equal(after.revision, paused.revision + 1, 'Animation frames do not force a DOM rebuild');
  assert.ok(after.players[0].animation.time > paused.players[0].animation.time);
  game.toggleAuto(); assert.equal(game.getState().ownCanAct, true);
});

function dealtHands(state) {
  const hands = state.players.map(player => player.hand.map(card => ({ ...card })));
  for (const item of [...state.tributeDetails].reverse()) {
    if (!['tribute', 'return'].includes(item.kind)) continue;
    hands[item.to] = hands[item.to].filter(card => card.id !== item.card.id); hands[item.from].push(item.card);
  }
  return hands;
}

test('guandan: real next-round deals perform single/double tribute, legal returns, resistance, and correct first leads', () => {
  const observed = new Set();
  const { game, results } = harness({ seed: 1, endless: true }); game.start();
  for (let round = 1; round <= 16; round++) {
    completePlay(game); const prior = settle(game);
    assert.equal(prior.phase, 'roundEnd'); assert.equal(prior.canNextRound, true); assert.equal(results.length, 0);
    assert.equal(game.nextRound(), true); const next = detailed(game); assertCards(next);
    assert.deepEqual(next.players.map(player => player.count), [27, 27, 27, 27]);
    assert.equal(next.round, prior.round + 1); assert.equal(next.level, prior.teamLevels[prior.lastResult.winner]);
    const before = dealtHands(next), details = next.tributeDetails;
    if (details[0].kind === 'resist') {
      observed.add('resist'); const resisting = details[0].players;
      assert.equal(resisting.flatMap(id => before[id]).filter(card => card.suit === 'J' && card.rank === 16).length, 2);
      assert.equal(next.turn, prior.finishOrder[0]); assert.equal(details.length, 1);
    } else {
      const gives = details.filter(item => item.kind === 'tribute'), returns = details.filter(item => item.kind === 'return');
      observed.add(gives.length === 2 ? 'double' : 'single');
      assert.equal(gives.length, prior.lastResult.doubleDown ? 2 : 1); assert.equal(returns.length, gives.length);
      for (const [index, item] of gives.entries()) {
        const allowed = before[item.from].filter(card => !(card.suit === 'H' && card.rank === next.level));
        assert.ok(!(item.card.suit === 'H' && item.card.rank === next.level));
        assert.equal(cardStrength(item.card, next.level), Math.max(...allowed.map(card => cardStrength(card, next.level))));
        assert.equal(item.to, prior.finishOrder[index]);
      }
      assert.equal(next.turn, gives[0].from, 'The larger tribute giver leads');
      if (gives.length === 2) {
        const first = cardStrength(gives[0].card, next.level), second = cardStrength(gives[1].card, next.level);
        assert.ok(first >= second);
        if (first === second) { observed.add('tied'); assert.equal(gives[0].from, (prior.finishOrder[0] + 1) % 4); }
      }
      for (const transfer of details) {
        if (transfer.kind === 'return') {
          const low = before[transfer.from].filter(card => card.suit !== 'J' && card.rank !== next.level && card.rank <= 10);
          if (low.length) assert.ok(low.some(card => card.id === transfer.card.id), 'Return a non-level 10 or lower when available');
          else {
            const allowed = before[transfer.from].filter(card => !(card.suit === 'H' && card.rank === next.level));
            assert.equal(cardStrength(transfer.card, next.level), Math.min(...allowed.map(card => cardStrength(card, next.level))));
          }
        }
        before[transfer.from] = before[transfer.from].filter(card => card.id !== transfer.card.id);
        before[transfer.to].push(transfer.card);
      }
    }
  }
  assert.deepEqual([...observed].sort(), ['double', 'resist', 'single', 'tied']);
});

test('guandan: endless levels rise by partner placement, must play A, then reset only after actually passing A', () => {
  const { game, results } = harness({ seed: 3, endless: true }); game.start();
  const increments = new Set(); let passedA = false, heldAtA = false, previousScore = 0;
  for (let round = 1; round <= 35 && !passedA; round++) {
    const before = game.getState(); const completed = completePlay(game); const result = completed.lastResult;
    increments.add(result.upgrade); assert.ok(completed.score >= previousScore); previousScore = completed.score;
    assert.equal(result.upgrade, result.mateRank === 2 ? 3 : result.mateRank === 3 ? 2 : 1);
    assert.equal(completed.teamLevels[1 - result.winner], before.teamLevels[1 - result.winner]);
    if (result.passedA) {
      passedA = true; assert.equal(before.teamLevels[result.winner], 14); assert.equal(before.level, 14);
      assert.ok(result.mateRank < 4); assert.equal(completed.teamLevels[result.winner], 2);
      assert.equal(completed.passesA[result.winner], 1);
    } else {
      assert.equal(completed.teamLevels[result.winner], Math.min(14, before.teamLevels[result.winner] + result.upgrade));
      if (before.teamLevels[result.winner] === 14 && result.mateRank === 4) heldAtA = true;
    }
    settle(game); assert.equal(results.length, 0);
    assert.equal(game.nextRound(), true);
  }
  assert.equal(passedA, true); assert.equal(heldAtA, true); assert.deepEqual([...increments].sort(), [1, 2, 3]);
  assert.equal(game.finish(), true); assert.equal(game.getState().phase, 'ended');
  assert.equal(results.length, 1); assert.equal(results[0].score, previousScore); assert.equal(game.finish(), false);
});

test('guandan: restart resets score, level and controls; destruction blocks every mutation', () => {
  const { game, results } = harness({ endless: true }); game.start(); completePlay(game);
  assert.equal(game.finish(), false, 'The victory laughter cannot be cut off by early finish');
  settle(game); assert.equal(game.finish(), true); assert.equal(results.length, 1);
  game.start({ endless: false }); const fresh = game.getState();
  assert.equal(fresh.score, 0); assert.equal(fresh.round, 1); assert.equal(fresh.level, 2); assert.equal(fresh.auto, false);
  assert.equal(fresh.lastResult, null); assert.equal(fresh.endless, false); assert.equal(fresh.hand.length, 27);
  game.destroy(); const destroyed = game.getState();
  for (const method of ['start', 'hint', 'playSelected', 'pass', 'toggleAuto', 'nextRound', 'finish', 'clearSelection', 'chooseInterpretation']) assert.equal(game[method](), false);
  assert.equal(game.toggleCard(fresh.hand[0].id), false); game.update(1000); game.cancelInput();
  assert.deepEqual(game.getState(), destroyed);
});
