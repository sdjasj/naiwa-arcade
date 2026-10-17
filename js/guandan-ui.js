const SUITS = { S: '♠', H: '♥', D: '♦', C: '♣', J: '★' };
const SUIT_NAMES = { S: '黑桃', H: '红桃', D: '方块', C: '梅花' };
const rankName = rank => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '小王', 16: '大王' }[rank] || String(rank));

/** DOM hand controls stay readable and keyboard-accessible at phone sizes. */
export function createGuandanUI({ getGame, getHostState, unlockAudio }) {
  const $ = id => document.getElementById(id);
  const panel = $('guandan-controls'), hand = $('guandan-hand');
  let signature = '', handSignature = '', active = false, currentGame = null;
  const buttons = { play: 'guandan-play', pass: 'guandan-pass', hint: 'guandan-hint', clear: 'guandan-clear', auto: 'guandan-auto', next: 'guandan-next', finish: 'guandan-finish' };
  const methods = { play: 'playSelected', pass: 'pass', hint: 'hint', clear: 'clearSelection', auto: 'toggleAuto', next: 'nextRound', finish: 'finish' };
  function act(action, cardId) {
    if (!active || getHostState() !== 'playing') return;
    const game = getGame();
    unlockAudio();
    if (action === 'card') game.toggleCard(cardId);
    else game[methods[action]]?.();
    signature = '';
    update(true);
  }
  for (const [action, id] of Object.entries(buttons)) $(id).addEventListener('click', event => {
    act(action);
    if (event.detail > 0 && getHostState() === 'playing') $('game-canvas').focus({ preventScroll: true });
  });
  $('guandan-interpretation').addEventListener('change', event => {
    if (!active || getHostState() !== 'playing') return;
    getGame().chooseInterpretation?.(Number(event.target.value));
    signature = ''; update(true);
  });
  hand.addEventListener('click', event => {
    const button = event.target.closest('[data-card-id]');
    if (button && hand.contains(button) && !button.disabled) {
      act('card', button.dataset.cardId);
      if (event.detail > 0) $('game-canvas').focus({ preventScroll: true });
    }
  });
  function update(enabled) {
    active = enabled;
    panel.hidden = !active;
    $('guandan-guide').hidden = !active;
    if (!active) { signature = ''; handSignature = ''; currentGame = null; return; }
    const game = getGame();
    if (game !== currentGame) { currentGame = game; signature = ''; handSignature = ''; }
    const view = game?.getState();
    if (!view) return;
    const host = getHostState();
    const next = `${host}:${view.revision}`;
    if (next === signature) return;
    signature = next;
    const playing = host === 'playing', isTurn = playing && view.phase === 'playing' && view.turn === 0 && !view.auto;
    const selected = new Set(view.selected || []);
    const cards = view.hand || [];
    const newHandSignature = cards.map(card => `${card.id}:${card.rank}:${card.suit}`).join('|');
    if (newHandSignature !== handSignature) {
      const focused = document.activeElement?.dataset?.cardId;
      handSignature = newHandSignature;
      hand.replaceChildren(...cards.map(card => {
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.cardId = card.id; button.className = 'playing-card';
        const red = card.suit === 'H' || card.suit === 'D' || card.rank === 16;
        button.classList.toggle('red', red);
        const name = card.rank >= 15 ? rankName(card.rank) : `${SUIT_NAMES[card.suit]} ${rankName(card.rank)}`;
        button.dataset.cardName = name;
        button.append(Object.assign(document.createElement('b'), { textContent: rankName(card.rank) }),
          Object.assign(document.createElement('span'), { textContent: SUITS[card.suit] || '★', ariaHidden: 'true' }),
          Object.assign(document.createElement('small'), { textContent: '' }));
        return button;
      }));
      if (focused) [...hand.children].find(button => button.dataset.cardId === focused)?.focus({ preventScroll: true });
    }
    for (let index = 0; index < cards.length; index++) {
      const card = cards[index], button = hand.children[index];
      const wild = card.suit === 'H' && card.rank === view.level;
      const levelCard = card.rank === view.level;
      button.classList.toggle('wild', wild); button.classList.toggle('level-card', levelCard);
      button.classList.toggle('selected', selected.has(card.id));
      button.setAttribute('aria-pressed', String(selected.has(card.id)));
      button.setAttribute('aria-label', `${button.dataset.cardName}${wild ? '，逢人配' : levelCard ? '，级牌' : ''}`);
      button.querySelector('small').textContent = wild ? '百搭' : levelCard ? '级牌' : '';
      button.disabled = !isTurn;
    }
    const teamLevels = view.teamLevels || [2, 2];
    $('guandan-round').textContent = `第 ${view.round || 1} 副 · 打 ${rankName(view.level || 2)}`;
    $('guandan-levels').textContent = `我方 ${rankName(teamLevels[0])} / 对方 ${rankName(teamLevels[1])}`;
    $('guandan-hand-count').textContent = `${cards.length} 张手牌 · 已选 ${selected.size} 张`;
    $('guandan-message').textContent = host === 'ready' ? '你在下方，与上方奶蛙组队。开局后点选手牌。'
      : host === 'paused' ? '已暂停，继续后再出牌。'
      : isTurn ? `轮到你了 · ${view.message || '点选手牌后出牌。'}` : view.message || '奶蛙正在思考…';
    $('guandan-selection').textContent = selected.size ? view.selectionLabel || `已选 ${selected.size} 张` : '点选手牌；提示可帮你找一手合法牌。';
    const interpretations = view.selectionOptions || [];
    $('guandan-interpretation-setting').hidden = interpretations.length < 2;
    $('guandan-interpretation').replaceChildren(...interpretations.map((option, index) => Object.assign(document.createElement('option'), { value: String(option.index ?? index), textContent: option.label })));
    $('guandan-interpretation').value = String(view.selectionIndex ?? 0);
    $('guandan-interpretation').disabled = !isTurn;
    $('guandan-play').disabled = !isTurn || !view.canPlay;
    $('guandan-pass').disabled = !isTurn || !view.canPass;
    $('guandan-hint').disabled = !isTurn;
    $('guandan-clear').disabled = !isTurn || !selected.size;
    $('guandan-auto').disabled = !playing || !['playing', 'roundEnd'].includes(view.phase);
    $('guandan-auto').setAttribute('aria-pressed', String(Boolean(view.auto)));
    $('guandan-auto').textContent = view.auto ? '接管手牌' : '托管';
    $('guandan-next').hidden = !view.canNextRound;
    $('guandan-next').disabled = !playing || !view.canNextRound;
    $('guandan-finish').hidden = !view.endless;
    $('guandan-finish').disabled = !playing || !['playing', 'roundEnd'].includes(view.phase);
    $('guandan-tribute').hidden = !(view.tributeLog?.length);
    $('guandan-tribute').textContent = (view.tributeLog || []).join(' · ');
    panel.classList.toggle('your-turn', isTurn);
    hand.setAttribute('aria-label', `你的手牌，共 ${cards.length} 张，${isTurn ? '可选择' : '等待轮次'}`);
  }
  function keyDown(event) {
    if (!active || getHostState() !== 'playing' || event.repeat || ['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(event.target.tagName)) return false;
    const action = { Enter: 'play', Space: 'pass', KeyH: 'hint', Backspace: 'clear', KeyT: 'auto' }[event.code];
    if (!action || $(buttons[action]).disabled || $(buttons[action]).hidden) return false;
    act(action); return true;
  }
  return { update, keyDown };
}
