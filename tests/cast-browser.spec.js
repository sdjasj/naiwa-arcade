import { test as base, expect } from './browser-fixtures.js';

const test = base.extend({
  page: async ({ page }, use) => {
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    await use(page);
    expect(failures).toEqual([]);
  },
});
const current = page => page.evaluate(() => window.__arcade.getState());
const skinNames = { naiwa: '奶蛙', naidan: '奶蛋', naigou: '奶狗', naishu: '奶鼠' };
async function open(page) {
  await page.clock.install();
  await page.goto('./?debug', { waitUntil: 'networkidle' });
  await expect(page.locator('#cast-choices [data-skin]')).toHaveCount(4);
}
async function start(page) {
  await page.locator('#start-button').click();
  await expect(page.locator('#game-overlay')).toBeHidden();
}
async function canvasHash(locator) {
  return locator.evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let value = 2166136261;
    for (const byte of pixels) value = Math.imul(value ^ byte, 16777619);
    return value >>> 0;
  });
}
async function observeVoice(page) {
  await page.evaluate(async () => {
    const script = [...document.querySelectorAll('script[type="module"][src]')]
      .find(script => new URL(script.src).pathname.endsWith('/js/app.js'));
    const app = new URL(script.src), url = new URL('./audio.js', app); url.search = app.search;
    const { GameAudio } = await import(url.href);
    const original = GameAudio.prototype.previewVoice;
    window.__voicePreviews = [];
    GameAudio.prototype.previewVoice = async function (id) {
      const entry = { id, host: window.__arcade.getState().state, done: false };
      window.__voicePreviews.push(entry);
      entry.played = await original.call(this, id); entry.done = true;
      const buffer = this.voiceBuffers.get(id);
      let squares = 0, peak = 0, samples = 0;
      if (buffer) for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        for (const sample of buffer.getChannelData(channel)) {
          squares += sample * sample; peak = Math.max(peak, Math.abs(sample)); samples++;
        }
      }
      Object.assign(entry, { peak, rms: samples ? Math.sqrt(squares / samples) : 0 });
      return entry.played;
    };
  });
}

test('four distinct portraits switch the global cosmetic without restarting a guandan run', async ({ page }) => {
  const runs = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') runs.push(request.postDataJSON());
  });
  await open(page);
  expect((await current(page)).skin).toBe('naiwa');
  expect((await current(page)).voicePack).toBe('meme');
  await expect.poll(async () => new Set(await Promise.all(Object.keys(skinNames)
    .map(id => canvasHash(page.locator(`[data-skin-preview="${id}"]`))))).size).toBe(4);
  await page.locator('#game-select').selectOption('guandan');
  await start(page);
  await expect.poll(() => runs.length).toBe(1);
  const initial = await current(page), board = runs[0].board;
  let heroPixels = await canvasHash(page.locator('#hero-canvas'));
  for (const [id, name] of Object.entries(skinNames)) {
    await page.locator(`[data-skin="${id}"]`).click();
    await expect(page.locator(`[data-skin="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#cast-choices [aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#hero-title')).toContainText(`让${name}替你`);
    const state = await current(page);
    expect(state.skin).toBe(id);
    expect(state.state).toBe('playing');
    expect(state.game.hand).toEqual(initial.game.hand);
    expect(state.game.turn).toBe(initial.game.turn);
    expect(state.score).toBe(initial.score);
    expect(runs).toHaveLength(1);
    expect(runs[0].board).toBe(board);
    const selectedHero = await canvasHash(page.locator('#hero-canvas'));
    if (id !== 'naiwa') expect(selectedHero).not.toBe(heroPixels);
    heroPixels = selectedHero;
  }
  expect(await page.evaluate(() => localStorage.getItem('naiwa:skin'))).toBe('naishu');
  await page.screenshot({ path: '/tmp/naiwa-cast-desktop.png', fullPage: true });
  await page.reload({ waitUntil: 'networkidle' });
  expect((await current(page)).skin).toBe('naishu');
  await expect(page.locator('[data-skin="naishu"]')).toHaveAttribute('aria-pressed', 'true');
});

test('cosmetic changes preserve fighter class, paused combat state and its original leaderboard board', async ({ page }) => {
  const runs = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') runs.push(request.postDataJSON());
  });
  await open(page);
  await page.locator('#game-select').selectOption('fighter');
  await page.locator('#fighter-character').selectOption('laugh');
  await start(page);
  await page.keyboard.press('KeyP');
  await expect.poll(async () => (await current(page)).state).toBe('paused');
  await expect.poll(() => runs.length).toBe(1);
  const before = await current(page), pixels = await canvasHash(page.locator('#game-canvas'));
  await page.locator('[data-skin="naigou"]').click();
  await page.clock.runFor(100);
  const after = await current(page);
  expect(after.state).toBe('paused');
  expect(after.game).toEqual(before.game);
  expect(after.fighterCharacter).toBe('laugh');
  expect(after.game.players[0].character).toBe('laugh');
  expect(runs).toHaveLength(1);
  expect(runs[0].board).toBe('v1:fighter:classic:laugh');
  await expect.poll(() => canvasHash(page.locator('#game-canvas'))).not.toBe(pixels);
  await page.locator('#leaderboard-button').click();
  await expect(page.locator('#leaderboard-board')).toHaveValue('v1:fighter:classic:laugh');
});

test('voice pack persists and explicit previews respect mute, pause the game and never auto-resume', async ({ page }) => {
  await open(page);
  await page.locator('#voice-pack-select').selectOption('classic');
  expect((await current(page)).voicePack).toBe('classic');
  expect(await page.evaluate(() => localStorage.getItem('naiwa:voice-pack'))).toBe('classic');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('#voice-pack-select')).toHaveValue('classic');
  await page.locator('#voice-pack-select').selectOption('meme');
  await observeVoice(page);
  await page.locator('#game-select').selectOption('guandan');
  await start(page);
  await page.locator('#sound-toggle').click();
  await page.locator('[data-voice-preview="kakatte"]').click();
  await expect(page.locator('#voice-preview-status')).toContainText('先开启');
  expect((await current(page)).state).toBe('paused');
  expect(await page.evaluate(() => window.__voicePreviews)).toEqual([]);
  await page.locator('#sound-toggle').click();
  for (const id of ['kakatte', 'andy']) {
    await start(page);
    await page.locator(`[data-voice-preview="${id}"]`).click();
    await expect(page.locator('#voice-preview-status')).toContainText('游戏保持暂停');
    expect((await current(page)).state).toBe('paused');
    const last = await page.evaluate(() => window.__voicePreviews.at(-1));
    expect(last).toMatchObject({ id, host: 'paused', done: true, played: true });
    expect(last.peak, `${id} decoded audio must contain an audible signal`).toBeGreaterThan(.01);
    expect(last.rms, `${id} decoded audio must not be silent or nearly silent`).toBeGreaterThan(.003);
    const paused = (await current(page)).game;
    await page.clock.runFor(1000);
    expect((await current(page)).game).toEqual(paused);
  }
});

for (const width of [320, 390]) test.describe(`cast ${width}px mobile`, () => {
  test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
  test('four touch portraits and voice controls fit the viewport and retain selection', async ({ page }) => {
    await open(page);
    await page.locator('[data-skin="naidan"]').tap();
    await expect(page.locator('#cast-current-name')).toHaveText('奶蛋');
    expect((await current(page)).skin).toBe('naidan');
    await page.locator('#voice-pack-select').selectOption('classic');
    for (const button of await page.locator('#cast-settings button').all()) {
      const rect = await button.boundingBox();
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      expect(rect.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.locator('#cast-settings').screenshot({ path: `/tmp/naiwa-cast-mobile-${width}.png` });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-skin="naidan"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#voice-pack-select')).toHaveValue('classic');
  });
});
