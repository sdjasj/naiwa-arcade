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
const cards = page => page.locator('#guandan-hand [data-card-id]');

function auditRequests(page) {
  const audit = { runs: [], scores: [] };
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (path === '/api/runs') audit.runs.push(request.postDataJSON());
    if (path === '/api/scores') audit.scores.push(request.postDataJSON());
  });
  return audit;
}

async function openGuandan(page, mode = 'classic') {
  await page.clock.install();
  await page.goto('./?debug', { waitUntil: 'networkidle' });
  await page.locator('#game-select').selectOption('guandan');
  await page.locator('#play-mode-select').selectOption(mode);
  await expect(page.locator('#current-name')).toHaveText('奶蛙掼蛋');
  await expect(page.locator('#game-number')).toHaveText('11 / 11');
  await expect(page.locator('#difficulty-setting')).toBeHidden();
  await expect(page.locator('#guandan-controls')).toBeVisible();
}

async function start(page, touch = false) {
  if (touch) await page.locator('#start-button').tap();
  else await page.locator('#start-button').click();
  await expect(page.locator('#game-overlay')).toBeHidden();
  expect((await current(page)).state).toBe('playing');
}

async function namePlayer(page) {
  await page.locator('#leaderboard-button').click();
  await page.locator('#leaderboard-name').fill('掼蛋浏览器测试');
  await page.locator('#leaderboard-save').click();
  await expect(page.locator('#leaderboard-feedback')).toContainText('昵称');
  await page.locator('#leaderboard-close').click();
}

async function watchLaughs(page) {
  // Observe the real audio calls; preserve playback and never alter game state.
  await page.evaluate(async () => {
    const expected = new URL('./js/app.js', document.baseURI);
    const appScript = [...document.querySelectorAll('script[type="module"][src]')].find(script => {
      const url = new URL(script.src);
      return url.origin === expected.origin && url.pathname === expected.pathname;
    });
    if (!appScript) throw new Error('The application module script is missing');
    const appURL = new URL(appScript.src);
    const audioURL = new URL('./audio.js', appURL);
    // The build applies one version query to the entry and every local import.
    // Reading the DOM also works when Playwright replaces performance timing.
    audioURL.search = appURL.search;
    const { GameAudio } = await import(audioURL.href);
    const original = GameAudio.prototype.play;
    window.__guandanAudio = [];
    GameAudio.prototype.play = function (kind, ...args) {
      window.__guandanAudio.push(kind);
      return original.call(this, kind, ...args);
    };
  });
}

async function reachCelebration(page) {
  for (let second = 0; second < 200; second++) {
    if ((await current(page)).game.phase === 'celebrating') return;
    await page.clock.runFor(1000);
  }
  expect((await current(page)).game.phase).toBe('celebrating');
}

test('guandan hand selection, legal hints and pause work through real desktop controls', async ({ page }) => {
  const audit = auditRequests(page);
  await openGuandan(page);
  await expect(page.locator('#guandan-play')).toBeDisabled();
  await start(page);
  await expect(cards(page)).toHaveCount(27);
  expect((await current(page)).game.players.map(player => player.count)).toEqual([27, 27, 27, 27]);
  expect((await current(page)).game.players.every(player => !('hand' in player))).toBe(true);
  await expect(page.locator('#guandan-pass')).toBeDisabled();
  await cards(page).first().click();
  await expect(cards(page).first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#guandan-play')).toBeEnabled();
  await page.locator('#guandan-clear').click();
  expect((await current(page)).game.selected).toHaveLength(0);
  await page.locator('#game-canvas').focus();
  await page.keyboard.press('KeyH');
  const selected = (await current(page)).game.selected;
  expect(selected.length).toBeGreaterThan(0);
  await expect(page.locator('#guandan-play')).toBeEnabled();
  await page.locator('#player-window').screenshot({ path: '/tmp/naiwa-guandan-desktop.png' });
  await page.keyboard.press('KeyP');
  await expect.poll(async () => (await current(page)).state).toBe('paused');
  const paused = (await current(page)).game;
  await page.clock.runFor(3000);
  expect((await current(page)).game).toEqual(paused);
  for (const action of ['play', 'pass', 'hint', 'clear', 'auto']) await expect(page.locator(`#guandan-${action}`)).toBeDisabled();
  await start(page);
  expect((await current(page)).game.selected).toEqual(selected);
  await page.locator('#game-canvas').focus();
  await page.keyboard.press('Enter');
  await expect(cards(page)).toHaveCount(27 - selected.length);
  expect((await current(page)).score).toBe(selected.length * 5);
  expect((await current(page)).game.lastPlay.player).toBe(0);
  await expect.poll(() => audit.runs.length).toBe(1);
  expect(audit.runs[0].board).toBe('v1:guandan:classic');
  expect(audit.scores).toEqual([]);
});

test('guandan autoplay finishes a real classic hand with winner laughter and one final result', async ({ page }) => {
  test.setTimeout(90_000);
  const audit = auditRequests(page);
  await openGuandan(page);
  await watchLaughs(page);
  await namePlayer(page);
  await start(page);
  await page.locator('#guandan-auto').click();
  await expect(page.locator('#guandan-auto')).toHaveAttribute('aria-pressed', 'true');
  await reachCelebration(page);
  const celebration = await current(page);
  expect(celebration.state).toBe('playing');
  expect(celebration.game.lastResult.finishOrder.length).toBeGreaterThanOrEqual(2);
  expect(celebration.game.players.filter(player => player.team === celebration.game.lastResult.winner)
    .every(player => player.animation.name === 'laugh')).toBe(true);
  expect(await page.evaluate(() => window.__guandanAudio.filter(kind => kind === 'laugh:victory').length)).toBe(1);
  expect(audit.scores).toHaveLength(0);
  await page.locator('#player-window').screenshot({ path: `/tmp/naiwa-guandan-${celebration.game.lastResult.won ? 'own' : 'opponent'}-celebration.png` });
  await page.clock.runFor(2600);
  await expect.poll(async () => (await current(page)).state).toBe('ended');
  await expect(page.locator('#result-value')).toHaveText(String(celebration.score));
  expect(celebration.score).toBeLessThanOrEqual(835);
  await expect.poll(() => audit.scores.length).toBe(1);
  expect(audit.runs[0].board).toBe('v1:guandan:classic');
  expect(audit.scores[0]).toEqual({ runId: audit.runs[0].runId, score: celebration.score });
  await page.clock.runFor(3000);
  expect(audit.scores).toHaveLength(1);
  await page.locator('#player-window').screenshot({ path: `/tmp/naiwa-guandan-${celebration.game.lastResult.won ? 'own' : 'opponent'}-result.png` });
  await start(page);
  await expect(cards(page)).toHaveCount(27);
  expect((await current(page)).score).toBe(0);
  expect((await current(page)).game.auto).toBe(false);
  await expect.poll(() => audit.runs.length).toBe(2);
  expect(audit.runs[1].runId).not.toBe(audit.runs[0].runId);
});

test('guandan endless keeps one run through upgrades and tribute, then submits only on finish', async ({ page }) => {
  test.setTimeout(90_000);
  const audit = auditRequests(page);
  await openGuandan(page, 'endless');
  await namePlayer(page);
  await start(page);
  await page.locator('#guandan-auto').click();
  await reachCelebration(page);
  await expect(page.locator('#guandan-finish')).toBeDisabled();
  const first = (await current(page)).game;
  await page.clock.runFor(2600);
  expect((await current(page)).state).toBe('playing');
  expect((await current(page)).game.phase).toBe('roundEnd');
  expect(audit.scores).toHaveLength(0);
  await expect(page.locator('#guandan-next')).toBeEnabled();
  await page.locator('#guandan-next').click();
  const next = (await current(page)).game;
  expect(next.phase).toBe('playing');
  expect(next.round).toBe(2);
  expect(next.score).toBe(first.score);
  expect(next.players.map(player => player.count)).toEqual([27, 27, 27, 27]);
  expect(next.teamLevels).toEqual(first.lastResult.teamLevels);
  expect(next.tributeLog.length).toBeGreaterThan(0);
  await expect(page.locator('#guandan-tribute')).toBeVisible();
  expect(audit.runs).toHaveLength(1);
  expect(audit.runs[0].board).toBe('v1:guandan:endless');
  expect(audit.scores).toHaveLength(0);
  await page.locator('#guandan-finish').click();
  await expect.poll(async () => (await current(page)).state).toBe('ended');
  await expect.poll(() => audit.scores.length).toBe(1);
  expect(audit.scores[0].runId).toBe(audit.runs[0].runId);
  expect(audit.scores[0].score).toBeGreaterThanOrEqual(first.score);
  await page.locator('#leaderboard-result-open').click();
  await expect(page.locator('#leaderboard-board')).toHaveValue('v1:guandan:endless');
  await expect(page.locator('#leaderboard-board option')).toHaveCount(2);
});

test('guandan interpretation selector preserves the declared wildcard full house and straight flush', async ({ page }) => {
  await openGuandan(page);
  await page.locator('#sound-toggle').click();
  const scenarios = [
    { ids: ['0-H-3', '0-D-3', '0-H-2', '1-S-4', '0-C-4'], index: 1,
      expected: { type: 'fullHouse', rank: 4, pairRank: 3, suit: null } },
    { ids: ['0-H-2', '0-C-3', '0-C-4', '0-C-5', '1-C-6'], index: 3,
      expected: { type: 'straightFlush', rank: 7, pairRank: null, suit: 'C' } },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    // Seed only the random source before a normal UI deal. The game still
    // shuffles the complete 108-card deck and owns all hands and scoring.
    await page.evaluate(() => {
      let seed = 1;
      Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    });
    if (index) await page.locator('#restart-button').click();
    else await start(page);
    const initial = (await current(page)).game;
    expect(initial.hand).toHaveLength(27);
    expect(scenario.ids.every(id => initial.hand.some(card => card.id === id))).toBe(true);
    for (const id of scenario.ids) await page.locator(`[data-card-id="${id}"]`).click();
    const choices = (await current(page)).game.selectionOptions;
    expect(choices.length).toBeGreaterThan(scenario.index);
    expect((await current(page)).game.selectionIndex).toBe(0);
    await expect(page.locator('#guandan-interpretation-setting')).toBeVisible();
    await page.locator('#guandan-interpretation').selectOption(String(scenario.index));
    expect((await current(page)).game.selectionIndex).toBe(scenario.index);
    await expect(page.locator('#guandan-selection')).toHaveText(choices[scenario.index].label);
    expect((await current(page)).game.selected.slice().sort()).toEqual(scenario.ids.slice().sort());
    await page.locator('#guandan-play').click();
    const { game, score } = await current(page);
    const combo = game.lastPlay.combo;
    expect({ type: combo.type, rank: combo.rank, pairRank: combo.pairRank ?? null, suit: combo.suit ?? null }).toEqual(scenario.expected);
    expect(combo.cards.map(card => card.id).sort()).toEqual(scenario.ids.slice().sort());
    expect(game.hand).toHaveLength(22);
    expect(score).toBe(25);
  }
});

test.describe('guandan 320px overlay layout', () => {
  test.use({ viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true });
  test('ready and ended overlay text and buttons are reachable without clipping', async ({ page }) => {
    test.setTimeout(90_000);
    await openGuandan(page);
    const clipped = [];
    async function checkOverlay(phase) {
      for (const id of ['overlay-kicker', 'overlay-title', 'overlay-message', 'result-score', 'start-button', 'overlay-hint']) {
        const item = page.locator(`#${id}`);
        if (!(await item.isVisible())) continue;
        await item.scrollIntoViewIfNeeded();
        const outer = await page.locator('#game-overlay').boundingBox(), inner = await item.boundingBox();
        if (inner.x < outer.x - 1 || inner.x + inner.width > outer.x + outer.width + 1
          || inner.y < outer.y - 1 || inner.y + inner.height > outer.y + outer.height + 1) {
          clipped.push({ phase, id, outer, inner });
        }
      }
      await page.locator('#player-window').screenshot({ path: `/tmp/naiwa-guandan-mobile-320-${phase}.png` });
    }
    await checkOverlay('classic-ready');
    await start(page, true);
    await page.locator('#guandan-auto').tap();
    await reachCelebration(page);
    await page.clock.runFor(2600);
    await expect.poll(async () => (await current(page)).state).toBe('ended');
    await checkOverlay('classic-ended');
    await page.locator('#play-mode-select').selectOption('endless');
    await checkOverlay('endless-ready');
    await start(page, true);
    await page.locator('#guandan-finish').tap();
    await expect.poll(async () => (await current(page)).state).toBe('ended');
    await checkOverlay('endless-ended');
    expect(clipped).toEqual([]);
  });
});

for (const width of [320, 390]) test.describe(`guandan ${width}px touch layout`, () => {
  test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
  test('all 27 cards remain tappable, selected cards toggle and hints play without horizontal overflow', async ({ page }) => {
    await openGuandan(page);
    await start(page, true);
    await expect(cards(page)).toHaveCount(27);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const first = cards(page).first(), last = cards(page).last();
    await first.tap();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await first.tap();
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await last.tap();
    await expect(last).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#guandan-clear').tap();
    await page.locator('#guandan-hint').tap();
    const selected = (await current(page)).game.selected;
    expect(selected.length).toBeGreaterThan(0);
    await page.locator('#guandan-controls').screenshot({ path: `/tmp/naiwa-guandan-mobile-${width}.png` });
    const bounds = await cards(page).evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    }));
    for (const rect of bounds) {
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(width);
      expect(rect.width).toBeGreaterThan(20);
      expect(rect.height).toBeGreaterThanOrEqual(40);
    }
    await page.locator('#guandan-play').tap();
    await expect(cards(page)).toHaveCount(27 - selected.length);
    expect((await current(page)).score).toBe(selected.length * 5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
});
