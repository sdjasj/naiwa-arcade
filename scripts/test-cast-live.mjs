/**
 * Read-only deployed cast/voice acceptance check using real Firefox and assets.
 *
 * NAIWA_TEST_URL=https://sdjasj.github.io/naiwa-arcade/ \
 *   node scripts/test-cast-live.mjs
 * Optional: NAIWA_EXPECT_VERSION (default 7.1.0), NAIWA_EXPECT_BUILD,
 * PLAYWRIGHT_FIREFOX_EXECUTABLE; uses the environment HTTPS/HTTP proxy.
 *
 * Uses only cosmetic controls, voice previews and the Guandan ready screen.
 * Never starts a game, registers a player or submits a score. No mocks, routes,
 * clock overrides, injected game state or persistent browser profiles are used.
 * --help performs no browser launch or network requests.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { firefox, expect } from '@playwright/test';

if (process.argv.includes('--help')) {
  console.log('Usage: NAIWA_TEST_URL=https://sdjasj.github.io/naiwa-arcade/ node scripts/test-cast-live.mjs\nRead-only Firefox check: four cosmetic portraits, saved preferences, Guandan ready seats, real voice decoding/playback and mute.\nOptional NAIWA_EXPECT_VERSION (default 7.1.0), NAIWA_EXPECT_BUILD, PLAYWRIGHT_FIREFOX_EXECUTABLE. Screenshots go to /tmp/naiwa-cast-live-*.png. No game or leaderboard identity is created.');
  process.exit(0);
}
if (!process.env.NAIWA_TEST_URL) throw new Error('Set NAIWA_TEST_URL explicitly. Use --help for usage.');
const frontend = new URL(process.env.NAIWA_TEST_URL);
assert.ok(['http:', 'https:'].includes(frontend.protocol), 'NAIWA_TEST_URL must use HTTP or HTTPS.');
assert.ok(!frontend.username && !frontend.password, 'NAIWA_TEST_URL must not contain credentials.');
const timeout = 30_000;
const skins = { naiwa: '奶蛙', naidan: '奶蛋', naigou: '奶狗', naishu: '奶鼠' };
const lines = { kakatte: '刚刚跌落水', andy: '安迪' };
const resources = new Map(), errors = [], writes = [], secrets = new Set();
let browser;

function proxySettings() {
  if (['localhost', '127.0.0.1', '[::1]'].includes(frontend.hostname)) return undefined;
  const value = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
  if (!value) return undefined;
  const url = new URL(value), proxy = { server: url.origin };
  if (url.username || url.password) {
    proxy.username = decodeURIComponent(url.username); proxy.password = decodeURIComponent(url.password);
    for (const secret of [proxy.username, proxy.password, url.username, url.password]) if (secret) secrets.add(secret);
  }
  return proxy;
}
function safeMessage(error) {
  let message = String(error?.message || error);
  for (const secret of secrets) message = message.replaceAll(secret, '[redacted]');
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}
const state = page => page.evaluate(() => window.__arcade.getState());
async function ready(page) {
  await page.waitForFunction(() => Boolean(window.__arcade?.getState), null, { timeout });
  assert.equal((await state(page)).state, 'ready', 'Acceptance must never start a game.');
}
async function portraitHashes(page) {
  return page.locator('[data-skin-preview]').evaluateAll(canvases => canvases.map(canvas => {
    let hash = 2166136261;
    for (const byte of canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) {
      hash = Math.imul(hash ^ byte, 16777619);
    }
    return hash >>> 0;
  }));
}
async function observeRealAudio(page) {
  await page.evaluate(async () => {
    const script = [...document.querySelectorAll('script[type="module"][src]')]
      .find(item => new URL(item.src).pathname.endsWith('/js/app.js'));
    if (!script) throw new Error('The deployed application module was not found.');
    const app = new URL(script.src), url = new URL('./audio.js', app); url.search = app.search;
    const { GameAudio } = await import(url.href);
    const original = GameAudio.prototype.previewVoice;
    let instance;
    // Observe the application's own return value and decoded buffer. All actual
    // fetching, decoding, gating and playback still run through the original.
    window.__castLiveAudio = { calls: [], inspect: () => ({ enabled: instance?.enabled,
      liveVoice: instance?.laughSource?.voiceId || null, sources: instance?.sources.size || 0 }) };
    GameAudio.prototype.previewVoice = async function (id) {
      instance = this;
      const entry = { id, host: window.__arcade.getState().state, done: false };
      window.__castLiveAudio.calls.push(entry);
      entry.played = await original.call(this, id);
      const buffer = this.voiceBuffers.get(id);
      Object.assign(entry, { done: true, duration: buffer?.duration || 0, sampleRate: buffer?.sampleRate || 0,
        channels: buffer?.numberOfChannels || 0, context: this.context?.state });
      return entry.played;
    };
  });
}
async function main() {
  const proxy = proxySettings();
  browser = await firefox.launch({ headless: true, ...(proxy ? { proxy } : {}),
    ...(process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE } : {}),
    firefoxUserPrefs: { 'network.http.http2.enabled': false, 'network.http.http3.enable': false } });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  page.on('requestfailed', request => errors.push(`Network failure: ${new URL(request.url()).pathname}`));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${path}`);
    if (/\/assets\/(cast\/.*\.webp|voices\/.*\.mp3)$/.test(path)) resources.set(path, response.status());
  });
  const url = new URL(frontend); url.searchParams.set('debug', '');
  await page.goto(url.href, { waitUntil: 'networkidle', timeout });
  await ready(page);
  const release = await page.evaluate(async () => {
    const response = await fetch(new URL('./release.json', document.baseURI), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Release metadata returned HTTP ${response.status()}`);
    return response.json();
  });
  assert.equal(release.version, process.env.NAIWA_EXPECT_VERSION || '7.1.0', 'Unexpected deployed version.');
  if (process.env.NAIWA_EXPECT_BUILD) assert.equal(release.build, process.env.NAIWA_EXPECT_BUILD, 'Unexpected deployed build.');
  await expect(page.locator('#cast-choices [data-skin]')).toHaveCount(4);
  await expect.poll(async () => new Set(await portraitHashes(page)).size, { timeout }).toBe(4);
  for (const [id, name] of Object.entries(skins)) {
    await page.locator(`[data-skin="${id}"]`).click();
    await expect(page.locator(`[data-skin="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#cast-choices [aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#hero-cast-name')).toHaveText(name);
    assert.equal((await state(page)).skin, id);
    await ready(page);
  }
  await page.locator('#voice-pack-select').selectOption('classic');
  await page.reload({ waitUntil: 'networkidle', timeout });
  await ready(page);
  assert.equal((await state(page)).skin, 'naishu');
  assert.equal((await state(page)).voicePack, 'classic');
  await expect(page.locator('[data-skin="naishu"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#voice-pack-select')).toHaveValue('classic');
  await page.locator('#voice-pack-select').selectOption('meme');
  await page.locator('#game-select').selectOption('guandan');
  await ready(page);
  const game = (await state(page)).game;
  assert.equal(game.phase, 'idle'); assert.equal(game.players.length, 4);
  assert.equal(game.hand.length, 0); assert.equal(game.score, 0);
  await expect(page.locator('#game-overlay')).toBeVisible();
  await expect.poll(() => page.locator('#game-canvas').evaluate(canvas => {
    const ctx = canvas.getContext('2d');
    return [[480, 444], [835, 280], [480, 112], [125, 280]].map(([x, y]) => {
      const pixels = ctx.getImageData(x - 42, y - 42, 84, 84).data;
      let gold = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 130 && pixels[i + 1] > 90 && pixels[i + 2] < pixels[i] * .85) gold++;
      return gold;
    }).every(count => count > 100);
  }), { timeout }).toBe(true);
  await observeRealAudio(page);
  for (const [id, label] of Object.entries(lines)) {
    await page.locator(`[data-voice-preview="${id}"]`).click();
    await expect(page.locator('#voice-preview-status')).toHaveText(`试听「${label}」。`, { timeout });
    const result = await page.evaluate(() => window.__castLiveAudio.calls.at(-1));
    assert.equal(result.id, id); assert.equal(result.host, 'ready');
    assert.equal(result.done, true); assert.equal(result.played, true);
    assert.ok(result.duration > .1 && result.duration <= 4.5 && result.sampleRate > 0 && result.channels > 0, 'The real voice file must decode.');
    assert.equal(result.context, 'running');
    await ready(page);
  }
  const played = await page.evaluate(() => window.__castLiveAudio.calls);
  await page.locator('#sound-toggle').click();
  assert.equal((await state(page)).soundEnabled, false);
  for (const id of Object.keys(lines)) {
    await page.locator(`[data-voice-preview="${id}"]`).click();
    await expect(page.locator('#voice-preview-status')).toContainText('先开启');
  }
  assert.deepEqual(await page.evaluate(() => window.__castLiveAudio.calls), played, 'Muted previews must not call playback.');
  assert.deepEqual(await page.evaluate(() => window.__castLiveAudio.inspect()), { enabled: false, liveVoice: null, sources: 0 });
  await page.locator('#cast-settings').screenshot({ path: '/tmp/naiwa-cast-live-panel.png' });
  await page.locator('#player-window').screenshot({ path: '/tmp/naiwa-cast-live-guandan-ready.png' });
  const canvas = await page.locator('#game-canvas').evaluate(element => element.toDataURL('image/png').split(',')[1]);
  await writeFile('/tmp/naiwa-cast-live-guandan-canvas.png', Buffer.from(canvas, 'base64'));
  for (const file of ['cast/naidan-v1.webp', 'cast/naigou-v1.webp', 'cast/naishu-v1.webp', 'voices/kakatte.mp3', 'voices/andy.mp3']) {
    assert.ok([...resources].some(([path, status]) => path.endsWith(`/assets/${file}`) && status === 200), `Expected real HTTP 200 for ${file}`);
  }
  await ready(page);
  assert.equal(await page.evaluate(() => localStorage.getItem('naiwa:leaderboard:v1:identity')), null, 'Read-only acceptance must not create a leaderboard identity.');
  assert.deepEqual(writes, [], 'Read-only acceptance must not issue any write requests.');
  assert.deepEqual(errors, [], 'No browser or asset errors are allowed.');
  return { version: release.version, build: release.build, portraits: 4, readySeats: 4,
    voiceDecodes: played.map(({ id, played, duration, sampleRate }) => ({ id, played, duration, sampleRate })),
    resourceHTTP200: 5, gameStarts: 0, writeRequests: writes.length, identities: 0,
    screenshots: ['/tmp/naiwa-cast-live-panel.png', '/tmp/naiwa-cast-live-guandan-ready.png', '/tmp/naiwa-cast-live-guandan-canvas.png'] };
}
let failure, report;
try { report = await main(); } catch (error) { failure = error; }
finally { if (browser) await browser.close().catch(error => { failure ||= error; }); }
if (failure) { console.error(`FAIL: ${safeMessage(failure)}`); process.exitCode = 1; }
else console.log(`PASS read-only Firefox cast acceptance\n${JSON.stringify(report, null, 2)}`);
