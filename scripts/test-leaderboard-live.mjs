/**
 * End-to-end check against a real shared leaderboard, with two isolated browsers.
 *
 * Local: node scripts/test-leaderboard-live.mjs
 * Hosted: NAIWA_TEST_URL=https://example.github.io/naiwa-arcade/ \
 *         NAIWA_LEADERBOARD_SERVICE=https://scores.example.com \
 *         node scripts/test-leaderboard-live.mjs
 *
 * Only real, unattended Flappy games scoring zero are submitted. Every identity
 * created by this process is deleted in finally, including its scores and runs.
 * The local proxy forwards real HTTP responses unchanged; it supplies no data.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { LEADERBOARD_API } from '../js/leaderboard-config.js';

const frontend = new URL(process.env.NAIWA_TEST_URL || 'http://127.0.0.1:8080/');
const localHost = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
const service = new URL(process.env.NAIWA_LEADERBOARD_SERVICE || (localHost(frontend.hostname) ? 'http://127.0.0.1:8787/' : LEADERBOARD_API));
const configuredOrigin = new URL(LEADERBOARD_API).origin;
const proxyLocal = localHost(service.hostname);
const identityKey = 'naiwa:leaderboard:v1:identity';
const timeout = 30000;
const cachedChromium = join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(cachedChromium) ? cachedChromium : undefined);
const qaPrefix = `QA${Date.now().toString(36).slice(-7)}${randomBytes(2).toString('hex')}`;
const identities = new Map(), contexts = [], observers = [], pageErrors = [], forwardingFailures = [];
let browser, cleanupCount = 0;

function remember(profile) {
  if (profile && typeof profile.id === 'string' && typeof profile.token === 'string') identities.set(profile.id, profile);
}

function safeMessage(error) {
  let message = String(error?.message || error);
  for (const identity of identities.values()) message = message.replaceAll(identity.token, '[redacted]');
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}

async function api(path, options = {}) {
  return fetch(new URL(path, service), { ...options, signal: AbortSignal.timeout(timeout) });
}

async function checkService() {
  const health = await api('/api/health');
  assert.equal(health.status, 200, 'Leaderboard health endpoint must be available');
  assert.equal((await health.json()).ok, true);
  const preflight = await api('/api/player', { method: 'OPTIONS', headers: { Origin: frontend.origin,
    'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.ok(preflight.ok, 'Real HTTP CORS preflight must succeed');
  assert.ok([frontend.origin, '*'].includes(preflight.headers.get('access-control-allow-origin')),
    `The leaderboard must allow frontend origin ${frontend.origin}`);
  assert.match(preflight.headers.get('access-control-allow-methods') || '', /PATCH/);
  const allowHeaders = preflight.headers.get('access-control-allow-headers') || '';
  assert.match(allowHeaders, /authorization/i);
  assert.match(allowHeaders, /content-type/i);
}

async function chooseBoard() {
  const choices = [];
  for (const difficulty of ['normal', 'easy', 'hard']) {
    const board = `v1:flappy:classic:${difficulty}`;
    const response = await api(`/api/boards?${new URLSearchParams({ board, limit: '50' })}`);
    assert.equal(response.status, 200);
    const data = await response.json();
    choices.push({ board, difficulty, totalPlayers: data.totalPlayers });
  }
  choices.sort((a, b) => a.totalPlayers - b.totalPlayers);
  assert.ok(choices[0].totalPlayers < 49,
    'All classic Flappy boards already have at least 49 players; two zero scores cannot both appear in Top 50. No QA identity was created.');
  return choices[0];
}

async function createPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
  contexts.push(context);
  if (proxyLocal) {
    await context.route(`${configuredOrigin}/api/**`, async route => {
      const original = new URL(route.request().url());
      const target = new URL(`${original.pathname}${original.search}`, service);
      try {
        // Real backend status, headers and body are preserved, including CORS.
        const response = await route.fetch({ url: target.href, timeout });
        await route.fulfill({ response });
      } catch {
        // Throwing from an asynchronous route would skip main's finally cleanup.
        // Never log a Playwright request error: it can contain bearer headers.
        forwardingFailures.push(original.pathname);
        await route.abort('failed').catch(() => {});
      }
    });
  }
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (new URL(response.url()).pathname !== '/api/players' || response.request().method() !== 'POST' || !response.ok()) return;
    const observer = response.json().then(data => remember({ ...data.player, token: data.token })).catch(() => {});
    observers.push(observer);
  });
  const url = new URL(frontend); url.searchParams.set('debug', '');
  await page.goto(url.href, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__arcade), null, { timeout });
  return page;
}

async function playZeroScore(page, difficulty) {
  await page.bringToFront();
  await page.locator('#game-select').selectOption('flappy');
  await page.locator('#play-mode-select').selectOption('classic');
  await page.locator('#difficulty-select').selectOption(difficulty);
  await page.locator('#start-button').click();
  // No input after Start: gravity ends an actual game without passing any pipes.
  await page.waitForFunction(() => window.__arcade.getState().state === 'ended', null, { timeout });
  assert.equal(await page.evaluate(() => window.__arcade.getState().score), 0);
  await expect(page.locator('#leaderboard-result-message')).toContainText('昵称', { timeout });
  remember(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), identityKey));
}

async function publish(page, nickname, board) {
  await page.locator('#leaderboard-button').click();
  await expect(page.locator('#leaderboard-board')).toHaveValue(board);
  await expect(page.locator('#leaderboard-pending')).toContainText('1 局待传', { timeout });
  await page.locator('#leaderboard-name').fill(nickname);
  await page.locator('#leaderboard-save').click();
  await expect(page.locator('#leaderboard-save')).toBeEnabled({ timeout: timeout + 5000 });
  if (!(await page.locator('#leaderboard-feedback').textContent()).includes('已提交 1 局')) {
    // A persisted score is retried through the UI with its original run ID.
    const retry = await page.locator('#leaderboard-submit').isEnabled() ? '#leaderboard-submit' : '#leaderboard-save';
    await page.locator(retry).click();
  }
  await expect(page.locator('#leaderboard-feedback')).toContainText('已提交 1 局', { timeout });
  await ensureBoardLoaded(page);
  await expect(page.locator('#leaderboard-me')).toContainText('我的全球排名', { timeout });
  const identity = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), identityKey);
  remember(identity);
  assert.equal(identity.nickname, nickname);
  return identity.id;
}

async function ensureBoardLoaded(page) {
  const ranking = page.locator('.leaderboard-ranking');
  await expect(ranking).toHaveAttribute('aria-busy', 'false', { timeout });
  if ((await page.locator('#leaderboard-status').textContent()).includes('重试')) {
    await page.locator('#leaderboard-refresh').click();
    await expect(ranking).toHaveAttribute('aria-busy', 'false', { timeout });
  }
  await expect(page.locator('#leaderboard-status')).not.toContainText('重试');
}

async function verifyBoth(page, board, names, ownName) {
  await ensureBoardLoaded(page);
  await expect(page.locator('#leaderboard-board')).toHaveValue(board);
  for (const name of names) {
    const row = page.locator('#leaderboard-list .leaderboard-entry').filter({ has: page.locator('.leaderboard-nickname').filter({ hasText: name }) });
    await expect(row).toHaveCount(1, { timeout });
    await expect(row.locator('.leaderboard-entry-score')).toHaveText('0');
  }
  await expect(page.locator('#leaderboard-name')).toHaveValue(ownName);
  await expect(page.locator('#leaderboard-me')).toHaveText(/我的全球排名\s+#\d+\s+·\s+0 分/, { timeout });
  const rank = await page.locator('#leaderboard-me').textContent();
  return rank.match(/#([\d,]+)/)?.[1];
}

async function cleanup() {
  await Promise.allSettled(observers);
  for (const context of contexts) for (const page of context.pages()) {
    try { remember(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), identityKey)); } catch { /* A closed page may still have been observed at registration. */ }
  }
  const failures = [];
  for (const identity of identities.values()) {
    try {
      const response = await api('/api/player', { method: 'DELETE', headers: { Authorization: `Bearer ${identity.token}` } });
      assert.ok(response.ok, `QA identity cleanup returned HTTP ${response.status}`);
      cleanupCount += 1;
    } catch (error) { failures.push(`${identity.id}: ${safeMessage(error)}`); }
  }
  if (browser) await browser.close();
  assert.equal(failures.length, 0, `QA cleanup failed: ${failures.join('; ')}`);
}

async function main() {
  await checkService();
  const { board, difficulty } = await chooseBoard();
  browser = await chromium.launch({ args: ['--disable-quic'], ...(executablePath ? { executablePath } : {}) });
  const first = await createPage(), names = [`${qaPrefix}A`, `${qaPrefix}B`];
  await playZeroScore(first, difficulty);
  const firstId = await publish(first, names[0], board);

  const second = await createPage();
  await second.locator('#difficulty-select').selectOption(difficulty);
  await second.locator('#leaderboard-button').click();
  await ensureBoardLoaded(second);
  await expect(second.locator('#leaderboard-list .leaderboard-nickname')).toContainText([names[0]], { timeout });
  assert.equal(await second.evaluate(key => localStorage.getItem(key), identityKey), null,
    'The second browser must see the first score without sharing its local identity');
  await second.locator('#leaderboard-close').click();
  await playZeroScore(second, difficulty);
  const secondId = await publish(second, names[1], board);
  assert.notEqual(firstId, secondId, 'Each isolated browser must get its own identity');

  const ranks = [];
  for (const [page, ownName] of [[first, names[0]], [second, names[1]]]) {
    await page.bringToFront();
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#leaderboard-button').click();
    ranks.push(await verifyBoth(page, board, names, ownName));
  }
  assert.equal(pageErrors.length, 0, `Browser errors: ${pageErrors.join('; ')}`);
  console.log(`PASS real HTTP leaderboard: ${board}; two isolated identities; scores 0/0; ranks ${ranks.join('/')}; peer visibility and reload verified.`);
  if (forwardingFailures.length) console.log(`Recovered local HTTP forwarding failures: ${forwardingFailures.length}.`);
}

let failure;
try { await main(); } catch (error) { failure = error; }
try { await cleanup(); } catch (error) { failure = failure ? new Error(`${safeMessage(failure)}; ${safeMessage(error)}`) : error; }
if (cleanupCount) console.log(`Cleanup: deleted ${cleanupCount} QA identities and their scores/runs.`);
if (failure) { console.error(`FAIL: ${safeMessage(failure)}`); process.exitCode = 1; }
