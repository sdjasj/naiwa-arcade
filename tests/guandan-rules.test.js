import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck, shuffleDeck, cardStrength, sortHand, classify, beats, legalPlays, choosePlay } from '../js/games/guandan-rules.js';

const DECK = createDeck();
const card = (rank, suit = rank >= 15 ? 'J' : 'S', deck = 0) => ({ ...DECK.find(item => item.rank === rank && item.suit === suit && item.deck === deck) });
function group(rank, size) { return DECK.filter(item => item.rank === rank).slice(0, size).map(item => ({ ...item })); }
const wilds = level => [card(level, 'H', 0), card(level, 'H', 1)];
const mixed = ranks => ranks.map((rank, i) => card(rank, ['S', 'D', 'C', 'H'][i % 4]));
const named = (cards, type, level = 2) => {
  const play = classify(cards, level).find(item => item.type === type);
  assert.ok(play, `${cards.map(c => `${c.rank}${c.suit}`).join(' ')} should form ${type}`); return play;
};
const signature = play => [play.type, play.size, play.rank, play.power, play.wildCount, play.pairRank || '', play.suit || '', play.sequence?.join(',') || ''].join('|');
function seeded(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; }; }

test('guandan deck: exactly two physical copies per face, four 27-card hands, immutable seeded shuffle', () => {
  const deck = createDeck(), snapshot = JSON.stringify(deck);
  assert.equal(deck.length, 108); assert.equal(new Set(deck.map(item => item.id)).size, 108);
  for (let rank = 2; rank <= 14; rank++) for (const suit of ['S', 'H', 'D', 'C']) {
    assert.equal(deck.filter(item => item.rank === rank && item.suit === suit).length, 2);
  }
  for (const rank of [15, 16]) assert.equal(deck.filter(item => item.rank === rank && item.suit === 'J').length, 2);
  const shuffled = shuffleDeck(deck, seeded(123));
  assert.deepEqual(shuffled, shuffleDeck(deck, seeded(123))); assert.notDeepEqual(shuffled, deck);
  assert.equal(JSON.stringify(deck), snapshot); assert.equal(new Set(shuffled.map(item => item.id)).size, 108);
  assert.deepEqual(Array.from({ length: 4 }, (_, index) => shuffled.slice(index * 27, index * 27 + 27).length), [27, 27, 27, 27]);
  assert.throws(() => shuffleDeck(deck, () => 1), RangeError);
});

test('guandan strength: level above A below jokers, suits equal, hand sorting leaves caller untouched', () => {
  const level = 7;
  assert.equal(cardStrength(card(7, 'H'), level), 15);
  assert.equal(cardStrength(card(7, 'S'), level), 15);
  assert.equal(cardStrength(card(14), level), 14);
  assert.equal(cardStrength(card(15), level), 16); assert.equal(cardStrength(card(16), level), 17);
  const hand = [card(3), card(14), card(7, 'D'), card(16), card(15)];
  const snapshot = JSON.stringify(hand);
  assert.deepEqual(sortHand(hand, level).map(item => item.rank), [16, 15, 7, 14, 3]);
  assert.equal(JSON.stringify(hand), snapshot);
  assert.equal(cardStrength({ id: 'bad', rank: 15, suit: 'S' }, level), 0);
});

test('guandan classification: all ordinary groups, real joker pairs and full house with joker attachment', () => {
  assert.equal(named([card(10)], 'single').rank, 10);
  assert.equal(named(group(8, 2), 'pair').rank, 8);
  assert.equal(named(group(8, 3), 'triple').rank, 8);
  assert.equal(named([...group(8, 3), ...group(10, 2)], 'fullHouse').rank, 8);
  assert.equal(named([...group(8, 3), ...group(16, 2)], 'fullHouse').pairRank, 16);
  assert.equal(named(group(15, 2), 'pair').rank, 16);
  assert.equal(named(group(16, 2), 'pair').rank, 17);
  assert.deepEqual(classify([card(15), card(16)], 2), []);
  assert.deepEqual(classify([...group(8, 3), card(9)], 2), []);
  assert.deepEqual(classify([...group(8, 3), card(9), card(10)], 2), []);
});

test('guandan wilds: only heart-level is flexible, a single keeps its own rank, and jokers can never be substituted', () => {
  const level = 6, wild = card(6, 'H');
  const single = classify([wild], level);
  assert.equal(single.length, 1); assert.equal(single[0].type, 'single'); assert.equal(single[0].rank, 15);
  assert.equal(single[0].substitutions.length, 0);
  const pair = named([card(9), wild], 'pair', level);
  assert.equal(pair.rank, 9); assert.deepEqual(pair.substitutions, [{ id: wild.id, rank: 9, suit: 'H' }]);
  assert.equal(named([card(9), ...wilds(level)], 'triple', level).rank, 9);
  assert.deepEqual(classify([card(9), card(6, 'D')], level), []);
  assert.deepEqual(classify([card(15), wild], level), []);
  assert.deepEqual(classify([card(16), wild], level), []);
  assert.deepEqual(classify([...group(16, 2), wild], level), []);
  assert.deepEqual(classify([card(15), card(16), ...wilds(level)], level), []);
  const doubleWild = classify(wilds(level), level);
  assert.equal(doubleWild.length, 13); assert.ok(doubleWild.every(play => play.type === 'pair' && play.rank <= 15));
  assert.equal(doubleWild.find(play => play.naturalRank === level).substitutions.length, 0);
});

test('guandan ambiguity: two pairs plus a wild support both triples, and response can select the stronger interpretation', () => {
  const cards = [...group(7, 2), ...group(8, 2), card(2, 'H')];
  const interpretations = classify(cards, 2).filter(play => play.type === 'fullHouse');
  assert.deepEqual(interpretations.map(play => play.rank), [7, 8]);
  const previous = named([...group(7, 3), ...group(3, 2)], 'fullHouse');
  assert.equal(beats(interpretations[0], previous), false); assert.equal(beats(interpretations[1], previous), true);
  const response = legalPlays(cards, 2, previous).filter(play => play.type === 'fullHouse' && play.size === cards.length);
  assert.equal(response.length, 1); assert.equal(response[0].rank, 8);
  assert.deepEqual(new Set(response[0].cards.map(card => card.id)), new Set(cards.map(card => card.id)));
  const arbitraryPair = classify([...group(7, 3), ...wilds(2)], 2).filter(play => play.type === 'fullHouse' && play.naturalRank === 7);
  assert.equal(arbitraryPair.length, 12, 'a pair made of two wilds has every non-joker rank except the triple rank');
});

test('guandan sequences: exact lengths, A low/high and natural level rank, without wrapping or joker runs', () => {
  const wheel = named(mixed([14, 2, 3, 4, 5]), 'straight', 9);
  const sixHigh = named(mixed([2, 3, 4, 5, 6]), 'straight', 9);
  const broadway = named(mixed([10, 11, 12, 13, 14]), 'straight', 9);
  assert.equal(wheel.rank, 5); assert.equal(broadway.rank, 14); assert.ok(beats(sixHigh, wheel));
  assert.equal(named(mixed([5, 6, 7, 8, 9]), 'straight', 7).rank, 9, 'level 7 is natural inside sequences');
  assert.deepEqual(classify(mixed([12, 13, 14, 2, 3]), 9), []);
  assert.deepEqual(classify(mixed([2, 3, 4, 5]), 9), []);
  assert.deepEqual(classify(mixed([2, 3, 4, 5, 6, 7]), 9), []);
  assert.deepEqual(classify([...mixed([11, 12, 13, 14]), card(15)], 9), []);
  const lowPairs = named([14, 2, 3].flatMap(rank => group(rank, 2)), 'pairRun', 9);
  const highPairs = named([12, 13, 14].flatMap(rank => group(rank, 2)), 'pairRun', 9);
  assert.equal(lowPairs.rank, 3); assert.equal(highPairs.rank, 14);
  assert.equal(named([14, 2].flatMap(rank => group(rank, 3)), 'tripleRun', 9).rank, 2);
  assert.equal(named([13, 14].flatMap(rank => group(rank, 3)), 'tripleRun', 9).rank, 14);
  assert.deepEqual(classify([13, 14, 2].flatMap(rank => group(rank, 2)), 9), []);
  assert.deepEqual(classify([7, 8].flatMap(rank => group(rank, 2)), 9), []);
  assert.deepEqual(classify([6, 7, 8].flatMap(rank => group(rank, 3)), 9), []);
});

test('guandan straight flush: wild changes suit, multiple endpoints remain available, mismatched fixed suits reject flush', () => {
  const cards = [7, 8, 9, 10].map(rank => card(rank, 'S')).concat(card(2, 'H'));
  const plays = classify(cards, 2);
  assert.deepEqual(plays.filter(p => p.type === 'straight').map(p => p.rank), [10, 11]);
  const flushes = plays.filter(p => p.type === 'straightFlush');
  assert.deepEqual(flushes.map(p => p.rank), [10, 11]);
  assert.ok(flushes.every(p => p.substitutions.length === 1 && p.substitutions[0].suit === 'S'));
  const changed = [...cards]; changed[0] = card(7, 'D');
  assert.ok(classify(changed, 2).some(p => p.type === 'straight'));
  assert.equal(classify(changed, 2).some(p => p.type === 'straightFlush'), false);
  const twoWilds = [3, 4, 5].map(rank => card(rank, 'C')).concat(wilds(2));
  assert.deepEqual(classify(twoWilds, 2).filter(p => p.type === 'straightFlush').map(p => p.rank), [5, 6, 7]);
});

test('guandan bomb ladder: ordinary < four < five < flush < six through ten < four real jokers', () => {
  const normal = named(group(14, 3), 'triple', 2);
  const bombs = Array.from({ length: 7 }, (_, i) => {
    const count = i + 4;
    const cards = count <= 8 ? group(3, count) : [...group(3, 8), ...wilds(2).slice(0, count - 8)];
    const play = named(cards, 'bomb', 2); assert.equal(play.size, count); return play;
  });
  const flush = named([5, 6, 7, 8, 9].map(rank => card(rank, 'S')), 'straightFlush', 2);
  const jokers = named([...group(15, 2), ...group(16, 2)], 'jokerBomb', 2);
  const ladder = [normal, bombs[0], bombs[1], flush, ...bombs.slice(2), jokers];
  assert.deepEqual(ladder.map(p => p.power), [0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
  for (let i = 1; i < ladder.length; i++) for (let j = 0; j < i; j++) {
    assert.equal(beats(ladder[i], ladder[j]), true); assert.equal(beats(ladder[j], ladder[i]), false);
  }
  assert.equal(beats(jokers, jokers), false);
  assert.equal(beats(named(group(2, 4), 'bomb', 2), named(group(14, 4), 'bomb', 2)), true);
  assert.equal(beats(named(group(3, 5), 'bomb', 2), named(group(2, 4), 'bomb', 2)), true);
});

test('guandan beats: ordinary types and sizes must match, equal ranks never win, wrapper is accepted', () => {
  const single = named([card(8)], 'single');
  const pair = named(group(9, 2), 'pair');
  const triple = named(group(10, 3), 'triple');
  assert.equal(beats(pair, single), false); assert.equal(beats(triple, pair), false);
  assert.equal(beats(named([card(8, 'D')], 'single'), single), false);
  assert.equal(beats(named([card(9)], 'single'), { player: 2, cards: single.cards, combo: single }), true);
  assert.equal(beats(single, null), true); assert.equal(beats(null, single), false);
  assert.equal(beats({ type: '__proto__', rank: 99, power: 0 }, single), false);
});

test('guandan invalid input: repeated ids, impossible physical faces, bad suits/ranks/levels and oversized plays reject', () => {
  const one = card(7);
  assert.deepEqual(classify([one, one], 2), []);
  assert.deepEqual(classify([one, { ...one, id: 'copy2' }, { ...one, id: 'copy3' }], 2), []);
  for (const bad of [{ id: 'bad', rank: 15, suit: 'S' }, { id: 'bad', rank: 2, suit: 'J' },
    { id: 'bad', rank: 1, suit: 'H' }, { id: 'bad', rank: 7.5, suit: 'S' }, { id: '', rank: 7, suit: 'S' }, null]) {
    assert.deepEqual(classify([bad], 2), []); assert.deepEqual(legalPlays([bad], 2), []);
  }
  for (const level of [1, 15, NaN, '2']) assert.deepEqual(classify([one], level), []);
  assert.deepEqual(classify([], 2), []); assert.deepEqual(legalPlays([], 2), []);
  assert.deepEqual(classify(createDeck().slice(0, 11), 2), []);
});

test('guandan candidates: preserve natural/both wildcard costs, all bomb lengths, and do not split bombs unknowingly', () => {
  const hand = [...group(6, 4), ...group(8, 2), card(3), card(4), ...wilds(2)];
  const plays = legalPlays(hand, 2);
  assert.deepEqual(new Set(plays.filter(p => p.type === 'pair' && p.rank === 8).map(p => p.wildCount)), new Set([0, 1, 2]));
  const bombs = plays.filter(p => p.type === 'bomb' && p.rank === 6);
  assert.deepEqual([...new Set(bombs.map(p => p.size))], [4, 5, 6]);
  assert.deepEqual([4, 5, 6].map(size => Math.min(...bombs.filter(p => p.size === size).map(p => p.wildCount))), [0, 1, 2]);
  assert.ok(plays.filter(p => p.type === 'single' && p.rank === 6).every(p => p.bombCost === 1));
  assert.ok(bombs.filter(p => p.size - p.wildCount === 4).every(p => p.bombCost === 0));
  assert.ok(bombs.filter(p => p.size - p.wildCount < 4).every(p => p.bombCost === 1));
  const first = plays[0]; first.cards[0].rank = 999; if (first.substitutions[0]) first.substitutions[0].rank = 999;
  assert.ok(hand.every(card => card.rank <= 16), 'candidate objects cannot modify the real hand');
});

test('guandan candidates: representative templates cover every semantic subset interpretation in a small ambiguous hand', () => {
  const hand = [...group(7, 2), ...group(8, 2), card(9), ...wilds(2), ...group(15, 2)];
  const generated = new Set(legalPlays(hand, 2).map(signature));
  for (let mask = 1; mask < 2 ** hand.length; mask++) {
    const selected = hand.filter((_, i) => mask & (1 << i));
    for (const play of classify(selected, 2)) assert.ok(generated.has(signature(play)), `missing candidate shape ${signature(play)}`);
  }
  const previous = named([...group(7, 3), ...group(3, 2)], 'fullHouse');
  assert.ok(legalPlays(hand, 2, previous).every(play => beats(play, previous)));
});

test('guandan candidates: seeded 27-card hands return only owned, unique and reclassifiable plays within a practical bound', () => {
  const random = seeded(20261017), started = performance.now();
  let count = 0;
  for (let handIndex = 0; handIndex < 100; handIndex++) {
    const level = 2 + handIndex % 13, hand = shuffleDeck(createDeck(), random).slice(0, 27), snapshot = JSON.stringify(hand);
    const ids = new Set(hand.map(card => card.id)), plays = legalPlays(hand, level), keys = new Set();
    assert.ok(plays.length >= 27 && plays.length < 5000);
    for (const play of plays) {
      count++;
      assert.equal(new Set(play.cards.map(card => card.id)).size, play.size);
      assert.ok(play.cards.every(card => ids.has(card.id)));
      assert.ok(classify(play.cards, level).some(candidate => signature(candidate) === signature(play)));
      const key = `${signature(play)}:${play.cards.map(card => card.id).sort().join(',')}`;
      assert.ok(!keys.has(key)); keys.add(key);
    }
    assert.equal(JSON.stringify(hand), snapshot);
  }
  assert.ok(count > 3000, 'exercise substantial mixed-suit/wild candidate coverage');
  assert.ok(performance.now() - started < 4000, '100 full hand generations plus independent reclassification should remain interactive');
});

test('guandan choosePlay: public team state yields to partner, goes out when possible, blocks an imminent opponent', () => {
  const previous = named([card(4)], 'single');
  const hand = [card(5), card(9), card(16)];
  assert.equal(choosePlay(hand, 2, previous, { teammateLeading: true }), null);
  assert.equal(choosePlay(hand, 2, previous, { player: 0, lastPlayer: 2 }), null);
  const final = choosePlay([card(5)], 2, previous, { teammateLeading: true });
  assert.equal(final.size, 1); assert.equal(final.rank, 5);
  const block = choosePlay(hand, 2, previous, { player: 0, lastPlayer: 1, opponentMinCards: 1 });
  assert.equal(block.rank, 17);
  const ordinary = choosePlay(hand, 2, previous, { player: 0, lastPlayer: 1, counts: [3, 17, 12, 20] });
  assert.equal(ordinary.rank, 5);
  const context = { player: 0, lastPlayer: 1, counts: [3, 17, 12, 20] };
  Object.defineProperty(context, 'opponentHands', { get() { throw new Error('AI must not inspect hidden cards'); } });
  assert.ok(choosePlay(hand, 2, previous, context));
});

test('guandan choosePlay: free leads preserve natural bombs/wilds when a useful ordinary group is available', () => {
  const hand = [...group(8, 4), ...group(5, 2), ...group(6, 2), ...group(7, 2), ...wilds(2), card(14)];
  const play = choosePlay(hand, 2);
  assert.equal(play.type, 'pairRun'); assert.equal(play.bombCost, 0); assert.equal(play.wildCount, 0);
  assert.ok(play.cards.every(card => [5, 6, 7].includes(card.rank)));
  const simple = choosePlay([...group(8, 4), ...group(3, 2), card(11)], 2);
  assert.equal(simple.type, 'pair', 'a useful low pair should lead before spending a four-card bomb');
  assert.equal(simple.rank, 3);
  const onlyBombs = choosePlay([...group(3, 4), ...group(4, 4)], 2);
  assert.equal(onlyBombs.type, 'bomb', 'when the hand is all bombs, do not split one into an ordinary single');
  assert.equal(choosePlay([], 2), null);
});
