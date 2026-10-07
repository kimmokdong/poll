import {
  PRESENCE_GRACE_MS,
  activePlayerIds,
  advanceRound,
  authenticate,
  authError,
  clientError,
  clientState,
  createRoom,
  displayState,
  id,
  joinRoom,
  maybeAdvanceCompletedPhase,
  pinHash,
  roomCode,
  secureEqual,
  studentAction,
  teacherAction
} from './game.js';

const ROOM_KEY = 'room';
const MAX_BODY_BYTES = 100_000;
const DEFAULT_TTL_HOURS = 24;

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
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
  if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code)) throw clientError('방 코드를 확인해 주세요.', 404);
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
      if (!error.status) console.error(error);
      return json({ error: error.status ? error.message : '서버에서 문제가 생겼습니다.' }, error.status || 500);
    }
  }
};

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  ttlMs() {
    const hours = Number(this.env.ROOM_TTL_HOURS || DEFAULT_TTL_HOURS);
    return Math.max(1, Math.min(24 * 30, Number.isFinite(hours) ? hours : DEFAULT_TTL_HOURS)) * 60 * 60 * 1000;
  }

  origin(request) {
    return request.headers.get('X-App-Origin') || null;
  }

  async loadRoom() {
    const room = await this.ctx.storage.get(ROOM_KEY);
    if (room?.expiresAt && room.expiresAt <= Date.now()) {
      await this.expire();
      return null;
    }
    return room || null;
  }

  requireRoom(room) {
    if (!room) throw clientError('방 코드를 확인해 주세요.', 404);
    return room;
  }

  touch(room) {
    room.updatedAt = Date.now();
    room.expiresAt = room.updatedAt + this.ttlMs();
  }

  onlineTokens(exceptSocket = null) {
    return new Set(this.ctx.getWebSockets()
      .filter((socket) => socket !== exceptSocket)
      .map((socket) => socket.deserializeAttachment())
      .filter((attachment) => attachment?.role !== 'display' && attachment?.token)
      .map((attachment) => attachment.token));
  }

  stateFor(room, auth, origin) {
    return clientState(room, auth, this.onlineTokens(), origin);
  }

  async persist(room) {
    await this.ctx.storage.put(ROOM_KEY, room);
    await this.scheduleAlarm(room);
  }

  async scheduleAlarm(room) {
    const candidates = [room.expiresAt];
    const round = room.currentRound;
    if (round?.timerEnd && !round.timerExpired) candidates.push(round.timerEnd);
    if (round && !['reveal', 'finished'].includes(round.phase)) {
      const participantIds = Array.isArray(round.participantIds) ? round.participantIds : Object.keys(room.players);
      participantIds.forEach((playerId) => {
        const disconnectedAt = room.players[playerId]?.disconnectedAt;
        if (Number.isFinite(disconnectedAt)) candidates.push(disconnectedAt + PRESENCE_GRACE_MS);
      });
    }
    const next = Math.min(...candidates.filter((value) => Number.isFinite(value) && value > Date.now()));
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/internal/create') {
        if (await this.loadRoom()) return json({ error: '이미 사용 중인 방 코드입니다.' }, 409);
        const { input, code } = await readJson(request);
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
        const body = await readJson(request);
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
        await this.broadcast(room, origin);
        return json({ token: room.teacherToken, state: this.stateFor(room, { role: 'teacher', player: null }, origin) });
      }

      if (request.method === 'POST' && endpoint === 'join') {
        const player = joinRoom(room, await readJson(request));
        this.touch(room);
        await this.persist(room);
        await this.broadcast(room, origin);
        return json({ token: player.token, state: this.stateFor(room, { role: 'student', player }, origin) });
      }

      if (request.method === 'GET' && endpoint === 'display-state') {
        return json(displayState(room, this.onlineTokens(), origin));
      }

      if (request.method === 'GET' && ['events', 'display-events'].includes(endpoint)) {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
          throw clientError('실시간 연결 방식이 올바르지 않습니다.', 426);
        }
        const role = endpoint === 'display-events' ? 'display' : null;
        const token = role === 'display' ? null : url.searchParams.get('token');
        const auth = role === 'display' ? { role: 'display', player: null } : authenticate(room, token);
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ role: role || auth.role, token, origin });
        if (auth.player) {
          auth.player.lastSeen = Date.now();
          auth.player.disconnectedAt = null;
        }
        this.touch(room);
        await this.persist(room);
        await this.broadcast(room, origin);
        return new Response(null, { status: 101, webSocket: client });
      }

      const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || url.searchParams.get('token');
      const auth = authenticate(room, token);
      if (request.method === 'GET' && endpoint === 'state') {
        this.touch(room);
        await this.persist(room);
        return json(this.stateFor(room, auth, origin));
      }

      if (request.method === 'POST' && endpoint === 'action') {
        const body = await readJson(request);
        const onlineTokens = this.onlineTokens();
        if (auth.role === 'teacher') {
          teacherAction(room, body.action, body.payload || {}, {
            participantIds: activePlayerIds(room, onlineTokens)
          });
        }
        else studentAction(room, auth.player, body.action, body.payload || {});
        maybeAdvanceCompletedPhase(room, onlineTokens);
        this.touch(room);
        await this.persist(room);
        await this.broadcast(room, origin);
        return json(this.stateFor(room, auth, origin));
      }

      throw clientError('API 주소를 찾을 수 없습니다.', 404);
    } catch (error) {
      if (!error.status) console.error(error);
      return json({ error: error.status ? error.message : '서버에서 문제가 생겼습니다.' }, error.status || 500);
    }
  }

  async broadcast(room, fallbackOrigin = null) {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const attachment = socket.deserializeAttachment() || {};
        const origin = attachment.origin || fallbackOrigin;
        const state = attachment.role === 'display'
          ? displayState(room, this.onlineTokens(), origin)
          : this.stateFor(room, authenticate(room, attachment.token), origin);
        socket.send(JSON.stringify(state));
      } catch {
        socket.close(4001, '입장 정보가 만료되었습니다.');
      }
    }
  }

  async webSocketMessage(socket, message) {
    if (message === 'ping') socket.send('pong');
  }

  async handleSocketDeparture(socket) {
    const room = await this.loadRoom();
    if (!room) return;
    const attachment = socket.deserializeAttachment() || {};
    if (attachment.role === 'student' && attachment.token && !this.onlineTokens(socket).has(attachment.token)) {
      const player = Object.values(room.players).find((item) => item.token === attachment.token);
      if (player) {
        player.lastSeen = Date.now();
        player.disconnectedAt = player.lastSeen;
        await this.persist(room);
      }
    }
    await this.broadcast(room);
  }

  async webSocketClose(socket) {
    await this.handleSocketDeparture(socket);
  }

  async webSocketError(socket) {
    await this.handleSocketDeparture(socket);
  }

  async alarm() {
    const room = await this.loadRoom();
    if (!room) return;
    const now = Date.now();
    if (room.expiresAt <= now) return this.expire();
    let round = room.currentRound;
    let changed = maybeAdvanceCompletedPhase(room, this.onlineTokens(), now);
    const advancedForCompletion = changed;
    round = room.currentRound;
    if (!advancedForCompletion && round?.timerEnd && !round.timerExpired && round.timerEnd <= now) {
      if (round.config.autoAdvance && !['reveal', 'finished'].includes(round.phase)) advanceRound(room);
      else round.timerExpired = true;
      changed = true;
    }
    const participantIds = Array.isArray(round?.participantIds) ? round.participantIds : Object.keys(room.players);
    const presenceExpired = Boolean(round && participantIds.some((playerId) => {
      const disconnectedAt = room.players[playerId]?.disconnectedAt;
      return Number.isFinite(disconnectedAt) && disconnectedAt + PRESENCE_GRACE_MS <= now;
    }));
    if (changed) await this.ctx.storage.put(ROOM_KEY, room);
    if (changed || presenceExpired) await this.broadcast(room);
    await this.scheduleAlarm(room);
  }

  async expire() {
    for (const socket of this.ctx.getWebSockets()) socket.close(1001, '방 사용 시간이 끝났습니다.');
    await this.ctx.storage.deleteAll();
  }
}
