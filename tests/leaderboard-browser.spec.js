import { test as base, expect } from '@playwright/test';

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith('/api/')) errors.push(response.url());
    });
    await use(page);
    expect(errors).toEqual([]);
  },
});

const state = page => page.evaluate(() => window.__arcade.getState());
const playerId = '10000000-0000-4000-8000-000000000001';
const achievedAt = '2026-10-13T10:00:00.000Z';

/** Network-only fixture: app, browser identity, game inputs and UI stay real. */
async function mockService(page) {
  const service = { profile: null, runs: new Map(), runRequests: [], accepted: [], attempts: [], reads: [], failBoards: 0, failScores: 0,
    boards: new Map(), boardResponse: null, scoreStatuses: [] };
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const json = async (body, status = 200) => route.fulfill({ status, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS' }, body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return json({});
    if (url.pathname === '/api/players') {
      service.profile = { id: playerId, nickname: '' };
      return json({ player: service.profile, token: 'mock_browser_identity_token_1234567890' });
    }
    if (url.pathname === '/api/player') {
      service.profile.nickname = request.postDataJSON().nickname;
      return json({ player: service.profile });
    }
    if (url.pathname === '/api/runs') {
      const run = request.postDataJSON(); service.runs.set(run.runId, run); service.runRequests.push(run);
      return json({ runId: run.runId, startedAt: Date.now() });
    }
    if (url.pathname === '/api/scores') {
      const score = request.postDataJSON(); service.attempts.push(score);
      const forcedStatus = service.scoreStatuses.shift();
      if (forcedStatus >= 400) return json({ error: { message: forcedStatus === 410 ? '本局已过期' : '测试网络暂时不可用' } }, forcedStatus);
      if (service.failScores-- > 0) return json({ error: { message: '测试网络暂时不可用' } }, 503);
      const run = service.runs.get(score.runId);
      service.accepted.push({ ...score, board: run.board });
      return json({ accepted: true, best: { rank: 1, score: score.score } });
    }
    if (url.pathname === '/api/boards') {
      const board = url.searchParams.get('board'); service.reads.push(board);
      if (service.failBoards-- > 0) return json({ error: { message: '测试排行榜暂时不可用' } }, 503);
      if (service.boardResponse) return json(await service.boardResponse(board));
      if (service.boards.has(board)) return json(service.boards.get(board));
      const scores = service.accepted.filter(entry => entry.board === board).map(entry => entry.score);
      const best = scores.length ? Math.max(...scores) : null;
      const entries = best === null ? [] : [{ rank: 1, playerId, nickname: service.profile.nickname, score: best, achievedAt }];
      return json({ entries, totalPlayers: entries.length, myBest: best === null ? null : { rank: 1, score: best } });
    }
    return json({ error: { message: 'Unexpected mock API route' } }, 404);
  });
  return service;
}

async function finishFlappy(page, service) {
  const before = service.runs.size;
  await page.locator('#game-select').selectOption('flappy');
  await page.locator('#start-button').click();
  await expect.poll(() => service.runs.size).toBe(before + 1);
  for (let index = 0; index < 25 && (await state(page)).state !== 'ended'; index += 1) await page.clock.runFor(200);
  expect((await state(page)).state).toBe('ended');
}

test('anonymous results stay local until consent; failed uploads retry the same run and later rounds upload automatically', async ({ page }) => {
  const service = await mockService(page);
  service.failBoards = 1; service.failScores = 1;
  await page.clock.install();
  await page.goto('./?debug', { waitUntil: 'networkidle' });
  await finishFlappy(page, service);
  expect(service.accepted).toHaveLength(0);
  expect(service.profile.nickname).toBe('');
  await page.locator('#leaderboard-button').click();
  await expect(page.locator('#leaderboard-status')).toContainText('重试');
  await page.locator('#leaderboard-refresh').click();
  await expect(page.locator('#leaderboard-list')).toContainText('还没有公开成绩');
  await expect(page.locator('#leaderboard-pending')).toContainText('1 局待传');
  await expect(page.locator('#leaderboard-submit')).toBeDisabled();
  await expect(page.locator('#leaderboard-privacy')).toContainText('全球公开');
  await expect(page.locator('#leaderboard-identity-note')).toContainText('清除浏览器数据会丢失身份');
  await page.locator('#leaderboard-name').fill(' ');
  await page.locator('#leaderboard-save').click();
  await expect(page.locator('#leaderboard-name')).toHaveAttribute('aria-invalid', 'true');
  expect(service.profile.nickname).toBe('');
  await page.locator('#leaderboard-name').fill('抹茶奶蛙');
  await page.locator('#leaderboard-save').click();
  await expect(page.locator('#leaderboard-feedback')).toContainText('提交失败');
  expect(service.accepted).toHaveLength(0);
  await expect(page.locator('#leaderboard-pending')).toContainText('1 局待传');
  await page.locator('#leaderboard-submit').click();
  await expect(page.locator('#leaderboard-feedback')).toContainText('已提交 1 局');
  await expect(page.locator('#leaderboard-list .leaderboard-entry')).toHaveCount(1);
  await expect(page.locator('#leaderboard-me')).toContainText('#1');
  expect(service.attempts).toHaveLength(2);
  expect(service.attempts[0]).toEqual(service.attempts[1]);
  await page.locator('#leaderboard-close').click();
  await finishFlappy(page, service);
  await expect.poll(() => service.accepted.length).toBe(2);
  expect(service.accepted[0].runId).not.toBe(service.accepted[1].runId);
});

test('all nine games have separate boards; only real top 50 rows render and public names remain plain text', async ({ page }) => {
  const service = await mockService(page);
  const hostileName = '<img src=x onerror=alert(1)>';
  const entries = Array.from({ length: 55 }, (_, index) => ({ rank: index + 1, playerId: `fixture-${index}`,
    nickname: index ? `测试奶蛙${index}` : hostileName, score: 10000 - index * 10, achievedAt }));
  service.boards.set('v1:flappy:classic:normal', { entries, totalPlayers: 91, myBest: { rank: 73, score: 490 } });
  await page.goto('./?debug', { waitUntil: 'networkidle' });
  await page.locator('#leaderboard-button').click();
  await expect(page.locator('#leaderboard-game option')).toHaveCount(9);
  await expect(page.locator('#leaderboard-list .leaderboard-entry')).toHaveCount(50);
  await expect(page.locator('#leaderboard-list .leaderboard-nickname').first()).toHaveText(hostileName);
  await expect(page.locator('#leaderboard-list img')).toHaveCount(0);
  for (const rank of [1, 2, 3]) await expect(page.locator(`.leaderboard-top-${rank}`)).toHaveCount(1);
  await expect(page.locator('#leaderboard-status')).toContainText('91 位玩家');
  await expect(page.locator('#leaderboard-me')).toContainText('#73');
  await page.locator('#leaderboard-dialog').screenshot({ path: '/tmp/naiwa-leaderboard-desktop.png' });
  await page.locator('#leaderboard-game').selectOption('merge');
  await expect(page.locator('#leaderboard-board option')).toHaveCount(2);
  await page.locator('#leaderboard-board').selectOption('v1:merge:classic:6');
  await expect(page.locator('#leaderboard-board-title')).toContainText('6×6');
  await expect(page.locator('#leaderboard-list')).toContainText('还没有公开成绩');
  await page.locator('#leaderboard-game').selectOption('angry');
  await expect(page.locator('#leaderboard-board option')).toHaveCount(13);
  await page.locator('#leaderboard-board').selectOption('v1:angry:classic:12');
  await expect(page.locator('#leaderboard-board-title')).toContainText('第 12 关起');
  await page.locator('#leaderboard-game').selectOption('fighter');
  await expect(page.locator('#leaderboard-board option')).toHaveCount(6);
  await page.locator('#leaderboard-board').selectOption('v1:fighter:endless:laugh');
  await expect(page.locator('#leaderboard-board-title')).toContainText('无限 · 狂笑奶蛙');
  await page.locator('#leaderboard-close').click();
  for (const mode of ['training', 'duel']) {
    await page.locator('#game-select').selectOption('fighter');
    await page.locator('#play-mode-select').selectOption(mode);
    await page.locator('#leaderboard-button').click();
    await expect(page.locator('#leaderboard-context')).toContainText('不参与个人积分榜');
    await expect(page.locator('#leaderboard-board')).toHaveValue('v1:fighter:classic:belly');
    await page.locator('#leaderboard-close').click();
  }
});

test('a slow previous board cannot overwrite the current selection', async ({ page }) => {
  const service = await mockService(page);
  let releaseOld;
  const slow = new Promise(resolve => { releaseOld = resolve; });
  service.boardResponse = board => board === 'v1:flappy:classic:normal' ? slow : Promise.resolve({
    entries: [{ rank: 1, playerId: 'fixture-new', nickname: '新棋盘奶蛙', score: 4096, achievedAt }], totalPlayers: 1, myBest: null,
  });
  await page.goto('./?debug', { waitUntil: 'networkidle' });
  await page.locator('#leaderboard-button').click();
  await expect.poll(() => service.reads.length).toBe(1);
  await page.locator('#leaderboard-game').selectOption('merge');
  await page.locator('#leaderboard-board').selectOption('v1:merge:classic:6');
  await expect(page.locator('#leaderboard-list')).toContainText('新棋盘奶蛙');
  const oldResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get('board') === 'v1:flappy:classic:normal');
  releaseOld({ entries: [{ rank: 1, playerId: 'fixture-old', nickname: '旧水管奶蛙', score: 12, achievedAt }], totalPlayers: 1, myBest: null });
  await oldResponse;
  // Let the browser settle the old fetch promise without modifying application state.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('#leaderboard-board')).toHaveValue('v1:merge:classic:6');
  await expect(page.locator('#leaderboard-list')).toContainText('新棋盘奶蛙');
  await expect(page.locator('#leaderboard-list')).not.toContainText('旧水管奶蛙');
});

test('expired runs are discarded, valid scores still submit, and only temporary failures remain for retry', async ({ page }) => {
  const service = await mockService(page);
  await page.clock.install();
  await page.goto('./?debug', { waitUntil: 'networkidle' });
  for (let round = 0; round < 3; round += 1) await finishFlappy(page, service);
  expect(service.accepted).toHaveLength(0);
  service.scoreStatuses = [410, 200, 503];
  await page.locator('#leaderboard-button').click();
  await expect(page.locator('#leaderboard-pending')).toContainText('3 局待传');
  await page.locator('#leaderboard-name').fill('掉线也要笑');
  await page.locator('#leaderboard-save').click();
  await expect(page.locator('#leaderboard-feedback')).toContainText('已提交 1 局');
  await expect(page.locator('#leaderboard-feedback')).toContainText('1 局已过期或无效，未上榜');
  await expect(page.locator('#leaderboard-feedback')).toContainText('1 局提交失败，保留在本机待重试');
  await expect(page.locator('#leaderboard-pending')).toContainText('1 局待传');
  expect(service.attempts.map(item => item.runId)).toEqual(service.runRequests.map(item => item.runId));
  expect(service.accepted[0].runId).toBe(service.runRequests[1].runId);
  await page.locator('#leaderboard-submit').click();
  await expect(page.locator('#leaderboard-feedback')).toContainText('已提交 1 局');
  await expect(page.locator('#leaderboard-pending')).toContainText('暂无待传成绩');
  expect(service.attempts.at(-1).runId).toBe(service.runRequests[2].runId);
  expect(service.attempts.filter(item => item.runId === service.runRequests[0].runId)).toHaveLength(1);
});

async function simulateUntil(page, predicate, milliseconds = 12000) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 200) {
    const current = await state(page);
    if (predicate(current)) return current;
    await page.clock.runFor(200);
  }
  expect(predicate(await state(page)), 'Game did not reach the expected state through public inputs').toBe(true);
  return state(page);
}

async function angryShot(page, angleDegrees, power) {
  await page.locator('#game-canvas').scrollIntoViewIfNeeded();
  const rect = await page.locator('#game-canvas').boundingBox();
  const at = (x, y) => ({ x: rect.x + x / 960 * rect.width, y: rect.y + y / 560 * rect.height });
  const start = at(176, 342), angle = angleDegrees / 180 * Math.PI;
  const end = at(176 - Math.cos(angle) * 112 * power, 342 + Math.sin(angle) * 112 * power);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 }); await page.mouse.up();
}

test('angry finishing on a later level keeps the leaderboard registered to the original starting level', async ({ page }) => {
  const service = await mockService(page);
  await page.clock.install();
  await page.goto('./?debug', { waitUntil: 'networkidle' });
  await page.locator('#game-select').selectOption('angry');
  await page.locator('#start-button').click();
  await expect.poll(() => service.runRequests.length).toBe(1);
  expect(service.runRequests[0].board).toBe('v1:angry:classic:1');
  await angryShot(page, 10, 0.95);
  await simulateUntil(page, current => current.game.level === 2 && current.game.phase === 'ready');
  for (let shot = 0; shot < 3; shot += 1) {
    await angryShot(page, 0, 0.16); // Deliberately stop well before the buildings.
    await simulateUntil(page, current => current.state === 'ended' || current.game.phase === 'ready');
  }
  const ended = await state(page);
  expect(ended.state).toBe('ended');
  expect(ended.game.level).toBe(2);
  expect(ended.selectedLevel).toBe(2);
  expect(service.runRequests).toHaveLength(1);
  await page.locator('#leaderboard-result-open').click();
  await expect(page.locator('#leaderboard-board')).toHaveValue('v1:angry:classic:1');
  await expect(page.locator('#leaderboard-pending')).toContainText('1 局待传');
  await page.locator('#leaderboard-close').click();
  await page.locator('#start-button').click();
  await expect.poll(() => service.runRequests.length).toBe(2);
  expect(service.runRequests[1].board).toBe('v1:angry:classic:2');
});

const mergeSaveKey = 'naiwa:save:merge';
const nearMilestone = { gridSize: 4, board: [1024, 1024, ...Array(14).fill(0)], score: 4000, moves: 30, won: false };
const savedMerge = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), mergeSaveKey);

async function restoreMergeFixture(page, save) {
  await page.evaluate(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), { key: mergeSaveKey, save });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#game-select').selectOption('merge');
  await page.locator('#start-button').click();
}

test('2048 saves the server run ID; reload, milestone Continue and undo keep that same run', async ({ page }) => {
  const service = await mockService(page);
  await page.clock.install();
  await page.goto('./?debug', { waitUntil: 'networkidle' });
  await page.locator('#game-select').selectOption('merge');
  await page.locator('#start-button').click();
  await expect.poll(() => service.runRequests.length).toBe(1);
  const runId = service.runRequests[0].runId;
  expect(service.runRequests[0].board).toBe('v1:merge:classic:4');
  await expect.poll(async () => (await savedMerge(page))?.leaderboardRun).toBe(runId);
  // First prove an untouched real save resumes before setting up a saved milestone.
  const original = await savedMerge(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#game-select').selectOption('merge');
  await page.locator('#start-button').click();
  expect((await state(page)).game.board).toEqual(original.board);
  expect((await savedMerge(page)).leaderboardRun).toBe(runId);
  expect(service.runRequests).toHaveLength(1);
  await restoreMergeFixture(page, { ...nearMilestone, leaderboardRun: runId });
  expect((await state(page)).game.board).toEqual(nearMilestone.board);
  await page.keyboard.press('ArrowLeft');
  await simulateUntil(page, current => current.state === 'ended');
  expect((await state(page)).game.phase).toBe('won');
  expect((await savedMerge(page)).leaderboardRun).toBe(runId);
  await expect(page.locator('#start-button')).toContainText('继续');
  await page.locator('#start-button').click();
  expect((await state(page)).state).toBe('playing');
  expect((await state(page)).game.board).toContain(2048);
  await page.locator('#undo-button').click();
  expect((await state(page)).game.board).toEqual(nearMilestone.board);
  expect((await savedMerge(page)).leaderboardRun).toBe(runId);
  expect(service.runRequests).toHaveLength(1);
  await page.locator('#game-canvas').focus();
  await page.keyboard.press('ArrowLeft');
  await simulateUntil(page, current => current.state === 'ended');
  await page.locator('#leaderboard-result-open').click();
  await expect(page.locator('#leaderboard-pending')).toContainText('1 局待传');
  await page.locator('#leaderboard-name').fill('合蛙高手');
  await page.locator('#leaderboard-save').click();
  await expect(page.locator('#leaderboard-feedback')).toContainText('已提交 1 局');
  expect(service.runRequests).toHaveLength(1);
  expect(service.accepted).toEqual([{ runId, score: 6048, board: 'v1:merge:classic:4' }]);
});

test('legacy 2048 saves stay playable but neither register a run nor upload an old result', async ({ page }) => {
  const service = await mockService(page);
  await page.clock.install();
  await page.goto('./?debug', { waitUntil: 'networkidle' });
  await restoreMergeFixture(page, nearMilestone);
  expect((await state(page)).game.board).toEqual(nearMilestone.board);
  expect(service.runRequests).toHaveLength(0);
  expect(service.profile).toBeNull();
  await page.keyboard.press('ArrowLeft');
  await simulateUntil(page, current => current.state === 'ended');
  await expect(page.locator('#leaderboard-result-message')).toContainText('未登记全球榜');
  expect((await savedMerge(page)).leaderboardRun).toBeUndefined();
  await page.locator('#leaderboard-result-open').click();
  await expect(page.locator('#leaderboard-pending')).toContainText('暂无待传成绩');
  await page.locator('#leaderboard-name').fill('带着老存档来');
  await page.locator('#leaderboard-save').click();
  await expect(page.locator('#leaderboard-feedback')).toContainText('昵称已保存');
  await page.locator('#leaderboard-close').click();
  await page.locator('#start-button').click();
  await page.locator('#undo-button').click();
  expect((await state(page)).game.board).toEqual(nearMilestone.board);
  expect(service.runRequests).toHaveLength(0);
  expect(service.attempts).toHaveLength(0);
});

test.describe('leaderboard at 320px', () => {
  test.use({ viewport: { width: 320, height: 680 }, isMobile: true, hasTouch: true });

  test('dialog scrolls without overflow, pauses play, and Escape does not resume the game', async ({ page }) => {
    await mockService(page);
    await page.clock.install();
    await page.goto('./?debug', { waitUntil: 'networkidle' });
    await page.locator('#start-button').click();
    await page.locator('#leaderboard-button').click();
    expect((await state(page)).state).toBe('paused');
    await expect(page.locator('#leaderboard-list')).toContainText('还没有公开成绩');
    await page.screenshot({ path: '/tmp/naiwa-leaderboard-mobile-top.png' });
    await page.locator('#leaderboard-name').fill('P 奶蛙');
    await page.keyboard.press('KeyP');
    expect((await state(page)).state).toBe('paused');
    const bounds = await page.evaluate(() => {
      const dialog = document.querySelector('#leaderboard-dialog'), box = dialog.getBoundingClientRect();
      return { right: box.right, left: box.left, top: box.top, bottom: box.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight,
        pageWidth: document.documentElement.scrollWidth, scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
    expect(bounds.pageWidth).toBeLessThanOrEqual(bounds.viewportWidth);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
    await page.locator('#leaderboard-save').scrollIntoViewIfNeeded();
    await expect(page.locator('#leaderboard-save')).toBeInViewport();
    await page.screenshot({ path: '/tmp/naiwa-leaderboard-mobile.png' });
    await page.keyboard.press('Escape');
    await expect(page.locator('#leaderboard-dialog')).not.toBeVisible();
    expect((await state(page)).state).toBe('paused');
    await page.clock.runFor(800);
    expect((await state(page)).state).toBe('paused');
  });
});
