import { canBeAt, gapBucket, leaderIds, orderedResults, topCount, topGap } from './ranking.js';
import { pick, shuffled, sum } from './util.js';

// 모드마다 진행 단계, 시작 조건, 단계 전환 처리, 점수, 교실 TV 결과 판정을 한곳에 모은다.
// score·outcome이 받는 ctx: { room, round, counts, firstCounts, ranking, total, playerIds, switched }

const SIGNAL_PHASES = ['vote', 'signal', 'revote', 'reveal', 'finished'];
const GAME_MINIMUM = {
  minPlayers: 2,
  minPlayersMessage: '게임 모드는 학생이 2명 이상 입장한 뒤 시작할 수 있습니다.'
};

function finalVote(round, playerId) {
  return round.votes.final[playerId] || round.votes.first[playerId];
}

function sameSet(left, right) {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function award(playerIds, pointsFor) {
  return Object.fromEntries(playerIds.map((playerId) => [playerId, pointsFor(playerId)]));
}

// ---------- 중간 신호와 단서 ----------

export function qualitativeSignal(round, counts) {
  const values = round.options.map((option) => counts[option.id] || 0);
  const max = Math.max(...values);
  const min = Math.min(...values);
  return Object.fromEntries(round.options.map((option) => {
    const count = counts[option.id] || 0;
    const label = max === min ? '보통' : count === max ? '혼잡' : count === min ? '한산' : '보통';
    return [option.id, label];
  }));
}

function buildClueDeck(round, counts, ranking) {
  const total = sum(Object.values(counts));
  const clues = [];
  for (const option of ranking) {
    clues.push(`${option.label}은(는) ${Math.max(0, option.count - 1)}표 이상이다.`);
    clues.push(`${option.label}은(는) ${option.count + 1}표 미만이다.`);
    if (option.rank > 1) clues.push(`${option.label}은(는) 현재 1위가 아니다.`);
  }
  if (ranking[0]) clues.push(`현재 1위는 ${Math.max(0, ranking[0].count - 1)}표 이상이다.`);
  clues.push(ranking[0]?.count > total / 2 ? '과반수를 넘은 선택지가 있다.' : '과반수를 넘은 선택지는 없다.');
  const [a, b] = round.options;
  const diff = Math.abs((counts[a.id] || 0) - (counts[b.id] || 0));
  clues.push(`${a.label}과(와) ${b.label}의 차이는 ${diff <= 2 ? '2표 이하' : '3표 이상'}이다.`);
  return shuffled([...new Set(clues)]);
}

// 거짓 단서는 반드시 실제 집계와 어긋나야 한다. 단독 1위가 있을 때만 "1위가 아니다"를 쓰고,
// 동점이거나 표가 없으면 실제보다 2표 많은 하한을 말한다.
export function falseClue(ranking) {
  const leaders = ranking.filter((item) => item.rank === 1);
  if (leaders.length === 1 && leaders[0].count > 0) return `${leaders[0].label}은(는) 현재 1위가 아니다.`;
  const option = pick(ranking);
  return `${option.label}은(는) ${option.count + 2}표 이상이다.`;
}

export function dealClues(round, counts, playerIds) {
  const ranking = orderedResults(round, counts);
  const deck = buildClueDeck(round, counts, ranking);
  const players = shuffled(playerIds);
  round.clueDeck = deck;
  round.clues = {};
  players.forEach((playerId, index) => { round.clues[playerId] = [deck[index % deck.length]]; });
  if (round.config.roles) {
    players.filter((playerId) => round.roles[playerId] === 'analyst').forEach((playerId, index) => {
      round.clues[playerId].push(deck[(players.length + index) % deck.length]);
    });
  }
  if (round.config.falseClue && players.length) {
    round.clues[players[players.length - 1]].push(falseClue(ranking));
  }
}

// 단서를 나눈 뒤 들어온 학생에게는 참인 단서 하나를 준다.
export function lateJoinerClues(round) {
  return round.clueDeck?.length ? [pick(round.clueDeck)] : null;
}

function openSignal(round, { first, playerIds }) {
  round.signal = qualitativeSignal(round, first);
  round.votes.final = { ...round.votes.first };
  round.confirmations = {};
  for (const [playerId, role] of Object.entries(round.roles)) {
    if (role === 'influencer') round.confirmations[playerId] = true;
  }
  dealClues(round, first, playerIds);
}

// ---------- 역할과 비밀 임무 ----------

export function assignRoles(round, playerIds) {
  const roles = ['analyst', 'floater', 'citizen', 'citizen'];
  if (playerIds.length >= 8) roles.push('influencer');
  round.roles = Object.fromEntries(shuffled(playerIds).map((playerId, index) => [playerId, roles[index % roles.length]]));
}

export function roleCanRevote(round, playerId) {
  if (!round.config.roles) return true;
  return ['floater', 'citizen', 'analyst'].includes(round.roles[playerId]);
}

export function roleText(role) {
  return {
    influencer: { name: '영향가', description: '내 선택은 2표로 계산되지만 2차 이동은 할 수 없습니다.' },
    analyst: { name: '분석가', description: '표는 1표이고 비밀 단서를 하나 더 받습니다.' },
    floater: { name: '유동가', description: '표는 1표이고 중간 신호 뒤 자유롭게 이동할 수 있습니다.' },
    citizen: { name: '시민', description: '표는 1표이고 중간 신호 뒤 한 번 이동할 수 있습니다.' }
  }[role] || null;
}

function assignMissions(round, playerIds) {
  const optionIds = round.options.map((option) => option.id);
  const playerCount = playerIds.length;
  const missionTypes = ['chosen_first', 'chosen_second', 'close_gap', 'no_majority', 'exact_count'];
  if (playerCount >= optionIds.length * 2) missionTypes.push('all_minimum');
  shuffled(playerIds).forEach((playerId, index) => {
    const type = missionTypes[index % missionTypes.length];
    const optionId = optionIds[index % optionIds.length];
    const target = Math.max(2, Math.min(playerCount - 1, Math.round(playerCount / optionIds.length)));
    round.missions[playerId] = { type, optionId, target };
  });
}

export function missionText(round, mission) {
  if (!mission) return '';
  const option = round.options.find((item) => item.id === mission.optionId)?.label || '선택지';
  const texts = {
    chosen_first: `${option}을(를) 1위로 만들어라. (공동 1위도 성공)`,
    chosen_second: `${option}을(를) 2위로 만들어라. (동점으로 2위 자리에 걸쳐도 성공)`,
    close_gap: '1위와 2위의 차이를 2표 이내로 만들어라.',
    no_majority: '어떤 선택지도 과반수를 넘지 않게 하라.',
    exact_count: `${option}이(가) 정확히 ${mission.target}표를 얻도록 하라.`,
    all_minimum: '모든 선택지가 최소 2표 이상을 얻도록 하라.'
  };
  return texts[mission.type] || '';
}

export function missionSucceeded(mission, counts, total) {
  if (!mission) return false;
  if (mission.type === 'chosen_first') return total > 0 && canBeAt(counts, mission.optionId, 1);
  if (mission.type === 'chosen_second') return total > 0 && canBeAt(counts, mission.optionId, 2);
  if (mission.type === 'close_gap') return topGap(counts) <= 2;
  if (mission.type === 'no_majority') return topCount(counts) <= total / 2;
  if (mission.type === 'exact_count') return counts[mission.optionId] === mission.target;
  if (mission.type === 'all_minimum') return Object.values(counts).every((count) => count >= 2);
  return false;
}

// ---------- 점수와 결과 ----------

// 표가 하나도 없으면 모든 선택지가 0표 동점이라 순위를 맞힌 것으로 치지 않는다.
function scorePrediction({ round, counts, ranking, total, playerIds }) {
  const ranked = total > 0;
  const actualGap = gapBucket(ranking[0], ranking[1]);
  const points = {};
  for (const playerId of playerIds) {
    const prediction = round.predictions[playerId]?.final || round.predictions[playerId]?.initial;
    if (!prediction) continue;
    const skill = round.skills[playerId] || { tokens: 0, used: [], allIn: false };
    const firstHit = ranked && canBeAt(counts, prediction.first, 1);
    const secondHit = ranked && canBeAt(counts, prediction.second, 2);
    const gapHit = prediction.gap === actualGap;
    const splitActive = skill.used.includes('split') && prediction.split?.length;
    let base = 0;
    if (splitActive) {
      if (ranked && prediction.split.some((optionId) => canBeAt(counts, optionId, 1))) base += 1.5;
    } else if (firstHit) base += 3;
    if (secondHit) base += 2;
    if (gapHit) base += 2;
    if (firstHit && secondHit && gapHit) base += 2;
    if (ranked && skill.used.includes('insurance') && !firstHit && canBeAt(counts, prediction.first, 2)) base += 1;
    points[playerId] = (skill.allIn ? base * 2 : base) + skill.tokens;
  }
  return points;
}

export function minorityWinners({ round, ranking }) {
  const qualified = ranking.filter((option) => option.count >= round.config.minorityMinimum);
  if (!qualified.length) return [];
  const fewest = Math.min(...qualified.map((option) => option.count));
  return qualified.filter((option) => option.count === fewest);
}

function scoreMinority(ctx) {
  const winners = new Set(minorityWinners(ctx).map((option) => option.id));
  return award(ctx.playerIds, (playerId) => (winners.has(finalVote(ctx.round, playerId)) ? 3 : 0));
}

function minorityOutcome(ctx) {
  const winners = minorityWinners(ctx);
  if (!winners.length) return { kind: 'none', title: '최소 인원을 채운 문이 없습니다', winners: [] };
  return { kind: 'minority', title: winners.length > 1 ? '소수파 공동 생존' : '소수파 생존 성공', winners };
}

function exactWinners({ ranking, counts }) {
  return ranking.filter((option) => option.capacity && counts[option.id] === option.capacity);
}

function scoreExact(ctx) {
  const winners = new Set(exactWinners(ctx).map((option) => option.id));
  return award(ctx.playerIds, (playerId) => (winners.has(finalVote(ctx.round, playerId)) ? 3 : 0));
}

function exactOutcome(ctx) {
  const winners = exactWinners(ctx);
  return winners.length
    ? { kind: 'exact', title: '정원을 정확히 달성', winners }
    : { kind: 'none', title: '정원을 정확히 채운 방이 없습니다', winners: [] };
}

function scoreMigration({ round, counts, firstCounts, switched, playerIds }) {
  const actualRange = switched === 0 ? 'none' : switched <= 3 ? 'few' : 'many';
  const winnerChanged = !sameSet(leaderIds(firstCounts), leaderIds(counts));
  const oldGap = topGap(firstCounts);
  const newGap = topGap(counts);
  const trend = newGap === oldGap ? 'same' : newGap < oldGap ? 'narrower' : 'wider';
  return award(playerIds, (playerId) => {
    const guess = round.movementPredictions[playerId];
    if (!guess) return 0;
    return (guess.switchRange === actualRange ? 2 : 0)
      + (guess.winnerChange === winnerChanged ? 2 : 0)
      + (guess.gapTrend === trend ? 2 : 0);
  });
}

function scoreAlliance({ room, round, counts, total, playerIds }) {
  const points = {};
  for (const [team, guess] of Object.entries(round.teamGuesses)) {
    const placed = guess.order.map((optionId, index) => total > 0 && canBeAt(counts, optionId, index + 1));
    let teamPoints = placed.filter(Boolean).length;
    teamPoints += Object.entries(guess.counts).filter(([optionId, value]) => counts[optionId] === value).length;
    if (placed.length && placed.every(Boolean)) teamPoints += 3;
    for (const playerId of playerIds) {
      if (room.players[playerId]?.team === team) points[playerId] = (points[playerId] || 0) + teamPoints;
    }
  }
  return points;
}

function scoreMission({ round, counts, total, playerIds }) {
  return award(playerIds, (playerId) => (missionSucceeded(round.missions[playerId], counts, total) ? 4 : 0));
}

function leaderOutcome({ ranking }) {
  const leaders = ranking.filter((item) => item.rank === 1);
  return { kind: 'leader', title: leaders.length > 1 ? '공동 1위' : '최종 집계 1위', winners: leaders };
}

// ---------- 모드 정의 ----------

function defineMode(spec) {
  return {
    minPlayers: 0,
    minPlayersMessage: '',
    roles: false,
    missions: false,
    falseClue: false,
    onStart() {},
    onLeaveVote() {},
    score() { return {}; },
    outcome: leaderOutcome,
    ...spec
  };
}

export const MODES = {
  official: defineMode({ phases: ['vote', 'reveal', 'finished'] }),
  show: defineMode({ phases: ['vote', 'reveal', 'finished'] }),
  prediction: defineMode({
    phases: ['vote', 'predict', 'intel', 'final_predict', 'reveal', 'finished'],
    score: scorePrediction
  }),
  minority: defineMode({
    ...GAME_MINIMUM,
    phases: SIGNAL_PHASES,
    roles: true,
    onLeaveVote: openSignal,
    score: scoreMinority,
    outcome: minorityOutcome
  }),
  exact: defineMode({
    ...GAME_MINIMUM,
    phases: SIGNAL_PHASES,
    onLeaveVote: openSignal,
    score: scoreExact,
    outcome: exactOutcome
  }),
  migration: defineMode({
    ...GAME_MINIMUM,
    phases: SIGNAL_PHASES,
    onLeaveVote: openSignal,
    score: scoreMigration
  }),
  alliance: defineMode({
    ...GAME_MINIMUM,
    phases: ['vote', 'clue', 'team_guess', 'reveal', 'finished'],
    falseClue: true,
    onLeaveVote: (round, { first, playerIds }) => dealClues(round, first, playerIds),
    score: scoreAlliance
  }),
  mission: defineMode({
    minPlayers: 3,
    minPlayersMessage: '비밀 목표전은 학생이 3명 이상일 때 시작할 수 있습니다.',
    phases: ['mission', ...SIGNAL_PHASES],
    roles: true,
    missions: true,
    onStart: assignMissions,
    onLeaveVote: openSignal,
    score: scoreMission
  })
};

export const MODE_PHASES = Object.fromEntries(Object.entries(MODES).map(([key, mode]) => [key, mode.phases]));

// 역할 카드나 비밀 임무는 시작할 때 인원에 맞춰 나누므로, 도중에 들어온 학생은 다음 라운드부터 참여한다.
export function lateJoinersWait(round) {
  return Boolean(round.config.roles) || MODES[round.mode].missions;
}
