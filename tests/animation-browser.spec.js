import { test as base, expect } from '@playwright/test';

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    page.on('requestfailed', request => {
      if (/\/assets\//.test(request.url()) && request.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`Asset failed: ${request.url()}`);
    });
    await page.addInitScript(() => {
      // Track an atlas through the offscreen compositor into the visible game
      // canvas. Merely requesting an image is not proof that a game uses it.
      const provenance = new WeakMap();
      const trace = { atlasDraws: { motion: 0, combat: 0, footwork: 0 }, gameDraws: { motion: 0, combat: 0, footwork: 0 }, gameFrames: { motion: [], combat: [], footwork: [] }, invalidCrops: [] };
      Object.defineProperty(window, '__frogDrawTrace', { value: trace });
      const originalDraw = CanvasRenderingContext2D.prototype.drawImage;
      const originalClear = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        provenance.delete(this.canvas);
        return originalClear.apply(this, args);
      };
      CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
        const result = originalDraw.call(this, source, ...args);
        const url = source instanceof HTMLImageElement ? source.currentSrc || source.src : '';
        const atlas = /\/assets\/animation\/naiwa-motion-/.test(url) ? 'motion'
          : /\/assets\/animation\/naiwa-combat-/.test(url) ? 'combat' : /\/assets\/animation\/naiwa-footwork-/.test(url) ? 'footwork' : null;
        let incoming = provenance.get(source);
        if (atlas) {
          const crop = args.length === 8 ? args.slice(0, 4) : [0, 0, source.naturalWidth, source.naturalHeight];
          const [x, y, width, height] = crop;
          if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0
            || x + width > source.naturalWidth || y + height > source.naturalHeight) trace.invalidCrops.push({ atlas, crop });
          trace.atlasDraws[atlas] += 1;
          incoming = new Map([[atlas, new Set([crop.join(',')])]]);
        }
        if (incoming) {
          const accumulated = provenance.get(this.canvas) || new Map();
          for (const [name, crops] of incoming) {
            const recorded = accumulated.get(name) || new Set();
            for (const crop of crops) recorded.add(crop);
            accumulated.set(name, recorded);
            if (this.canvas.id === 'game-canvas') {
              trace.gameDraws[name] += 1;
              for (const crop of crops) if (!trace.gameFrames[name].includes(crop)) trace.gameFrames[name].push(crop);
            }
          }
          provenance.set(this.canvas, accumulated);
        }
        return result;
      };
    });
    await use(page);
    expect(errors).toEqual([]);
  },
});

const current = page => page.evaluate(() => window.__arcade.getState());
const traceOf = page => page.evaluate(() => window.__frogDrawTrace);

async function open(page) {
  await page.goto('./?debug', { waitUntil: 'networkidle' });
  await expect.poll(async () => (await current(page)).animations).toEqual({ motion: true, combat: true, footwork: true });
}

async function select(page, id) {
  await page.locator('#game-select').selectOption(id);
  await expect(page.locator('#game-select')).toHaveValue(id);
}

async function start(page) {
  await page.locator('#start-button').click();
  await expect(page.locator('#game-overlay')).toBeHidden();
}

const canvasHash = page => page.locator('#game-canvas').evaluate(canvas => {
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 2166136261;
  for (let index = 0; index < pixels.length; index += 1) hash = Math.imul(hash ^ pixels[index], 16777619);
  return hash >>> 0;
});

test('three transparent atlases decode and all 72 authored frames render distinct, bounded pixels', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const { FROG_ATLASES } = await import('./js/frog-atlas.js');
    const { FROG_CLIPS } = await import('./js/frog-animation.js');
    const { frogReady, drawFrog, frogAnimationStatus } = await import('./js/frog.js');
    await frogReady;
    const atlases = [];
    for (const [name, metadata] of Object.entries(FROG_ATLASES)) {
      const response = await fetch(new URL(`./assets/animation/${metadata.file}`, location.href));
      if (!response.ok) throw new Error(`Cannot load ${metadata.file}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      const cells = [];
      metadata.frames.forEach((row, rowIndex) => row.forEach((frame, column) => {
        const pixels = ctx.getImageData(column * 256, rowIndex * 256, 256, 256).data;
        let transparent = 0, opaque = 0;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] === 0) transparent += 1;
          if (pixels[index] >= 240) opaque += 1;
        }
        cells.push({ row: rowIndex, column, ...frame, transparent, opaque,
          corners: [3, 255 * 4 + 3, 255 * 256 * 4 + 3, pixels.length - 1].map(index => pixels[index]) });
      }));
      atlases.push({ name, width: bitmap.width, height: bitmap.height, cells });
      bitmap.close();
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const clips = [];
    for (const name of Object.keys(FROG_CLIPS)) {
      const frames = [];
      for (let frame = 0; frame < 6; frame += 1) {
        ctx.clearRect(0, 0, 256, 256);
        drawFrog(ctx, 128, 120, 118, { animation: name, animationProgress: frame / 5 });
        const pixels = ctx.getImageData(0, 0, 256, 256).data;
        let hash = 2166136261, visible = 0;
        for (let index = 0; index < pixels.length; index += 1) hash = Math.imul(hash ^ pixels[index], 16777619);
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) visible += 1;
        frames.push({ hash: hash >>> 0, visible, corners: [3, 255 * 4 + 3, 255 * 256 * 4 + 3, pixels.length - 1].map(index => pixels[index]) });
      }
      clips.push({ name, frames });
    }
    return { status: frogAnimationStatus(), atlases, clips };
  });
  expect(result.status).toEqual({ motion: true, combat: true, footwork: true });
  expect(result.atlases).toHaveLength(3);
  let total = 0;
  for (const atlas of result.atlases) {
    expect([atlas.width, atlas.height]).toEqual([1536, 1024]);
    expect(atlas.cells).toHaveLength(24);
    for (const frame of atlas.cells) {
      expect(frame.x).toBeGreaterThanOrEqual(frame.column * 256);
      expect(frame.y).toBeGreaterThanOrEqual(frame.row * 256);
      expect(frame.x + frame.width).toBeLessThanOrEqual((frame.column + 1) * 256);
      expect(frame.y + frame.height).toBeLessThanOrEqual((frame.row + 1) * 256);
      expect(frame.foot).toBeGreaterThan(0);
      expect(frame.foot).toBeLessThanOrEqual(frame.height);
      expect(frame.opaque).toBeGreaterThan(400);
      expect(frame.transparent).toBeGreaterThan(400);
      // The generated alpha may retain a 1/255 antialias value in an empty
      // source corner; visible background or an opaque matte must still fail.
      for (const alpha of frame.corners) expect(alpha).toBeLessThanOrEqual(2);
      total += 1;
    }
  }
  expect(total).toBe(72);
  expect(result.clips).toHaveLength(14);
  for (const clip of result.clips) {
    expect(new Set(clip.frames.map(frame => frame.hash)).size, `${clip.name} should render six different authored frames`).toBe(6);
    for (const frame of clip.frames) {
      expect(frame.visible).toBeGreaterThan(400);
      expect(frame.visible).toBeLessThan(256 * 256 / 2);
      expect(frame.corners).toEqual([0, 0, 0, 0]);
    }
  }
  const trace = await traceOf(page);
  expect(trace.atlasDraws.motion).toBeGreaterThanOrEqual(24);
  expect(trace.atlasDraws.combat).toBeGreaterThanOrEqual(24);
  expect(trace.atlasDraws.footwork).toBeGreaterThanOrEqual(24);
  expect(trace.invalidCrops).toEqual([]);
});

test('a missing motion atlas keeps the legacy pose visible and cannot fade out a loaded combat pose', async ({ page }) => {
  await page.route('**/assets/animation/naiwa-motion-*.webp', route => route.fulfill({
    contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64'),
  }));
  await page.goto('./?debug', { waitUntil: 'networkidle' });
  const result = await page.evaluate(async () => {
    const { drawFrog, frogReady, frogAnimationStatus } = await import('./js/frog.js');
    await frogReady;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    function pixels(options) {
      ctx.clearRect(0, 0, 256, 256); drawFrog(ctx, 128, 120, 100, options);
      return Array.from(ctx.getImageData(0, 0, 256, 256).data);
    }
    const idle = pixels({ animation: 'idle' });
    const attack = pixels({ animation: 'light', animationProgress: .6 });
    const transition = pixels({ animation: 'light', animationProgress: .6, animationFrom: { name: 'idle', time: .1 }, animationMix: 0 });
    return { status: frogAnimationStatus(), idleVisible: idle.some((p, i) => i % 4 === 3 && p > 100), attackVisible: attack.some((p, i) => i % 4 === 3 && p > 100), unchanged: attack.every((p, i) => p === transition[i]) };
  });
  expect(result.status).toEqual({ motion: false, combat: true, footwork: true });
  expect(result.idleVisible).toBe(true);
  expect(result.attackVisible).toBe(true);
  expect(result.unchanged).toBe(true);
  expect((await traceOf(page)).invalidCrops).toEqual([]);
});

test('fighter movement and attacks use the new atlases and their frame clocks freeze on pause', async ({ page }) => {
  await page.clock.install();
  await open(page); await select(page, 'fighter');
  await page.locator('#play-mode-select').selectOption('duel');
  await page.locator('#fighter-character').selectOption('belly');
  await start(page);
  const initialX = (await current(page)).game.players[0].x;
  await page.keyboard.down('KeyD'); await page.clock.runFor(180);
  const running = (await current(page)).game.players[0];
  expect(running.x).toBeGreaterThan(initialX + 10);
  expect(running.animation.name).toBe('run');
  await page.clock.runFor(120);
  expect((await current(page)).game.players[0].animation.time).toBeGreaterThan(running.animation.time);
  await page.keyboard.up('KeyD'); await page.keyboard.press('KeyJ'); await page.clock.runFor(32);
  const attack = (await current(page)).game.players[0];
  expect(attack.attack.type).toBe('light');
  expect(attack.animation.name).toBe('light');
  expect(attack.animation.progress).toBeGreaterThan(0);
  await page.clock.runFor(48);
  expect((await current(page)).game.players[0].animation.progress).toBeGreaterThan(attack.animation.progress);
  await page.keyboard.press('KeyP'); await page.clock.runFor(32);
  const paused = await current(page), pausedPixels = await canvasHash(page);
  expect(paused.state).toBe('paused');
  await page.clock.runFor(700);
  expect((await current(page)).game.players.map(player => player.animation)).toEqual(paused.game.players.map(player => player.animation));
  expect((await current(page)).game.elapsed).toBe(paused.game.elapsed);
  expect(await canvasHash(page)).toBe(pausedPixels);
  await start(page); await page.clock.runFor(500);
  expect((await current(page)).game.elapsed).toBeGreaterThan(paused.game.elapsed);
  const trace = await traceOf(page);
  expect(trace.gameDraws.motion).toBeGreaterThan(0);
  expect(trace.gameDraws.combat).toBeGreaterThan(0);
  expect(trace.gameFrames.motion.some(crop => Number(crop.split(',')[1]) >= 256 && Number(crop.split(',')[1]) < 512)).toBe(true);
  expect(trace.invalidCrops).toEqual([]);
});

test('survivor run and dash render new motion frames and resume from the same paused pose', async ({ page }) => {
  await page.clock.install();
  await open(page); await select(page, 'survivor'); await start(page);
  await page.keyboard.down('ArrowRight'); await page.clock.runFor(160);
  const running = (await current(page)).game;
  expect(running.animation.name).toBe('run');
  await page.clock.runFor(120);
  expect((await current(page)).game.animation.time).toBeGreaterThan(running.animation.time);
  await page.keyboard.press('Space'); await page.clock.runFor(64);
  const dash = (await current(page)).game;
  expect(dash.animation.name).toBe('dash');
  expect(dash.animation.progress).toBeGreaterThan(0);
  expect(dash.animation.progress).toBeLessThan(1);
  await page.keyboard.press('KeyP'); await page.keyboard.up('ArrowRight'); await page.clock.runFor(32);
  const paused = await current(page), pausedPixels = await canvasHash(page);
  expect(paused.state).toBe('paused');
  await page.clock.runFor(800);
  expect((await current(page)).game.animation).toEqual(paused.game.animation);
  expect((await current(page)).game.dashCooldown).toBe(paused.game.dashCooldown);
  expect(await canvasHash(page)).toBe(pausedPixels);
  await start(page); await page.clock.runFor(350);
  const resumed = (await current(page)).game;
  expect(resumed.elapsed).toBeGreaterThan(paused.game.elapsed);
  expect(resumed.dashTime).toBe(0);
  expect(resumed.animation.name).not.toBe('dash');
  const trace = await traceOf(page);
  expect(trace.gameDraws.motion).toBeGreaterThan(0);
  expect(trace.gameFrames.motion.some(crop => Number(crop.split(',')[1]) >= 512 && Number(crop.split(',')[1]) < 768)).toBe(true);
  expect(trace.invalidCrops).toEqual([]);
});

test.describe('mobile animation and audio', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('mobile upgrade freezes the pose, touch resumes celebration, and mute persists', async ({ page }) => {
    test.setTimeout(60_000);
    await page.clock.install();
    await open(page); await select(page, 'survivor'); await start(page);
    for (let attempt = 0; attempt < 12 && !(await current(page)).game.upgrades.length; attempt += 1) await page.clock.runFor(2000);
    await expect(page.locator('#upgrade-panel')).toBeVisible();
    const paused = (await current(page)).game;
    expect(paused.animation.name).toBe('laugh');
    await page.clock.runFor(1400);
    expect((await current(page)).game.animation).toEqual(paused.animation);
    expect((await current(page)).game.elapsed).toBe(paused.elapsed);
    await page.locator('[data-upgrade="0"]').tap();
    await expect(page.locator('#upgrade-panel')).toBeHidden();
    await page.clock.runFor(120);
    const resumed = (await current(page)).game;
    expect(resumed.weapons.belly).toBe(1);
    expect(resumed.animation.name).toBe('laugh');
    expect(resumed.animation.time).toBeGreaterThan(0);
    expect(resumed.elapsed).toBeGreaterThan(paused.elapsed);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const trace = await traceOf(page);
    expect(trace.gameDraws.motion).toBeGreaterThan(0);
    expect(trace.gameDraws.combat).toBeGreaterThan(0);
    expect(trace.invalidCrops).toEqual([]);
    await page.locator('#sound-toggle').tap();
    await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
    expect((await current(page)).soundEnabled).toBe(false);
    const elapsed = (await current(page)).game.elapsed;
    await page.clock.runFor(250);
    expect((await current(page)).game.elapsed).toBeGreaterThan(elapsed);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
    expect((await current(page)).soundEnabled).toBe(false);
    await page.locator('#sound-toggle').tap();
    await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.reload({ waitUntil: 'networkidle' });
    expect((await current(page)).soundEnabled).toBe(true);
  });
});
