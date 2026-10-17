// Pure two-deck Guandan rules. Public comparison ranks: 2..A=14,
// the current level=15, small joker=16, big joker=17. Runs use natural ranks.
// Rules reference: https://www.nsi.edu.cn/jgzj/75/d2/c1954a30162/page.htm
const SUITS = ['S', 'H', 'D', 'C'];
const NAMES = { single: '单张', pair: '对子', triple: '三同张', fullHouse: '三带对',
  straight: '顺子', pairRun: '三连对', tripleRun: '二连三', bomb: '炸弹', straightFlush: '同花顺', jokerBomb: '四王炸' };
const validLevel = level => Number.isInteger(level) && level >= 2 && level <= 14;
const isWild = (card, level) => card.rank === level && card.suit === 'H';
const normalStrength = (rank, level) => rank >= 15 ? rank + 1 : rank === level ? 15 : rank;
const rankName = rank => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '小王', 16: '大王' }[rank] || String(rank));
const validCard = card => card && typeof card.id === 'string' && card.id.length > 0
  && Number.isInteger(card.rank) && (card.rank >= 2 && card.rank <= 14 ? SUITS.includes(card.suit)
    : (card.rank === 15 || card.rank === 16) && card.suit === 'J');

function validCards(cards, max = 108) {
  if (!Array.isArray(cards) || !cards.length || cards.length > max) return false;
  const ids = new Set(), faces = new Map();
  for (const card of cards) {
    if (!validCard(card) || ids.has(card.id)) return false;
    ids.add(card.id);
    const face = `${card.rank}:${card.suit}`, count = (faces.get(face) || 0) + 1;
    if (count > 2) return false; // There are exactly two physical copies per face.
    faces.set(face, count);
  }
  return true;
}

export function createDeck() {
  const cards = [];
  for (let deck = 0; deck < 2; deck++) {
    for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) cards.push({ id: `${deck}-${suit}-${rank}`, rank, suit, deck });
    for (const rank of [15, 16]) cards.push({ id: `${deck}-J-${rank}`, rank, suit: 'J', deck });
  }
  return cards;
}

export function shuffleDeck(deck, rng = Math.random) {
  const result = deck.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const value = rng();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('rng must return a number in [0, 1).');
    const j = Math.floor(value * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function cardStrength(card, level = 2) {
  return validCard(card) && validLevel(level) ? normalStrength(card.rank, level) : 0;
}

export function sortHand(hand, level = 2) {
  return hand.slice().sort((a, b) => cardStrength(b, level) - cardStrength(a, level)
    || Number(isWild(b, level)) - Number(isWild(a, level))
    || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || a.id.localeCompare(b.id));
}

function sequences(length) {
  const values = [{ ranks: [14, ...Array.from({ length: length - 1 }, (_, i) => i + 2)], high: length }];
  for (let start = 2; start <= 15 - length; start++) values.push({ ranks: Array.from({ length }, (_, i) => start + i), high: start + length - 1 });
  return values;
}

// Finite shape templates, not subsets of a 27-card hand. Even with both wild
// cards, at most two missing positions are allocated among these groups.
const TEMPLATES = [];
function template(type, groups, naturalRank, extra = {}) {
  const size = groups.reduce((total, group) => total + group.count, 0);
  const power = type === 'jokerBomb' ? 900 : type === 'straightFlush' ? 300
    : type === 'bomb' ? (size <= 5 ? (size - 3) * 100 : (size - 2) * 100) : 0;
  TEMPLATES.push({ type, groups, naturalRank, size, power, ...extra });
}
for (let rank = 2; rank <= 16; rank++) template('pair', [{ rank, count: 2 }], rank);
for (let rank = 2; rank <= 14; rank++) template('triple', [{ rank, count: 3 }], rank);
for (let rank = 2; rank <= 14; rank++) for (let pair = 2; pair <= 16; pair++) {
  if (rank !== pair) template('fullHouse', [{ rank, count: 3 }, { rank: pair, count: 2 }], rank, { pairRank: pair });
}
for (let size = 4; size <= 10; size++) for (let rank = 2; rank <= 14; rank++) template('bomb', [{ rank, count: size }], rank);
for (const [type, length, copies] of [['straight', 5, 1], ['pairRun', 3, 2], ['tripleRun', 2, 3]]) {
  for (const sequence of sequences(length)) {
    template(type, sequence.ranks.map(rank => ({ rank, count: copies })), sequence.high, { sequence: sequence.ranks });
    if (type === 'straight') for (const suit of SUITS) {
      template('straightFlush', sequence.ranks.map(rank => ({ rank, count: 1, suit })), sequence.high, { sequence: sequence.ranks, suit });
    }
  }
}
template('jokerBomb', [{ rank: 15, count: 2 }, { rank: 16, count: 2 }], 16);
const BY_SIZE = new Map();
for (const item of TEMPLATES) {
  if (!BY_SIZE.has(item.size)) BY_SIZE.set(item.size, []);
  BY_SIZE.get(item.size).push(item);
}
const sequential = type => ['straight', 'straightFlush', 'pairRun', 'tripleRun'].includes(type);

function explanation(shape, cards, wildAssignments, level) {
  const substitutions = wildAssignments.filter(({ card, rank, suit }) => card.rank !== rank || card.suit !== suit)
    .map(({ card, rank, suit }) => ({ id: card.id, rank, suit }));
  const type = shape.type;
  return { type, name: type === 'bomb' ? `${shape.size}张${rankName(shape.naturalRank)}炸弹` : NAMES[type],
    size: shape.size, rank: sequential(type) ? shape.naturalRank : normalStrength(shape.naturalRank, level),
    power: shape.power, naturalRank: shape.naturalRank,
    ...(shape.pairRank ? { pairRank: shape.pairRank } : {}),
    ...(shape.sequence ? { sequence: [...shape.sequence] } : {}),
    ...(shape.suit ? { suit: shape.suit } : {}),
    cards: cards.map(card => ({ ...card })), substitutions,
    wildCount: cards.filter(card => isWild(card, level)).length };
}

function matchShape(shape, cards, level) {
  const remaining = shape.groups.map(group => group.count), wilds = [];
  for (const card of cards) {
    if (isWild(card, level)) { wilds.push(card); continue; }
    const index = shape.groups.findIndex((group, i) => remaining[i] > 0 && group.rank === card.rank && (!group.suit || group.suit === card.suit));
    if (index === -1) return null;
    remaining[index]--;
  }
  const assigned = [];
  for (let i = 0; i < remaining.length; i++) {
    const group = shape.groups[i];
    if (remaining[i] && group.rank >= 15) return null; // A heart-level card can never become a joker.
    for (let count = 0; count < remaining[i]; count++) {
      const card = wilds[assigned.length];
      if (!card) return null;
      assigned.push({ card, rank: group.rank, suit: group.suit || card.suit });
    }
  }
  if (assigned.length !== wilds.length) return null;
  return explanation(shape, cards, assigned, level);
}

/** All meaningful rank/type interpretations, including both ways of completing
 * two pairs + a wild and the ordinary/straight-flush interpretations. Equivalent
 * permutations of identical wild cards are represented once. */
export function classify(cards, level = 2) {
  if (!validLevel(level) || !validCards(cards, 10)) return [];
  if (cards.length === 1) {
    const card = cards[0];
    return [explanation({ type: 'single', size: 1, naturalRank: card.rank, power: 0 }, cards, [], level)];
  }
  const results = [];
  for (const shape of BY_SIZE.get(cards.length) || []) {
    const play = matchShape(shape, cards, level);
    if (play) results.push(play);
  }
  return results.sort(comparePlays);
}

function comparePlays(a, b) {
  return a.power - b.power || a.rank - b.rank || a.size - b.size || a.wildCount - b.wildCount
    || a.type.localeCompare(b.type) || (a.pairRank || 0) - (b.pairRank || 0);
}

export function beats(play, previous = null) {
  if (!play || !Object.hasOwn(NAMES, play.type) || !Number.isFinite(play.rank) || !Number.isFinite(play.power)) return false;
  previous = previous?.combo || previous;
  if (!previous) return true;
  if (play.power !== previous.power) return play.power > previous.power;
  if (play.power > 0) return play.rank > previous.rank;
  return play.type === previous.type && play.size === previous.size && play.rank > previous.rank;
}

function candidateKey(play) {
  return [play.type, play.power, play.rank, play.pairRank || '', play.suit || '', play.cards.map(card => card.id).sort().join(',')].join('|');
}

/** Returns representative physical selections per legal shape and wildcard
 * allocation, not every permutation of equivalent suits/deck copies. All bomb
 * lengths, natural/wild costs, and distinct beating interpretations remain. */
export function legalPlays(hand, level = 2, previous = null) {
  if (!validLevel(level) || !validCards(hand)) return [];
  previous = previous?.combo || previous;
  const wilds = hand.filter(card => isWild(card, level)).sort((a, b) => a.id.localeCompare(b.id));
  const naturals = hand.filter(card => !isWild(card, level));
  const byRank = new Map();
  for (const card of naturals) {
    if (!byRank.has(card.rank)) byRank.set(card.rank, []);
    byRank.get(card.rank).push(card);
  }
  // Prefer short suits when selecting an equal-rank representative, tending to
  // leave the longer suits available for later straight-flush combinations.
  const suitCounts = Object.fromEntries(SUITS.map(suit => [suit, naturals.filter(card => card.suit === suit).length]));
  for (const pool of byRank.values()) pool.sort((a, b) => suitCounts[a.suit] - suitCounts[b.suit] || a.id.localeCompare(b.id));
  const results = [], seen = new Set();
  function add(play) {
    if (!beats(play, previous)) return;
    const key = candidateKey(play); if (seen.has(key)) return;
    seen.add(key);
    const used = new Map();
    for (const card of play.cards) if (!isWild(card, level)) used.set(card.rank, (used.get(card.rank) || 0) + 1);
    play.bombCost = [...used].filter(([rank, count]) => byRank.get(rank).length >= 4 && count < byRank.get(rank).length).length;
    results.push(play);
  }
  for (const card of hand) add(explanation({ type: 'single', size: 1, naturalRank: card.rank, power: 0 }, [card], [], level));
  for (const shape of TEMPLATES) {
    if (shape.size > hand.length) continue;
    const rank = sequential(shape.type) ? shape.naturalRank : normalStrength(shape.naturalRank, level);
    if (!beats({ ...shape, rank }, previous)) continue;
    const pools = shape.groups.map(group => (byRank.get(group.rank) || []).filter(card => !group.suit || group.suit === card.suit));
    const minWild = shape.groups.reduce((sum, group, i) => sum + Math.max(0, group.count - pools[i].length), 0);
    if (minWild > wilds.length) continue;
    function fill(index, usedWild, cards, assignments) {
      if (index === shape.groups.length) { add(explanation(shape, cards, assignments, level)); return; }
      const group = shape.groups[index], pool = pools[index];
      const minimum = Math.max(0, group.count - pool.length);
      const maximum = group.rank >= 15 ? 0 : Math.min(group.count, wilds.length - usedWild);
      for (let count = minimum; count <= maximum; count++) {
        const selectedWilds = wilds.slice(usedWild, usedWild + count);
        fill(index + 1, usedWild + count,
          [...cards, ...pool.slice(0, group.count - count), ...selectedWilds],
          [...assignments, ...selectedWilds.map(card => ({ card, rank: group.rank, suit: group.suit || card.suit }))]);
      }
    }
    fill(0, 0, [], []);
  }
  return results.sort(comparePlays);
}

/** A conservative teammate-aware hint / CPU policy. Only the caller's own hand
 * and public counts/last-player information are inspected; no hidden hands. */
export function choosePlay(hand, level = 2, previous = null, context = {}) {
  const plays = legalPlays(hand, level, previous);
  if (!plays.length) return null;
  const finishers = plays.filter(play => play.size === hand.length);
  if (finishers.length) return finishers.sort(comparePlays)[0];
  const owner = context.previousPlayer ?? context.lastPlayer ?? previous?.player;
  const sameTeam = context.teammateLeading === true || (Number.isInteger(context.player) && Number.isInteger(owner)
    && owner !== context.player && owner % 2 === context.player % 2);
  if (previous && sameTeam) return null;
  const publicCounts = Array.isArray(context.counts) ? context.counts : [];
  const opponentCounts = publicCounts.filter((count, seat) => Number.isInteger(context.player) && seat % 2 !== context.player % 2 && count > 0);
  const opponentMinimum = context.opponentMinCards ?? (opponentCounts.length ? Math.min(...opponentCounts) : 27);
  const urgent = opponentMinimum <= 2;
  const previousCombo = previous?.combo || previous;
  const ordinary = plays.filter(play => play.power === 0);
  if (previousCombo && urgent && ['single', 'pair'].includes(previousCombo.type) && ordinary.length) {
    return ordinary.sort((a, b) => b.rank - a.rank || a.wildCount - b.wildCount || a.bombCost - b.bombCost)[0];
  }
  if (previousCombo && !ordinary.length && !urgent && hand.length > 9) return null;
  const value = play => play.bombCost * 90 + play.wildCount * 30 + play.power * 0.15 + (play.power > 0 ? 50 : 0)
    + play.rank + play.cards.filter(card => card.rank >= 15).length * 12 - (!previousCombo ? play.size * 12 : 0);
  return plays.sort((a, b) => value(a) - value(b) || comparePlays(a, b))[0];
}
