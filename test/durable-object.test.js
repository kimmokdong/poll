import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import test from 'node:test';

// ---------- Cloudflare Workers 런타임의 필요한 부분만 흉내 낸다 ----------
// (npm 레지스트리 없이도 돌도록 외부 패키지 없이 작성했다. 실제 런타임 차이는 `wrangler deploy --dry-run`과 배포로 확인한다.)

const NativeResponse = globalThis.Response;
class WorkerResponse extends NativeResponse {
  constructor(body, init = {}) {
    if (init?.status === 101) {
      super(null, { ...init, status: 200 });
      this.upgradeStatus = 101;
      this.webSocket = init.webSocket;
    } else super(body, init);
  }

  get status() {
    return this.upgradeStatus ?? super.status;
  }
}
globalThis.Response = WorkerResponse;

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.sent = [];
    this.closed = null;
    this.attachment = null;
  }

  send(data) {
    if (this.readyState !== 1) throw new Error('socket is closed');
    this.sent.push(data);
  }

  close(code, reason) {
    if (this.readyState === 3) throw new Error('socket is already closed');
    this.readyState = 3;
    this.closed = { code, reason };
  }

  serializeAttachment(value) {
    this.attachment = structuredClone(value);
  }

  deserializeAttachment() {
    return this.attachment ? structuredClone(this.attachment) : null;
  }

  states() {
    return this.sent.filter((item) => item !== 'pong').map((item) => JSON.parse(item));
  }

  last() {
    return this.states().at(-1);
  }
}

globalThis.WebSocketPair = class {
  constructor() {
    const client = new FakeSocket();
    const server = new FakeSocket();
    client.server = server;
    this[0] = client;
    this[1] = server;
  }
};

globalThis.WebSocketRequestResponsePair = class {
  constructor(request, response) {
    this.request = request;
    this.response = response;
  }
};

// 입력 게이트(input gate) 흉내: 한 요청이 저장소 작업을 시작하면 그 요청이 끝나거나
// 저장소가 아닌 대기(요청 본문 읽기)에 들어갈 때까지 다른 요청의 저장소 작업을 막는다.
// 그래서 "불러오기 → 수정 → 저장" 사이에 본문 읽기가 끼면 실제처럼 한쪽 변경이 사라진다.
const requestContext = new AsyncLocalStorage();

class InputGate {
  constructor() {
    this.holder = null;
    this.active = new Set();
    this.waiters = [];
  }

  async enter(requestId) {
    while (this.holder !== null && this.holder !== requestId) {
      await new Promise((resolve) => { this.waiters.push(resolve); });
    }
    this.holder = requestId;
  }

  release(requestId) {
    if (this.holder !== requestId) return;
    this.holder = null;
    this.waiters.splice(0).forEach((resolve) => resolve());
  }
}

class GatedRequest extends Request {
  constructor(input, init, gate) {
    super(input, init);
    this.gate = gate;
  }

  async text() {
    this.gate.release(requestContext.getStore());
    await new Promise((resolve) => { setImmediate(resolve); });
    return super.text();
  }
}

class FakeStorage {
  constructor(gate) {
    this.gate = gate;
    this.data = new Map();
    this.alarm = null;
    this.writes = 0;
    this.alarmWrites = 0;
  }

  async operation(run) {
    const requestId = requestContext.getStore();
    if (requestId && this.gate.active.has(requestId)) await this.gate.enter(requestId);
    await new Promise((resolve) => { setImmediate(resolve); });
    return run();
  }

  get(key) {
    return this.operation(() => (this.data.has(key) ? structuredClone(this.data.get(key)) : undefined));
  }

  put(key, value) {
    const copy = structuredClone(value);
    return this.operation(() => {
      this.writes += 1;
      this.data.set(key, copy);
    });
  }

  deleteAll() {
    return this.operation(() => this.data.clear());
  }

  getAlarm() {
    return this.operation(() => this.alarm);
  }

  setAlarm(time) {
    return this.operation(() => {
      this.alarmWrites += 1;
      this.alarm = Number(time);
    });
  }

  deleteAlarm() {
    return this.operation(() => { this.alarm = null; });
  }

  edit(update) {
    const room = this.data.get('room');
    update(room);
    this.data.set('room', room);
  }
}

class FakeState {
  constructor() {
    this.gate = new InputGate();
    this.storage = new FakeStorage(this.gate);
    this.accepted = [];
    this.autoResponse = null;
  }

  acceptWebSocket(socket) {
    this.accepted.push(socket);
  }

  getWebSockets() {
    return this.accepted.filter((socket) => socket.readyState !== 3);
  }

  setWebSocketAutoResponse(pair) {
    this.autoResponse = pair;
  }
}

const { default: worker, Room } = await import('../src/worker.js');

function createEnv(overrides = {}) {
  const instances = new Map();
  const env = {
    ROOM_TTL_HOURS: '24',
    BROADCAST_DELAY_MS: '0',
    PRESENCE_DELAY_MS: '0',
    ASSETS: { fetch: async (request) => new NativeResponse(`asset:${new URL(request.url).pathname}`) },
    ROOMS: {
      idFromName: (name) => name,
      get: (name) => ({
        fetch(input, init) {
          if (!instances.has(name)) instances.set(name, new Room(new FakeState(), env));
          const room = instances.get(name);
          const { gate } = room.ctx;
          const request = new GatedRequest(input, init, gate);
          const requestId = Symbol('request');
          gate.active.add(requestId);
          return requestContext.run(requestId, async () => {
            try {
              return await room.fetch(request);
            } finally {
              gate.active.delete(requestId);
              gate.release(requestId);
            }
          });
        }
      })
    },
    ...overrides
  };
  return { env, instances };
}

const settle = (ms = 20) => new Promise((resolve) => { setTimeout(resolve, ms); });

// 실제 런타임처럼 알람이 울리면 예약을 지운 뒤 alarm()을 부른다(그동안 getAlarm()은 null).
async function fireAlarm(room) {
  room.ctx.storage.alarm = null;
  await room.alarm();
}

async function call(env, method, path, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await worker.fetch(new Request(`https://poll.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function openSocket(env, code, token = null) {
  const path = token
    ? `/api/rooms/${code}/events?token=${encodeURIComponent(token)}`
    : `/api/rooms/${code}/display-events`;
  const response = await worker.fetch(new Request(`https://poll.test${path}`, { headers: { Upgrade: 'websocket' } }), env);
  assert.equal(response.status, 101);
  return response.webSocket.server;
}

async function classroom(env, students = 2) {
  const created = await call(env, 'POST', '/api/rooms', { body: { className: '5학년 2반', teacherName: '담임', pin: '1234' } });
  assert.equal(created.status, 201);
  const { code, teacherToken } = created.body;
  const tokens = [];
  for (let index = 0; index < students; index += 1) {
    const joined = await call(env, 'POST', `/api/rooms/${code}/join`, { body: { name: `학생${index + 1}` } });
    assert.equal(joined.status, 200);
    tokens.push(joined.body.token);
  }
  return { code, teacherToken, tokens };
}

const action = (env, code, token, name, payload = {}) => call(env, 'POST', `/api/rooms/${code}/action`, { token, body: { action: name, payload } });

test('ping은 Durable Object를 깨우지 않는 자동 응답으로 등록한다', async () => {
  const { env, instances } = createEnv();
  const { code } = await classroom(env, 0);
  const pair = instances.get(code).ctx.autoResponse;
  assert.equal(pair.request, 'ping');
  assert.equal(pair.response, 'pong');
});

test('상태 조회와 실시간 연결은 보관 기한 연장 간격 전에는 저장소에 쓰지 않는다', async () => {
  const { env, instances } = createEnv();
  const { code, teacherToken } = await classroom(env, 1);
  const storage = instances.get(code).ctx.storage;
  const before = storage.writes;
  for (let index = 0; index < 3; index += 1) {
    assert.equal((await call(env, 'GET', `/api/rooms/${code}/state`, { token: teacherToken })).status, 200);
  }
  await openSocket(env, code, teacherToken);
  await openSocket(env, code);
  assert.equal(storage.writes, before);

  storage.edit((room) => { room.updatedAt = Date.now() - 11 * 60 * 1000; });
  await call(env, 'GET', `/api/rooms/${code}/state`, { token: teacherToken });
  assert.equal(storage.writes, before + 1);
});

test('알람은 더 이른 시각이 필요할 때만 다시 건다', async () => {
  const { env, instances } = createEnv();
  const { code, teacherToken } = await classroom(env, 2);
  const storage = instances.get(code).ctx.storage;
  assert.equal(storage.alarmWrites, 1);
  await call(env, 'POST', `/api/rooms/${code}/join`, { body: { name: '늦은학생' } });
  assert.equal(storage.alarmWrites, 1);
  await action(env, code, teacherToken, 'create_round', { mode: 'official', options: ['가', '나'], timerSeconds: 30 });
  assert.equal(storage.alarmWrites, 2);
  assert.ok(storage.alarm <= Date.now() + 30_000);
});

test('새 연결은 바로 상태를 받고, 한꺼번에 들어온 제출은 한 번에 전송한다', async () => {
  const { env } = createEnv({ BROADCAST_DELAY_MS: '40' });
  const { code, teacherToken, tokens } = await classroom(env, 3);
  const teacher = await openSocket(env, code, teacherToken);
  const tv = await openSocket(env, code);
  const students = [];
  for (const token of tokens) students.push(await openSocket(env, code, token));
  for (const socket of [teacher, tv, ...students]) assert.ok(socket.sent.length >= 1);
  await settle(80);

  await action(env, code, teacherToken, 'create_round', { mode: 'official', options: ['가', '나'], timerSeconds: 0 });
  await settle(80);
  const optionId = teacher.last().round.options[0].id;
  const counts = [teacher, tv, ...students].map((socket) => socket.sent.length);

  await Promise.all(tokens.map((token) => action(env, code, token, 'vote', { optionId })));
  await settle(80);
  [teacher, tv, ...students].forEach((socket, index) => assert.equal(socket.sent.length, counts[index] + 1));
  assert.equal(teacher.last().round.submissions.vote, 3);
  assert.equal(tv.last().round.submissions.vote, 3);
  assert.equal(JSON.stringify(tv.last()).includes('학생1'), false);
});

test('여러 학생이 동시에 입장하고 투표해도 입장 정보나 표가 사라지지 않는다', async () => {
  const { env, instances } = createEnv();
  const { code, teacherToken } = await classroom(env, 0);
  const joined = await Promise.all(Array.from({ length: 12 }, (_, index) => (
    call(env, 'POST', `/api/rooms/${code}/join`, { body: { name: `동시${index + 1}` } })
  )));
  assert.ok(joined.every((result) => result.status === 200));
  const stored = () => instances.get(code).ctx.storage.data.get('room');
  assert.equal(Object.keys(stored().players).length, 12);

  await action(env, code, teacherToken, 'create_round', { mode: 'official', options: ['가', '나'], timerSeconds: 0 });
  const optionId = stored().currentRound.options[1].id;
  const votes = await Promise.all(joined.map((result) => action(env, code, result.body.token, 'vote', { optionId })));
  assert.ok(votes.every((result) => result.status === 200));
  assert.equal(Object.keys(stored().currentRound.votes.first).length, 12);
});

test('학생 접속과 종료는 교사 명단의 접속 표시로 반영된다', async () => {
  const { env, instances } = createEnv();
  const { code, teacherToken, tokens } = await classroom(env, 1);
  const teacher = await openSocket(env, code, teacherToken);
  const student = await openSocket(env, code, tokens[0]);
  await settle();
  assert.equal(teacher.last().players[0].online, true);

  student.readyState = 3;
  await instances.get(code).webSocketClose(student, 1001, 'bye', true);
  await settle();
  assert.equal(teacher.last().players[0].online, false);
});

test('내보낸 학생과 새 로그인에 밀린 교사 화면은 4001로 닫힌다', async () => {
  const { env } = createEnv();
  const { code, teacherToken, tokens } = await classroom(env, 2);
  const oldTeacher = await openSocket(env, code, teacherToken);
  const student = await openSocket(env, code, tokens[0]);
  const studentId = student.last().me.id;

  assert.equal((await action(env, code, teacherToken, 'remove_player', { playerId: studentId })).status, 200);
  await settle();
  assert.equal(student.closed?.code, 4001);

  const login = await call(env, 'POST', `/api/rooms/${code}/teacher-login`, { body: { pin: '1234' } });
  assert.equal(login.status, 200);
  await settle();
  assert.equal(oldTeacher.closed?.code, 4001);
});

test('새 방 코드는 숫자 5자리이고, 전환 전에 만든 영문 코드 방도 계속 열린다', async () => {
  const { env } = createEnv();
  const { code } = await classroom(env, 0);
  assert.match(code, /^\d{5}$/);
  const legacy = await env.ROOMS.get('M7K2P').fetch('https://room.internal/internal/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: { className: '예전 방', pin: '1234' }, code: 'M7K2P' })
  });
  assert.equal(legacy.status, 201);
  assert.equal((await call(env, 'GET', '/api/rooms/M7K2P/display-state')).status, 200);
  assert.equal((await call(env, 'GET', '/api/rooms/m7k2p/display-state')).status, 200);
  assert.equal((await call(env, 'GET', '/api/rooms/12AB!/display-state')).status, 404);
});

test('잘못된 토큰의 실시간 연결은 401로 거절한다', async () => {
  const { env } = createEnv();
  const { code } = await classroom(env, 0);
  const response = await worker.fetch(new Request(`https://poll.test/api/rooms/${code}/events?token=nope`, { headers: { Upgrade: 'websocket' } }), env);
  assert.equal(response.status, 401);
});

test('교사 PIN을 5번 틀리면 잠시 잠근다', async () => {
  const { env } = createEnv();
  const { code } = await classroom(env, 0);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await call(env, 'POST', `/api/rooms/${code}/teacher-login`, { body: { pin: '0000' } })).status, 401);
  }
  assert.equal((await call(env, 'POST', `/api/rooms/${code}/teacher-login`, { body: { pin: '1234' } })).status, 429);
});

test('제한 시간이 끝나면 알람이 자동 진행하고 모든 화면에 알린다', async () => {
  const { env, instances } = createEnv();
  const { code, teacherToken } = await classroom(env, 1);
  await action(env, code, teacherToken, 'create_round', { mode: 'official', options: ['가', '나'], timerSeconds: 30, autoAdvance: true });
  const tv = await openSocket(env, code);
  const room = instances.get(code);
  room.ctx.storage.edit((stored) => { stored.currentRound.timerEnd = Date.now() - 1; });
  await fireAlarm(room);
  assert.equal(tv.last().round.phase, 'reveal');
  // 다음 단계의 타이머로 알람을 다시 건다.
  const stored = room.ctx.storage.data.get('room');
  assert.equal(room.ctx.storage.alarm, stored.currentRound.timerEnd);
  assert.ok(room.ctx.storage.alarm > Date.now());
});

test('늦게 울린 알람은 아무것도 바꾸지 않고 다음 알람만 다시 건다', async () => {
  const { env, instances } = createEnv();
  const { code, teacherToken } = await classroom(env, 1);
  await action(env, code, teacherToken, 'create_round', { mode: 'official', options: ['가', '나'], timerSeconds: 30 });
  await action(env, code, teacherToken, 'set_timer', { seconds: 120 });
  const room = instances.get(code);
  const writes = room.ctx.storage.writes;
  await fireAlarm(room);
  const stored = room.ctx.storage.data.get('room');
  assert.equal(stored.currentRound.phase, 'vote');
  assert.equal(room.ctx.storage.writes, writes);
  assert.equal(room.ctx.storage.alarm, stored.currentRound.timerEnd);
});

test('보관 기한이 지나면 연결을 4004로 닫고 저장소와 알람을 비운다', async () => {
  const { env, instances } = createEnv();
  const { code, teacherToken } = await classroom(env, 1);
  const teacher = await openSocket(env, code, teacherToken);
  const room = instances.get(code);
  room.ctx.storage.edit((stored) => { stored.expiresAt = Date.now() - 1; });
  await fireAlarm(room);
  assert.equal(teacher.closed?.code, 4004);
  assert.equal(room.ctx.storage.data.size, 0);
  assert.equal(room.ctx.storage.alarm, null);
  assert.equal((await call(env, 'GET', `/api/rooms/${code}/state`, { token: teacherToken })).status, 404);
});

test('예전 형식(v2)으로 저장된 방은 불러올 때 현재 형식으로 바꾸고 빠진 기록을 채운다', async () => {
  const { env, instances } = createEnv();
  const { code, teacherToken, tokens } = await classroom(env, 2);
  await action(env, code, teacherToken, 'create_round', { mode: 'official', options: ['가', '나'], timerSeconds: 0 });
  const optionId = (await call(env, 'GET', `/api/rooms/${code}/state`, { token: teacherToken })).body.round.options[0].id;
  for (const token of tokens) await action(env, code, token, 'vote', { optionId });
  const storage = instances.get(code).ctx.storage;
  storage.edit((room) => {
    room.version = 2;
    room.history = [];
    delete room.currentRound.participants;
    delete room.currentRound.tally;
    room.currentRound.phase = 'finished';
    room.currentRound.phaseIndex = 2;
  });
  const state = await call(env, 'GET', `/api/rooms/${code}/state`, { token: teacherToken });
  assert.equal(state.status, 200);
  assert.equal(state.body.history.length, 1);
  assert.equal(state.body.round.totalPlayers, 2);
  const stored = storage.data.get('room');
  assert.equal(stored.version, 3);
  assert.deepEqual(Object.values(stored.currentRound.tally.final).sort(), [0, 2]);
});
