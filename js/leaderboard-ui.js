import { GAMES, makeBoard, boardLabel, getBoardChoices } from './leaderboard-rules.js?v=8fb8b395f3ed';

const formatNumber = value => new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.floor(Number(value) || 0)));
const hasNickname = profile => typeof profile?.nickname === 'string' && profile.nickname.trim().length > 0;

function element(tag, attributes = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Public names and scores are always rendered as text, never interpreted as markup. */
export function createLeaderboardUI({ client, getContext, onOpen }) {
  let destroyed = false, generation = 0, selectedBoard = '', loading = false;
  let saving = false, submitting = false, nameEdited = false, lastProfileName = '';
  let refreshQueued = false;
  const dialog = element('dialog', { id: 'leaderboard-dialog', 'aria-labelledby': 'leaderboard-title' });
  const header = element('header', { class: 'leaderboard-header' });
  const heading = element('div');
  heading.append(element('span', { class: 'leaderboard-kicker' }, 'A LITTLE FRIENDLY COMPETITION'),
    element('h2', { id: 'leaderboard-title' }, '奶蛙全球排行榜'));
  const closeButton = element('button', { id: 'leaderboard-close', type: 'button', 'aria-label': '关闭排行榜' }, '×');
  header.append(heading, closeButton);
  const body = element('div', { class: 'leaderboard-body' });
  const description = element('p', { class: 'leaderboard-intro' }, '和各地的奶蛙比一比。每个榜单只展示每位玩家的最高成绩。');
  const contextNote = element('p', { id: 'leaderboard-context', class: 'leaderboard-context', hidden: '' });
  const filters = element('div', { class: 'leaderboard-filters' });
  const gameLabel = element('label', { for: 'leaderboard-game' }, '游戏');
  const gameSelect = element('select', { id: 'leaderboard-game' });
  gameSelect.append(...GAMES.map(game => element('option', { value: game.id }, game.name)));
  gameLabel.append(gameSelect);
  const boardLabelElement = element('label', { for: 'leaderboard-board' }, '榜单');
  const boardSelect = element('select', { id: 'leaderboard-board' });
  boardLabelElement.append(boardSelect);
  filters.append(gameLabel, boardLabelElement);

  const ranking = element('section', { class: 'leaderboard-ranking', 'aria-label': '全球成绩' });
  const rankingHeader = element('div', { class: 'leaderboard-ranking-header' });
  const boardTitle = element('h3', { id: 'leaderboard-board-title' });
  const refreshButton = element('button', { id: 'leaderboard-refresh', type: 'button', class: 'leaderboard-secondary' }, '刷新榜单');
  rankingHeader.append(boardTitle, refreshButton);
  const status = element('p', { id: 'leaderboard-status', role: 'status', 'aria-live': 'polite' });
  const columns = element('div', { class: 'leaderboard-columns', 'aria-hidden': 'true' });
  columns.append(element('span', {}, '名次'), element('span', {}, '奶蛙'), element('span', {}, '得分'), element('span', {}, '达成日期'));
  const list = element('ol', { id: 'leaderboard-list', 'aria-label': '全球前 50 名' });
  const me = element('p', { id: 'leaderboard-me' });
  ranking.append(rankingHeader, status, columns, list, me);

  const identity = element('section', { class: 'leaderboard-identity', 'aria-labelledby': 'leaderboard-identity-title' });
  identity.append(element('h3', { id: 'leaderboard-identity-title' }, '给上榜的奶蛙起个名字'));
  const privacy = element('p', { id: 'leaderboard-privacy', class: 'leaderboard-note' },
    '昵称和成绩将全球公开展示。保存后，每局结束自动提交成绩；你可以随时改名。');
  const nameForm = element('form', { class: 'leaderboard-name-form', novalidate: '' });
  const nameLabel = element('label', { for: 'leaderboard-name' }, '昵称 · 1–16 个字');
  const nameInput = element('input', { id: 'leaderboard-name', type: 'text', maxlength: 32, autocomplete: 'nickname',
    placeholder: '例如：肚子先到终点', 'aria-describedby': 'leaderboard-privacy leaderboard-identity-note' });
  nameLabel.append(nameInput);
  const saveButton = element('button', { id: 'leaderboard-save', type: 'submit', class: 'leaderboard-primary' }, '保存昵称并提交');
  nameForm.append(nameLabel, saveButton);
  const identityNote = element('p', { id: 'leaderboard-identity-note', class: 'leaderboard-note' },
    '无需登录，身份保存在此浏览器。清除浏览器数据会丢失身份。还没设置昵称的成绩只保存在本机待传。');
  const pendingText = element('p', { id: 'leaderboard-pending', class: 'leaderboard-pending' });
  const submitButton = element('button', { id: 'leaderboard-submit', type: 'button', class: 'leaderboard-secondary' }, '提交本榜待传成绩');
  const feedback = element('p', { id: 'leaderboard-feedback', role: 'status', 'aria-live': 'polite' });
  identity.append(privacy, nameForm, identityNote, pendingText, submitButton, feedback);
  body.append(description, contextNote, filters, ranking, identity);
  dialog.append(header, body);
  document.body.append(dialog);

  function setFeedback(message, failed = false) {
    if (destroyed) return;
    feedback.textContent = message || '';
    feedback.classList.toggle('leaderboard-error', failed);
  }

  function pending() {
    const entries = client.getPending?.();
    return Array.isArray(entries) ? entries : [];
  }

  function syncIdentity() {
    if (destroyed) return;
    const profile = client.getProfile();
    const nickname = hasNickname(profile) ? profile.nickname : '';
    if (!nameEdited || nickname !== lastProfileName) {
      nameInput.value = nickname;
      nameEdited = false;
    }
    lastProfileName = nickname;
    nameInput.disabled = saving;
    saveButton.disabled = saving || submitting;
    saveButton.textContent = saving ? '正在保存与提交…' : '保存昵称并提交';
    const all = pending(), local = all.filter(run => run.board === selectedBoard);
    const highest = Math.max(0, ...local.map(run => Number(run.score) || 0));
    pendingText.textContent = local.length
      ? `本榜有 ${local.length} 局待传，最高 ${formatNumber(highest)} 分。`
      : '本榜暂无待传成绩。';
    if (all.length > local.length) pendingText.textContent += ` 另有 ${all.length - local.length} 局在其他榜单待传。`;
    if (all.length && !nickname) pendingText.textContent += ' 保存昵称并确认后，才会公开提交。';
    submitButton.disabled = !nickname || !local.length || saving || submitting;
    submitButton.textContent = submitting ? '正在提交…' : '提交本榜待传成绩';
  }

  function showMyBest(data) {
    const best = data?.myBest;
    if (best && Number.isFinite(Number(best.rank)) && Number(best.rank) > 0 && Number.isFinite(Number(best.score))) {
      me.textContent = `我的全球排名  #${formatNumber(best.rank)}  ·  ${formatNumber(best.score)} 分${Number(best.rank) > 50 ? ' · 继续冲击前 50！' : ''}`;
    } else {
      me.textContent = hasNickname(client.getProfile())
        ? '你还没有在这个榜单留下公开成绩。'
        : '设置昵称并提交成绩后，这里会显示你的全球排名。';
    }
  }

  function renderEntries(data) {
    list.replaceChildren();
    const entries = Array.isArray(data?.entries) ? data.entries.slice(0, 50) : [];
    const profile = client.getProfile();
    for (const entry of entries) {
      const rank = Number(entry.rank), row = element('li', { class: 'leaderboard-entry' });
      if (rank >= 1 && rank <= 3) row.classList.add(`leaderboard-top-${rank}`);
      if (profile?.id && entry.playerId === profile.id) row.classList.add('leaderboard-self');
      const medal = ['🥇', '🥈', '🥉'][rank - 1];
      const place = element('span', { class: 'leaderboard-rank', 'aria-label': `第 ${formatNumber(rank)} 名` }, medal || String(rank));
      const nickname = element('span', { class: 'leaderboard-nickname' }, String(entry.nickname ?? ''));
      const score = element('strong', { class: 'leaderboard-entry-score' }, formatNumber(entry.score));
      const date = new Date(entry.achievedAt);
      const time = element('time', { class: 'leaderboard-date' }, '—');
      if (entry.achievedAt && Number.isFinite(date.getTime())) {
        time.dateTime = date.toISOString();
        time.textContent = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
        time.title = date.toLocaleString('zh-CN');
      }
      row.append(place, nickname, score, time);
      list.append(row);
    }
    if (!entries.length) list.append(element('li', { class: 'leaderboard-empty' }, '这个榜单还没有公开成绩。第一只上榜的奶蛙会是谁？'));
    status.textContent = `${formatNumber(data?.totalPlayers)} 位玩家 · 全球前 50 名`;
    status.classList.remove('leaderboard-error');
    showMyBest(data);
  }

  async function refresh() {
    if (destroyed || !selectedBoard) return;
    const token = ++generation, board = selectedBoard;
    loading = true;
    ranking.setAttribute('aria-busy', 'true');
    refreshButton.disabled = true;
    status.textContent = '正在加载全球成绩…';
    status.classList.remove('leaderboard-error');
    list.replaceChildren(element('li', { class: 'leaderboard-empty' }, '奶蛙正在翻成绩册…'));
    me.textContent = '';
    syncIdentity();
    try {
      const data = await client.getBoard(board);
      if (destroyed || token !== generation) return;
      renderEntries(data);
    } catch {
      if (destroyed || token !== generation) return;
      status.textContent = '暂时没能加载排行榜，请点击“重试加载”。';
      status.classList.add('leaderboard-error');
      list.replaceChildren(element('li', { class: 'leaderboard-empty' }, '全球成绩暂时不可用，你的本机纪录不会受影响。'));
      me.textContent = '连接恢复后，即可查看全球排名。';
      refreshButton.textContent = '重试加载';
    } finally {
      if (!destroyed && token === generation) {
        loading = false;
        ranking.setAttribute('aria-busy', 'false');
        refreshButton.disabled = false;
        if (!status.classList.contains('leaderboard-error')) refreshButton.textContent = '刷新榜单';
      }
    }
  }

  function selectGame(game, preferredBoard) {
    gameSelect.value = GAMES.some(item => item.id === game) ? game : GAMES[0].id;
    const choices = getBoardChoices(gameSelect.value);
    boardSelect.replaceChildren(...choices.map(choice => element('option', { value: choice.value }, choice.label)));
    selectedBoard = choices.some(choice => choice.value === preferredBoard) ? preferredBoard : choices[0]?.value || '';
    boardSelect.value = selectedBoard;
    boardTitle.textContent = boardLabel(selectedBoard);
    syncIdentity();
  }

  function reportSubmission(result) {
    const submitted = Number(result?.submitted) || 0;
    const failed = Number(result?.failed) || 0;
    if (failed) {
      const terminal = Math.min(failed, (result.failures || []).filter(failure => failure.terminal).length);
      const retryable = failed - terminal;
      const messages = [`已提交 ${submitted} 局。`];
      if (terminal) messages.push(`${terminal} 局已过期或无效，未上榜。`);
      if (retryable) messages.push(`${retryable} 局提交失败，保留在本机待重试。`);
      setFeedback(messages.join(''), true);
    }
    else if (submitted) setFeedback(`已提交 ${submitted} 局成绩，排行榜已更新。`);
    else setFeedback('昵称已保存。后续每局结束会自动提交成绩。');
  }

  nameForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || submitting || destroyed) return;
    const nickname = nameInput.value.trim();
    if ([...nickname].length < 1 || [...nickname].length > 16 || /[\p{Cc}\p{Cf}]/u.test(nickname)) {
      setFeedback('昵称需要 1–16 个可见字符，请再改一下。', true);
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.focus();
      return;
    }
    nameInput.removeAttribute('aria-invalid');
    saving = true; setFeedback('正在保存昵称并提交待传成绩…'); syncIdentity();
    try {
      await client.setNickname(nickname);
      if (destroyed) return;
      nameEdited = false;
      reportSubmission(await client.submitPending());
      if (!destroyed && dialog.open) await refresh();
    } catch {
      setFeedback('昵称或成绩未能提交，请检查连接后重试。待传成绩仍保存在本机。', true);
    } finally {
      saving = false; syncIdentity();
    }
  });

  submitButton.addEventListener('click', async () => {
    if (saving || submitting || destroyed || !hasNickname(client.getProfile())) return;
    const board = selectedBoard;
    submitting = true; setFeedback('正在提交本榜待传成绩…'); syncIdentity();
    try {
      reportSubmission(await client.submitPending(board));
      if (!destroyed && dialog.open && selectedBoard === board) await refresh();
    } catch {
      setFeedback('提交失败，成绩仍在本机。连接恢复后可以再次提交。', true);
    } finally {
      submitting = false; syncIdentity();
    }
  });

  nameInput.addEventListener('input', () => { nameEdited = true; nameInput.removeAttribute('aria-invalid'); });
  gameSelect.addEventListener('change', () => { selectGame(gameSelect.value); void refresh(); });
  boardSelect.addEventListener('change', () => {
    selectedBoard = boardSelect.value; boardTitle.textContent = boardLabel(selectedBoard); void refresh();
  });
  refreshButton.addEventListener('click', () => { if (!loading) void refresh(); });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('keyup', event => event.stopPropagation());
  dialog.addEventListener('close', () => { generation += 1; loading = false; });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });

  const unsubscribe = client.subscribe?.(event => {
    if (destroyed) return;
    syncIdentity();
    if (event?.type === 'error' && !saving && !submitting) setFeedback(event.message || '成绩暂未上传，稍后可以重试。', true);
    const changedBoard = event?.type === 'submitted' && (!event.board || event.board === selectedBoard);
    if (dialog.open && (changedBoard || event?.type === 'profile') && !refreshQueued) {
      refreshQueued = true;
      queueMicrotask(() => { refreshQueued = false; if (!destroyed && dialog.open) void refresh(); });
    }
  });

  return {
    open() {
      if (destroyed) return;
      onOpen?.();
      const context = getContext?.() || {};
      const board = makeBoard(context) || makeBoard({ ...context, mode: 'classic' });
      selectGame(context.game, board);
      contextNote.hidden = !['training', 'duel'].includes(context.mode);
      contextNote.textContent = context.mode === 'training'
        ? '练习模式不参与个人积分榜。你仍可浏览本游戏的经典与无限榜单。'
        : '双人对战不参与个人积分榜。你仍可浏览本游戏的经典与无限榜单。';
      if (!dialog.open) dialog.showModal();
      void refresh();
    },
    refresh,
    notifyResult(result) {
      if (destroyed) return;
      syncIdentity();
      if (result?.message) setFeedback(result.message);
      else if (result?.queued && !hasNickname(client.getProfile())) setFeedback('本局成绩已保存在本机。保存昵称并确认提交后，就能参加全球排行。');
      if (dialog.open && (!result?.board || result.board === selectedBoard)) void refresh();
    },
    destroy() {
      destroyed = true; generation += 1;
      if (typeof unsubscribe === 'function') unsubscribe();
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
}
