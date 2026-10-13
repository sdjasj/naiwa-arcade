import { env } from 'cloudflare:workers';
import { createLeaderboardService, type SqlDatabase } from '../../lib/leaderboard-service';
export async function handle(request: Request): Promise<Response> {
  const unavailable = { prepare() { throw new Error('Missing DB binding'); }, batch() { throw new Error('Missing DB binding'); } };
  // The production bundle is also exercised by the local Wrangler preview.
  // Local browser CORS is enabled only when that preview itself has a loopback URL.
  const localPreview = ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname);
  return createLeaderboardService((env.DB ?? unavailable) as SqlDatabase, { development: process.env.NODE_ENV !== 'production' || localPreview }).handle(request);
}
