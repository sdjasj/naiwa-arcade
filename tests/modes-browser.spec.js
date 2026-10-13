import { test as base, expect } from './browser-fixtures.js';

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await use(page);
    expect(errors).toEqual([]);
  },
});
const state = page => page.evaluate(() => window.__arcade.getState());
async function open(page, entries = {}) {
  await page.addInitScript(values => {
    if (sessionStorage.getItem('modes-test-seeded')) return;
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    sessionStorage.setItem('modes-test-seeded', 'yes');
  }, entries);
  await page.goto('./?debug', { waitUntil: 'networkidle' });
}
const choose = (page, id) => page.locator('#game-select').selectOption(id);
const board4 = { board: [2, 2, 4, ...Array(13).fill(0)], score: 12, moves: 2, won: false };
const board6 = { gridSize: 6, board: [2, 2, 8, ...Array(33).fill(0)], score: 24, moves: 5, won: false };

test('4×4 and 6×6 preserve separate boards, best scores, undo and reload preference', async ({ page }) => {
  await open(page, { 'naiwa:save:merge': board4, 'naiwa:save:merge:6': board6, 'naiwa:best:merge': 100, 'naiwa:best:merge:6': 25 });
  await choose(page, 'merge');
  await expect(page.locator('#play-mode-setting')).toBeHidden();
  await expect(page.locator('#board-size-select')).toHaveValue('4');
  await expect(page.locator('#best-score')).toContainText('100');
  await page.locator('#start-button').click();
  expect((await state(page)).game.board).toEqual(board4.board);
  await page.locator('#board-size-select').selectOption('6');
  await expect(page.locator('#overlay-message')).toContainText('6×6');
  await expect(page.locator('#best-score')).toContainText('25');
  await page.locator('#start-button').click();
  expect((await state(page)).game.board).toEqual(board6.board);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await state(page)).game.moves).toBe(6);
  await page.waitForFunction(() => !window.__arcade.getState().game.transitioning);
  await expect(page.locator('#best-score')).toContainText('28');
  expect(await page.evaluate(() => localStorage.getItem('naiwa:best:merge'))).toBe('100');
  await page.locator('#undo-button').click();
  expect((await state(page)).game.board).toEqual(board6.board);
  await expect(page.locator('#best-score')).toContainText('28');
  await page.locator('[data-direction="ArrowRight"]').click();
  await expect.poll(async () => (await state(page)).game.moves).toBe(6);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('naiwa:save:merge:6')));
  expect(saved.board).toHaveLength(36);
  expect(saved.gridSize).toBe(6);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('naiwa:save:merge')).board)).toEqual(board4.board);
  await page.reload({ waitUntil: 'networkidle' });
  await choose(page, 'merge');
  await expect(page.locator('#board-size-select')).toHaveValue('6');
  await page.locator('#start-button').click();
  expect((await state(page)).game.board).toEqual(saved.board);
  await page.locator('#board-size-select').selectOption('4');
  await page.locator('#start-button').click();
  expect((await state(page)).game.board).toEqual(board4.board);
});

for (const id of ['flappy', 'angry', 'whack', 'catch', 'jump']) {
  test(`${id}: endless selection, separate records, pause, restart and persistent preference`, async ({ page }) => {
    const progress = { unlocked: 4, stars: { 1: 3, 2: 2, 3: 1 } };
    await open(page, { [`naiwa:best:${id}`]: 111, [`naiwa:best:${id}:endless`]: 222, 'naiwa:progress:angry': progress });
    await choose(page, id);
    await expect(page.locator('#board-setting')).toBeHidden();
    await expect(page.locator('#best-score')).toContainText('111');
    await page.locator('#play-mode-select').selectOption('endless');
    await expect(page.locator('#best-score')).toContainText('222');
    await expect(page.locator('#instruction-summary')).toContainText(id === 'flappy' ? '3 颗心' : id === 'whack' ? '5 颗心' : id === 'angry' ? '工地持续出现' : '持续生成');
    if (id === 'angry') await expect(page.locator('.level-panel')).toBeHidden();
    await page.locator('#start-button').click();
    expect((await state(page)).game.endless).toBe(true);
    if (id === 'angry') expect((await state(page)).game.level).toBe(1);
    await page.keyboard.press('KeyP');
    expect((await state(page)).state).toBe('paused');
    await page.locator('#start-button').click();
    expect((await state(page)).state).toBe('playing');
    await page.locator('#restart-button').click();
    expect((await state(page)).game.endless).toBe(true);
    expect((await state(page)).score).toBe(0);
    if (id === 'angry') expect((await state(page)).game.level).toBe(1);
    await page.reload({ waitUntil: 'networkidle' });
    await choose(page, id);
    await expect(page.locator('#play-mode-select')).toHaveValue('endless');
    await page.locator('#play-mode-select').selectOption('classic');
    await expect(page.locator('#best-score')).toContainText('111');
    if (id === 'angry') {
      await expect(page.locator('.level-panel')).toBeVisible();
      expect((await state(page)).progress).toEqual(progress);
    }
    await page.locator('#start-button').click();
    expect((await state(page)).game.endless).toBe(false);
    if (id === 'angry') expect((await state(page)).game.level).toBe(4);
  });
}

test('an actual endless hit writes only the endless high score', async ({ page }) => {
  await open(page, { 'naiwa:best:whack': 111 });
  await choose(page, 'whack');
  await page.locator('#play-mode-select').selectOption('endless');
  await page.locator('#start-button').click();
  await page.waitForFunction(() => window.__arcade.getState().game.holes.some(h => h.state === 'up'));
  const index = (await state(page)).game.holes.findIndex(h => h.state === 'up');
  await page.keyboard.press(String(index + 1));
  await expect.poll(async () => (await state(page)).score).toBe(10);
  expect(await page.evaluate(() => localStorage.getItem('naiwa:best:whack:endless'))).toBe('10');
  expect(await page.evaluate(() => localStorage.getItem('naiwa:best:whack'))).toBe('111');
});

test.describe('mobile large board', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  test('6×6 fits a phone and supports a swipe across the last row', async ({ page }) => {
    const saved = { gridSize: 6, board: [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 0, ...Array(18).fill(0), 0, 0, 0, 0, 2, 2], score: 40, moves: 8, won: true };
    await open(page, { 'naiwa:board:merge': '6', 'naiwa:save:merge:6': saved });
    await choose(page, 'merge');
    await page.locator('#start-button').tap();
    const canvas = page.locator('#game-canvas');
    await canvas.scrollIntoViewIfNeeded();
    const bounds = await canvas.boundingBox();
    const scale = Math.min(bounds.width / 560, bounds.height / 640);
    const rect = (await state(page)).game.boardRect;
    const x = bounds.x + (bounds.width - 560 * scale) / 2 + (rect.x + rect.side - 25) * scale;
    const y = bounds.y + (bounds.height - 640 * scale) / 2 + (rect.y + rect.side - 25) * scale;
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 150, y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
    await expect.poll(async () => (await state(page)).game.moves).toBe(9);
    await page.waitForFunction(() => !window.__arcade.getState().game.transitioning);
    expect((await state(page)).game.board[30]).toBe(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('#player-window').screenshot({ path: '/tmp/naiwa-6x6-mobile.png' });
    await choose(page, 'whack');
    await page.locator('#play-mode-select').selectOption('endless');
    await page.locator('#difficulty-select').selectOption('easy');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('#start-button').tap();
    expect((await state(page)).game.endless).toBe(true);
  });
});
