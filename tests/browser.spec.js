import { test as base, expect } from './browser-fixtures.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Every scenario also verifies that the application and its local assets load
// without errors. Navigations can legitimately cancel an in-flight request.
const test = base.extend({
  page: async ({ page }, use) => {
    const pageErrors = [];
    const failedAssets = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith(process.env.NAIWA_TEST_URL || 'http://127.0.0.1:8080/') && response.status() >= 400) {
        failedAssets.push(`${response.status()} ${response.url()}`);
      }
    });
    page.on('requestfailed', request => {
      const error = request.failure()?.errorText ?? 'request failed';
      if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(error)) failedAssets.push(`${error} ${request.url()}`);
    });
    await use(page);
    expect(pageErrors, 'No uncaught browser errors').toEqual([]);
    expect(failedAssets, 'All requested assets are available').toEqual([]);
  },
});

const stateOf = page => page.evaluate(() => window.__arcade.getState());

async function openArcade(page) {
  await page.goto('./?debug', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__arcade));
  await expect(page.locator('#game-overlay')).toBeVisible();
}

async function selectGame(page, id, touch = false) {
  const card = page.locator(`[data-game="${id}"]`);
  if (touch) await card.tap();
  else await card.click();
  await expect.poll(async () => (await stateOf(page)).id).toBe(id);
  await expect(card).toHaveAttribute('aria-pressed', 'true');
}

async function startGame(page, touch = false) {
  const button = page.locator('#start-button');
  if (touch) await button.tap();
  else await button.click();
  await expect.poll(async () => (await stateOf(page)).state).toBe('playing');
  await expect(page.locator('#game-overlay')).toBeHidden();
}

async function animationFrames(page, count = 15) {
  await page.evaluate(frames => new Promise(resolve => {
    function next() {
      frames -= 1;
      if (frames <= 0) resolve();
      else requestAnimationFrame(next);
    }
    requestAnimationFrame(next);
  }), count);
}

async function canvasPoint(page, x, y) {
  const canvas = page.locator('#game-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const rect = await canvas.boundingBox();
  expect(rect).not.toBeNull();
  const scale = Math.min(rect.width / 960, rect.height / 560);
  return {
    x: rect.x + (rect.width - 960 * scale) / 2 + x * scale,
    y: rect.y + (rect.height - 560 * scale) / 2 + y * scale,
  };
}

test('desktop lobby renders and switches between all ten games', async ({ page }) => {
  await openArcade(page);
  await expect(page).toHaveTitle(/奶蛙摸鱼乐园/);
  await expect(page.locator('[data-game]')).toHaveCount(10);
  await expect(page.locator('#hero-title')).toContainText('让奶蛙替你');
  await page.screenshot({ path: join(tmpdir(), 'naiwa-desktop.png'), fullPage: true });

  for (const [id, name] of [['angry', '愤怒的奶蛙'], ['whack', '暴打奶蛙'], ['catch', '奶蛙接不住'], ['jump', '奶蛙跳一跳'], ['merge', '奶蛙 2048'], ['flappy', '奶蛙飞不动'], ['fighter', '奶蛙大乱斗'], ['survivor', '奶蛙幸存者'], ['bomber', '奶蛙炸弹人'], ['aim', '奶蛙瞄准实验室']]) {
    await selectGame(page, id);
    await expect(page.locator('#current-name')).toHaveText(name);
    await expect(page.locator('[data-game][aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#live-score')).toHaveText('0');
    expect((await stateOf(page)).state).toBe('ready');
  }
});

test('flappy responds to a flap, reaches game over, and restarts', async ({ page }) => {
  await openArcade(page);
  await startGame(page);
  await page.keyboard.press('Space');
  expect((await stateOf(page)).game.player.velocity).toBeLessThan(-250);
  await page.waitForFunction(() => window.__arcade.getState().state === 'ended', null, { timeout: 8_000 });
  await expect(page.locator('#result-score')).toBeVisible();
  await expect(page.locator('#result-value')).toHaveText('0');
  await expect(page.locator('#start-button')).toContainText('再来一局');
  await startGame(page);
  const state = await stateOf(page);
  expect(state.game.phase).toBe('running');
  expect(state.score).toBe(0);
  expect(state.game.pipes.every(pipe => !pipe.passed)).toBe(true);
});

test('P and the help dialog pause the timer until the player resumes', async ({ page }) => {
  await openArcade(page);
  await selectGame(page, 'whack');
  await startGame(page);
  await page.waitForFunction(() => window.__arcade.getState().game.timeLeft < 29.8);
  await page.keyboard.press('p');
  await expect.poll(async () => (await stateOf(page)).state).toBe('paused');
  const pausedAt = (await stateOf(page)).game.timeLeft;
  await animationFrames(page);
  expect((await stateOf(page)).game.timeLeft).toBe(pausedAt);
  await page.keyboard.press('p');
  await page.waitForFunction(time => window.__arcade.getState().game.timeLeft < time - 0.1, pausedAt);

  await page.locator('#help-button').click();
  await expect(page.locator('#help-dialog')).toBeVisible();
  expect((await stateOf(page)).state).toBe('paused');
  const helpTime = (await stateOf(page)).game.timeLeft;
  await animationFrames(page);
  expect((await stateOf(page)).game.timeLeft).toBe(helpTime);
  await page.locator('#help-done').click();
  await expect(page.locator('#help-dialog')).toBeHidden();
  expect((await stateOf(page)).state).toBe('paused');
  await startGame(page);
  await page.waitForFunction(time => window.__arcade.getState().game.timeLeft < time - 0.1, helpTime);
});

test('number keys hit visible frogs and preserve the correct best score after reload', async ({ page }) => {
  await openArcade(page);
  await selectGame(page, 'whack');
  await startGame(page);
  for (let hit = 1; hit <= 3; hit += 1) {
    await page.waitForFunction(() => window.__arcade.getState().game.holes.some(hole => hole.state === 'up' && hole.age < 0.4));
    const hole = (await stateOf(page)).game.holes.find(candidate => candidate.state === 'up');
    await page.keyboard.press(String(hole.key));
    await expect.poll(async () => (await stateOf(page)).game.hits).toBe(hit);
  }
  const score = (await stateOf(page)).score;
  expect(score).toBeGreaterThanOrEqual(30);
  await expect(page.locator('#live-score')).toHaveText(String(score));
  expect(await page.evaluate(() => Number(localStorage.getItem('naiwa:best:whack')))).toBe(score);
  await page.reload({ waitUntil: 'networkidle' });
  await selectGame(page, 'whack');
  await expect(page.locator('#best-score')).toHaveText(`${score} 分`);
  await expect(page.locator('#live-score')).toHaveText('0');
  expect((await stateOf(page)).state).toBe('ready');
});

test('dragging the scaled canvas sling consumes one shot and launches forward', async ({ page }) => {
  await openArcade(page);
  await selectGame(page, 'angry');
  await startGame(page);
  const anchor = await canvasPoint(page, 176, 342);
  const pulled = await canvasPoint(page, 86, 410);
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  await expect.poll(async () => (await stateOf(page)).game.phase).toBe('dragging');
  await page.mouse.move(pulled.x, pulled.y, { steps: 8 });
  expect((await stateOf(page)).game.aimPower).toBeGreaterThan(0.85);
  await page.mouse.up();
  const launched = (await stateOf(page)).game;
  expect(launched.phase).toBe('flying');
  expect(launched.shots).toBe(2);
  expect(launched.frog.vx).toBeGreaterThan(0);
  expect(launched.frog.vy).toBeLessThan(0);
  await page.waitForFunction(x => window.__arcade.getState().game.frog?.x > x + 35, launched.frog.x);
});

test('sound preference persists through reloads in both directions', async ({ page }) => {
  await openArcade(page);
  const button = page.locator('#sound-toggle');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect((await stateOf(page)).soundEnabled).toBe(false);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect((await stateOf(page)).soundEnabled).toBe(true);
});

test.describe('390px touch screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('fits the viewport and accepts touch flaps and frog hits', async ({ page }) => {
    await openArcade(page);
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fits()).toBe(true);
    await page.screenshot({ path: join(tmpdir(), 'naiwa-mobile.png'), fullPage: true });
    await startGame(page, true);
    const flap = await canvasPoint(page, 480, 260);
    await page.touchscreen.tap(flap.x, flap.y);
    expect((await stateOf(page)).game.player.velocity).toBeLessThan(-220);

    await selectGame(page, 'whack', true);
    await startGame(page, true);
    await page.waitForFunction(() => window.__arcade.getState().game.holes.some(hole => hole.state === 'up' && hole.age < 0.4));
    const hole = (await stateOf(page)).game.holes.find(candidate => candidate.state === 'up');
    const target = await canvasPoint(page, hole.x, hole.y - 51);
    await page.touchscreen.tap(target.x, target.y);
    await expect.poll(async () => (await stateOf(page)).game.hits).toBe(1);
    await expect(page.locator('#live-score')).toHaveText('10');
    expect(await fits()).toBe(true);
  });
});
