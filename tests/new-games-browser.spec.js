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
const current = page => page.evaluate(() => window.__arcade.getState());
const select = (page, id) => page.locator('#game-select').selectOption(id);
const start = async page => {
  await page.locator('#start-button').click();
  await expect(page.locator('#game-overlay')).toBeHidden();
};
async function open(page) { await page.goto('./?debug', { waitUntil: 'networkidle' }); }

test('new game cards, controls, mode choices and eleven-game numbering agree', async ({ page }) => {
  await open(page);
  for (const [index, id] of ['fighter', 'survivor', 'bomber'].entries()) {
    await page.locator(`[data-game="${id}"]`).click();
    await expect(page.locator('#game-select')).toHaveValue(id);
    await expect(page.locator('#game-number')).toHaveText(`0${index + 7} / 11`);
    await expect(page.locator('#action-controls')).toBeVisible();
    for (const button of await page.locator('#action-controls button').all()) await expect(button).toBeDisabled();
    await expect(page.locator('#play-mode-select option')).toHaveCount(id === 'survivor' ? 2 : id === 'fighter' ? 4 : 3);
    await expect(page.locator('#fighter-setting')).toBeVisible({ visible: id === 'fighter' });
    await start(page);
    for (const button of await page.locator('#action-controls button').all()) await expect(button).toBeEnabled();
    await page.locator('#pause-button').click();
    for (const button of await page.locator('#action-controls button').all()) await expect(button).toBeDisabled();
  }
  await select(page, 'merge');
  await expect(page.locator('#action-controls')).toBeHidden();
  await expect(page.locator('#puzzle-controls')).toBeVisible();
});

test('fighter selects persistent characters and both players move independently', async ({ page }) => {
  await open(page); await select(page, 'fighter');
  await page.locator('#play-mode-select').selectOption('duel');
  await page.locator('#fighter-character').selectOption('laugh');
  await page.locator('#opponent-character').selectOption('speed');
  await expect(page.locator('#duel-guide')).toContainText('玩家 2');
  await start(page);
  const before = (await current(page)).game;
  expect(before.multiplayer).toBe(true);
  await page.keyboard.down('KeyD'); await page.keyboard.down('ArrowLeft');
  await expect.poll(async () => (await current(page)).game.players[0].x).toBeGreaterThan(before.players[0].x + 20);
  await expect.poll(async () => (await current(page)).game.players[1].x).toBeLessThan(before.players[1].x - 20);
  await page.keyboard.up('KeyD'); await page.keyboard.up('ArrowLeft');
  await page.keyboard.press('KeyP');
  const frozen = (await current(page)).game.players.map(player => player.x);
  await page.waitForTimeout(200);
  expect((await current(page)).game.players.map(player => player.x)).toEqual(frozen);
  await start(page);
  await page.locator('#player-window').screenshot({ path: '/tmp/naiwa-v3-fighter.png' });
  await page.reload({ waitUntil: 'networkidle' }); await select(page, 'fighter');
  await expect(page.locator('#fighter-character')).toHaveValue('laugh');
  await expect(page.locator('#opponent-character')).toHaveValue('speed');
  await expect(page.locator('#play-mode-select')).toHaveValue('duel');
  await page.locator('#play-mode-select').selectOption('endless'); await start(page);
  expect((await current(page)).game.endless).toBe(true);
  expect((await current(page)).game.multiplayer).toBe(false);
});

test('survivor moves, dashes and clears held movement on pause', async ({ page }) => {
  await open(page); await select(page, 'survivor'); await start(page);
  const initial = (await current(page)).game.player.x;
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await current(page)).game.player.x).toBeGreaterThan(initial + 25);
  await page.keyboard.press('Space');
  expect((await current(page)).game.dashCooldown).toBeGreaterThan(0);
  await page.keyboard.press('KeyP'); await page.keyboard.up('ArrowRight');
  const paused = (await current(page)).game;
  await page.waitForTimeout(200);
  expect((await current(page)).game.elapsed).toBe(paused.elapsed);
  await start(page);
  await page.waitForTimeout(500);
  const resumed = (await current(page)).game;
  expect(resumed.elapsed).toBeGreaterThan(paused.elapsed);
  await page.locator('#player-window').screenshot({ path: '/tmp/naiwa-v3-survivor.png' });
  await page.locator('#play-mode-select').selectOption('endless'); await start(page);
  expect((await current(page)).game.endless).toBe(true);
});

test('bomber places a bomb, releases it once, and routes the second keyboard player', async ({ page }) => {
  await open(page); await select(page, 'bomber');
  await page.locator('#play-mode-select').selectOption('duel'); await start(page);
  await page.keyboard.press('Space');
  expect((await current(page)).game.bombs).toHaveLength(1);
  await page.keyboard.press('Enter');
  expect((await current(page)).game.bombs).toHaveLength(2);
  await page.keyboard.down('KeyD'); await page.keyboard.down('ArrowLeft');
  await expect.poll(async () => (await current(page)).game.players[0].x).toBeGreaterThan(1);
  await expect.poll(async () => (await current(page)).game.players[1].x).toBeLessThan(11);
  await page.keyboard.up('KeyD'); await page.keyboard.up('ArrowLeft');
  await page.keyboard.press('KeyP');
  await start(page);
  await page.locator('#player-window').screenshot({ path: '/tmp/naiwa-v3-bomber.png' });
  await page.locator('#restart-button').click();
  expect((await current(page)).game.bombs).toHaveLength(0);
  expect((await current(page)).game.multiplayer).toBe(true);
  await page.locator('#play-mode-select').selectOption('endless'); await start(page);
  expect((await current(page)).game.endless).toBe(true);
  expect((await current(page)).game.multiplayer).toBe(false);
});

test('direction button keyboard activation moves and its pulse is cleared on pause', async ({ page }) => {
  await open(page); await select(page, 'bomber'); await start(page);
  const right = page.locator('[data-action="right"]');
  await right.focus(); await page.keyboard.press('Enter');
  await expect.poll(async () => (await current(page)).game.players[0].x).toBeGreaterThan(1);
  await expect(right).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-action="down"]').evaluate(button => button.click());
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(200);
  expect((await current(page)).game.players[0].held).toEqual([]);
  await expect(page.locator('#action-controls [aria-pressed="true"]')).toHaveCount(0);
});

test.describe('new mobile controls', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  test('survivor upgrade cards freeze time, accept touch and apply a weapon', async ({ page }) => {
    test.setTimeout(60_000);
    await page.clock.install();
    await open(page); await select(page, 'survivor'); await start(page);
    for (let turn = 0; turn < 6 && !(await current(page)).game.upgrades.length; turn++) await page.clock.runFor(5000);
    await expect(page.locator('#upgrade-panel')).toBeVisible();
    await expect(page.locator('[data-upgrade]')).toHaveCount(3);
    const frozen = (await current(page)).game.elapsed;
    await page.clock.runFor(2000);
    expect((await current(page)).game.elapsed).toBe(frozen);
    await page.locator('#upgrade-panel').scrollIntoViewIfNeeded();
    await page.locator('#player-window').screenshot({ path: '/tmp/naiwa-v3-upgrades-mobile.png' });
    await page.locator('[data-upgrade="0"]').tap();
    await expect(page.locator('#upgrade-panel')).toBeHidden();
    expect((await current(page)).game.weapons.belly).toBe(1);
    await page.clock.runFor(300);
    expect((await current(page)).game.elapsed).toBeGreaterThan(frozen);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test('two simultaneous fingers move and drop a bomb; pausing releases both touches', async ({ page }) => {
    await open(page); await select(page, 'bomber'); await start(page);
    await page.locator('#action-controls').scrollIntoViewIfNeeded();
    const right = await page.locator('[data-action="right"]').boundingBox();
    const bomb = await page.locator('[data-action="bomb"]').boundingBox();
    const client = await page.context().newCDPSession(page);
    const points = [right, bomb].map((box, id) => ({ id, x: box.x + box.width / 2, y: box.y + box.height / 2 }));
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
    await expect(page.locator('[data-action="right"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-action="bomb"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await current(page)).game.players[0].x).toBeGreaterThan(1);
    expect((await current(page)).game.bombs).toHaveLength(1);
    await page.keyboard.press('KeyP');
    await expect(page.locator('#action-controls [aria-pressed="true"]')).toHaveCount(0);
    expect((await current(page)).game.players[0].held).toEqual([]);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await client.detach();
    await start(page);
    await page.locator('#player-window').screenshot({ path: '/tmp/naiwa-v3-bomber-mobile.png' });
    for (const id of ['fighter', 'survivor']) {
      await select(page, id); await start(page);
      await expect(page.locator('#action-controls')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
});
