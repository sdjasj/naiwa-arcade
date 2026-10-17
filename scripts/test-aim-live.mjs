/**
 * Real Firefox / HTTP acceptance check for deployed aim or Guandan games.
 *
 * NAIWA_TEST_URL=https://sdjasj.github.io/naiwa-arcade/ \
 *   node scripts/test-aim-live.mjs
 * Optional: NAIWA_QA_GAME=guandan (default aim), NAIWA_LEADERBOARD_SERVICE,
 * PLAYWRIGHT_FIREFOX_EXECUTABLE.
 * Firefox and HTTP checks use https_proxy / HTTPS_PROXY / http_proxy / HTTP_PROXY.
 *
 * This creates two temporary identities through the real UI, hits one aim
 * target or plays one Guandan card per identity, and deletes all captured
 * identities in finally. No routes, fake responses, clock changes, injected
 * hands or score setters are used.
 * --help is read-only and performs no browser launch or network requests.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { firefox, expect, request as playwrightRequest } from '@playwright/test';
import { LEADERBOARD_API } from '../js/leaderboard-config.js';

if (process.argv.includes('--help')) {
  console.log('Usage: NAIWA_TEST_URL=https://sdjasj.github.io/naiwa-arcade/ node scripts/test-aim-live.mjs\nOptional: NAIWA_QA_GAME=aim|guandan (default aim).\naim hits one grid/cursor target per browser; guandan plays one card for 5 points in endless mode and finishes through the UI.\nUses two isolated Firefox contexts, real HTTP and the environment HTTPS proxy; deletes temporary identities and verifies cleanup.');
  process.exit(0);
}
const qaGame = process.env.NAIWA_QA_GAME || 'aim';
if (!['aim', 'guandan'].includes(qaGame)) throw new Error('NAIWA_QA_GAME must be aim or guandan.');
if (!process.env.NAIWA_TEST_URL) throw new Error('Set NAIWA_TEST_URL explicitly before running this live write/cleanup check. Use --help for usage.');
const frontend = new URL(process.env.NAIWA_TEST_URL);
const service = new URL(process.env.NAIWA_LEADERBOARD_SERVICE || LEADERBOARD_API);
const timeout = 30_000;
const identityKey = 'naiwa:leaderboard:v1:identity';
const qaPrefix = `QA${Date.now().toString(36).slice(-6)}${randomBytes(2).toString('hex')}`;
const identities = new Map(), contexts = [], observers = [], errors = [], registrations = new Set(), secrets = new Set();
const pageRuns = new WeakMap();
let browser, http, selectedBoard, cleanupCount = 0;

function proxySettings() {
  const value = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
  if (!value) return undefined;
  const url = new URL(value), proxy = { server: url.origin };
  if (url.username || url.password) {
    proxy.username = decodeURIComponent(url.username); proxy.password = decodeURIComponent(url.password);
    for (const secret of [proxy.username, proxy.password, url.username, url.password]) if (secret) secrets.add(secret);
  }
  return proxy;
}
function remember(profile) {
  if (profile && typeof profile.id === 'string' && typeof profile.token === 'string') {
    identities.set(profile.id, profile); secrets.add(profile.token);
  }
}
function safeMessage(error) {
  let message = String(error?.message || error);
  for (const secret of secrets) message = message.replaceAll(secret, '[redacted]');
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}
async function api(path, options = {}) {
  return http.fetch(new URL(path, service).href, { ...options, headers: { Origin: frontend.origin, ...options.headers }, timeout, failOnStatusCode: false });
}
async function jsonApi(path, options) {
  const response = await api(path, options);
  assert.ok(response.ok(), `${options?.method || 'GET'} ${path.split('?')[0]} returned HTTP ${response.status()}`);
  assert.equal(response.headers()['access-control-allow-origin'], frontend.origin, 'Real API response must allow the frontend origin');
  return response.json();
}
async function checkService() {
  assert.equal((await jsonApi('/api/health')).ok, true);
  const response = await api('/api/player', { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization,content-type',
  } });
  assert.ok(response.ok(), 'Production CORS preflight failed');
  assert.equal(response.headers()['access-control-allow-origin'], frontend.origin);
  assert.match(response.headers()['access-control-allow-methods'] || '', /PATCH/);
  assert.match(response.headers()['access-control-allow-headers'] || '', /authorization/i);
  if (qaGame === 'guandan') {
    const board = 'v1:guandan:endless';
    const data = await jsonApi(`/api/boards?${new URLSearchParams({ board, limit: '50' })}`);
    assert.equal(data.board, board, 'The deployed service must recognize the Guandan endless board');
    assert.ok(data.totalPlayers < 49, 'The Guandan endless board already has 49 players; stop before creating identities because both QA rows may not fit Top 50.');
    return { board, totalPlayers: data.totalPlayers };
  }
  const boards = [];
  for (const difficulty of ['normal', 'easy', 'hard']) {
    const board = `v1:aim:classic:${difficulty}:grid:cursor`;
    const data = await jsonApi(`/api/boards?${new URLSearchParams({ board, limit: '50' })}`);
    assert.equal(data.board, board, 'The deployed service must recognize the exact aim dimensions');
    boards.push({ board, difficulty, totalPlayers: data.totalPlayers });
  }
  boards.sort((a, b) => a.totalPlayers - b.totalPlayers);
  assert.ok(boards[0].totalPlayers < 49, 'All grid/cursor classic boards already have 49 players; stop before creating identities because both QA rows may not fit Top 50.');
  return boards[0];
}
async function createPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
  contexts.push(context);
  const page = await context.newPage();
  pageRuns.set(page, []);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).origin !== service.origin || request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (path === '/api/players') registrations.add(request);
    if (path === '/api/runs') pageRuns.get(page).push(request.postDataJSON());
  });
  const settled = request => registrations.delete(request);
  page.on('requestfinished', settled); page.on('requestfailed', settled);
  page.on('response', response => {
    if (new URL(response.url()).origin !== service.origin || new URL(response.url()).pathname !== '/api/players' || response.request().method() !== 'POST' || !response.ok()) return;
    observers.push(response.json().then(data => remember({ ...data.player, token: data.token })).catch(() => {}));
  });
  const url = new URL(frontend); url.searchParams.set('debug', '');
  await page.goto(url.href, { waitUntil: 'networkidle', timeout });
  await page.waitForFunction(() => Boolean(window.__arcade), null, { timeout });
  // This fetch runs in the real Firefox page, exercising production browser CORS.
  const health = await page.evaluate(async endpoint => {
    const response = await fetch(endpoint, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    const data = await response.json(); return { status: response.status, ok: data.ok };
  }, new URL('/api/health', service).href);
  assert.deepEqual(health, { status: 200, ok: true });
  return page;
}
async function selectAim(page, difficulty) {
  await page.bringToFront();
  await page.locator('#game-select').selectOption('aim');
  await page.locator('#aim-drill').selectOption('grid');
  await page.locator('#aim-input').selectOption('cursor');
  await page.locator('#play-mode-select').selectOption('classic');
  await page.locator('#difficulty-select').selectOption(difficulty);
}
async function selectCheckedGame(page, difficulty) {
  if (qaGame === 'aim') return selectAim(page, difficulty);
  await page.bringToFront();
  await page.locator('#game-select').selectOption('guandan');
  await page.locator('#play-mode-select').selectOption('endless');
}
async function playOneTarget(page, difficulty) {
  await selectAim(page, difficulty);
  await page.locator('#start-button').click();
  await page.waitForFunction(() => {
    const state = window.__arcade.getState(); return state.id === 'aim' && state.state === 'playing' && state.game.phase === 'playing';
  }, null, { timeout });
  const canvas = page.locator('#game-canvas');
  await canvas.scrollIntoViewIfNeeded();
  // Read the rendered target position; the shot itself uses native mouse input.
  const target = await page.evaluate(() => window.__arcade.getState().game.targets.find(target => target.screen.visible));
  assert.ok(target, 'A visible real aim target is required');
  const bounds = await canvas.boundingBox();
  assert.ok(bounds, 'Game canvas must be visible');
  const scale = Math.min(bounds.width / 960, bounds.height / 560);
  const x = bounds.x + (bounds.width - 960 * scale) / 2 + target.screen.x * scale;
  const y = bounds.y + (bounds.height - 560 * scale) / 2 + target.screen.y * scale;
  await page.mouse.click(x, y);
  const played = await page.evaluate(() => window.__arcade.getState());
  assert.equal(played.game.stats.hits, 1, 'Exactly one actual target was hit');
  assert.equal(played.game.stats.shots, 1, 'Exactly one actual shot was fired');
  assert.ok(played.score > 0 && played.score <= 200, 'The score must come from one legitimate low-score hit');
  assert.equal(played.game.targets.some(item => item.id === target.id), false, 'A hit must replace the target through game logic');
  await page.locator('#aim-finish').click();
  await page.waitForFunction(() => window.__arcade.getState().state === 'ended', null, { timeout });
  await expect(page.locator('#result-value')).toHaveText(String(played.score), { timeout });
  await expect(page.locator('#aim-results')).toContainText('1 / 1');
  await expect(page.locator('#leaderboard-result-message')).toContainText('昵称', { timeout });
  remember(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), identityKey));
  assert.equal(pageRuns.get(page).length, 1, 'One real session must register exactly one server run');
  assert.equal(pageRuns.get(page)[0].board, selectedBoard);
  return played.score;
}
async function playCheckedGame(page, difficulty) {
  if (qaGame === 'aim') return playOneTarget(page, difficulty);
  await selectCheckedGame(page);
  await page.locator('#start-button').click();
  await page.waitForFunction(() => {
    const state = window.__arcade.getState();
    return state.id === 'guandan' && state.state === 'playing' && state.game.phase === 'playing' && state.game.ownCanAct;
  }, null, { timeout });
  const before = await page.evaluate(() => window.__arcade.getState());
  assert.equal(before.score, 0); assert.equal(before.game.hand.length, 27);
  const cards = page.locator('#guandan-hand [data-card-id]');
  await expect(cards).toHaveCount(27);
  const chosenId = await cards.first().getAttribute('data-card-id');
  await cards.first().click();
  await expect(page.locator('#guandan-play')).toBeEnabled({ timeout });
  await page.locator('#guandan-play').click();
  const played = await page.evaluate(() => window.__arcade.getState());
  assert.equal(played.score, 5, 'Exactly one legitimately played card must award five points');
  assert.equal(played.game.hand.length, 26, 'The real hand must lose exactly one card');
  assert.ok(!played.game.hand.some(card => card.id === chosenId), 'The selected card must leave the hand through game logic');
  await page.locator('#guandan-finish').click();
  await page.waitForFunction(() => window.__arcade.getState().state === 'ended', null, { timeout });
  await expect(page.locator('#result-value')).toHaveText('5', { timeout });
  await expect(page.locator('#leaderboard-result-message')).toContainText('昵称', { timeout });
  remember(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), identityKey));
  assert.equal(pageRuns.get(page).length, 1, 'One real Guandan session must register exactly one server run');
  assert.equal(pageRuns.get(page)[0].board, selectedBoard);
  return played.score;
}
async function boardLoaded(page) {
  await expect(page.locator('.leaderboard-ranking')).toHaveAttribute('aria-busy', 'false', { timeout });
  if ((await page.locator('#leaderboard-status').textContent()).includes('重试')) {
    await page.locator('#leaderboard-refresh').click();
    await expect(page.locator('.leaderboard-ranking')).toHaveAttribute('aria-busy', 'false', { timeout });
  }
  await expect(page.locator('#leaderboard-status')).not.toContainText('重试');
}
async function publish(page, nickname) {
  await page.locator('#leaderboard-button').click();
  await expect(page.locator('#leaderboard-board')).toHaveValue(selectedBoard);
  await expect(page.locator('#leaderboard-pending')).toContainText('1 局待传', { timeout });
  await page.locator('#leaderboard-name').fill(nickname);
  await page.locator('#leaderboard-save').click();
  await expect(page.locator('#leaderboard-save')).toBeEnabled({ timeout: timeout + 5000 });
  if (!(await page.locator('#leaderboard-feedback').textContent()).includes('已提交 1 局')) {
    const retry = await page.locator('#leaderboard-submit').isEnabled() ? '#leaderboard-submit' : '#leaderboard-save';
    await page.locator(retry).click();
  }
  await expect(page.locator('#leaderboard-feedback')).toContainText('已提交 1 局', { timeout });
  await boardLoaded(page);
  await expect(page.locator('#leaderboard-me')).toContainText('我的全球排名', { timeout });
  const profile = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), identityKey);
  remember(profile); assert.equal(profile.nickname, nickname);
  return profile.id;
}
async function verifyShared(page, results, own) {
  await boardLoaded(page);
  await expect(page.locator('#leaderboard-board')).toHaveValue(selectedBoard);
  for (const result of results) {
    const row = page.locator('#leaderboard-list .leaderboard-entry').filter({ has: page.locator('.leaderboard-nickname').filter({ hasText: new RegExp(`^${result.name}$`) }) });
    await expect(row).toHaveCount(1, { timeout });
    await expect(row.locator('.leaderboard-entry-score')).toHaveText(String(result.score));
  }
  await expect(page.locator('#leaderboard-name')).toHaveValue(own.name);
  await expect(page.locator('#leaderboard-me')).toContainText(`${own.score} 分`);
  const rank = (await page.locator('#leaderboard-me').textContent()).match(/#([\d,]+)/)?.[1];
  assert.ok(rank, 'The real personal global rank must be visible');
  return rank;
}
async function cleanup() {
  // Let any registration response finish so its bearer can be deleted even when UI assertions failed.
  const deadline = Date.now() + timeout;
  while (registrations.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  await Promise.allSettled(observers);
  for (const context of contexts) for (const page of context.pages()) {
    try { remember(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), identityKey)); } catch { /* Registration observers also retain identities. */ }
  }
  const failures = [];
  if (registrations.size) failures.push('A registration request did not settle; cleanup completeness cannot be confirmed.');
  for (const profile of identities.values()) {
    let removed = false;
    for (let attempt = 0; attempt < 2 && !removed; attempt++) {
      try {
        const response = await api('/api/player', { method: 'DELETE', headers: { Authorization: `Bearer ${profile.token}` } });
        // An idempotent retry can receive 401 if deletion succeeded but its response was lost.
        assert.ok(response.ok() || response.status() === 401, `QA deletion returned HTTP ${response.status()}`);
        if (response.ok()) assert.equal((await response.json()).deleted, true);
        removed = true; cleanupCount++;
      } catch (error) { if (attempt === 1) failures.push(`${profile.id}: ${safeMessage(error)}`); }
    }
  }
  if (identities.size && selectedBoard) {
    try {
      const board = await jsonApi(`/api/boards?${new URLSearchParams({ board: selectedBoard, limit: '100' })}`);
      assert.ok(board.entries.every(entry => !identities.has(entry.playerId)), 'A QA row remains in the shared leaderboard');
      for (const profile of identities.values()) {
        const personal = await jsonApi(`/api/boards?${new URLSearchParams({ board: selectedBoard, player: profile.id, limit: '1' })}`);
        assert.equal(personal.myBest, null, 'A deleted QA personal best remains');
      }
    } catch (error) { failures.push(`Cleanup verification: ${safeMessage(error)}`); }
  }
  if (browser) await browser.close().catch(error => failures.push(safeMessage(error)));
  if (http) await http.dispose().catch(error => failures.push(safeMessage(error)));
  assert.equal(failures.length, 0, `QA cleanup failed: ${failures.join('; ')}`);
}
async function main() {
  const proxy = proxySettings();
  http = await playwrightRequest.newContext({ ...(proxy ? { proxy } : {}), timeout,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0' });
  const choice = await checkService(); selectedBoard = choice.board;
  browser = await firefox.launch({ headless: true, ...(proxy ? { proxy } : {}),
    ...(process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE } : {}),
    firefoxUserPrefs: { 'network.http.http2.enabled': false, 'network.http.http3.enable': false } });
  const results = [], first = await createPage();
  const firstScore = await playCheckedGame(first, choice.difficulty);
  const firstName = `${qaPrefix}A`, firstId = await publish(first, firstName);
  results.push({ name: firstName, id: firstId, score: firstScore });
  const second = await createPage();
  await selectCheckedGame(second, choice.difficulty);
  await second.locator('#leaderboard-button').click();
  await boardLoaded(second);
  await expect(second.locator('#leaderboard-list .leaderboard-nickname')).toContainText([firstName], { timeout });
  assert.equal(await second.evaluate(key => localStorage.getItem(key), identityKey), null, 'Peer score must be visible without sharing local identity');
  await second.locator('#leaderboard-close').click();
  const secondScore = await playCheckedGame(second, choice.difficulty);
  const secondName = `${qaPrefix}B`, secondId = await publish(second, secondName);
  assert.notEqual(firstId, secondId, 'Isolated contexts must have different identities');
  results.push({ name: secondName, id: secondId, score: secondScore });
  const ranks = [];
  for (const [index, page] of [first, second].entries()) {
    await page.bringToFront(); await page.reload({ waitUntil: 'networkidle', timeout });
    await selectCheckedGame(page, choice.difficulty);
    await page.locator('#leaderboard-button').click();
    ranks.push(await verifyShared(page, results, results[index]));
  }
  assert.equal(errors.length, 0, `Browser errors: ${errors.map(safeMessage).join('; ')}`);
  return `PASS real Firefox ${qaGame}: ${selectedBoard}; ${qaGame === 'aim' ? 'real hits 1/1' : 'real single-card plays 1/1'}; scores ${results.map(result => result.score).join('/')}; ranks ${ranks.join('/')}; isolated identities, peer visibility and reload verified.`;
}
let failure, report;
try { report = await main(); } catch (error) { failure = error; }
try { await cleanup(); } catch (error) { failure = failure ? new Error(`${safeMessage(failure)}; ${safeMessage(error)}`) : error; }
if (failure) { console.error(`FAIL: ${safeMessage(failure)}`); process.exitCode = 1; }
else console.log(`${report}\nCleanup: deleted ${cleanupCount} QA identities; public rows and personal bests verified absent.`);
