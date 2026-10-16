import { test as base, expect } from './browser-fixtures.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const errors = [];
    const failures = [];
    const origin = new URL(baseURL).origin;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (new URL(response.url()).origin === origin && response.status() >= 400) {
        failures.push(`${response.status()} ${response.url()}`);
      }
    });
    page.on('requestfailed', (request) => {
      const error = request.failure()?.errorText || 'request failed';
      if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(error)) failures.push(`${error} ${request.url()}`);
    });
    await use(page);
    expect(errors, 'No uncaught application errors').toEqual([]);
    expect(failures, 'All requested assets load successfully').toEqual([]);
  },
});

const stateOf = (page) => page.evaluate(() => window.__arcade.getState());
const MERGE_KEY = 'naiwa:save:merge';
const PROGRESS_KEY = 'naiwa:progress:angry';
const simpleSave = {
  board: [2, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  score: 12, moves: 2, won: false,
};

async function openArcade(page) {
  await page.goto('./?debug', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__arcade));
}

async function seed(page, values) {
  await page.evaluate((entries) => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
  }, values);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__arcade));
}

async function choose(page, id) {
  await page.locator('#game-select').selectOption(id);
  await expect.poll(async () => (await stateOf(page)).id).toBe(id);
  await expect(page.locator(`[data-game="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
}

async function start(page, touch = false) {
  if (touch) await page.locator('#start-button').tap();
  else await page.locator('#start-button').click();
  await expect.poll(async () => (await stateOf(page)).state).toBe('playing');
  await expect(page.locator('#game-overlay')).toBeHidden();
}

async function frames(page, count = 12) {
  await page.evaluate((remaining) => new Promise((resolve) => {
    const next = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  }), count);
}

async function canvasPoint(page, x, y) {
  const canvas = page.locator('#game-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const id = (await stateOf(page)).id;
  const logical = id === 'merge' ? { width: 560, height: 640 } : { width: 960, height: 560 };
  const scale = Math.min(bounds.width / logical.width, bounds.height / logical.height);
  return {
    x: bounds.x + (bounds.width - logical.width * scale) / 2 + x * scale,
    y: bounds.y + (bounds.height - logical.height * scale) / 2 + y * scale,
  };
}

async function touchDrag(page, from, to) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let step = 1; step <= 5; step += 1) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        x: from.x + (to.x - from.x) * step / 5,
        y: from.y + (to.y - from.y) * step / 5,
      }] });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }
}

async function settledMerge(page, moves) {
  await expect.poll(async () => (await stateOf(page)).game.moves).toBe(moves);
  await page.waitForFunction(() => !window.__arcade.getState().game.transitioning);
}

test('expanded desktop lobby exposes all ten games and synchronizes cards with the quick selector', async ({ page }) => {
  await openArcade(page);
  await expect(page.locator('[data-game]')).toHaveCount(10);
  await expect(page.locator('#game-select option')).toHaveCount(10);
  for (const id of ['catch', 'jump', 'merge', 'angry', 'whack', 'flappy']) {
    await choose(page, id);
    expect((await stateOf(page)).state).toBe('ready');
    await expect(page.locator('[data-game][aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#difficulty-select')).toBeVisible({ visible: ['flappy', 'whack'].includes(id) });
  }
  await page.locator('[data-game="jump"]').click();
  await expect(page.locator('#game-select')).toHaveValue('jump');
  await page.screenshot({ path: join(tmpdir(), 'naiwa-v2-desktop.png'), fullPage: true });
});

test('catch responds to held keyboard input and mouse movement; pausing clears held keys', async ({ page }) => {
  await openArcade(page);
  await choose(page, 'catch');
  await start(page);
  const initial = (await stateOf(page)).game.basket.x;
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await stateOf(page)).game.basket.x).toBeGreaterThan(initial + 90);
  await page.keyboard.up('ArrowRight');
  expect((await stateOf(page)).game.held.right).toBe(false);

  await page.keyboard.down('ArrowLeft');
  await expect.poll(async () => (await stateOf(page)).game.held.left).toBe(true);
  await page.keyboard.press('KeyP');
  await expect.poll(async () => (await stateOf(page)).state).toBe('paused');
  const paused = (await stateOf(page)).game;
  expect(paused.held).toEqual({ left: false, right: false });
  await page.keyboard.up('ArrowLeft');
  await frames(page, 20);
  expect((await stateOf(page)).game.elapsed).toBe(paused.elapsed);
  await start(page);
  const resumedX = (await stateOf(page)).game.basket.x;
  await frames(page, 10);
  expect((await stateOf(page)).game.basket.x).toBeCloseTo(resumedX, 5);

  const target = await canvasPoint(page, 710, 400);
  await page.mouse.move(target.x, target.y);
  await expect.poll(async () => (await stateOf(page)).game.basket.x).toBeCloseTo(710, 0);
});

test('jump charges with Space, cancels charging on pause, and launches only on a later release', async ({ page }) => {
  await openArcade(page);
  await choose(page, 'jump');
  await start(page);
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__arcade.getState().game.charge > 0.2);
  await page.keyboard.press('KeyP');
  await expect.poll(async () => (await stateOf(page)).state).toBe('paused');
  expect((await stateOf(page)).game.phase).toBe('ready');
  expect((await stateOf(page)).game.charge).toBe(0);
  await page.keyboard.up('Space');
  await start(page);
  await frames(page, 10);
  expect((await stateOf(page)).game.phase).toBe('ready');
  expect((await stateOf(page)).game.lives).toBe(3);

  const point = await canvasPoint(page, 320, 310);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForFunction(() => window.__arcade.getState().game.charge > 0.1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await stateOf(page)).state).toBe('paused');
  await page.mouse.up();
  expect((await stateOf(page)).game.charge).toBe(0);
  expect((await stateOf(page)).game.phase).toBe('ready');
  await start(page);

  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__arcade.getState().game.landingPreview?.perfect);
  await page.keyboard.up('Space');
  await expect.poll(async () => (await stateOf(page)).game.phase).toBe('airborne');
  await expect.poll(async () => (await stateOf(page)).game.completed).toBe(1);
  expect((await stateOf(page)).game.lives).toBe(3);
});

test('merge keyboard and mouse swipes change the board; undo and reload restore the expected state', async ({ page }) => {
  await openArcade(page);
  await seed(page, { [MERGE_KEY]: simpleSave });
  await choose(page, 'merge');
  await expect(page.locator('#puzzle-controls')).toBeVisible();
  await start(page);
  expect((await stateOf(page)).game.board).toEqual(simpleSave.board);
  await page.keyboard.press('ArrowLeft');
  await settledMerge(page, 3);
  expect((await stateOf(page)).game.board).not.toEqual(simpleSave.board);
  expect((await stateOf(page)).game.score).toBe(16);
  await page.locator('#undo-button').click();
  expect((await stateOf(page)).game.board).toEqual(simpleSave.board);
  expect((await stateOf(page)).game.moves).toBe(2);
  expect((await stateOf(page)).game.score).toBe(12);

  const from = await canvasPoint(page, 280, 215);
  const to = await canvasPoint(page, 280, 485);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await settledMerge(page, 3);
  const saved = (await stateOf(page)).game;
  expect(saved.board).not.toEqual(simpleSave.board);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), MERGE_KEY);
  expect(stored.board).toEqual(saved.board);
  expect(stored.moves).toBe(saved.moves);
  await page.reload({ waitUntil: 'networkidle' });
  await choose(page, 'merge');
  await start(page);
  expect((await stateOf(page)).game.board).toEqual(saved.board);
  expect((await stateOf(page)).game.moves).toBe(saved.moves);
  expect((await stateOf(page)).game.score).toBe(saved.score);
});

test('merge 2048 victory offers Continue and retains the winning board', async ({ page }) => {
  await openArcade(page);
  await seed(page, { [MERGE_KEY]: {
    board: [1024, 1024, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    score: 4000, moves: 30, won: false,
  } });
  await choose(page, 'merge');
  await start(page);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await stateOf(page)).game.phase).toBe('won');
  await expect(page.locator('#game-overlay')).toBeVisible();
  await expect(page.locator('#start-button')).toContainText('继续');
  const winning = (await stateOf(page)).game;
  expect(winning.board).toContain(2048);
  expect(winning.score).toBe(6048);
  await start(page);
  expect((await stateOf(page)).game.phase).toBe('playing');
  expect((await stateOf(page)).game.board).toEqual(winning.board);
  expect((await stateOf(page)).game.moves).toBe(winning.moves);
  await page.keyboard.press('ArrowDown');
  await settledMerge(page, 32);
  await expect(page.locator('#game-overlay')).toBeHidden();
});

test('merge game-over can be undone through the visible control without restarting the board', async ({ page }) => {
  const almostFull = {
    board: [0, 8, 16, 32, 64, 128, 256, 512, 8, 16, 32, 64, 128, 256, 512, 1024],
    score: 800, moves: 70, won: false,
  };
  await openArcade(page);
  await seed(page, { [MERGE_KEY]: almostFull });
  await choose(page, 'merge');
  await start(page);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await stateOf(page)).state).toBe('ended');
  await expect(page.locator('#game-overlay')).toBeVisible();
  await expect(page.locator('#undo-button')).toBeEnabled();
  await page.locator('#undo-button').click();
  await expect.poll(async () => (await stateOf(page)).state).toBe('playing');
  await expect(page.locator('#game-overlay')).toBeHidden();
  expect((await stateOf(page)).game.board).toEqual(almostFull.board);
  expect((await stateOf(page)).game.moves).toBe(70);
  expect((await stateOf(page)).game.score).toBe(800);
  const restored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), MERGE_KEY);
  expect(restored.board).toEqual(almostFull.board);
});

test('difficulty persists per game and easy, normal, hard keep separate best scores', async ({ page }) => {
  await openArcade(page);
  await seed(page, {
    'naiwa:best:flappy': 17, 'naiwa:best:flappy:easy': 41, 'naiwa:best:flappy:hard': 9,
    'naiwa:best:whack': 51, 'naiwa:best:whack:easy': 0, 'naiwa:best:whack:hard': 25,
  });
  await choose(page, 'flappy');
  for (const [difficulty, best] of [['normal', 17], ['hard', 9], ['easy', 41]]) {
    await page.locator('#difficulty-select').selectOption(difficulty);
    await expect(page.locator('#best-score')).toContainText(String(best));
    expect((await stateOf(page)).game.difficulty).toBe(difficulty);
  }
  await choose(page, 'whack');
  await page.locator('#difficulty-select').selectOption('easy');
  await start(page);
  await page.waitForFunction(() => window.__arcade.getState().game.holes.some((hole) => hole.state === 'up'));
  const hole = (await stateOf(page)).game.holes.find((candidate) => candidate.state === 'up');
  await page.keyboard.press(String(hole.key));
  await expect.poll(async () => (await stateOf(page)).score).toBeGreaterThan(0);
  const keys = await page.evaluate(() => ({
    normal: localStorage.getItem('naiwa:best:whack'),
    easy: Number(localStorage.getItem('naiwa:best:whack:easy')),
    hard: localStorage.getItem('naiwa:best:whack:hard'),
  }));
  expect(keys.normal).toBe('51');
  expect(keys.hard).toBe('25');
  expect(keys.easy).toBeGreaterThan(0);
  await page.locator('#difficulty-select').selectOption('hard');
  await expect(page.locator('#best-score')).toContainText('25');
  await page.reload({ waitUntil: 'networkidle' });
  await choose(page, 'flappy');
  await expect(page.locator('#difficulty-select')).toHaveValue('easy');
  await expect(page.locator('#best-score')).toContainText('41');
  await choose(page, 'whack');
  await expect(page.locator('#difficulty-select')).toHaveValue('hard');
});

test('angry level selection honors saved unlocks and stars, and Retry keeps the selected level', async ({ page }) => {
  await openArcade(page);
  await seed(page, { [PROGRESS_KEY]: { unlocked: 3, stars: { 1: 3, 2: 2 } } });
  await choose(page, 'angry');
  await expect(page.locator('#level-grid button[data-level]')).toHaveCount(12);
  await expect(page.locator('#level-grid [data-level="1"]')).toContainText('★★★');
  await expect(page.locator('#level-grid [data-level="2"]')).toContainText('★★');
  await expect(page.locator('#level-grid [data-level="3"]')).toBeEnabled();
  await expect(page.locator('#level-grid [data-level="4"]')).toBeDisabled();
  await page.locator('#level-grid [data-level="3"]').click();
  await start(page);
  expect((await stateOf(page)).game.level).toBe(3);
  await page.keyboard.press('Space');
  expect((await stateOf(page)).game.shots).toBeLessThan((await stateOf(page)).game.maxShots);
  await page.locator('#restart-button').click();
  await expect.poll(async () => (await stateOf(page)).state).toBe('playing');
  expect((await stateOf(page)).game.level).toBe(3);
  expect((await stateOf(page)).game.shots).toBe((await stateOf(page)).game.maxShots);
  await page.reload({ waitUntil: 'networkidle' });
  await choose(page, 'angry');
  await expect(page.locator('#level-grid [data-level="3"]')).toBeEnabled();
  await expect(page.locator('#level-grid [data-level="4"]')).toBeDisabled();
  await expect(page.locator('#level-grid [data-level="1"]')).toContainText('★★★');
});

test('angry clearing a level writes newly earned stars and unlocks the next level after reload', async ({ page }) => {
  await openArcade(page);
  await choose(page, 'angry');
  await expect(page.locator('#level-grid [data-level="2"]')).toBeDisabled();
  await start(page);
  const from = await canvasPoint(page, 176, 342);
  const angle = 10 * Math.PI / 180;
  const to = await canvasPoint(page, 176 - Math.cos(angle) * 112 * 0.95, 342 + Math.sin(angle) * 112 * 0.95);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__arcade.getState().game.progress.unlocked >= 2, null, { timeout: 8_000 });
  const progress = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), PROGRESS_KEY);
  expect(progress.unlocked).toBeGreaterThanOrEqual(2);
  expect(progress.stars['1']).toBeGreaterThanOrEqual(1);
  await page.reload({ waitUntil: 'networkidle' });
  await choose(page, 'angry');
  await expect(page.locator('#level-grid [data-level="2"]')).toBeEnabled();
  await expect(page.locator('#level-grid [data-level="1"]')).toContainText('★');
});

test.describe('expanded mobile games', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

  test('mobile lobby fits the viewport and catch follows a native touch drag without scrolling', async ({ page }) => {
    await openArcade(page);
    await expect(page.locator('[data-game]')).toHaveCount(10);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: join(tmpdir(), 'naiwa-v2-mobile.png'), fullPage: true });
    await choose(page, 'catch');
    await start(page, true);
    const from = await canvasPoint(page, 220, 360);
    const to = await canvasPoint(page, 720, 360);
    const scrollBefore = await page.evaluate(() => scrollY);
    await touchDrag(page, from, to);
    await expect.poll(async () => (await stateOf(page)).game.basket.x).toBeCloseTo(720, 0);
    expect(await page.evaluate(() => scrollY)).toBeCloseTo(scrollBefore, 0);
  });

  test('mobile merge portrait board supports buttons and native swipe without page scrolling', async ({ page }) => {
    await openArcade(page);
    await seed(page, { [MERGE_KEY]: simpleSave });
    await choose(page, 'merge');
    await start(page, true);
    const canvas = page.locator('#game-canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds.height).toBeGreaterThan(bounds.width);
    expect(bounds.width).toBeLessThanOrEqual(390);
    await expect(page.locator('#puzzle-controls')).toBeVisible();
    const left = page.locator('#puzzle-controls [data-direction="ArrowLeft"]');
    await left.scrollIntoViewIfNeeded();
    const buttonScroll = await page.evaluate(() => scrollY);
    await left.tap();
    await settledMerge(page, 3);
    expect(await page.evaluate(() => scrollY)).toBeCloseTo(buttonScroll, 0);
    const beforeSwipe = (await stateOf(page)).game.board;
    const from = await canvasPoint(page, 280, 230);
    const to = await canvasPoint(page, 280, 460);
    const swipeScroll = await page.evaluate(() => scrollY);
    await touchDrag(page, from, to);
    await settledMerge(page, 4);
    expect((await stateOf(page)).game.board).not.toEqual(beforeSwipe);
    expect(await page.evaluate(() => scrollY)).toBeCloseTo(swipeScroll, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.locator('#player-window').screenshot({ path: join(tmpdir(), 'naiwa-v2-merge-mobile.png') });
  });
});
