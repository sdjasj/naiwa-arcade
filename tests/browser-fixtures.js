import { test as base, expect } from '@playwright/test';

// Existing gameplay regressions must never create visitors or test scores in
// the production service. Dedicated leaderboard integration tests use real D1.
export const test = base.extend({
  context: async ({ context }, use) => {
    const player = { id: '01234567-89ab-4cde-8abc-0123456789ab', nickname: '' };
    await context.route('https://naiwa-arcade-scores.newcat6.chatgpt.site/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      let body = {};
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' } });
      if (url.pathname === '/api/players') body = { player, token: 'a'.repeat(64) };
      else if (url.pathname === '/api/player') { Object.assign(player, request.postDataJSON()); body = { player }; }
      else if (url.pathname === '/api/runs') body = { runId: request.postDataJSON().runId, startedAt: Date.now() };
      else if (url.pathname === '/api/scores') body = { accepted: true, improved: true };
      else body = { board: url.searchParams.get('board'), entries: [], totalPlayers: 0, myBest: null };
      return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await use(context);
  },
});
export { expect };
