const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../server');

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
