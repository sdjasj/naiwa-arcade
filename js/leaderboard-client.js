import { LEADERBOARD_API } from './leaderboard-config.js?v=13a5c1ec0c6e';
import { makeBoard, parseBoard } from './leaderboard-rules.js?v=13a5c1ec0c6e';

const PREFIX = 'naiwa:leaderboard:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validScore = value => Number.isSafeInteger(value) && value >= 0 && value < 2 ** 40;

export function createLeaderboardClient(options = {}) {
  const baseUrl = (options.baseUrl || LEADERBOARD_API).replace(/\/$/, '');
  const fetcher = options.fetch || globalThis.fetch.bind(globalThis);
  const now = options.now || Date.now;
  const uuid = options.uuid || (() => globalThis.crypto.randomUUID());
  let storage = options.storage;
  if (!Object.hasOwn(options, 'storage')) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  const read = (key, fallback) => { try { return JSON.parse(storage?.getItem(PREFIX + key) || 'null') ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { storage?.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* Play remains available when storage is blocked. */ } };
  const storedIdentity = read('identity', null);
  let identity = storedIdentity && UUID.test(storedIdentity.id) && typeof storedIdentity.token === 'string'
    && /^[A-Za-z0-9_-]{32,128}$/.test(storedIdentity.token) && typeof storedIdentity.nickname === 'string' ? storedIdentity : null;
  let pending = read('pending', []);
  pending = Array.isArray(pending) ? pending.filter(item => item && UUID.test(item.runId) && item.playerId === identity?.id
    && parseBoard(item.board) && validScore(item.score)).slice(-200) : [];
  let savedRuns = read('merge-runs', []);
  savedRuns = Array.isArray(savedRuns) ? savedRuns.filter(item => item && UUID.test(item.runId) && item.playerId === identity?.id
    && parseBoard(item.board)?.game === 'merge').slice(-12) : [];
  const listeners = new Set();
  let identityRequest = null, uploading = null;
  function emit(event) { for (const callback of listeners) { try { callback(event); } catch { /* A view cannot break score storage. */ } } }
  function persistPending() { write('pending', pending); emit({ type: 'pending' }); }
  function persistRun(run) {
    if (parseBoard(run.board)?.game !== 'merge' || run.status !== 'ready') return;
    const submittedScore = Math.max(run.submittedScore ?? -1, savedRuns.find(item => item.runId === run.runId)?.submittedScore ?? -1);
    savedRuns = savedRuns.filter(item => item.runId !== run.runId);
    savedRuns.push({ runId: run.runId, board: run.board, playerId: run.playerId, startedAt: run.startedAt, submittedScore });
    savedRuns = savedRuns.slice(-12); write('merge-runs', savedRuns);
  }
  async function request(path, { method = 'GET', body, authenticated = false } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
    try {
      const response = await fetcher(`${baseUrl}${path}`, { method, signal: controller.signal, credentials: 'omit', cache: 'no-store',
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(authenticated && identity ? { Authorization: `Bearer ${identity.token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      let data; try { data = await response.json(); } catch { throw new Error('排行榜暂时无法连接，请稍后重试。'); }
      if (!response.ok) {
        const error = new Error(data?.error?.message || '排行榜暂时无法连接，请稍后重试。');
        error.code = data?.error?.code; error.status = response.status; throw error;
      }
      return data;
    } catch (error) {
      if (error?.name === 'AbortError' || error instanceof TypeError) throw new Error('排行榜网络连接失败，请稍后重试。');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function getProfile() { return identity ? { id: identity.id, nickname: identity.nickname } : null; }
  async function ensureIdentity() {
    if (identity) return identity;
    if (!identityRequest) identityRequest = request('/api/players', { method: 'POST', body: {} }).then(data => {
      if (!UUID.test(data?.player?.id) || typeof data.token !== 'string') throw new Error('排行榜身份创建失败，请重试。');
      identity = { ...data.player, token: data.token }; write('identity', identity); emit({ type: 'profile' }); return identity;
    }).finally(() => { identityRequest = null; });
    return identityRequest;
  }
  async function setNickname(nickname) {
    nickname = String(nickname).trim();
    if (!nickname || Array.from(nickname).length > 16 || /[\p{Cc}\p{Cf}]/u.test(nickname)) throw new Error('昵称请用 1–16 个可见字符。');
    await ensureIdentity();
    const data = await request('/api/player', { method: 'PATCH', authenticated: true, body: { nickname } });
    identity.nickname = data.player?.nickname ?? data.nickname ?? nickname;
    write('identity', identity); emit({ type: 'profile' }); return getProfile();
  }
  function beginRun(context, { resume = false, runId } = {}) {
    const board = makeBoard(context);
    if (!board) return null;
    if (resume) {
      const saved = savedRuns.find(item => item.runId === runId && item.board === board && item.playerId === identity?.id);
      if (!saved) return { board, status: 'legacy', message: '这份存档未登记全球榜，重开新局即可参与。' };
      return { ...saved, status: 'ready', ready: Promise.resolve(true) };
    }
    const run = { board, runId: uuid(), status: 'starting', submittedScore: -1 };
    run.ready = (async () => {
      try {
        const player = await ensureIdentity(); run.playerId = player.id;
        const data = await request('/api/runs', { method: 'POST', authenticated: true, body: { board, runId: run.runId } });
        if (data.runId !== run.runId) throw new Error('排行榜开局登记失败。');
        run.startedAt = data.startedAt; run.status = 'ready'; persistRun(run); return true;
      } catch (error) { run.status = 'offline'; run.message = error.message; return false; }
    })();
    return run;
  }
  async function submitPending(board) {
    if (uploading) {
      const previous = await uploading;
      if (!pending.some(item => !board || item.board === board)) return { ...previous, pending: pending.length };
      const next = await submitPending(board);
      return { submitted: previous.submitted + next.submitted, failed: previous.failed + next.failed, pending: next.pending,
        failures: [...(previous.failures || []), ...(next.failures || [])], successes: [...(previous.successes || []), ...(next.successes || [])] };
    }
    if (!identity?.nickname) return { submitted: 0, failed: 0, pending: pending.length };
    uploading = (async () => {
      let submitted = 0, failed = 0;
      const failures = [], successes = [];
      const attempted = new Set();
      while (true) {
        const item = pending.find(entry => (!board || entry.board === board) && !attempted.has(`${entry.runId}:${entry.score}`));
        if (!item) break;
        const snapshot = { ...item }; attempted.add(`${snapshot.runId}:${snapshot.score}`);
        try {
          const data = await request('/api/scores', { method: 'POST', authenticated: true, body: { runId: snapshot.runId, score: snapshot.score } });
          if (data.accepted !== true) throw new Error('这次成绩没有被排行榜接收，请重试。');
          successes.push({ runId: snapshot.runId, score: snapshot.score });
          pending = pending.filter(entry => entry.runId !== snapshot.runId || entry.score > snapshot.score);
          const saved = savedRuns.find(entry => entry.runId === snapshot.runId);
          if (saved) { saved.submittedScore = Math.max(saved.submittedScore ?? -1, snapshot.score); write('merge-runs', savedRuns); }
          persistPending(); submitted++; emit({ type: 'submitted', board: snapshot.board, score: snapshot.score, best: data.best });
        } catch (error) {
          const terminal = [400, 404, 409, 410].includes(error.status);
          failed++; failures.push({ runId: snapshot.runId, score: snapshot.score, message: error.message, terminal });
          emit({ type: 'error', board: snapshot.board, message: error.message });
          if (terminal) {
            // An expired or permanently rejected run must not block newer scores.
            pending = pending.filter(entry => entry.runId !== snapshot.runId || entry.score > snapshot.score);
            persistPending();
          } else break; // Network/429/5xx retain the same run for an idempotent retry.
        }
      }
      return { submitted, failed, pending: pending.length, failures, successes };
    })();
    try { return await uploading; } finally { uploading = null; }
  }
  async function recordResult(run, score) {
    if (!run) return { queued: false, message: '练习和本地双人对战不参与个人积分榜。' };
    await run.ready;
    if (run.status !== 'ready') return { board: run.board, score, queued: false, message: run.status === 'legacy' ? run.message : '本局未连接排行榜服务，成绩仅保存在本机。' };
    if (!validScore(score)) return { board: run.board, score, queued: false, message: '成绩格式不正确。' };
    const alreadySent = Math.max(run.submittedScore ?? -1, savedRuns.find(item => item.runId === run.runId)?.submittedScore ?? -1);
    if (score <= alreadySent) return { board: run.board, score, queued: false, submitted: true, message: '这局的最高成绩已经上榜。' };
    const existing = pending.find(item => item.runId === run.runId);
    if (existing) existing.score = Math.max(existing.score, score);
    else pending.push({ runId: run.runId, board: run.board, playerId: run.playerId, score, createdAt: now() });
    pending = pending.slice(-200); persistPending();
    if (identity?.nickname) {
      const result = await submitPending(run.board);
      const remaining = pending.some(item => item.runId === run.runId);
      // Queue removal can mean permanent rejection. Only an actual server
      // acknowledgement (including one awaited from another caller) proves success.
      const acknowledged = Math.max(run.submittedScore ?? -1, savedRuns.find(item => item.runId === run.runId)?.submittedScore ?? -1,
        (result.successes || []).reduce((best, item) => item.runId === run.runId ? Math.max(best, item.score) : best, -1));
      if (acknowledged >= score) {
        run.submittedScore = acknowledged; persistRun(run);
        return { board: run.board, score, queued: remaining, submitted: true,
          message: remaining ? '本局已上榜，还有更高成绩等待重试。' : '成绩已提交全球排行榜。' };
      }
      const rejected = result.failures?.slice().reverse().find(item => item.runId === run.runId && item.score >= score);
      if (rejected) return { board: run.board, score, queued: remaining, submitted: false,
        message: rejected.terminal ? `成绩未上榜：${rejected.message}` : '成绩已保留，打开排行榜可重试提交。' };
      return { board: run.board, score, queued: remaining, submitted: false,
        message: remaining ? '成绩已保留，打开排行榜可重试提交。' : '这次成绩尚未确认上榜，请打开排行榜查看。' };
    }
    return { board: run.board, score, queued: true, message: '打开排行榜，填写昵称后即可上榜。' };
  }
  async function getBoard(board) {
    if (!parseBoard(board)) throw new Error('请选择有效的排行榜。');
    const query = new URLSearchParams({ board, limit: '50' });
    if (identity?.id) query.set('player', identity.id);
    return request(`/api/boards?${query}`);
  }
  return { getProfile, setNickname, beginRun, recordResult, getBoard, submitPending,
    getPending: () => pending.map(item => ({ ...item })),
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
  };
}
