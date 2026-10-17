import { test as base, expect } from './browser-fixtures.js';

const test = base.extend({
  page: async ({ page }, use) => {
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    await use(page);
    expect(failures).toEqual([]);
  },
});

const current = page => page.evaluate(() => window.__arcade.getState());
const boardFor = ({ mode = 'classic', difficulty = 'normal', drill = 'grid', input = 'cursor' } = {}) => `v1:aim:${mode}:${difficulty}:${drill}:${input}`;

function auditRuns(page) {
  const runs = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') runs.push(request.postDataJSON());
  });
  return runs;
}

async function deferredPointerLock(page) {
  await page.addInitScript(() => {
    let locked = null;
    const pending = [];
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    Element.prototype.requestPointerLock = function () {
      return new Promise(resolve => pending.push({ element: this, resolve }));
    };
    document.exitPointerLock = () => { locked = null; document.dispatchEvent(new Event('pointerlockchange')); };
    window.__testPointerLock = { grant() {
      const request = pending.shift();
      if (!request) throw new Error('No pending browser permission request');
      locked = request.element;
      document.dispatchEvent(new Event('pointerlockchange'));
      request.resolve();
    } };
  });
}

async function openAim(page, { drill = 'grid', input = 'cursor', mode = 'classic', difficulty = 'normal' } = {}) {
  await page.clock.install();
  await page.goto('./?debug', { waitUntil: 'networkidle' });
  await page.locator('#game-select').selectOption('aim');
  await page.locator('#aim-drill').selectOption(drill);
  await page.locator('#aim-input').selectOption(input);
  await page.locator('#play-mode-select').selectOption(mode);
  await page.locator('#difficulty-select').selectOption(difficulty);
  await expect(page.locator('#aim-settings')).toBeVisible();
  await expect(page.locator('#game-number')).toHaveText('10 / 11');
}

async function startAim(page, touch = false) {
  if (touch) await page.locator('#start-button').tap();
  else await page.locator('#start-button').click();
  await expect(page.locator('#game-overlay')).toBeHidden();
  expect((await current(page)).game.phase).toBe('countdown');
}

async function beginTraining(page) {
  await page.clock.runFor(3200);
  expect((await current(page)).game.phase).toBe('playing');
}

async function point(page, logical) {
  const canvas = page.locator('#game-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  const scale = Math.min(bounds.width / 960, bounds.height / 560);
  return { x: bounds.x + (bounds.width - 960 * scale) / 2 + logical.x * scale,
    y: bounds.y + (bounds.height - 560 * scale) / 2 + logical.y * scale };
}

async function targetPoint(page) {
  const target = (await current(page)).game.targets.find(item => item.screen.visible);
  expect(target, 'An actual visible target is available').toBeTruthy();
  return { target, screen: await point(page, target.screen) };
}

async function shootTarget(page, touch = false) {
  const { screen, target } = await targetPoint(page);
  if (touch) await page.touchscreen.tap(screen.x, screen.y);
  else await page.mouse.click(screen.x, screen.y);
  return target;
}

async function emptyPoint(page) {
  const targets = (await current(page)).game.targets.filter(item => item.screen.visible);
  const candidates = [{ x: 30, y: 120 }, { x: 930, y: 120 }, { x: 30, y: 510 }, { x: 930, y: 510 }];
  const distance = candidate => Math.min(...targets.map(({ screen }) => Math.hypot(candidate.x - screen.x, candidate.y - screen.y) - screen.r));
  candidates.sort((a, b) => distance(b) - distance(a));
  expect(distance(candidates[0])).toBeGreaterThan(60);
  return point(page, candidates[0]);
}

test('cursor grid counts real hits and misses, ignores countdown shots, and pauses without losing the run', async ({ page }) => {
  const runs = auditRuns(page);
  await openAim(page);
  await startAim(page);
  const center = await point(page, { x: 480, y: 280 });
  await page.mouse.click(center.x, center.y);
  expect((await current(page)).game.stats.shots).toBe(0);
  expect((await current(page)).score).toBe(0);
  await beginTraining(page);
  expect((await current(page)).game.stats.shots).toBe(0);
  const original = await shootTarget(page);
  const hit = (await current(page)).game;
  expect(hit.stats.shots).toBe(1);
  expect(hit.stats.hits).toBe(1);
  expect(hit.score).toBeGreaterThan(0);
  expect(hit.targets.some(target => target.id === original.id)).toBe(false);
  await page.clock.runFor(100);
  const miss = await emptyPoint(page);
  await page.mouse.click(miss.x, miss.y);
  const missed = (await current(page)).game;
  expect(missed.stats.shots).toBe(2);
  expect(missed.stats.hits).toBe(1);
  expect(missed.stats.misses).toBe(1);
  expect(missed.stats.accuracy).toBeCloseTo(50, 1);
  await expect.poll(() => runs.length).toBe(1);
  expect(runs[0].board).toBe(boardFor());
  await page.keyboard.press('KeyP');
  const paused = (await current(page)).game;
  expect((await current(page)).state).toBe('paused');
  await page.clock.runFor(1200);
  expect((await current(page)).game.elapsed).toBe(paused.elapsed);
  expect((await current(page)).game.stats).toEqual(paused.stats);
  await page.locator('#start-button').click();
  await page.clock.runFor(200);
  expect((await current(page)).game.elapsed).toBeGreaterThan(paused.elapsed);
  expect(runs).toHaveLength(1);
  await page.locator('#player-window').screenshot({ path: '/tmp/naiwa-aim-desktop.png' });
});

test('precision settings persist and a finished session uses its exact leaderboard dimensions', async ({ page }) => {
  const options = { drill: 'precision', mode: 'endless', difficulty: 'hard' };
  const runs = auditRuns(page);
  await openAim(page, options);
  await page.locator('#aim-input').selectOption('fps');
  await page.locator('#aim-sensitivity').focus();
  await page.keyboard.press('End');
  await expect(page.locator('#aim-sensitivity')).toHaveValue('3');
  await page.locator('#aim-input').selectOption('cursor');
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#game-select').selectOption('aim');
  await expect(page.locator('#aim-drill')).toHaveValue('precision');
  await expect(page.locator('#aim-input')).toHaveValue('cursor');
  await expect(page.locator('#aim-sensitivity')).toHaveValue('3');
  await expect(page.locator('#difficulty-select')).toHaveValue('hard');
  await expect(page.locator('#play-mode-select')).toHaveValue('endless');
  await startAim(page); await beginTraining(page);
  await shootTarget(page);
  const played = (await current(page)).game;
  expect(played.stats.hits).toBe(1);
  expect(played.stats.averageReactionMs).toBeGreaterThanOrEqual(0);
  await page.locator('#aim-finish').click();
  expect((await current(page)).state).toBe('ended');
  expect((await current(page)).game.phase).toBe('ended');
  await expect(page.locator('#result-value')).toHaveText(String(played.score));
  await expect(page.locator('#aim-results')).toContainText('命中率');
  await expect(page.locator('#aim-results')).toContainText('平均反应');
  await expect(page.locator('#aim-results')).toContainText('1 / 1');
  await expect.poll(() => runs.at(-1)?.board).toBe(boardFor(options));
  await page.locator('#leaderboard-result-open').click();
  await expect(page.locator('#leaderboard-board')).toHaveValue(boardFor(options));
  await expect(page.locator('#leaderboard-pending')).toContainText('1 局待传');
  await page.locator('#leaderboard-close').click();
  await page.locator('#aim-drill').selectOption('grid');
  expect((await current(page)).state).toBe('ready');
  await expect(page.locator('#result-score')).toBeHidden();
});

test('tracking only scores while firing on the moving target, and pause clears held fire', async ({ page }) => {
  await openAim(page, { drill: 'track', difficulty: 'easy' });
  await startAim(page); await beginTraining(page);
  const first = await targetPoint(page);
  await page.mouse.move(first.screen.x, first.screen.y);
  await page.mouse.down();
  for (let frame = 0; frame < 20; frame += 1) {
    const { screen } = await targetPoint(page);
    await page.mouse.move(screen.x, screen.y);
    await page.clock.runFor(32);
  }
  const tracked = (await current(page)).game;
  expect(tracked.score).toBeGreaterThan(0);
  expect(tracked.stats.trackingHitTime).toBeGreaterThan(0.3);
  expect(tracked.stats.trackingFireTime).toBeGreaterThanOrEqual(tracked.stats.trackingHitTime);
  const miss = await emptyPoint(page);
  await page.mouse.move(miss.x, miss.y);
  const movedOff = (await current(page)).game;
  await page.clock.runFor(300);
  const offTarget = (await current(page)).game;
  expect(offTarget.stats.trackingHitTime).toBe(movedOff.stats.trackingHitTime);
  expect(offTarget.stats.trackingFireTime).toBeGreaterThan(tracked.stats.trackingFireTime);
  await page.mouse.up();
  const released = (await current(page)).game;
  await page.clock.runFor(300);
  expect((await current(page)).game.stats.trackingFireTime).toBe(released.stats.trackingFireTime);
  const { screen } = await targetPoint(page);
  await page.mouse.move(screen.x, screen.y); await page.mouse.down();
  await page.keyboard.press('KeyP'); await page.mouse.up();
  const paused = (await current(page)).game;
  await page.locator('#start-button').click();
  await page.clock.runFor(300);
  expect((await current(page)).game.stats.trackingFireTime).toBe(paused.stats.trackingFireTime);
});

test('classic training ends after 60 active seconds and shows the real session report', async ({ page }) => {
  test.setTimeout(45_000);
  const runs = auditRuns(page);
  await openAim(page);
  await startAim(page); await beginTraining(page);
  await shootTarget(page);
  await page.clock.runFor(61_000);
  const finished = await current(page);
  expect(finished.state).toBe('ended');
  expect(finished.game.elapsed).toBeCloseTo(60, 5);
  expect(finished.game.stats.hits).toBe(1);
  await expect(page.locator('#aim-results')).toBeVisible();
  await expect(page.locator('#aim-results')).toContainText('100.0%');
  await expect(page.locator('#aim-results')).toContainText('1 / 1');
  await expect(page.locator('#aim-results')).toContainText('60.0 秒');
  await expect(page.locator('#aim-finish')).toBeDisabled();
  await expect.poll(() => runs.length).toBe(1);
  expect(runs[0].board).toBe(boardFor());
});

test('native FPS lock moves the camera with a fixed reticle, resumes its run, and releases on Esc', async ({ page }) => {
  const runs = auditRuns(page);
  await openAim(page, { input: 'fps' });
  await page.locator('#start-button').click();
  await expect.poll(async () => (await current(page)).state).toBe('playing');
  const started = await current(page);
  test.skip(!started.aimLocked, 'The browser refused native Pointer Lock; separate lifecycle tests cover the fallback.');
  expect(started.aimInput).toBe('fps');
  await beginTraining(page);
  await page.evaluate(() => {
    window.__observedAimMouse = [];
    document.addEventListener('mousemove', event => {
      if (event.movementX || event.movementY) {
        const { view, crosshair } = window.__arcade.getState().game;
        window.__observedAimMouse.push({ trusted: event.isTrusted, yaw: view.yaw, crosshair });
      }
    });
  });
  // Headless Chromium emits an opposite recenter event after each automated
  // mouse move while locked. Observe the actual trusted events and game camera
  // together, so the final recenter cannot hide a correctly handled movement.
  for (const x of [1300, 100, 1100]) {
    await page.mouse.move(x, 500);
  }
  const moved = (await current(page)).game;
  const samples = await page.evaluate(() => window.__observedAimMouse);
  expect(new Set(samples.map(sample => sample.yaw)).size).toBeGreaterThan(1);
  expect(samples.every(sample => sample.trusted && sample.crosshair.x === 480 && sample.crosshair.y === 280)).toBe(true);
  expect(moved.crosshair).toEqual({ x: 480, y: 280 });
  await page.mouse.down(); await page.mouse.up();
  expect((await current(page)).game.stats.shots).toBe(1);
  await page.keyboard.press('KeyP');
  await expect.poll(async () => (await current(page)).aimLocked).toBe(false);
  const paused = (await current(page)).game.elapsed;
  await page.clock.runFor(700);
  expect((await current(page)).game.elapsed).toBe(paused);
  await page.locator('#start-button').click();
  await expect.poll(async () => (await current(page)).aimLocked).toBe(true);
  await page.clock.runFor(100);
  expect((await current(page)).game.elapsed).toBeGreaterThan(paused);
  expect(runs).toHaveLength(1);
  expect(runs[0].board).toBe(boardFor({ input: 'fps' }));
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await current(page)).aimLocked).toBe(false);
  expect((await current(page)).state).toBe('paused');
});

test('denied Pointer Lock starts a separate cursor board and honestly changes the selected control', async ({ page }) => {
  await page.addInitScript(() => {
    Element.prototype.requestPointerLock = function () { return Promise.reject(new DOMException('Denied for this test', 'NotAllowedError')); };
  });
  const runs = auditRuns(page);
  await openAim(page, { input: 'fps', drill: 'precision', difficulty: 'hard' });
  await page.locator('#start-button').click();
  await expect(page.locator('#aim-input')).toHaveValue('cursor');
  await expect.poll(() => runs.length).toBe(1);
  expect(runs[0].board).toBe(boardFor({ drill: 'precision', difficulty: 'hard' }));
  expect((await current(page)).aimLocked).toBe(false);
  await beginTraining(page);
  await shootTarget(page);
  expect((await current(page)).game.stats.hits).toBe(1);
});

test('mocked Pointer Lock lifecycle preserves a paused FPS run when reacquiring fails', async ({ page }) => {
  // This deliberately mocks only the browser permission/lifecycle API. Game
  // state is read-only, and gameplay still uses ordinary pointer/key events.
  await page.addInitScript(() => {
    let locked = null, requests = 0;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    Element.prototype.requestPointerLock = function () {
      requests++;
      if (requests === 2) return Promise.reject(new DOMException('Reacquire denied for this test', 'NotAllowedError'));
      locked = this;
      document.dispatchEvent(new Event('pointerlockchange'));
      return Promise.resolve();
    };
    document.exitPointerLock = () => { locked = null; document.dispatchEvent(new Event('pointerlockchange')); };
  });
  const runs = auditRuns(page);
  await openAim(page, { input: 'fps' });
  await startAim(page); await beginTraining(page);
  expect((await current(page)).aimLocked).toBe(true);
  await page.keyboard.press('KeyP');
  const elapsed = (await current(page)).game.elapsed;
  await page.locator('#start-button').click();
  await expect(page.locator('#start-button')).toBeEnabled();
  expect((await current(page)).state).toBe('paused');
  expect((await current(page)).aimLocked).toBe(false);
  await expect(page.locator('#aim-input')).toHaveValue('fps');
  await page.clock.runFor(1000);
  expect((await current(page)).game.elapsed).toBe(elapsed);
  expect(runs).toHaveLength(1);
  expect(runs[0].board).toBe(boardFor({ input: 'fps' }));
  await page.locator('#start-button').click();
  expect((await current(page)).aimLocked).toBe(true);
  await page.clock.runFor(100);
  expect((await current(page)).game.elapsed).toBeGreaterThan(elapsed);
  expect(runs).toHaveLength(1);
  await page.locator('#game-select').selectOption('flappy');
  expect((await current(page)).aimLocked).toBe(false);
});

test('a delayed mocked lock grant cannot start behind help or after window blur', async ({ page }) => {
  await deferredPointerLock(page);
  const runs = auditRuns(page);
  await openAim(page, { input: 'fps' });
  await page.locator('#start-button').click();
  await expect(page.locator('#start-button')).toBeDisabled();
  await page.locator('#help-button').click();
  await expect(page.locator('#help-dialog')).toBeVisible();
  await page.evaluate(() => window.__testPointerLock.grant());
  expect((await current(page)).state).toBe('ready');
  expect((await current(page)).aimLocked).toBe(false);
  expect(runs).toHaveLength(0);
  await page.locator('#help-done').click();
  await page.locator('#start-button').click();
  await expect(page.locator('#start-button')).toBeDisabled();
  // The blur event models the browser losing focus while its permission prompt
  // is unresolved; it does not alter any game state or call a game method.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.evaluate(() => window.__testPointerLock.grant());
  expect((await current(page)).state).toBe('ready');
  expect((await current(page)).aimLocked).toBe(false);
  expect(runs).toHaveLength(0);
  await expect(page.locator('#start-button')).toBeEnabled();
});

test('a delayed mocked resume grant cannot restart an already finished training session', async ({ page }) => {
  await deferredPointerLock(page);
  const runs = auditRuns(page);
  await openAim(page, { input: 'fps' });
  await page.locator('#start-button').click();
  await page.evaluate(() => window.__testPointerLock.grant());
  await beginTraining(page);
  await page.keyboard.press('KeyP');
  await page.locator('#start-button').click();
  await expect(page.locator('#start-button')).toBeDisabled();
  await page.locator('#aim-finish').click();
  const ended = (await current(page)).game;
  expect((await current(page)).state).toBe('ended');
  await page.evaluate(() => window.__testPointerLock.grant());
  await page.clock.runFor(250);
  expect((await current(page)).state).toBe('ended');
  expect((await current(page)).aimLocked).toBe(false);
  expect((await current(page)).game.elapsed).toBe(ended.elapsed);
  expect(runs).toHaveLength(1);
  await expect(page.locator('#aim-results')).toBeVisible();
});

test.describe('aim mobile cursor', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('390px touch hits a real target, keeps the page still, and has no horizontal overflow', async ({ page }) => {
    await openAim(page, { mode: 'endless' });
    await startAim(page, true); await beginTraining(page);
    await page.locator('#game-canvas').scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => scrollY);
    await shootTarget(page, true);
    expect((await current(page)).game.stats.hits).toBe(1);
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#player-window').screenshot({ path: '/tmp/naiwa-aim-mobile.png' });
    await page.locator('#aim-finish').tap();
    expect((await current(page)).state).toBe('ended');
    await expect(page.locator('#result-score')).toBeVisible();
    await expect(page.locator('#aim-results')).toBeVisible();
    await expect(page.locator('#aim-results dt')).toHaveText(['命中率', '平均切换', '命中 / 射击', '有效训练']);
    const viewport = page.viewportSize();
    for (const item of [...await page.locator('#aim-results > div').all(), page.locator('#start-button')]) {
      await expect(item).toBeVisible();
      const bounds = await item.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.locator('#player-window').screenshot({ path: '/tmp/naiwa-aim-mobile-result.png' });
  });
});
