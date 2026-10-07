import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESENCE_GRACE_MS,
  __test,
  advanceRound,
  clientState,
  createRoom,
  createRound,
  maybeAdvanceCompletedPhase,
  studentAction
} from '../src/game.js';

function roomFixture() {
  return {
    players: { a: {}, b: {}, c: {}, d: {} },
    currentRound: {
      options: [
        { id: 'red', label: '빨강' },
        { id: 'blue', label: '파랑' },
        { id: 'green', label: '초록' }
      ],
      votes: {
        first: { a: 'red', b: 'blue', c: 'green', d: 'green' },
        final: { b: 'green' }
      },
      config: { roles: true },
      roles: { a: 'influencer', b: 'citizen', c: 'analyst', d: 'floater' }
    }
  };
}

function liveRoom(mode = 'official') {
  const room = createRoom({ className: '테스트반', teacherName: '테스트 교사', pin: '1234' }, 'ABCDE');
  room.players = {
    a: { id: 'a', token: 'token-a', name: '가람', team: '별빛팀', score: 0 },
    b: { id: 'b', token: 'token-b', name: '나래', team: '구름팀', score: 0 }
  };
  createRound(room, {
    mode,
    title: '오늘의 선택',
    options: [{ label: 'A' }, { label: 'B' }],
    timerSeconds: 45,
    revealStyle: 'staircase',
    resultPrivacy: 'full'
  }, ['a', 'b']);
  return room;
}

test('최종 표는 2차 선택을 우선하고 영향가 표를 2표로 계산한다', () => {
  assert.deepEqual(__test.countVotes(roomFixture()), { red: 2, blue: 0, green: 3 });
});

test('혼잡도 신호는 최다·최소만 공개한다', () => {
  const room = roomFixture();
  const signal = __test.qualitativeSignal(room.currentRound, { red: 2, blue: 0, green: 3 });
  assert.deepEqual(signal, { red: '보통', blue: '한산', green: '혼잡' });
});

test('표 차이 구간을 경계값에 맞게 나눈다', () => {
  assert.equal(__test.gapBucket({ count: 8 }, { count: 6 }), 'close');
  assert.equal(__test.gapBucket({ count: 9 }, { count: 6 }), 'middle');
  assert.equal(__test.gapBucket({ count: 12 }, { count: 6 }), 'wide');
});

test('비밀 임무의 성공 여부를 판정한다', () => {
  const ranking = [{ id: 'red', count: 5 }, { id: 'blue', count: 4 }, { id: 'green', count: 3 }];
  const counts = { red: 5, blue: 4, green: 3 };
  assert.equal(__test.missionSucceeded({ type: 'chosen_first', optionId: 'red' }, ranking, counts, 12), true);
  assert.equal(__test.missionSucceeded({ type: 'close_gap' }, ranking, counts, 12), true);
  assert.equal(__test.missionSucceeded({ type: 'exact_count', optionId: 'green', target: 4 }, ranking, counts, 12), false);
});

test('정원은 정확히 N명 모드에만 남긴다', () => {
  const source = [{ label: 'A', capacity: 4 }, { label: 'B', capacity: 6 }];
  assert.deepEqual(__test.defaultOptions(source, 'official').map((option) => option.capacity), [null, null]);
  assert.deepEqual(__test.defaultOptions(source, 'exact').map((option) => option.capacity), [4, 6]);
});

test('낮은 순위 공개는 실제 등수를 유지하고 마지막에 상위 2개를 함께 연다', () => {
  const room = roomFixture();
  Object.assign(room.currentRound, {
    mode: 'official',
    phase: 'reveal',
    config: { ...room.currentRound.config, revealStyle: 'staircase', resultPrivacy: 'full' },
    reveal: { step: 0, totalSteps: 0, order: [], tallyOrder: [] },
    points: {},
    scored: false
  });
  Object.values(room.players).forEach((player) => { player.score = 0; });
  __test.prepareReveal(room);
  assert.equal(room.currentRound.reveal.totalSteps, 2);
  __test.revealNext(room);
  assert.equal(__test.publicResults(room, 'student')[0].rank, 3);
  __test.revealNext(room);
  assert.equal(__test.publicResults(room, 'student').length, 3);
});

test('1위만 공개 설정은 공개 연출이 끝나기 전에 승자를 누설하지 않는다', () => {
  const room = roomFixture();
  Object.assign(room.currentRound, {
    phase: 'reveal',
    config: { ...room.currentRound.config, revealStyle: 'staircase', resultPrivacy: 'winner' },
    reveal: { step: 0, totalSteps: 2, order: ['blue', 'red', 'green'], tallyOrder: [] }
  });
  assert.deepEqual(__test.publicResults(room, 'student'), []);
});

test('드럼롤 공개는 실제 유효 표 수만큼 한 표씩 센다', () => {
  const room = roomFixture();
  Object.assign(room.currentRound, {
    phase: 'reveal',
    config: { ...room.currentRound.config, revealStyle: 'drumroll', resultPrivacy: 'full' },
    reveal: { step: 0, totalSteps: 0, order: [], tallyOrder: [] }
  });
  __test.prepareReveal(room);
  assert.equal(room.currentRound.reveal.totalSteps, 5);
  __test.revealNext(room);
  assert.equal(__test.publicResults(room, 'student').reduce((sum, item) => sum + item.count, 0), 1);
});

test('소수파 생존과 정확히 N명 모드는 승리한 학생에게만 점수를 준다', () => {
  const minority = roomFixture();
  Object.assign(minority.currentRound, {
    mode: 'minority',
    config: { roles: false, minorityMinimum: 1 },
    votes: { first: { a: 'red', b: 'red', c: 'blue', d: 'green' }, final: {} },
    points: {},
    scored: false
  });
  Object.values(minority.players).forEach((player) => { player.score = 0; });
  __test.scoreRound(minority);
  assert.equal(minority.currentRound.points.c + minority.currentRound.points.d, 3);

  const exact = roomFixture();
  exact.currentRound.options[0].capacity = 2;
  exact.currentRound.options[1].capacity = 1;
  exact.currentRound.options[2].capacity = 4;
  Object.assign(exact.currentRound, {
    mode: 'exact',
    config: { roles: false },
    votes: { first: { a: 'red', b: 'red', c: 'blue', d: 'green' }, final: {} },
    points: {},
    scored: false
  });
  Object.values(exact.players).forEach((player) => { player.score = 0; });
  __test.scoreRound(exact);
  assert.deepEqual(exact.currentRound.points, { a: 3, b: 3, c: 3, d: 0 });
});

test('표심전 점수는 학생 화면에 항목별 근거와 합계로 전달한다', () => {
  const room = liveRoom('prediction');
  const [first, second] = room.currentRound.options;
  room.currentRound.votes.first = { a: first.id, b: first.id };
  room.currentRound.predictions.a = {
    final: { first: first.id, second: second.id, gap: 'close', split: [] }
  };
  __test.scoreRound(room);

  assert.equal(room.currentRound.points.a, 11);
  assert.equal(room.currentRound.pointBreakdowns.a.reduce((sum, item) => sum + item.points, 0), 11);
  assert.deepEqual(room.currentRound.pointBreakdowns.a.map((item) => item.label), [
    '1위 예측 적중',
    '2위 예측 적중',
    '1·2위 표 차이 적중',
    '완벽 예측 보너스',
    '남은 정보 토큰'
  ]);

  const state = clientState(room, { role: 'student', player: room.players.a }, new Set(['token-a', 'token-b']));
  assert.deepEqual(state.round.pointBreakdown, room.currentRound.pointBreakdowns.a);
});

test('교실 TV 상태에는 학생의 이름과 비밀 토큰을 보내지 않는다', () => {
  const state = __test.displayState({
    code: 'ABCDE',
    className: '5학년 2반',
    teacherName: '김목동 선생님',
    history: [],
    currentRound: null,
    players: {
      a: { id: 'a', name: '김하늘', team: '별빛 팀', score: 4, token: 'secret-token' }
    }
  });
  assert.deepEqual(state.players, [{ online: false }]);
  assert.equal(JSON.stringify(state).includes('김하늘'), false);
  assert.equal(JSON.stringify(state).includes('secret-token'), false);
});

test('교실 TV는 소수파 생존의 실제 승리 조건을 따로 계산한다', () => {
  const room = roomFixture();
  Object.assign(room.currentRound, {
    mode: 'minority',
    phase: 'finished',
    config: { roles: false, minorityMinimum: 1, resultPrivacy: 'full' },
    votes: { first: { a: 'red', b: 'red', c: 'blue', d: 'green' }, final: {} }
  });
  const outcome = __test.publicDisplayOutcome(room);
  assert.equal(outcome.kind, 'minority');
  assert.equal(outcome.winners[0].count, 1);
  assert.notEqual(outcome.winners[0].id, 'red');
});

test('제한시간이 있는 첫 비밀투표는 선택을 잠그고 모두 제출하면 즉시 마감한다', () => {
  const room = liveRoom('official');
  const [first, second] = room.currentRound.options;
  studentAction(room, room.players.a, 'vote', { optionId: first.id });
  assert.throws(
    () => studentAction(room, room.players.a, 'vote', { optionId: second.id }),
    /이미 확정/
  );
  assert.equal(maybeAdvanceCompletedPhase(room, new Set(['token-a', 'token-b'])), false);
  studentAction(room, room.players.b, 'vote', { optionId: second.id });
  assert.equal(maybeAdvanceCompletedPhase(room, new Set(['token-a', 'token-b'])), true);
  assert.equal(room.currentRound.phase, 'reveal');
});

test('최종 선택 단계는 모두 제출해도 제한시간 안에 다시 바꿀 수 있다', () => {
  const room = liveRoom('migration');
  const [first, second] = room.currentRound.options;
  studentAction(room, room.players.a, 'vote', { optionId: first.id });
  studentAction(room, room.players.b, 'vote', { optionId: second.id });
  assert.equal(maybeAdvanceCompletedPhase(room, new Set(['token-a', 'token-b'])), true);
  assert.equal(room.currentRound.phase, 'signal');
  advanceRound(room);
  assert.equal(room.currentRound.phase, 'revote');
  studentAction(room, room.players.a, 'vote', { optionId: first.id });
  studentAction(room, room.players.b, 'vote', { optionId: second.id });
  assert.equal(maybeAdvanceCompletedPhase(room, new Set(['token-a', 'token-b'])), false);
  studentAction(room, room.players.a, 'vote', { optionId: second.id });
  assert.equal(room.currentRound.votes.final.a, second.id);
});

test('연결이 끊긴 학생은 30초 유예 후 현재 라운드 분모에서만 제외한다', () => {
  const room = liveRoom('official');
  const now = Date.now();
  room.players.b.disconnectedAt = now - PRESENCE_GRACE_MS - 1;
  const state = clientState(room, { role: 'teacher', player: null }, new Set(['token-a']));
  assert.equal(state.round.totalPlayers, 1);
  assert.equal(state.players.find((player) => player.id === 'b').roundActive, false);
  assert.ok(room.players.b);

  studentAction(room, room.players.a, 'vote', { optionId: room.currentRound.options[0].id });
  assert.equal(maybeAdvanceCompletedPhase(room, new Set(['token-a']), now), true);
});
