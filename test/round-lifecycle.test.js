import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __test,
  buildViewContext,
  clientState,
  createRoom,
  displayState,
  joinRoom,
  migrateRoom,
  roomCode,
  studentAction,
  teacherAction
} from '../src/game.js';
import { falseClue } from '../src/modes.js';
import { orderedResults } from '../src/ranking.js';

function classroom(names = ['가온', '나래', '다온']) {
  const room = createRoom({ className: '5학년 2반', teacherName: '담임', pin: '1234' }, '12345');
  const players = names.map((name) => joinRoom(room, { name }));
  return { room, players };
}

const optionIds = (room) => room.currentRound.options.map((option) => option.id);
const vote = (room, player, index) => studentAction(room, player, 'vote', { optionId: optionIds(room)[index] });
const studentView = (room, player) => clientState(room, { role: 'student', player });

test('방 코드는 숫자 5자리다', () => {
  for (let index = 0; index < 50; index += 1) assert.match(roomCode(), /^\d{5}$/);
});

test('표심전이 시작된 뒤 들어온 학생도 정보 스킬을 쓸 수 있다', () => {
  const { room } = classroom(['가온', '나래']);
  teacherAction(room, 'create_round', { mode: 'prediction', options: ['가', '나'] });
  const late = joinRoom(room, { name: '늦봄' });
  teacherAction(room, 'advance');
  teacherAction(room, 'advance');
  studentAction(room, late, 'use_skill', { skill: 'radar' });
  assert.equal(room.currentRound.skills[late.id].tokens, 1);
  assert.equal(studentView(room, late).round.participating, true);
  assert.equal(studentView(room, late).round.totalPlayers, 3);
});

test('표심전 1차 예측이 끝난 뒤 들어온 학생은 최종 예측만 바로 낼 수 있다', () => {
  const { room, players } = classroom(['가온', '나래']);
  teacherAction(room, 'create_round', { mode: 'prediction', options: ['가', '나'] });
  const [a, b] = optionIds(room);
  vote(room, players[0], 0);
  teacherAction(room, 'advance');
  teacherAction(room, 'advance');
  const late = joinRoom(room, { name: '늦봄' });
  teacherAction(room, 'advance');
  studentAction(room, late, 'predict', { first: a, second: b, gap: 'close' });
  assert.throws(() => studentAction(room, players[1], 'predict', { first: a, second: b, gap: 'close' }), /먼저 1차 예측/);
  assert.equal(clientState(room, { role: 'teacher', player: null }).round.submissions.finalPrediction, 1);
});

test('비밀 목표전 도중 들어온 학생은 다음 라운드부터 참여한다', () => {
  const { room } = classroom();
  teacherAction(room, 'create_round', { mode: 'mission', options: ['가', '나'] });
  const late = joinRoom(room, { name: '늦봄' });
  teacherAction(room, 'advance');
  assert.throws(() => vote(room, late, 0), (error) => error.status === 403);
  const view = studentView(room, late).round;
  assert.equal(view.participating, false);
  assert.equal(view.totalPlayers, 3);
  assert.equal(view.waitingPlayers, 1);

  teacherAction(room, 'finish_round');
  teacherAction(room, 'create_round', { mode: 'official', options: ['가', '나'] });
  vote(room, late, 0);
  assert.equal(studentView(room, late).round.participating, true);
});

test('정보 연합전 단서를 나눈 뒤 들어온 학생도 실제와 맞는 단서를 하나 받는다', () => {
  const { room, players } = classroom();
  teacherAction(room, 'create_round', { mode: 'alliance', options: ['가', '나'] });
  players.forEach((player) => vote(room, player, 0));
  teacherAction(room, 'advance');
  const late = joinRoom(room, { name: '늦봄' });
  const clues = studentView(room, late).round.clues;
  assert.equal(clues.length, 1);
  assert.ok(room.currentRound.clueDeck.includes(clues[0]));
});

test('투표 중에 내보낸 학생의 표와 제출 기록은 모두 사라진다', () => {
  const { room, players } = classroom();
  teacherAction(room, 'create_round', { mode: 'official', options: ['가', '나'] });
  players.forEach((player) => vote(room, player, 0));
  teacherAction(room, 'remove_player', { playerId: players[0].id });
  assert.deepEqual(Object.values(__test.countVotes(room)), [2, 0]);
  assert.equal(room.currentRound.votes.first[players[0].id], undefined);
  assert.equal(room.currentRound.participants[players[0].id], undefined);
  assert.equal(clientState(room, { role: 'teacher', player: null }).round.submissions.vote, 2);
});

test('결과 공개가 시작된 뒤에는 학생을 내보내도 공개 중인 집계가 바뀌지 않는다', () => {
  const { room, players } = classroom();
  teacherAction(room, 'create_round', { mode: 'official', options: ['가', '나'], revealStyle: 'staircase' });
  players.forEach((player) => vote(room, player, 0));
  teacherAction(room, 'advance');
  teacherAction(room, 'remove_player', { playerId: players[0].id });
  assert.deepEqual(Object.values(__test.countVotes(room)), [3, 0]);
  teacherAction(room, 'finish_round');
  assert.equal(room.history[0].results[0].count, 3);
});

test('결과 공개 전에 팀 답안을 확정한 학생을 내보내면 팀이 다시 제출할 수 있다', () => {
  const { room, players } = classroom(['가온', '나래', '다온', '라온', '마루']);
  const [first, , , , teammate] = players;
  teacherAction(room, 'create_round', { mode: 'alliance', options: ['가', '나'] });
  teacherAction(room, 'advance');
  teacherAction(room, 'advance');
  const order = optionIds(room);
  studentAction(room, first, 'team_guess', { order, counts: {} });
  teacherAction(room, 'remove_player', { playerId: first.id });
  assert.equal(studentView(room, teammate).round.teamGuess, null);
  studentAction(room, teammate, 'team_guess', { order: [...order].reverse(), counts: {} });
  assert.equal(studentView(room, teammate).round.teamGuess.submittedBy, teammate.name);
});

test('표가 하나도 없는 라운드에서는 순위를 맞힌 점수를 주지 않는다', () => {
  const { room, players } = classroom(['가온', '나래']);
  teacherAction(room, 'create_round', { mode: 'prediction', options: ['가', '나', '다'] });
  const [a, b] = optionIds(room);
  teacherAction(room, 'advance');
  studentAction(room, players[0], 'predict', { first: a, second: b, gap: 'wide' });
  teacherAction(room, 'advance');
  teacherAction(room, 'advance');
  teacherAction(room, 'finish_round');
  // 순위 점수 없이 남은 토큰 2개만
  assert.equal(room.currentRound.points[players[0].id], 2);
  assert.equal(__test.missionSucceeded({ type: 'chosen_first', optionId: a }, { [a]: 0, [b]: 0 }, 0), false);
});

test('다음 단계로 라운드를 끝내도 기록이 남고 타이머가 꺼진다', () => {
  const { room, players } = classroom();
  teacherAction(room, 'create_round', { mode: 'official', options: ['가', '나'], timerSeconds: 30 });
  vote(room, players[0], 1);
  teacherAction(room, 'advance');
  teacherAction(room, 'advance');
  assert.equal(room.currentRound.phase, 'finished');
  assert.equal(room.currentRound.timerEnd, null);
  assert.equal(room.history.length, 1);
  teacherAction(room, 'finish_round');
  assert.equal(room.history.length, 1);
  assert.throws(() => teacherAction(room, 'set_timer', { seconds: 30 }), /이미 끝난 라운드/);
});

test('동점은 공동 순위로 표시하고, 낮은 순위부터 공개하는 도중에는 동점을 숨긴다', () => {
  const round = { options: [{ id: 'a', label: '가' }, { id: 'b', label: '나' }, { id: 'c', label: '다' }] };
  const ranking = orderedResults(round, { a: 3, b: 3, c: 1 });
  assert.deepEqual(ranking.map(({ id, rank, tied }) => [id, rank, tied]), [['a', 1, true], ['b', 1, true], ['c', 3, false]]);

  const { room, players } = classroom(['가온', '나래', '다온', '라온']);
  teacherAction(room, 'create_round', { mode: 'official', options: ['가', '나', '다'], revealStyle: 'staircase' });
  [0, 1, 1, 2].forEach((index, order) => vote(room, players[order], index));
  teacherAction(room, 'advance');
  teacherAction(room, 'reveal_next');
  const partial = clientState(room, { role: 'teacher', player: null }).round.results;
  assert.equal(partial.length, 1);
  assert.equal(partial[0].tied, false);
  assert.equal(partial[0].rank, 3);
  teacherAction(room, 'reveal_next');
  const complete = clientState(room, { role: 'teacher', player: null }).round.results;
  assert.deepEqual(complete.map((item) => item.rank), [1, 2, 2]);
  assert.deepEqual(complete.map((item) => item.tied), [false, true, true]);
});

test('공동 1위는 교실 TV에 함께 표시되고, 1위만 공개 설정에서도 모두 보인다', () => {
  const { room, players } = classroom(['가온', '나래', '다온', '라온']);
  teacherAction(room, 'create_round', { mode: 'official', options: ['가', '나', '다'], resultPrivacy: 'winner', revealStyle: 'instant' });
  [0, 0, 1, 1].forEach((index, order) => vote(room, players[order], index));
  teacherAction(room, 'advance');
  assert.deepEqual(studentView(room, players[0]).round.results.map((item) => item.label), ['가', '나']);
  teacherAction(room, 'finish_round');
  const outcome = displayState(room).round.displayOutcome;
  assert.equal(outcome.title, '공동 1위');
  assert.deepEqual(outcome.winners.map((item) => item.label), ['가', '나']);
});

test('표심전에서 공동 1위 중 하나를 1위로 예측하면 정답으로 인정한다', () => {
  const { room, players } = classroom(['가온', '나래', '다온', '라온']);
  teacherAction(room, 'create_round', { mode: 'prediction', options: ['가', '나', '다'] });
  const [a, b, c] = optionIds(room);
  [0, 0, 1, 1].forEach((index, order) => vote(room, players[order], index));
  teacherAction(room, 'advance');
  studentAction(room, players[0], 'predict', { first: b, second: a, gap: 'close' });
  studentAction(room, players[1], 'predict', { first: c, second: a, gap: 'close' });
  teacherAction(room, 'advance');
  teacherAction(room, 'advance');
  teacherAction(room, 'advance');
  teacherAction(room, 'finish_round');
  // 1위 3점 + 2위 2점 + 표 차이 2점 + 모두 적중 2점 + 남은 토큰 2개
  assert.equal(room.currentRound.points[players[0].id], 11);
  // 2위 2점 + 표 차이 2점 + 남은 토큰 2개
  assert.equal(room.currentRound.points[players[1].id], 6);
});

test('정확히 N명의 정원은 정수로 맞춘다', () => {
  const options = __test.defaultOptions([{ label: 'A', capacity: 3.6 }, { label: 'B', capacity: '2' }, { label: 'C', capacity: 99 }], 'exact');
  assert.deepEqual(options.map((option) => option.capacity), [4, 2, 50]);
});

test('정보 연합전 팀 답안은 한 명이 제출하면 확정되어 덮어쓸 수 없다', () => {
  const { room, players } = classroom(['가온', '나래', '다온', '라온', '마루']);
  const [first, , , , teammate] = players;
  assert.equal(first.team, teammate.team);
  teacherAction(room, 'create_round', { mode: 'alliance', options: ['가', '나'] });
  teacherAction(room, 'advance');
  teacherAction(room, 'advance');
  const order = optionIds(room);
  studentAction(room, first, 'team_guess', { order, counts: { [order[0]]: 3, [order[1]]: 2 } });
  assert.throws(
    () => studentAction(room, teammate, 'team_guess', { order: [...order].reverse(), counts: {} }),
    (error) => error.status === 409 && /이미 팀 답안을 확정/.test(error.message)
  );
  assert.equal(studentView(room, teammate).round.teamGuess.submittedBy, first.name);
});

test('거짓 단서는 동점이거나 표가 없어도 실제 집계와 어긋난다', () => {
  const round = { options: [{ id: 'a', label: '가' }, { id: 'b', label: '나' }] };
  const empty = orderedResults(round, { a: 0, b: 0 });
  for (let index = 0; index < 20; index += 1) {
    const clue = falseClue(empty);
    assert.match(clue, /2표 이상이다/);
  }
  assert.equal(falseClue(orderedResults(round, { a: 3, b: 1 })), '가은(는) 현재 1위가 아니다.');
});

test('참이라고 안내하는 단서에는 공동 1위를 1위가 아니라고 하는 문장이 없다', () => {
  const { room, players } = classroom(['가온', '나래']);
  teacherAction(room, 'create_round', { mode: 'alliance', options: ['가', '나'] });
  vote(room, players[0], 0);
  vote(room, players[1], 1);
  teacherAction(room, 'advance');
  assert.ok(room.currentRound.clueDeck.every((clue) => !clue.includes('1위가 아니다')));
});

test('예전(v2) 방을 불러오면 참여자·집계·빠진 기록을 채운다', () => {
  const { room, players } = classroom();
  teacherAction(room, 'create_round', { mode: 'official', options: ['가', '나'] });
  players.forEach((player) => vote(room, player, 1));
  const legacy = structuredClone(room);
  legacy.version = 2;
  delete legacy.currentRound.participants;
  delete legacy.currentRound.tally;
  delete legacy.currentRound.clueDeck;
  legacy.currentRound.votes.first.p_gone = legacy.currentRound.options[0].id;
  legacy.currentRound.phase = 'finished';
  legacy.currentRound.phaseIndex = 2;

  assert.equal(migrateRoom(legacy), true);
  assert.equal(legacy.version, 3);
  assert.deepEqual(Object.keys(legacy.currentRound.participants).sort(), players.map((player) => player.id).sort());
  assert.deepEqual(Object.values(legacy.currentRound.tally.final), [0, 3]);
  assert.equal(legacy.history.length, 1);
  assert.equal(migrateRoom(legacy), false);
});

test('예전(v2) 라운드 도중에 들어와 아직 투표하지 않은 학생도 계속 참여한다', () => {
  const { room, players } = classroom();
  teacherAction(room, 'create_round', { mode: 'official', options: ['가', '나'] });
  const legacy = structuredClone(room);
  legacy.version = 2;
  delete legacy.currentRound.participants;
  delete legacy.currentRound.skills[players[2].id];
  migrateRoom(legacy);
  assert.equal(legacy.currentRound.participants[players[2].id], true);
  studentAction(legacy, legacy.players[players[2].id], 'vote', { optionId: legacy.currentRound.options[0].id });
});

test('브로드캐스트용 공용 계산을 써도 화면 상태는 똑같다', () => {
  const { room, players } = classroom();
  teacherAction(room, 'create_round', { mode: 'minority', options: ['가', '나'], minorityMinimum: 1 });
  players.forEach((player, index) => vote(room, player, index % 2));
  teacherAction(room, 'advance');
  const online = new Set([players[0].token]);
  const context = buildViewContext(room, online);
  const strip = (state) => ({ ...state, serverTime: 0 });
  for (const auth of [{ role: 'teacher', player: null }, { role: 'student', player: players[1] }]) {
    assert.deepEqual(strip(clientState(room, auth, online, 'https://x', context)), strip(clientState(room, auth, online, 'https://x')));
  }
  assert.deepEqual(strip(displayState(room, online, 'https://x', context)), strip(displayState(room, online, 'https://x')));
});
