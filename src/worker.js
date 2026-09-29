import {
  advanceRound,
  authenticate,
  authError,
  buildViewContext,
  clientError,
  clientState,
  createRoom,
  displayState,
  id,
  joinRoom,
  migrateRoom,
  pinHash,
  roomCode,
  secureEqual,
  studentAction,
  teacherAction
} from './game.js';

const ROOM_KEY = 'room';
const MAX_BODY_BYTES = 100_000;
const DEFAULT_TTL_HOURS = 24;
// 읽기(상태 조회·실시간 연결)만 있을 때는 이 간격마다 한 번만 보관 기한을 늘려 저장소 쓰기를 줄인다.
const KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000;
// 짧은 시간에 몰린 제출·접속을 한 번의 전송으로 묶는다.
const BROADCAST_DELAY_MS = 120;
const PRESENCE_DELAY_MS = 400;
// 브라우저는 이 두 코드를 받으면 다시 연결하지 않고 입장 화면으로 돌아간다.
const CLOSE_AUTH_EXPIRED = 4001;
const CLOSE_ROOM_EXPIRED = 4004;
const CLOSE_SERVER_ERROR = 1011;
const SOCKET_OPEN = 1;

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

function errorResponse(error) {
  if (!error.status) console.error(error);
  return json({ error: error.status ? error.message : '서버에서 문제가 생겼습니다.' }, error.status || 500);
}

async function readJson(request) {
  const announcedSize = Number(request.headers.get('Content-Length') || 0);
  if (announcedSize > MAX_BODY_BYTES) throw clientError('요청 내용이 너무 큽니다.', 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw clientError('요청 내용이 너무 큽니다.', 413);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw clientError('요청 내용을 읽을 수 없습니다.');
  }
}

function roomStub(env, code) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

function asset(request, env, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return env.ASSETS.fetch(new Request(url, { headers: request.headers }));
}

async function api(request, env) {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/api/rooms') {
    const input = await readJson(request);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = roomCode();
      const response = await roomStub(env, code).fetch('https://room.internal/internal/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-App-Origin': url.origin },
        body: JSON.stringify({ input, code })
      });
      if (response.status !== 409) return response;
    }
    throw clientError('새 방 코드를 만들 수 없습니다.', 503);
  }

  const parts = url.pathname.split('/').filter(Boolean);
  const code = String(parts[2] || '').toUpperCase();
  // 새 방은 숫자 5자리다. 전환 전에 만든 영문·숫자 코드 방도 보관 기한(24시간)이 끝날 때까지 들어올 수 있게 둔다.
  if (!/^[0-9A-HJ-NP-Z]{5}$/.test(code)) throw clientError('방 코드를 확인해 주세요.', 404);
  const headers = new Headers(request.headers);
  headers.set('X-App-Origin', url.origin);
  return roomStub(env, code).fetch(new Request(request, { headers }));
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/manual') return Response.redirect(new URL('/manual/', url), 308);
      if (url.pathname === '/display') return Response.redirect(new URL('/display/', url), 308);
      if (url.pathname === '/') return asset(request, env, '/index.html');
      if (url.pathname === '/manual/') return asset(request, env, '/manual/index.html');
      if (url.pathname.startsWith('/display/')) return asset(request, env, '/display.html');
      if (url.pathname.startsWith('/api/')) return await api(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      return errorResponse(error);
    }
  }
};

function memo(cache, key, build) {
  if (!cache.has(key)) cache.set(key, JSON.stringify(build()));
  return cache.get(key);
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.broadcastTimer = null;
    this.broadcastDue = 0;
    // 'ping'에는 Durable Object를 깨우지 않고 런타임이 바로 'pong'으로 답한다.
    if (typeof WebSocketRequestResponsePair === 'function' && typeof ctx.setWebSocketAutoResponse === 'function') {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }
  }

  ttlMs() {
    const hours = Number(this.env.ROOM_TTL_HOURS || DEFAULT_TTL_HOURS);
    return Math.max(1, Math.min(24 * 30, Number.isFinite(hours) ? hours : DEFAULT_TTL_HOURS)) * 60 * 60 * 1000;
  }

  delay(name, fallback) {
    const value = Number(this.env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  origin(request) {
    return request.headers.get('X-App-Origin') || null;
  }

  async loadRoom() {
    const room = await this.ctx.storage.get(ROOM_KEY);
    if (!room) return null;
    if (room.expiresAt && room.expiresAt <= Date.now()) {
      await this.expire();
      return null;
    }
    if (migrateRoom(room)) await this.ctx.storage.put(ROOM_KEY, room);
    return room;
  }

  requireRoom(room) {
    if (!room) throw clientError('방 코드를 확인해 주세요.', 404);
    return room;
  }

  touch(room) {
    room.updatedAt = Date.now();
    room.expiresAt = room.updatedAt + this.ttlMs();
  }

  // 읽기 요청은 마지막 연장 뒤 KEEPALIVE_INTERVAL_MS가 지났을 때만 보관 기한을 늘린다.
  keepAlive(room) {
    if (Date.now() - (room.updatedAt || 0) < KEEPALIVE_INTERVAL_MS) return false;
    this.touch(room);
    return true;
  }

  sockets() {
    return this.ctx.getWebSockets()
      .filter((socket) => socket.readyState === undefined || socket.readyState === SOCKET_OPEN)
      .map((socket) => ({ socket, attachment: readAttachment(socket) }));
  }

  onlineTokens(entries = this.sockets()) {
    return new Set(entries
      .filter(({ attachment }) => attachment.role !== 'display' && attachment.token)
      .map(({ attachment }) => attachment.token));
  }

  stateFor(room, auth, origin) {
    return clientState(room, auth, this.onlineTokens(), origin);
  }

  async persist(room) {
    await this.ctx.storage.put(ROOM_KEY, room);
    await this.scheduleAlarm(room);
  }

  // 알람은 더 이른 시각이 필요할 때만 다시 건다. 늦게 울린 알람은 alarm()이 상태를 확인하고 다음 알람을 다시 건다.
  async scheduleAlarm(room) {
    const candidates = [room.expiresAt];
    const round = room.currentRound;
    if (round?.timerEnd && !round.timerExpired) candidates.push(round.timerEnd);
    const next = Math.min(...candidates.filter((value) => Number.isFinite(value) && value > Date.now()));
    if (!Number.isFinite(next)) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current === undefined || next < current) await this.ctx.storage.setAlarm(next);
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      // 요청 본문은 방을 불러오기 전에 모두 읽는다. 불러오기와 저장 사이에 저장소가 아닌 대기(본문 읽기)가 끼면
      // 입력 게이트가 열려 다른 요청이 같은 방을 동시에 고치고, 먼저 저장된 입장·투표가 사라질 수 있다.
      const body = request.method === 'POST' ? await readJson(request) : {};
      if (request.method === 'POST' && url.pathname === '/internal/create') {
        if (await this.loadRoom()) return json({ error: '이미 사용 중인 방 코드입니다.' }, 409);
        const { input, code } = body;
        const room = createRoom(input || {}, code);
        this.touch(room);
        await this.persist(room);
        return json({
          code: room.code,
          teacherToken: room.teacherToken,
          state: this.stateFor(room, { role: 'teacher', player: null }, this.origin(request))
        }, 201);
      }

      const room = this.requireRoom(await this.loadRoom());
      const parts = url.pathname.split('/').filter(Boolean);
      const endpoint = parts[3] || '';
      const origin = this.origin(request);

      if (request.method === 'POST' && endpoint === 'teacher-login') {
        const now = Date.now();
        if ((room.pinLockUntil || 0) > now) throw clientError('PIN을 여러 번 틀렸습니다. 잠시 뒤 다시 시도해 주세요.', 429);
        if (!secureEqual(pinHash(body.pin, room.pinSalt), room.pinHash)) {
          room.pinFailures = (room.pinFailures || 0) + 1;
          if (room.pinFailures >= 5) {
            room.pinFailures = 0;
            room.pinLockUntil = now + 30_000;
          }
          await this.persist(room);
          throw authError('교사 PIN이 맞지 않습니다.');
        }
        room.pinFailures = 0;
        room.pinLockUntil = 0;
        room.teacherToken = id('t_');
        this.touch(room);
        await this.persist(room);
        this.scheduleBroadcast(this.delay('BROADCAST_DELAY_MS', BROADCAST_DELAY_MS));
        return json({ token: room.teacherToken, state: this.stateFor(room, { role: 'teacher', player: null }, origin) });
      }

      if (request.method === 'POST' && endpoint === 'join') {
        const player = joinRoom(room, body);
        this.touch(room);
        await this.persist(room);
        this.scheduleBroadcast(this.delay('BROADCAST_DELAY_MS', BROADCAST_DELAY_MS));
        return json({ token: player.token, state: this.stateFor(room, { role: 'student', player }, origin) });
      }

      if (request.method === 'GET' && endpoint === 'display-state') {
        return json(displayState(room, this.onlineTokens(), origin));
      }

      if (request.method === 'GET' && ['events', 'display-events'].includes(endpoint)) {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
          throw clientError('실시간 연결 방식이 올바르지 않습니다.', 426);
        }
        const isDisplay = endpoint === 'display-events';
        const token = isDisplay ? null : url.searchParams.get('token');
        const auth = isDisplay ? { role: 'display', player: null } : authenticate(room, token);
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        const attachment = { role: auth.role, token, origin };
        server.serializeAttachment(attachment);
        if (this.keepAlive(room)) await this.persist(room);
        // 새 화면에는 현재 상태를 바로 보내고, 다른 화면의 접속 표시는 묶어서 갱신한다.
        const entries = this.sockets();
        server.send(this.payloadFor(room, attachment, buildViewContext(room, this.onlineTokens(entries)), new Map()));
        if (auth.role === 'student') this.scheduleBroadcast(this.delay('PRESENCE_DELAY_MS', PRESENCE_DELAY_MS));
        return new Response(null, { status: 101, webSocket: client });
      }

      const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || url.searchParams.get('token');
      const auth = authenticate(room, token);
      if (request.method === 'GET' && endpoint === 'state') {
        if (this.keepAlive(room)) await this.persist(room);
        return json(this.stateFor(room, auth, origin));
      }

      if (request.method === 'POST' && endpoint === 'action') {
        if (auth.role === 'teacher') teacherAction(room, body.action, body.payload || {});
        else studentAction(room, auth.player, body.action, body.payload || {});
        this.touch(room);
        await this.persist(room);
        this.scheduleBroadcast(this.delay('BROADCAST_DELAY_MS', BROADCAST_DELAY_MS));
        return json(this.stateFor(room, auth, origin));
      }

      throw clientError('API 주소를 찾을 수 없습니다.', 404);
    } catch (error) {
      return errorResponse(error);
    }
  }

  payloadFor(room, attachment, context, shared) {
    const origin = attachment.origin || null;
    if (attachment.role === 'display') {
      return memo(shared, `display:${origin}`, () => displayState(room, undefined, origin, context));
    }
    const auth = authenticate(room, attachment.token, context.playersByToken);
    if (auth.role === 'teacher') {
      return memo(shared, `teacher:${origin}`, () => clientState(room, auth, undefined, origin, context));
    }
    return JSON.stringify(clientState(room, auth, undefined, origin, context));
  }

  broadcast(room) {
    const entries = this.sockets();
    if (!entries.length) return;
    const context = buildViewContext(room, this.onlineTokens(entries));
    const shared = new Map();
    for (const { socket, attachment } of entries) {
      try {
        socket.send(this.payloadFor(room, attachment, context, shared));
      } catch (error) {
        if (error?.status === 401) closeSocket(socket, CLOSE_AUTH_EXPIRED, '입장 정보가 만료되었습니다.');
        else {
          if (!error?.status) console.error(error);
          closeSocket(socket, CLOSE_SERVER_ERROR, '상태를 보내지 못했습니다.');
        }
      }
    }
  }

  scheduleBroadcast(delay = BROADCAST_DELAY_MS) {
    const due = Date.now() + delay;
    if (this.broadcastTimer && this.broadcastDue <= due) return;
    clearTimeout(this.broadcastTimer);
    this.broadcastDue = due;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.flushBroadcast().catch((error) => console.error(error));
    }, delay);
  }

  async flushBroadcast() {
    const room = await this.loadRoom();
    if (room) this.broadcast(room);
  }

  async webSocketMessage(socket, message) {
    // 자동 응답이 없는 환경을 위한 예비 처리
    if (message === 'ping') socket.send('pong');
  }

  async webSocketClose(socket) {
    this.socketGone(socket);
  }

  async webSocketError(socket) {
    this.socketGone(socket);
  }

  socketGone(socket) {
    const attachment = readAttachment(socket);
    closeSocket(socket, 1000, '연결을 닫습니다.');
    if (attachment.role === 'student') this.scheduleBroadcast(this.delay('PRESENCE_DELAY_MS', PRESENCE_DELAY_MS));
  }

  async alarm() {
    const room = await this.loadRoom();
    if (!room) return;
    const now = Date.now();
    const round = room.currentRound;
    if (round?.timerEnd && !round.timerExpired && round.timerEnd <= now) {
      if (round.config.autoAdvance && !['reveal', 'finished'].includes(round.phase)) advanceRound(room);
      else round.timerExpired = true;
      await this.ctx.storage.put(ROOM_KEY, room);
      this.broadcast(room);
    }
    await this.scheduleAlarm(room);
  }

  async expire() {
    clearTimeout(this.broadcastTimer);
    this.broadcastTimer = null;
    for (const socket of this.ctx.getWebSockets()) closeSocket(socket, CLOSE_ROOM_EXPIRED, '방 사용 시간이 끝났습니다.');
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}

function readAttachment(socket) {
  try {
    return socket.deserializeAttachment() || {};
  } catch {
    return {};
  }
}

function closeSocket(socket, code, reason) {
  try {
    socket.close(code, reason);
  } catch {
    // 이미 닫힌 연결
  }
}
