import { test as base, expect } from '@playwright/test';

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

async function training(page) {
  await page.clock.install();
  await page.goto('./?debug', { waitUntil: 'networkidle' });
  await page.locator('#game-select').selectOption('fighter');
  await page.locator('#play-mode-select').selectOption('training');
  await page.locator('#fighter-character').selectOption('belly');
  await page.locator('#opponent-character').selectOption('belly');
  await page.locator('#start-button').click();
  await expect(page.locator('#game-overlay')).toBeHidden();
  expect((await current(page)).game.training).toBe(true);
}

async function until(page, predicate, milliseconds = 1800, step = 16) {
  for (let elapsed = 0; elapsed <= milliseconds; elapsed += step) {
    const state = await current(page);
    if (predicate(state.game)) return state.game;
    await page.clock.runFor(step);
  }
  throw new Error(`Public keyboard/touch condition timed out: ${JSON.stringify((await current(page)).game)}`);
}

async function approach(page, range = 80) {
  await page.locator('#game-canvas').focus();
  const initial = (await current(page)).game;
  const code = initial.players[0].x < initial.players[1].x ? 'KeyD' : 'KeyA';
  await page.keyboard.down(code);
  await until(page, state => Math.abs(state.players[0].x - state.players[1].x) <= range, 4000, 24);
  await page.keyboard.up(code); await page.clock.runFor(64);
}

test('98 training keyboard: retreat faces the opponent and both jump punches actually hit in the air', async ({ page }, testInfo) => {
  await training(page);
  await expect(page.locator('#fighter-training')).toBeVisible();
  await expect(page.locator('#training-boxes')).toBeChecked();
  const before = (await current(page)).game;
  await page.keyboard.down('KeyA'); await page.keyboard.down('ArrowRight'); await page.clock.runFor(180);
  const retreating = (await current(page)).game;
  expect(retreating.players.map(player => player.movement)).toEqual(['backwalk', 'backwalk']);
  expect(retreating.players.map(player => player.facing)).toEqual([1, -1]);
  expect(retreating.players[0].x).toBeLessThan(before.players[0].x);
  expect(retreating.players[1].x).toBeGreaterThan(before.players[1].x);
  await page.keyboard.up('KeyA'); await page.keyboard.up('ArrowRight');
  const evidence = [];
  for (const code of ['KeyJ', 'KeyK']) {
    await page.locator('#training-reset').click();
    await approach(page);
    const beforeHit = (await current(page)).game;
    await page.keyboard.down('KeyW'); await page.keyboard.down(code);
    await page.clock.runFor(24); await page.keyboard.up('KeyW'); await page.keyboard.up(code);
    const hit = await until(page, state => state.stats.hits[0] > beforeHit.stats.hits[0], 1400, 8);
    expect(hit.players[0].airborne, `${code} must land damage before landing`).toBe(true);
    expect(hit.players[0].attack?.context).toBe('air');
    expect(hit.stats.damage[0]).toBeGreaterThan(beforeHit.stats.damage[0]);
    expect(hit.players[1].hurtTime).toBeGreaterThan(0);
    expect(hit.players[1].hp).toBe(hit.players[1].maxHp);
    evidence.push({ key: code, airborne: hit.players[0].airborne, attack: hit.players[0].attack,
      attacker: { x: hit.players[0].x, y: hit.players[0].y, vx: hit.players[0].vx },
      target: { x: hit.players[1].x, y: hit.players[1].y, hurtTime: hit.players[1].hurtTime },
      hits: hit.stats.hits[0] - beforeHit.stats.hits[0], damage: hit.stats.damage[0] - beforeHit.stats.damage[0] });
  }
  await testInfo.attach('real-airborne-contact.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  await page.locator('#player-window').screenshot({ path: '/tmp/naiwa-fighter98-desktop.png' });
});

test('98 training guard selector makes low kicks beat stand guard and lose to crouch guard', async ({ page }) => {
  await training(page);
  for (const guard of ['stand', 'crouch']) {
    await page.locator('#training-guard').selectOption(guard);
    await page.locator('#training-reset').click();
    await approach(page);
    await page.keyboard.down('KeyS'); await page.keyboard.press('KeyU');
    const contact = await until(page, state => state.stats.hits[0] + state.stats.blockedHits[0] > 0, 1400);
    await page.keyboard.up('KeyS');
    expect(contact.stats.hits[0] > 0).toBe(guard === 'stand');
    expect(contact.stats.blockedHits[0] > 0).toBe(guard === 'crouch');
    expect(contact.players[0].attack?.context).toBe('crouch');
    expect(contact.players[0].attack?.height).toBe('low');
  }
  await page.locator('#training-boxes').uncheck();
  await expect(page.locator('#training-boxes')).not.toBeChecked();
  await expect(page.locator('#training-readout')).not.toHaveText('');
});

test.describe('98 mobile input', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('simultaneous direction, jump and punch work; MAX and pause release all touches', async ({ page }) => {
    await training(page);
    await expect(page.locator('#action-controls .action-buttons button')).toHaveCount(9);
    await page.locator('#action-controls').scrollIntoViewIfNeeded();
    const boxes = await Promise.all(['right', 'jump', 'light'].map(action => page.locator(`[data-action="${action}"]`).boundingBox()));
    expect(boxes.every(Boolean)).toBe(true);
    const touches = boxes.map((box, id) => ({ id, x: box.x + box.width / 2, y: box.y + box.height / 2 }));
    const client = await page.context().newCDPSession(page);
    try {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touches[0]] });
      await page.clock.runFor(100);
      const moving = (await current(page)).game.players[0];
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
      await page.clock.runFor(24);
      const jumped = (await current(page)).game.players[0];
      expect(jumped.airborne).toBe(true);
      expect(jumped.attack?.context).toBe('air');
      expect(jumped.vx).toBeGreaterThan(moving.vx * 0.85);
      await expect(page.locator('#action-controls [aria-pressed="true"]')).toHaveCount(3);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await until(page, state => !state.players[0].airborne && !state.players[0].attack, 2000);
      await page.locator('[data-action="max"]').tap();
      expect((await current(page)).game.players[0].maxTime).toBeGreaterThan(0);
      await page.locator('#player-window').screenshot({ path: '/tmp/naiwa-fighter98-mobile.png' });
      const right = await page.locator('[data-action="right"]').boundingBox();
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 4, x: right.x + right.width / 2, y: right.y + right.height / 2 }] });
      await page.keyboard.press('KeyP');
      const paused = await current(page);
      expect(paused.state).toBe('paused');
      await page.clock.runFor(500);
      expect((await current(page)).game.players[0].maxTime).toBe(paused.game.players[0].maxTime);
      expect((await current(page)).game.players[0].animation).toEqual(paused.game.players[0].animation);
      await expect(page.locator('#action-controls [aria-pressed="true"]')).toHaveCount(0);
      expect((await current(page)).game.held.every(input => Object.values(input).every(value => !value))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await client.detach();
    }
  });
});

const layout = page => page.evaluate(() => {
  const box = element => {
    const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
    return { x, y, width, height, right, bottom };
  };
  return {
    width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
    canvas: box(document.querySelector('#game-canvas')),
    controls: box(document.querySelector('#action-controls')),
    guide: box(document.querySelector('#fighter-guide')),
    buttons: [...document.querySelectorAll('#action-controls button')].map(box),
  };
});

function expectUnobstructed(layout, fullscreen = false) {
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.width);
  expect(layout.canvas.width).toBeGreaterThan(200);
  expect(layout.canvas.height).toBeGreaterThan(120);
  expect(layout.buttons).toHaveLength(13); // Four directions and all nine actions.
  for (const button of layout.buttons) {
    expect(button.width).toBeGreaterThan(24);
    expect(button.height).toBeGreaterThanOrEqual(40);
    expect(button.x).toBeGreaterThanOrEqual(-1);
    expect(button.right).toBeLessThanOrEqual(layout.width + 1);
    const overlapsCanvas = button.x < layout.canvas.right && button.right > layout.canvas.x
      && button.y < layout.canvas.bottom && button.bottom > layout.canvas.y;
    expect(overlapsCanvas, 'Every touch control must stay outside the actual game canvas').toBe(false);
    if (fullscreen) {
      expect(button.y).toBeGreaterThanOrEqual(-1);
      expect(button.bottom).toBeLessThanOrEqual(layout.height + 1);
    }
  }
}

for (const viewport of [{ width: 320, height: 740 }, { width: 844, height: 390 }]) {
  test.describe(`98 layout ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });

    test('expanded move guide and fullscreen keep the arena and all nine actions usable', async ({ page }) => {
      await training(page);
      await page.locator('#fighter-guide summary').click();
      expectUnobstructed(await layout(page));
      await page.locator('#fullscreen-button').click();
      await page.waitForFunction(() => document.fullscreenElement?.id === 'player-window');
      expectUnobstructed(await layout(page), true);
      await page.screenshot({ path: `/tmp/naiwa-fighter98-fullscreen-${viewport.width}.png` });
      await page.locator('[data-action="max"]').tap();
      expect((await current(page)).game.players[0].maxTime).toBeGreaterThan(0);
      await page.locator('#fullscreen-button').click();
      await page.waitForFunction(() => !document.fullscreenElement);
      await expect(page.locator('#fighter-guide')).toBeVisible();
      await expect(page.locator('#fighter-training')).toBeVisible();
      expectUnobstructed(await layout(page));
    });
  });
}

test('training persists after reload, preserves the classic record, and restores scoring when left', async ({ page }) => {
  await training(page);
  const storedBest = () => page.evaluate(() => localStorage.getItem('naiwa:best:fighter'));
  expect(await storedBest()).toBeNull();

  async function trainingHit() {
    await approach(page);
    await page.keyboard.press('KeyJ');
    const hit = await until(page, state => state.stats.hits[0] > 0);
    expect(hit.stats.damage[0]).toBeGreaterThan(0);
    expect((await current(page)).score).toBe(0);
    await expect(page.locator('#best-score')).toHaveText('—');
  }

  async function classicHit() {
    await page.locator('#play-mode-select').selectOption('classic');
    await page.locator('#start-button').click();
    expect((await current(page)).game.training).toBe(false);
    for (let attempt = 0; attempt < 50 && (await current(page)).score === 0; attempt += 1) {
      const { players } = (await current(page)).game;
      if (Math.abs(players[0].x - players[1].x) > 85) {
        const key = players[0].x < players[1].x ? 'KeyD' : 'KeyA';
        await page.keyboard.down(key); await page.clock.runFor(120); await page.keyboard.up(key);
      } else {
        await page.keyboard.down('KeyS'); await page.keyboard.press('KeyU');
        await page.clock.runFor(280); await page.keyboard.up('KeyS');
      }
    }
    const score = (await current(page)).score;
    expect(score, 'A real classic-mode hit should resume score and record updates').toBeGreaterThan(0);
    expect(Number(await storedBest())).toBeGreaterThanOrEqual(score);
    await expect(page.locator('#best-score')).not.toHaveText('—');
    return await storedBest();
  }

  await trainingHit();
  expect(await storedBest()).toBeNull();
  const best = await classicHit();
  await page.locator('#play-mode-select').selectOption('training');
  await page.locator('#start-button').click();
  await trainingHit();
  expect(await storedBest()).toBe(best);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#game-select').selectOption('fighter');
  await expect(page.locator('#play-mode-select')).toHaveValue('training');
  await expect(page.locator('#fighter-training')).toBeVisible();
  expect(await storedBest()).toBe(best);
  await page.locator('#start-button').click();
  expect((await current(page)).game.training).toBe(true);
  await classicHit();
});
