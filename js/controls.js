const layouts = {
  fighter: { directions: [['jump', '跳', '向上跳跃'], ['left', '←', '向左移动'], ['crouch', '蹲', '蹲下'], ['right', '→', '向右移动']], actions: [['light', '轻拳', 'J'], ['heavy', '重拳', 'K'], ['block', '防御', 'L'], ['special', '大招', '空格']] },
  survivor: { directions: [['up', '↑', '向上移动'], ['left', '←', '向左移动'], ['down', '↓', '向下移动'], ['right', '→', '向右移动']], actions: [['dash', '冲刺', '空格']] },
  bomber: { directions: [['up', '↑', '向上移动'], ['left', '←', '向左移动'], ['down', '↓', '向下移动'], ['right', '→', '向右移动']], actions: [['bomb', '放炸弹', '空格']] },
};

export function createTouchControls(element, { down, up, focus }) {
  const pointers = new Map();
  let enabled = false;
  function release(id) {
    const entry = pointers.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pointers.delete(id);
    if (![...pointers.values()].some(item => item.action === entry.action)) {
      up(entry.action); entry.button.classList.remove('held'); entry.button.setAttribute('aria-pressed', 'false');
    }
    if (typeof id === 'number') { try { entry.button.releasePointerCapture(id); } catch { /* It may already be released. */ } }
  }
  function clear() { for (const id of [...pointers.keys()]) release(id); }
  function buttonFor([action, title, hint], index, directional) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.action = action; button.disabled = !enabled;
    button.setAttribute('aria-label', directional ? hint : title);
    button.setAttribute('aria-pressed', 'false');
    button.append(Object.assign(document.createElement('strong'), { textContent: title }));
    if (directional) button.style.gridArea = ['1 / 2', '2 / 1', '2 / 2', '2 / 3'][index];
    else button.append(Object.assign(document.createElement('small'), { textContent: hint }));
    button.addEventListener('pointerdown', event => {
      if (!enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault(); focus();
      const alreadyHeld = [...pointers.values()].some(item => item.action === action);
      pointers.set(event.pointerId, { action, button });
      button.setPointerCapture(event.pointerId); button.classList.add('held'); button.setAttribute('aria-pressed', 'true');
      if (!alreadyHeld) down(action);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, event => release(event.pointerId));
    // A synthetic click needs to span simulation frames for held movement actions.
    // Store its pulse alongside touches so pause, switching and disabling cancel it.
    button.addEventListener('click', event => {
      if (!enabled || event.detail !== 0) return;
      focus();
      const id = `activation:${action}`;
      if (pointers.has(id)) clearTimeout(pointers.get(id).timer);
      const alreadyHeld = [...pointers.values()].some(item => item.action === action);
      const entry = { action, button, timer: setTimeout(() => release(id), 160) };
      pointers.set(id, entry); button.classList.add('held'); button.setAttribute('aria-pressed', 'true');
      if (!alreadyHeld) down(action);
    });
    return button;
  }
  return {
    clear,
    configure(id) {
      clear(); element.replaceChildren(); element.hidden = !layouts[id];
      if (!layouts[id]) return;
      const directions = document.createElement('div'), actions = document.createElement('div');
      directions.className = 'action-dpad'; actions.className = 'action-buttons';
      directions.setAttribute('aria-label', '移动控制'); actions.setAttribute('aria-label', '动作控制');
      directions.append(...layouts[id].directions.map((data, index) => buttonFor(data, index, true)));
      actions.append(...layouts[id].actions.map((data, index) => buttonFor(data, index, false)));
      element.append(directions, Object.assign(document.createElement('p'), { className: 'action-hint', textContent: '按住方向移动\n可同时按动作键' }), actions);
    },
    setEnabled(value) {
      if (enabled === value) return;
      enabled = value; if (!enabled) clear();
      element.querySelectorAll('button').forEach(button => { button.disabled = !enabled; });
    },
  };
}
