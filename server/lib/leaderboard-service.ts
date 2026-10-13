import { parseBoard, validateScore } from './leaderboard-rules.js';

// Routes supply D1; tests run this exact service and SQL against SQLite.
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<Array<{ results: unknown[] }>>;
}
type Player = { id: string; nickname: string };
type Run = { id: string; player_id: string; board: string; started_at: number; expires_at: number; last_score: number; submissions: number };
type Score = { playerId: string; nickname: string; score: number; achievedAt: number; rank?: number };
type Options = { development?: boolean; now?: () => number };
const ORIGINS = new Set(['https://sdjasj.github.io', 'https://naiwa-arcade-scores.newcat6.chatgpt.site']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY = 2048;
const DAY = 86_400_000;
class ApiError extends Error {
  status: number;
  code: string;
  retryAfter?: number;
  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message); this.status = status; this.code = code; this.retryAfter = retryAfter;
  }
}
function fail(status: number, code: string, message: string): never { throw new ApiError(status, code, message); }
function allowedOrigin(origin: string | null, development: boolean): boolean {
  if (!origin) return true; // Non-browser clients still need the same bearer identity and validation.
  if (ORIGINS.has(origin)) return true;
  if (!development) return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && ['localhost', '127.0.0.1'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol);
  } catch { return false; }
}
async function sha256(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function makeToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function nickname(value: unknown, allowEmpty = false): string {
  if (allowEmpty && (value === undefined || value === '')) return '';
  if (typeof value !== 'string') fail(400, 'INVALID_NICKNAME', '昵称须为 1–16 个可见字符。');
  if (/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)) fail(400, 'INVALID_NICKNAME', '昵称不能含控制字符。');
  const clean = value.trim().normalize('NFC');
  if (allowEmpty && clean === '') return '';
  if (!clean || Array.from(clean).length > 16 || !/[^\p{Z}\p{M}]/u.test(clean)) fail(400, 'INVALID_NICKNAME', '昵称须为 1–16 个可见字符。');
  return clean;
}
async function readBody(request: Request, fields: string[]): Promise<Record<string, unknown>> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) fail(413, 'BODY_TOO_LARGE', '请求内容不能超过 2 KiB。');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) fail(415, 'JSON_REQUIRED', '请使用 JSON 请求。');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'INVALID_JSON', '请求内容不能为空。');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE', '请求内容不能超过 2 KiB。'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(400, 'INVALID_JSON', 'JSON 格式无效。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'INVALID_JSON', '请求须为 JSON 对象。');
  if (Object.keys(body).some((key) => !fields.includes(key))) fail(400, 'UNKNOWN_FIELD', '请求包含不支持的字段。');
  return body as Record<string, unknown>;
}
function requireUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length !== 36 || !UUID.test(value)) fail(400, 'INVALID_ID', `${label}格式无效。`);
  return value.toLowerCase();
}

export function createLeaderboardService(db: SqlDatabase, options: Options = {}) {
  const clock = options.now ?? Date.now;
  function statement(sql: string, ...values: unknown[]) { return db.prepare(sql).bind(...values); }
  async function rate(key: string, limit: number, period: number, now: number) {
    const window = Math.floor(now / period) * period;
    const row = await statement(`INSERT INTO rate_limits (key, window_start, count, expires_at) VALUES (?, ?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
      window_start = excluded.window_start, expires_at = excluded.expires_at RETURNING count`, key, window, window + period).first<{ count: number }>();
    if (!row || row.count > limit) throw new ApiError(429, 'RATE_LIMITED', '操作太频繁，请稍后再试。', Math.max(1, Math.ceil((window + period - now) / 1000)));
  }
  async function cleanup(now: number) {
    // Bounded indexed maintenance; schema creation belongs exclusively to migrations.
    await db.batch([
      statement('DELETE FROM runs WHERE id IN (SELECT id FROM runs WHERE expires_at <= ? LIMIT 100)', now),
      statement('DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at <= ? LIMIT 100)', now),
    ]);
  }
  async function authenticate(request: Request): Promise<Player> {
    const match = /^Bearer ([a-f0-9]{64})$/i.exec(request.headers.get('authorization') || '');
    if (!match) fail(401, 'UNAUTHORIZED', '玩家身份已失效，请重新设置昵称。');
    const player = await statement('SELECT id, nickname FROM players WHERE token_hash = ?', await sha256(match[1])).first<Player>();
    if (!player) fail(401, 'UNAUTHORIZED', '玩家身份已失效，请重新设置昵称。');
    return player;
  }
  async function best(board: string, playerId: string): Promise<Score | null> {
    const result = await statement(`SELECT b.player_id AS playerId, p.nickname, b.score, b.achieved_at AS achievedAt
      FROM best_scores b JOIN players p ON p.id = b.player_id WHERE b.board = ? AND b.player_id = ?`, board, playerId).first<Score>();
    if (!result) return null;
    const rank = await statement(`SELECT COUNT(*) + 1 AS rank FROM best_scores WHERE board = ? AND
      (score > ? OR (score = ? AND achieved_at < ?) OR (score = ? AND achieved_at = ? AND player_id < ?))`,
    board, result.score, result.score, result.achievedAt, result.score, result.achievedAt, playerId).first<{ rank: number }>();
    return { ...result, rank: rank!.rank };
  }
  async function action(request: Request, now: number): Promise<{ body: unknown; status?: number }> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');
    const method = request.method;
    const methods: Record<string, string[]> = { '/api/health': ['GET'], '/api/boards': ['GET'], '/api/players': ['POST'], '/api/player': ['PATCH', 'DELETE'], '/api/runs': ['POST'], '/api/scores': ['POST'] };
    if (!methods[path]) fail(404, 'NOT_FOUND', '接口不存在。');
    if (!methods[path].includes(method)) fail(405, 'METHOD_NOT_ALLOWED', '此接口不支持该请求方式。');
    if (path === '/api/health' && method === 'GET') {
      await db.prepare('SELECT 1 AS healthy').first();
      return { body: { ok: true, service: 'naiwa-leaderboard', version: 1 } };
    }
    const ip = request.headers.get('cf-connecting-ip');
    // Ignore user-controlled forwarding headers. No raw IP is persisted.
    const source = ip ? await sha256(`naiwa-ip:${ip}`) : 'unknown';
    await rate('global:requests', 2000, 60_000, now);
    await rate(`source:${source}`, ip ? 180 : 1000, 60_000, now);
    await cleanup(now);
    if (path === '/api/players' && method === 'POST') {
      const body = await readBody(request, ['nickname']);
      const name = nickname(body.nickname, true);
      await rate('global:players', 10_000, DAY, now);
      await rate(`create:${source}`, ip ? 20 : 1000, 3_600_000, now);
      const id = crypto.randomUUID();
      const token = makeToken();
      const created = await statement(`INSERT INTO players (id, token_hash, nickname, created_at, updated_at)
        SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM players) < 100000 RETURNING id`,
      id, await sha256(token), name, now, now).first();
      if (!created) fail(503, 'CAPACITY_REACHED', '排行榜暂时无法新增玩家，请稍后再试。');
      return { status: 201, body: { player: { id, nickname: name }, token } };
    }
    if (path === '/api/boards' && method === 'GET') {
      const board = url.searchParams.get('board') || '';
      if (!parseBoard(board)) fail(400, 'INVALID_BOARD', '排行榜分类无效。');
      const rawLimit = url.searchParams.get('limit') ?? '50';
      if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) fail(400, 'INVALID_LIMIT', '榜单数量须为 1–100。');
      const player = url.searchParams.get('player');
      if (player) requireUuid(player, '玩家编号');
      const entries = await statement(`SELECT b.player_id AS playerId, p.nickname, b.score, b.achieved_at AS achievedAt
        FROM best_scores b JOIN players p ON p.id = b.player_id WHERE b.board = ?
        ORDER BY b.score DESC, b.achieved_at ASC, b.player_id ASC LIMIT ?`, board, Number(rawLimit)).all<Score>();
      const count = await statement('SELECT COUNT(*) AS total FROM best_scores WHERE board = ?', board).first<{ total: number }>();
      return { body: { board, entries: entries.results.map((entry, index) => ({ rank: index + 1, ...entry })), totalPlayers: count!.total, myBest: player ? await best(board, player.toLowerCase()) : null } };
    }
    if (!['/api/player', '/api/runs', '/api/scores'].includes(path)) fail(404, 'NOT_FOUND', '接口不存在。');
    const player = await authenticate(request);
    await rate(`player:${player.id}`, 120, 60_000, now);
    if (path === '/api/player' && method === 'PATCH') {
      const body = await readBody(request, ['nickname']);
      const name = nickname(body.nickname);
      await rate(`rename:${player.id}`, 10, 60_000, now);
      await statement('UPDATE players SET nickname = ?, updated_at = ? WHERE id = ?', name, now, player.id).run();
      return { body: { player: { id: player.id, nickname: name } } };
    }
    if (path === '/api/player' && method === 'DELETE') {
      await db.batch([
        statement('DELETE FROM best_scores WHERE player_id = ?', player.id),
        statement('DELETE FROM runs WHERE player_id = ?', player.id),
        statement('DELETE FROM players WHERE id = ?', player.id),
      ]);
      return { body: { deleted: true } };
    }
    if (path === '/api/runs' && method === 'POST') {
      const body = await readBody(request, ['board', 'runId']);
      const board = typeof body.board === 'string' ? body.board : '';
      const parsed = parseBoard(board);
      if (!parsed) fail(400, 'INVALID_BOARD', '排行榜分类无效。');
      const runId = requireUuid(body.runId, '本局编号');
      const existing = await statement('SELECT * FROM runs WHERE id = ?', runId).first<Run>();
      if (existing) {
        if (existing.player_id !== player.id || existing.board !== board) fail(409, 'RUN_CONFLICT', '本局编号已使用，不能更换玩家或分榜。');
        return { body: { runId, startedAt: existing.started_at } };
      }
      await rate(`runs:${player.id}`, 30, 60_000, now);
      await rate(`daily-runs:${player.id}`, 500, DAY, now);
      await rate('global:runs', 20_000, DAY, now);
      // Merge saves may be resumed much later; other runs expire after seven days.
      const expiry = now + (parsed.game === 'merge' ? 90 : 7) * DAY;
      const inserted = await statement(`INSERT INTO runs (id, player_id, board, started_at, expires_at)
        SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM runs) < 50000 AND (SELECT COUNT(*) FROM runs WHERE player_id = ?) < 500
        ON CONFLICT(id) DO NOTHING RETURNING id`, runId, player.id, board, now, expiry, player.id).first();
      if (!inserted) {
        const raced = await statement('SELECT * FROM runs WHERE id = ?', runId).first<Run>();
        if (raced?.player_id === player.id && raced.board === board) return { body: { runId, startedAt: raced.started_at } };
        if (raced) fail(409, 'RUN_CONFLICT', '本局编号已使用。');
        fail(429, 'RUN_CAPACITY', '暂存对局已达上限，请稍后再试。');
      }
      return { status: 201, body: { runId, startedAt: now } };
    }
    if (path === '/api/scores' && method === 'POST') {
      const body = await readBody(request, ['runId', 'score']);
      if (!player.nickname) fail(400, 'NICKNAME_REQUIRED', '先保存昵称，再将成绩公开到排行榜。');
      const runId = requireUuid(body.runId, '本局编号');
      const run = await statement('SELECT * FROM runs WHERE id = ? AND player_id = ?', runId, player.id).first<Run>();
      if (!run || run.expires_at <= now) fail(404, 'RUN_NOT_FOUND', '本局未进入全球榜或已过期，请重新开局。');
      const validation = validateScore(run.board, body.score, Math.max(0, now - run.started_at));
      if (!validation.ok) fail(400, validation.code || 'INVALID_SCORE', validation.error || '成绩无效。');
      const score = body.score as number;
      const checkpoint = parseBoard(run.board)!.game === 'merge';
      if (!checkpoint && run.last_score >= 0 && run.last_score !== score) fail(409, 'RUN_FINISHED', '本局成绩已提交，不能改写。');
      await rate(`scores:${player.id}`, 30, 60_000, now);
      let improved = false;
      let duplicate = run.last_score >= score;
      if (run.last_score < score) {
        if (run.submissions >= 600) fail(429, 'CHECKPOINT_LIMIT', '本局提交次数已达上限，请重新开局。');
        const result = await db.batch([
          statement(`UPDATE runs SET last_score = ?, last_submitted_at = ?, submissions = submissions + 1
            WHERE id = ? AND player_id = ? AND expires_at > ? AND submissions < 600
            AND (last_score = -1 OR (? = 1 AND last_score < ?)) RETURNING id`, score, now, runId, player.id, now, checkpoint ? 1 : 0, score),
          statement(`INSERT INTO best_scores (board, player_id, score, achieved_at, run_id)
            SELECT board, player_id, last_score, last_submitted_at, id FROM runs
            WHERE id = ? AND player_id = ? AND last_score = ? AND last_submitted_at = ?
            ON CONFLICT(board, player_id) DO UPDATE SET score = excluded.score, achieved_at = excluded.achieved_at, run_id = excluded.run_id
            WHERE excluded.score > best_scores.score RETURNING score`, runId, player.id, score, now),
        ]);
        duplicate = !result[0].results.length;
        improved = !!result[1].results.length;
        if (duplicate && !checkpoint) {
          const finished = await statement('SELECT last_score FROM runs WHERE id = ?', runId).first<{ last_score: number }>();
          if (finished?.last_score !== score) fail(409, 'RUN_FINISHED', '本局成绩已提交，不能改写。');
        }
      }
      return { body: { accepted: true, improved, duplicate, board: run.board, best: await best(run.board, player.id) } };
    }
    fail(405, 'METHOD_NOT_ALLOWED', '此接口不支持该请求方式。');
  }
  return {
    async handle(request: Request): Promise<Response> {
      const origin = request.headers.get('origin');
      const permitted = allowedOrigin(origin, !!options.development);
      const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' });
      if (origin && permitted) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        headers.set('Access-Control-Expose-Headers', 'Retry-After');
      }
      try {
        if (!permitted && request.method !== 'GET') fail(403, 'ORIGIN_NOT_ALLOWED', '此来源不能提交排行榜数据。');
        if (request.method === 'OPTIONS') { headers.set('Access-Control-Max-Age', '600'); return new Response(null, { status: 204, headers }); }
        const result = await action(request, Math.floor(clock()));
        return new Response(JSON.stringify(result.body), { status: result.status ?? 200, headers });
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.retryAfter) headers.set('Retry-After', String(error.retryAfter));
          return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), { status: error.status, headers });
        }
        // Never expose SQL, credentials, headers or internal exception messages to clients/logs.
        return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: '排行榜暂时不可用，请稍后重试。' } }), { status: 503, headers });
      }
    },
  };
}
