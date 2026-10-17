import { createDeck, shuffleDeck, sortHand, classify, beats, legalPlays, choosePlay } from './guandan-rules.js?v=13a5c1ec0c6e';

const NAMES = ['你', '右手对手', '对家队友', '左手对手'];
const SUITS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const FACE = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const CELEBRATION = 2.4;
const teamOf = id => id % 2;
const partnerOf = id => (id + 2) % 4;
const rankText = rank => FACE[rank] || String(rank);
const naturalRankText = rank => rank === 15 ? '小王' : rank === 16 ? '大王' : rankText(rank);
const interpretationKey = combo => JSON.stringify([combo.type, combo.size, combo.rank, combo.power,
  combo.naturalRank ?? null, combo.pairRank ?? null, combo.suit ?? null, combo.sequence || null]);
function interpretationLabel(combo) {
  const detail = combo.sequence?.length ? `${naturalRankText(combo.sequence[0])}至${naturalRankText(combo.sequence.at(-1))}`
    : combo.type === 'fullHouse' ? `${naturalRankText(combo.naturalRank)}带${naturalRankText(combo.pairRank)}`
      : combo.type === 'jokerBomb' || combo.type === 'bomb' ? '' : naturalRankText(combo.naturalRank);
  return `${combo.name}${detail ? ` · ${detail}` : ''}${combo.substitutions?.length ? ' · 百搭' : ''}`;
}
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const strength = (card, level) => card.suit === 'J' ? card.rank + 1 : card.rank === level ? 15 : card.rank;
const wild = (card, level) => card.suit === 'H' && card.rank === level;
const cardText = card => card.suit === 'J' ? card.rank === 16 ? '大王' : '小王' : `${SUITS[card.suit]}${rankText(card.rank)}`;

function seededRandom(seed) {
  let value = Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : 0;
  if (!Number.isFinite(Number(seed))) for (const letter of String(seed)) value = Math.imul(value ^ letter.charCodeAt(0), 16777619) >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let x = value;
    x = Math.imul(x ^ x >>> 15, x | 1);
    x ^= x + Math.imul(x ^ x >>> 7, x | 61);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

export function createGame(env) {
  const { ctx, width = 960, height = 560, drawFrog, audio, onScore, onStatus, onEnd } = env;
  let phase = 'idle', endless = env.endless === true, destroyed = false, endSent = false;
  let random = Math.random, round = 0, level = 2, teamLevels = [2, 2], passesA = [0, 0];
  let hands = [[], [], [], []], turn = 0, lastPlay = null, passed = new Set(), finishOrder = [];
  let selected = [], selectedCombo = null, selectionLabel = '点击下方手牌选择，红桃级牌可以百搭。';
  let selectionCombos = [], selectionOptions = [], selectionIndex = -1;
  let score = 0, ownPlayed = 0, auto = false, elapsed = 0, turnWait = 0.8, celebrating = 0;
  let message = '你和对家一队，先把两个人的手牌都打完。', revision = 0;
  let lastResult = null, tributeLog = [], tributeDetails = [], tableLog = [], history = [];
  let discarded = [], hintCache = null, hintIndex = 0, lastSpecial = -Infinity;
  const animations = Array.from({ length: 4 }, () => ({ name: 'idle', time: 0, remaining: 0 }));

  const notify = text => { message = text; revision++; onStatus?.(text); };
  const sound = kind => audio?.play?.(kind);
  const ownCanAct = () => !destroyed && phase === 'playing' && turn === 0 && !auto;
  const canPass = () => ownCanAct() && lastPlay !== null && lastPlay.player !== 0;
  function note(text) { tableLog.unshift(text); tableLog.length = Math.min(tableLog.length, 5); }
  function resetSelection() {
    selected = []; selectedCombo = null;
    selectionCombos = []; selectionOptions = []; selectionIndex = -1;
    selectionLabel = '点击手牌选择；提示可以轮换合法组合。';
  }
  function invalidateHints() { hintCache = null; hintIndex = 0; }
  function animate(id, name, duration = 0.7) { animations[id] = { name, time: 0, remaining: duration }; }
  function setScore(value) { score = Math.min(2 ** 40 - 1, value); onScore?.(score); }
  function nextActive(after) {
    for (let offset = 1; offset <= 4; offset++) {
      const id = (after + offset) % 4;
      if (hands[id].length) return id;
    }
    return -1;
  }
  function prepareTurn(id) {
    turn = id; turnWait = 0.65 + random() * 0.3;
    resetSelection(); invalidateHints(); revision++;
  }
  function chooseTribute(hand) {
    return hand.filter(card => !wild(card, level)).sort((a, b) => strength(b, level) - strength(a, level) || a.id.localeCompare(b.id))[0];
  }
  function chooseReturn(hand) {
    const low = hand.filter(card => card.suit !== 'J' && card.rank !== level && card.rank <= 10);
    const pool = low.length ? low : hand.filter(card => !wild(card, level));
    return pool.sort((a, b) => strength(a, level) - strength(b, level) || a.id.localeCompare(b.id))[0];
  }
  function transfer(from, to, card, kind) {
    hands[from] = hands[from].filter(item => item.id !== card.id); hands[to].push(card);
    tributeDetails.push({ kind, from, to, card: { ...card } });
    tributeLog.push(`${NAMES[from]}${kind === 'tribute' ? '向' : '还给'}${NAMES[to]}${kind === 'tribute' ? '进贡' : ''} ${cardText(card)}`);
  }
  function applyTribute(previous) {
    const head = previous.finishOrder[0], winners = previous.winner;
    const givers = previous.doubleDown ? [0, 1, 2, 3].filter(id => teamOf(id) !== winners) : [previous.finishOrder[3]];
    const bigJokers = givers.reduce((sum, id) => sum + hands[id].filter(card => card.suit === 'J' && card.rank === 16).length, 0);
    if (bigJokers === 2) {
      tributeLog.push(`${givers.map(id => NAMES[id]).join('与')}持有两张大王，抗贡；${NAMES[head]}先出。`);
      tributeDetails.push({ kind: 'resist', players: [...givers], leader: head });
      return head;
    }
    const offers = givers.map(id => ({ id, card: chooseTribute(hands[id]) }));
    offers.sort((a, b) => strength(b.card, level) - strength(a.card, level) || (a.id - head + 4) % 4 - (b.id - head + 4) % 4);
    const pairs = offers.map((offer, index) => ({ from: offer.id, to: previous.finishOrder[index], card: offer.card }));
    for (const pair of pairs) transfer(pair.from, pair.to, pair.card, 'tribute');
    const returns = pairs.map(pair => ({ from: pair.to, to: pair.from, card: chooseReturn(hands[pair.to]) }));
    for (const item of returns) transfer(item.from, item.to, item.card, 'return');
    tributeLog.push(`${NAMES[offers[0].id]}${offers.length === 2 ? '进贡较大（同点按头游下家顺序）' : '进贡后'}先出。`);
    return offers[0].id;
  }
  function deal(previous = null) {
    hands = [[], [], [], []];
    const deck = shuffleDeck(createDeck(), random);
    deck.forEach((card, index) => hands[index % 4].push(card));
    lastPlay = null; passed.clear(); finishOrder = []; discarded = []; ownPlayed = 0;
    tributeLog = []; tributeDetails = []; tableLog = []; history = []; celebrating = 0;
    const leader = previous ? applyTribute(previous) : 0;
    hands = hands.map(hand => sortHand(hand, level));
    for (let id = 0; id < 4; id++) animate(id, 'idle', 0);
    phase = 'playing'; prepareTurn(leader);
    notify(`第 ${round} 局 · 打 ${rankText(level)} · ${NAMES[leader]}先出。${previous ? tributeLog.at(-1) : '你与对家队友同队。'}`);
  }
  function start(options = {}) {
    if (destroyed) return false;
    if (options.endless !== undefined) endless = options.endless === true;
    const seed = options.seed ?? env.seed;
    random = seed === undefined ? Math.random : seededRandom(seed);
    round = 1; level = 2; teamLevels = [2, 2]; passesA = [0, 0];
    elapsed = 0; auto = false; endSent = false; lastResult = null; lastSpecial = -Infinity;
    setScore(0); deal(); sound('laugh:start');
    return true;
  }
  function checkSelection(preferred = null) {
    const cards = hands[0].filter(card => selected.includes(card.id));
    const options = classify(cards, level);
    const fitting = options.filter(combo => beats(combo, lastPlay?.combo || null));
    fitting.sort((a, b) => a.power - b.power || a.rank - b.rank);
    selectionCombos = fitting;
    selectionOptions = fitting.map((combo, index) => ({ index, label: interpretationLabel(combo) }));
    const preferredIndex = preferred ? fitting.findIndex(combo => interpretationKey(combo) === interpretationKey(preferred)) : -1;
    selectionIndex = fitting.length ? Math.max(0, preferredIndex) : -1;
    selectedCombo = fitting[selectionIndex] || null;
    selectionLabel = !selected.length ? '点击手牌选择；提示可以轮换合法组合。'
      : selectedCombo ? interpretationLabel(selectedCombo)
        : options.length ? '牌型合法，但压不过桌面这手牌。' : '这些牌不能组成合法牌型。';
  }
  function chooseInterpretation(index) {
    if (!ownCanAct() || !Number.isInteger(index) || !selectionCombos[index]) return false;
    selectionIndex = index; selectedCombo = selectionCombos[index];
    selectionLabel = selectionOptions[index].label; notify(`已声明：${selectionLabel}。`); return true;
  }
  function toggleCard(id) {
    if (!ownCanAct() || !hands[0].some(card => card.id === id)) return false;
    selected = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
    checkSelection(); notify(selectionLabel); return true;
  }
  function clearSelection() {
    if (!ownCanAct()) return false;
    resetSelection(); notify('已重选。点击手牌，或用提示寻找组合。'); return true;
  }
  function hint() {
    if (!ownCanAct()) return false;
    if (!hintCache) {
      hintCache = legalPlays(hands[0], level, lastPlay?.combo || null);
      hintCache.sort((a, b) => lastPlay
        ? a.power - b.power || a.rank - b.rank || b.size - a.size
        : a.power - b.power || b.size - a.size || a.rank - b.rank);
      hintIndex = 0;
    }
    if (!hintCache.length) { resetSelection(); notify('这手压不过，可以选择「不要」。'); return false; }
    const combo = hintCache[hintIndex++ % hintCache.length];
    selected = combo.cards.map(card => card.id); checkSelection(combo);
    notify(`提示 ${((hintIndex - 1) % hintCache.length) + 1}/${hintCache.length}：${selectionLabel}。`); return true;
  }
  function finishRound(doubleDown) {
    if (!doubleDown) {
      const last = [0, 1, 2, 3].find(id => !finishOrder.includes(id));
      if (last !== undefined) finishOrder.push(last);
    }
    const head = finishOrder[0], winner = teamOf(head), teammate = partnerOf(head);
    const mateRank = doubleDown ? 2 : finishOrder.indexOf(teammate) + 1;
    const upgrade = mateRank === 2 ? 3 : mateRank === 3 ? 2 : 1;
    const before = teamLevels[winner];
    const passedA = before === 14 && level === 14 && mateRank < 4;
    if (passedA) { passesA[winner]++; teamLevels[winner] = 2; }
    else teamLevels[winner] = Math.min(14, before + upgrade);
    const ownRank = finishOrder.indexOf(0) + 1;
    const bonus = (winner === 0 ? 500 : 0) + (ownRank === 1 ? 200 : ownRank === 2 ? 100 : 0);
    setScore(score + bonus);
    lastResult = { round, winner, won: winner === 0, doubleDown, finishOrder: [...finishOrder], mateRank,
      upgrade, passedA, levelBefore: before, levelAfter: teamLevels[winner], teamLevels: [...teamLevels],
      ownRank: ownRank || null, ownPlayed, bonus, score, roundScore: ownPlayed * 5 + bonus };
    phase = 'celebrating'; celebrating = CELEBRATION; resetSelection(); invalidateHints();
    for (let id = 0; id < 4; id++) animate(id, teamOf(id) === winner ? 'laugh' : 'hurt', Infinity);
    // Victory/taunt is an actual audible event for either team, including the
    // opponents. The host remains in playing state for the whole celebration.
    sound('win'); sound('laugh:victory');
    const text = winner === 0 ? '你们赢啦！对家笑得肚皮都在抖。' : '对面赢啦！两位对手正捧着肚皮笑你。';
    const upgradeText = passedA ? '成功过 A，重新从 2 出发。' : `升 ${upgrade} 级，下次打 ${rankText(teamLevels[winner])}。`;
    notify(`${text}${doubleDown ? ' 双上游！' : ''}${endless ? upgradeText : ''}`); note(text);
  }
  function submitEnd(result) {
    if (endSent) return;
    endSent = true; phase = 'ended'; revision++;
    onEnd?.(result);
  }
  function executePlay(id, requested) {
    if (destroyed || phase !== 'playing' || turn !== id || !requested?.cards?.length) return false;
    const ids = requested.cards.map(card => card.id), cards = hands[id].filter(card => ids.includes(card.id));
    if (new Set(ids).size !== ids.length || cards.length !== ids.length) return false;
    const options = classify(cards, level).filter(combo => beats(combo, lastPlay?.combo || null));
    const combo = options.find(item => interpretationKey(item) === interpretationKey(requested));
    if (!combo) return false;
    hands[id] = hands[id].filter(card => !ids.includes(card.id)); discarded.push(...cards);
    lastPlay = { player: id, cards: [...cards], combo }; passed.clear();
    if (id === 0) { ownPlayed += cards.length; setScore(score + cards.length * 5); }
    history.push({ type: 'play', player: id, cards: cards.map(card => ({ ...card })), combo: copy(combo), remaining: hands[id].length });
    const text = `${NAMES[id]}出${combo.name}，还剩 ${hands[id].length} 张。`;
    note(text); notify(text); animate(id, combo.power > 0 ? 'laugh' : 'light', combo.power > 0 ? 1 : 0.45); sound('pop');
    if (combo.power > 0 && elapsed - lastSpecial >= 3) { sound('laugh:special'); lastSpecial = elapsed; }
    if (!hands[id].length) {
      finishOrder.push(id); note(`${NAMES[id]}第 ${finishOrder.length} 个出完！`);
      if (finishOrder.length === 2 && teamOf(finishOrder[0]) === teamOf(finishOrder[1])) { finishRound(true); return true; }
      if (finishOrder.length === 3) { finishRound(false); return true; }
    }
    prepareTurn(nextActive(id)); return true;
  }
  function playSelected() {
    if (!ownCanAct()) return false;
    if (!selectedCombo) { notify(selected.length ? selectionLabel : '先选择要出的牌，或点「提示」。'); return false; }
    return executePlay(0, selectedCombo);
  }
  function executePass(id) {
    if (destroyed || phase !== 'playing' || turn !== id || !lastPlay || lastPlay.player === id) return false;
    passed.add(id); history.push({ type: 'pass', player: id, against: lastPlay.player });
    note(`${NAMES[id]}不要。`); notify(`${NAMES[id]}不要。`);
    const activeOpponents = [0, 1, 2, 3].filter(player => hands[player].length && player !== lastPlay.player);
    if (activeOpponents.every(player => passed.has(player))) {
      const previous = lastPlay.player;
      const leader = hands[previous].length ? previous : hands[partnerOf(previous)].length ? partnerOf(previous) : nextActive(previous);
      const catchWind = !hands[previous].length;
      history.push({ type: catchWind ? 'catchWind' : 'lead', player: leader, previous });
      lastPlay = null; passed.clear(); prepareTurn(leader);
      notify(catchWind ? `${NAMES[previous]}已出完，由对家${NAMES[leader]}接风先出。` : `都不要，${NAMES[leader]}重新领出。`);
      return true;
    }
    prepareTurn(nextActive(id)); return true;
  }
  function pass() {
    if (!canPass()) { if (ownCanAct()) notify('你是领出方，必须先出一手牌。'); return false; }
    return executePass(0);
  }
  function aiTurn() {
    const id = turn;
    if (id < 0 || !hands[id].length) return;
    const context = { player: id, lastPlayer: lastPlay?.player ?? null,
      teammateLeading: !!lastPlay && teamOf(lastPlay.player) === teamOf(id),
      opponentMinCards: Math.min(...[0, 1, 2, 3].filter(player => teamOf(player) !== teamOf(id) && hands[player].length).map(player => hands[player].length)),
      counts: hands.map(hand => hand.length) };
    const combo = choosePlay(hands[id], level, lastPlay?.combo || null, context);
    if (combo && executePlay(id, combo)) return;
    if (lastPlay) { executePass(id); return; }
    // A lead can never pass. Keep the table moving even if a heuristic has no
    // recommendation; this fallback uses only this player's lowest card.
    const card = [...hands[id]].sort((a, b) => strength(a, level) - strength(b, level))[0];
    const single = classify([card], level)[0];
    if (single) executePlay(id, single);
  }
  function toggleAuto() {
    if (destroyed || !['playing', 'roundEnd', 'celebrating'].includes(phase)) return false;
    auto = !auto; resetSelection(); invalidateHints(); turnWait = Math.max(turnWait, 0.4);
    notify(auto ? '已托管：奶蛙会替你出牌；再次点击可收回。' : '已收回托管，轮到你时自己选牌。'); return true;
  }
  function nextRound() {
    if (destroyed || !endless || phase !== 'roundEnd' || !lastResult) return false;
    const previous = copy(lastResult); round++; level = teamLevels[previous.winner];
    deal(previous); sound('laugh:start'); return true;
  }
  function finish() {
    if (destroyed || !endless || !['playing', 'roundEnd'].includes(phase)) return false;
    resetSelection(); notify(`本次连打收工，累计 ${score} 分。`);
    submitEnd({ score, won: !!lastResult?.won, title: '奶蛙收牌，笑着下桌。', message: `完成 ${round - (phase === 'playing' ? 1 : 0)} 局，累计 ${score} 分。下次从 2 再开一桌。`, endless: true });
    return true;
  }
  function update(dt) {
    if (destroyed || !Number.isFinite(dt) || dt <= 0 || !['playing', 'celebrating'].includes(phase)) return;
    elapsed += dt;
    for (const animation of animations) {
      animation.time += dt;
      if (animation.remaining > 0 && Number.isFinite(animation.remaining)) {
        animation.remaining -= dt;
        if (animation.remaining <= 0) { animation.name = 'idle'; animation.time = 0; }
      }
    }
    if (phase === 'celebrating') {
      celebrating = Math.max(0, celebrating - dt);
      if (celebrating > 1e-9) return;
      if (endless) { phase = 'roundEnd'; revision++; }
      else submitEnd({ score, won: lastResult.won, title: lastResult.won ? '你们双蛙合璧，赢啦！' : '对面奶蛙笑到捧肚子。',
        message: `${lastResult.doubleDown ? '双上游！' : `${NAMES[finishOrder[0]]}头游。`}你打出 ${ownPlayed} 张牌，本局 ${score} 分。再来一局把笑声赢回来。`, endless: false });
      return;
    }
    if (turn !== 0 || auto) {
      turnWait -= dt;
      if (turnWait <= 0) aiTurn();
    }
  }
  function getState(options = {}) {
    return { phase, endless, round, level, teamLevels: [...teamLevels], passesA: [...passesA], turn, score, auto,
      ownCanAct: ownCanAct(), canPlay: ownCanAct() && !!selectedCombo, canPass: canPass(),
      canNextRound: !destroyed && endless && phase === 'roundEnd', canFinish: !destroyed && endless && ['playing', 'roundEnd'].includes(phase),
      hand: hands[0].map(card => ({ ...card })), selected: [...selected], selectionLabel,
      selectionOptions: selectionOptions.map(option => ({ ...option })), selectionIndex, message, revision,
      players: hands.map((hand, id) => ({ id, name: NAMES[id], team: teamOf(id), count: phase === 'idle' ? 27 : hand.length,
        finished: round > 0 && !hand.length, rank: finishOrder.includes(id) ? finishOrder.indexOf(id) + 1 : null,
        animation: { name: animations[id].name, time: animations[id].time }, ...(options.reveal ? { hand: hand.map(card => ({ ...card })) } : {}) })),
      lastPlay: copy(lastPlay), finishOrder: [...finishOrder], lastResult: copy(lastResult), tributeLog: [...tributeLog],
      tributeDetails: copy(tributeDetails), tableLog: [...tableLog], passed: [...passed], celebrating,
      ...(options.reveal ? { history: copy(history), discarded: discarded.map(card => ({ ...card })), ownPlayed } : {}) };
  }
  function rounded(x, y, w, h, radius, fill, stroke) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, radius);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  function text(value, x, y, size = 18, color = '#f6f3d9', weight = 500, align = 'center') {
    ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(value, x, y);
  }
  function renderCard(card, x, y, w, h) {
    rounded(x, y, w, h, 7, '#fffdf0', wild(card, level) ? '#e8bf61' : '#d0d9c5');
    const red = card.suit === 'H' || card.suit === 'D' || (card.suit === 'J' && card.rank === 16);
    text(card.suit === 'J' ? card.rank === 16 ? '大' : '小' : rankText(card.rank), x + w / 2, y + h * 0.3, Math.min(25, w * 0.43), red ? '#bc4f42' : '#244536', 800);
    text(card.suit === 'J' ? '王' : SUITS[card.suit], x + w / 2, y + h * 0.69, Math.min(24, w * 0.4), red ? '#bc4f42' : '#244536', 700);
    if (wild(card, level)) text('百搭', x + w / 2, y + h - 8, 9, '#987019', 800);
  }
  function render() {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#193e36'); gradient.addColorStop(1, '#2e5745');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#bed1a62a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(480, 287, 363, 207, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(480, 287, 346, 191, 0, 0, Math.PI * 2); ctx.stroke();
    text('NAIWA / 奶蛙掼蛋', 28, 26, 15, '#c5d6bc', 700, 'left');
    text(`${endless ? '无限升级' : '一局定胜负'} · 第 ${round || 1} 局`, 930, 26, 15, '#c5d6bc', 600, 'right');
    rounded(26, 52, 130, 47, 13, '#fff9df'); text(`本局打 ${rankText(level)}`, 91, 76, 23, '#2d523c', 800);
    text(`我方 ${rankText(teamLevels[0])}  /  对方 ${rankText(teamLevels[1])}`, 865, 74, 17, '#e4e8ce', 700);
    const seats = [{ x: 480, y: 444 }, { x: 835, y: 280 }, { x: 480, y: 112 }, { x: 125, y: 280 }];
    for (let id = 0; id < 4; id++) {
      const { x, y } = seats[id], current = phase === 'playing' && turn === id;
      const winner = lastResult && ['celebrating', 'roundEnd', 'ended'].includes(phase) && teamOf(id) === lastResult.winner;
      if (current || winner) {
        ctx.beginPath(); ctx.ellipse(x, y + 30, 61, 19, 0, 0, Math.PI * 2);
        ctx.fillStyle = winner ? '#edcf676b' : '#a9dfa54d'; ctx.fill();
      }
      drawFrog?.(ctx, x, y, 54, { skinSlot: id, animation: animations[id].name, animationTime: animations[id].time,
        expression: animations[id].name === 'laugh' ? 'laugh' : animations[id].name === 'hurt' ? 'hurt' : 'happy',
        scaleX: id === 1 ? -1 : 1 });
      const count = phase === 'idle' ? 27 : hands[id].length;
      const skinName = env.getSkinName?.({ skinSlot: id });
      const seatName = skinName ? `${['你', '右手', '对家', '左手'][id]} · ${skinName}` : NAMES[id];
      text(`${seatName}${id === 2 ? ' · 队友' : ''}${id === 0 && auto ? ' · 托管' : ''}`, x, y - 54, 18, id % 2 === 0 ? '#f5e8a0' : '#e7f1df', 750);
      rounded(x - 43, y + 46, 86, 28, 12, current ? '#e4edba' : '#173e34');
      text(!count && round ? `${finishOrder.indexOf(id) + 1} 游` : `剩 ${count} 张`, x, y + 60, 17, current ? '#244c35' : '#e4ecd3', 750);
      if (current) text(id === 0 && !auto ? '轮到你了' : '想牌中…', x, y + 93, 14, '#e2da8f', 600);
      else if (passed.has(id)) text('不要', x, y + 91, 14, '#a8bd9f', 600);
    }
    rounded(254, 205, 452, 167, 22, '#163c33c9', '#78956d45');
    if (lastPlay) {
      text(`${NAMES[lastPlay.player]} · ${lastPlay.combo.name}`, 480, 228, 17, '#e9e6c2', 700);
      const cards = lastPlay.cards, w = Math.min(50, 390 / cards.length), gap = 4;
      const total = cards.length * w + (cards.length - 1) * gap;
      cards.forEach((card, index) => renderCard(card, 480 - total / 2 + index * (w + gap), 249, w, 78));
      if (lastPlay.combo.substitutions?.length && !['celebrating', 'roundEnd', 'ended'].includes(phase)) text('红桃级牌已作百搭解释', 480, 350, 12, '#c9c394');
    } else {
      text(phase === 'idle' ? '双副牌 · 奶家人 · 两队搭档' : `${NAMES[turn]}领出新一轮`, 480, 265, 22, '#e5ebcd', 700);
      text(phase === 'idle' ? '你的手牌会显示在桌面下方' : '先出完不算完，记得帮对家。', 480, 303, 16, '#afc6ad');
    }
    if (['celebrating', 'roundEnd', 'ended'].includes(phase) && lastResult) {
      rounded(285, 334, 390, 35, 16, '#faedbd');
      text(lastResult.won ? '我方赢啦！奶蛙笑出声。' : '对面赢啦，正在捧腹大笑！', 480, 351, 19, '#425638', 850);
    }
    text(`♥${rankText(level)} 百搭`, 27, 526, 17, '#e8d393', 700, 'left');
    text(`本次得分 ${score}`, 931, 526, 17, '#e8d393', 700, 'right');
  }
  function cancelInput() { /* No held inputs; a pause preserves the selected cards. */ }
  function destroy() { destroyed = true; resetSelection(); invalidateHints(); }
  return { start, update, render, getState, destroy, cancelInput, toggleCard, clearSelection, hint, playSelected,
    pass, toggleAuto, nextRound, finish, chooseInterpretation };
}
