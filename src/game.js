import {
  MODES,
  MODE_PHASES,
  assignRoles,
  lateJoinerClues,
  lateJoinersWait,
  missionSucceeded,
  missionText,
  qualitativeSignal,
  roleCanRevote,
  roleText
} from './modes.js';
import { gapBucket, orderedResults, positionRange, topGap } from './ranking.js';
import {
  authError,
  clampNumber,
  cleanText,
  clientError,
  id,
  pinHash,
  randomHex,
  roomCode,
  secureEqual,
  shuffled,
  sum
} from './util.js';

export const SCHEMA_VERSION = 3;
const MAX_HISTORY = 20;
const MAX_PLAYERS = 50;
const PALETTE = ['#e9542d', '#75ad94', '#e7b946', '#d68e34', '#2f6b59', '#c95736'];
const TEAM_NAMES = ['별빛팀', '구름팀', '새싹팀', '파도팀'];
const LATE_JOIN_MESSAGE = '이번 라운드는 이미 시작되어 다음 라운드부터 참여할 수 있어요.';

function freshSkills() {
  return { tokens: 2, used: [], logs: [], allIn: false };
}

// ---------- 방과 학생 ----------

function createRoom(input, code = roomCode()) {
  const className = cleanText(input.className, 30);
  const teacherName = cleanText(input.teacherName, 20) || '선생님';
  const pin = String(input.pin ?? '');
  if (!className) throw clientError('반 이름을 입력해 주세요.');
  if (!/^\d{4}$/.test(pin)) throw clientError('교사 PIN은 숫자 4자리여야 합니다.');
  const salt = randomHex(16);
  return {
    version: SCHEMA_VERSION,
    code,
    className,
    teacherName,
    pinSalt: salt,
    pinHash: pinHash(pin, salt),
    teacherToken: id('t_'),
    createdAt: Date.now(),
    players: {},
    currentRound: null,
    history: []
  };
}

function joinRoom(room, input) {
  const name = cleanText(input.name, 18);
  if (!name) throw clientError('이름을 입력해 주세요.');
  const existing = input.deviceToken
    ? Object.values(room.players).find((player) => player.token === input.deviceToken)
    : null;
  if (existing) {
    existing.name = name;
    existing.lastSeen = Date.now();
    return existing;
  }
  if (Object.keys(room.players).length >= MAX_PLAYERS) throw clientError('이 방은 정원 50명입니다.');
  const player = {
    id: id('p_'),
    token: id('s_'),
    name,
    team: cleanText(input.team, 12) || assignTeam(room),
    score: 0,
    joinedAt: Date.now(),
    lastSeen: Date.now()
  };
  room.players[player.id] = player;
  admitLateJoiner(room, player);
  return player;
}

function assignTeam(room) {
  const counts = Object.values(room.players).reduce((acc, player) => {
    acc[player.team] = (acc[player.team] || 0) + 1;
    return acc;
  }, {});
  return [...TEAM_NAMES].sort((a, b) => (counts[a] || 0) - (counts[b] || 0))[0];
}

function authenticate(room, token, playersByToken = null) {
  if (token && token === room.teacherToken) return { role: 'teacher', player: null };
  const player = token
    ? playersByToken?.get(token) || Object.values(room.players).find((item) => item.token === token)
    : null;
  if (player) return { role: 'student', player };
  throw authError('입장 정보가 만료되었습니다. 다시 입장해 주세요.');
}

// participants가 없는 예전 라운드는 모든 학생이 참여한 것으로 본다.
function isParticipant(round, playerId) {
  return !round.participants || Boolean(round.participants[playerId]);
}

function participantIds(room, round) {
  return Object.keys(room.players).filter((playerId) => isParticipant(round, playerId));
}

// 결과 공개 전에 들어온 학생은 바로 참여시킨다. 역할 카드·비밀 임무 라운드는 다음 라운드부터 참여한다.
function admitLateJoiner(room, player) {
  const round = room.currentRound;
  if (!round || ['reveal', 'finished'].includes(round.phase) || lateJoinersWait(round)) return;
  round.participants ||= {};
  round.participants[player.id] = true;
  round.lateJoiners ||= {};
  round.lateJoiners[player.id] = round.phase;
  round.skills[player.id] = freshSkills();
  const clues = lateJoinerClues(round);
  if (clues) round.clues[player.id] = clues;
}

// 내보낸 학생의 제출물은 모두 지운다. 결과 공개가 시작된 라운드는 집계(tally)가 고정되어 공개 중인 결과가 바뀌지 않는다.
function removePlayer(room, playerId) {
  if (!room.players[playerId]) return;
  delete room.players[playerId];
  const round = room.currentRound;
  if (!round) return;
  const maps = [
    round.votes?.first, round.votes?.final, round.confirmations, round.predictions, round.movementPredictions,
    round.skills, round.clues, round.missions, round.roles, round.participants, round.lateJoiners, round.points
  ];
  for (const map of maps) if (map) delete map[playerId];
  // 결과 공개 전이면 내보낸 학생이 확정한 팀 답안도 지워 팀이 다시 제출할 수 있게 한다.
  if (!round.tally) {
    for (const [team, guess] of Object.entries(round.teamGuesses || {})) {
      if (guess.submittedById === playerId) delete round.teamGuesses[team];
    }
  }
}

// 표심전 1차 예측 단계가 끝난 뒤 들어온 학생은 1차 예측 없이 최종 예측을 바로 낼 수 있다.
function joinedAfter(round, playerId, phase) {
  const joined = round.lateJoiners?.[playerId];
  if (!joined) return false;
  const phases = MODES[round.mode].phases;
  return phases.indexOf(joined) > phases.indexOf(phase);
}

// ---------- 라운드 ----------

function optionCapacity(option, mode) {
  if (mode !== 'exact' || !option || typeof option !== 'object') return null;
  if (option.capacity === null || option.capacity === undefined || option.capacity === '') return null;
  return clampNumber(option.capacity, 1, 50, null);
}

function defaultOptions(inputOptions, mode) {
  const options = (Array.isArray(inputOptions) ? inputOptions : [])
    .map((option, index) => ({
      id: id('o_'),
      label: cleanText(typeof option === 'string' ? option : option?.label, 30),
      color: PALETTE[index % PALETTE.length],
      capacity: optionCapacity(option, mode)
    }))
    .filter((option) => option.label);
  if (options.length < 2 || options.length > 6) throw clientError('선택지는 2개에서 6개까지 만들 수 있습니다.');
  if (mode === 'exact' && !options.some((option) => option.capacity)) {
    options.forEach((option, index) => { option.capacity = 3 + index * 2; });
  }
  return options;
}

function createRound(room, input) {
  const mode = MODES[input.mode] ? input.mode : 'official';
  const spec = MODES[mode];
  const options = defaultOptions(input.options, mode);
  const playerIds = Object.keys(room.players);
  if (playerIds.length < spec.minPlayers) throw clientError(spec.minPlayersMessage);
  const round = {
    id: id('r_'),
    mode,
    title: cleanText(input.title, 60) || '오늘의 선택',
    options,
    phase: spec.phases[0],
    phaseIndex: 0,
    startedAt: Date.now(),
    timerEnd: null,
    timerExpired: false,
    config: {
      timerSeconds: clampNumber(input.timerSeconds, 0, 600, 45),
      autoAdvance: Boolean(input.autoAdvance),
      anonymous: input.anonymous !== false,
      resultPrivacy: ['full', 'winner', 'hidden'].includes(input.resultPrivacy) ? input.resultPrivacy : 'full',
      revealStyle: ['instant', 'staircase', 'drumroll'].includes(input.revealStyle) ? input.revealStyle : 'staircase',
      minorityMinimum: clampNumber(input.minorityMinimum, 1, 20, 3),
      roles: Boolean(input.roles) && spec.roles,
      falseClue: Boolean(input.falseClue) && spec.falseClue
    },
    participants: Object.fromEntries(playerIds.map((playerId) => [playerId, true])),
    lateJoiners: {},
    votes: { first: {}, final: {} },
    confirmations: {},
    predictions: {},
    movementPredictions: {},
    skills: {},
    clues: {},
    clueDeck: [],
    teamGuesses: {},
    missions: {},
    roles: {},
    signal: null,
    reveal: { step: 0, totalSteps: 0, order: [], tallyOrder: [] },
    tally: null,
    points: {},
    scored: false
  };
  for (const playerId of playerIds) round.skills[playerId] = freshSkills();
  if (round.config.roles) assignRoles(round, playerIds);
  spec.onStart(round, playerIds);
  room.currentRound = round;
  startTimer(round);
  return round;
}

function startTimer(round) {
  round.timerExpired = false;
  round.timerEnd = round.config.timerSeconds > 0 ? Date.now() + round.config.timerSeconds * 1000 : null;
}

// ---------- 집계 ----------

function voteWeight(round, playerId) {
  return round.config.roles && round.roles[playerId] === 'influencer' ? 2 : 1;
}

function liveCounts(room, round, stage) {
  const source = stage === 'first' ? round.votes.first : { ...round.votes.first, ...round.votes.final };
  const counts = Object.fromEntries(round.options.map((option) => [option.id, 0]));
  for (const [playerId, optionId] of Object.entries(source)) {
    if (!(optionId in counts) || !room.players[playerId]) continue;
    counts[optionId] += voteWeight(round, playerId);
  }
  return counts;
}

function countVotes(room, stage = 'final') {
  const round = room.currentRound;
  if (!round) return {};
  if (round.tally) return { ...(stage === 'first' ? round.tally.first : round.tally.final) };
  return liveCounts(room, round, stage);
}

function switchedCount(room, round) {
  return Object.keys(room.players).filter((playerId) => {
    const first = round.votes.first[playerId];
    const final = round.votes.final[playerId];
    return first && final && first !== final;
  }).length;
}

// 결과 공개가 시작되면 투표함을 닫는다. 이후 학생을 내보내도 공개 중인 결과와 점수 기준은 바뀌지 않는다.
function freezeTally(room) {
  const round = room.currentRound;
  if (!round) return null;
  if (!round.tally) {
    round.tally = {
      first: liveCounts(room, round, 'first'),
      final: liveCounts(room, round, 'final'),
      switched: switchedCount(room, round),
      frozenAt: Date.now()
    };
  }
  return round.tally;
}

function scoringContext(room, round) {
  const counts = countVotes(room);
  const firstCounts = countVotes(room, 'first');
  return {
    room,
    round,
    counts,
    firstCounts,
    ranking: orderedResults(round, counts),
    total: sum(Object.values(counts)),
    playerIds: participantIds(room, round),
    switched: round.tally ? round.tally.switched : switchedCount(room, round)
  };
}

// ---------- 진행 ----------

function prepareReveal(room) {
  const round = room.currentRound;
  freezeTally(room);
  const counts = countVotes(room);
  round.reveal.order = orderedResults(round, counts).reverse().map((item) => item.id);
  round.reveal.tallyOrder = shuffled(Object.entries(counts).flatMap(([optionId, count]) => Array.from({ length: count }, () => optionId)));
  round.reveal.totalSteps = round.config.revealStyle === 'instant'
    ? 0
    : round.config.revealStyle === 'drumroll'
      ? Math.max(1, round.reveal.tallyOrder.length)
      : Math.max(1, round.options.length - 1);
  round.reveal.step = 0;
}

function advanceRound(room) {
  const round = requireRound(room);
  const spec = MODES[round.mode];
  if (round.phaseIndex >= spec.phases.length - 1) return round;
  const nextPhase = spec.phases[round.phaseIndex + 1];
  if (nextPhase === 'finished') return completeRound(room);
  const leaving = round.phase;
  round.phaseIndex += 1;
  round.phase = nextPhase;
  if (leaving === 'vote') spec.onLeaveVote(round, { first: countVotes(room, 'first'), playerIds: participantIds(room, round) });
  if (round.phase === 'reveal') {
    prepareReveal(room);
    if (round.config.revealStyle === 'instant') scoreRound(room);
  }
  startTimer(round);
  return round;
}

function revealNext(room) {
  const round = requireRound(room);
  if (round.phase !== 'reveal') throw clientError('지금은 결과 공개 단계가 아닙니다.');
  round.reveal.step = Math.min(round.reveal.totalSteps, round.reveal.step + 1);
  if (round.reveal.step >= round.reveal.totalSteps) scoreRound(room);
  return round;
}

function scoreRound(room) {
  const round = room.currentRound;
  if (!round || round.scored) return;
  freezeTally(room);
  const ctx = scoringContext(room, round);
  const points = Object.fromEntries(ctx.playerIds.map((playerId) => [playerId, 0]));
  for (const [playerId, value] of Object.entries(MODES[round.mode].score(ctx))) {
    if (playerId in points) points[playerId] += value;
  }
  for (const [playerId, value] of Object.entries(points)) room.players[playerId].score += value;
  round.points = points;
  round.scored = true;
}

// '다음 단계'와 '라운드 종료/결과 확정'은 모두 이 함수로 라운드를 끝낸다.
function completeRound(room) {
  const round = requireRound(room);
  freezeTally(room);
  scoreRound(room);
  round.phaseIndex = MODES[round.mode].phases.length - 1;
  round.phase = 'finished';
  round.timerEnd = null;
  round.timerExpired = false;
  recordHistory(room, round);
  return round;
}

function recordHistory(room, round) {
  if (room.history.some((item) => item.id === round.id)) return;
  room.history.unshift({
    id: round.id,
    title: round.title,
    mode: round.mode,
    endedAt: Date.now(),
    results: orderedResults(round, countVotes(room))
  });
  room.history = room.history.slice(0, MAX_HISTORY);
}

// ---------- 학생 제출 ----------

function submitVote(room, player, payload) {
  const round = requireRound(room);
  const optionId = cleanText(payload.optionId, 30);
  if (!round.options.some((option) => option.id === optionId)) throw clientError('선택지를 다시 골라 주세요.');
  if (round.phase === 'vote') round.votes.first[player.id] = optionId;
  else if (round.phase === 'revote') {
    if (!roleCanRevote(round, player.id)) throw clientError('이번 역할은 1차 선택을 유지해야 합니다.');
    round.votes.final[player.id] = optionId;
    round.confirmations[player.id] = true;
  } else throw clientError('지금은 투표할 수 없습니다.');
}

function submitPrediction(room, player, payload) {
  const round = requireRound(room);
  if (!['predict', 'final_predict'].includes(round.phase)) throw clientError('지금은 예측을 제출할 수 없습니다.');
  const ids = new Set(round.options.map((option) => option.id));
  const prediction = {
    first: ids.has(payload.first) ? payload.first : null,
    second: ids.has(payload.second) ? payload.second : null,
    gap: ['close', 'middle', 'wide'].includes(payload.gap) ? payload.gap : null,
    split: Array.isArray(payload.split) ? payload.split.filter((item) => ids.has(item)).slice(0, 2) : []
  };
  if (!prediction.first || !prediction.second || prediction.first === prediction.second || !prediction.gap) {
    throw clientError('1위, 2위, 표 차이를 모두 예측해 주세요.');
  }
  const current = round.predictions[player.id] || {};
  if (round.phase === 'final_predict' && !current.initial && !joinedAfter(round, player.id, 'predict')) {
    throw clientError('먼저 1차 예측을 제출해 주세요.');
  }
  if (round.phase === 'final_predict' && current.final) {
    const hasSecondChance = round.skills[player.id]?.used.includes('second');
    if (!hasSecondChance || current.secondChanceUsed) throw clientError('최종 예측은 이미 확정되었습니다.');
    current.secondChanceUsed = true;
  }
  round.predictions[player.id] = round.phase === 'predict'
    ? { ...current, initial: prediction }
    : { ...current, final: prediction };
}

function submitMovementPrediction(room, player, payload) {
  const round = requireRound(room);
  if (round.mode !== 'migration' || round.phase !== 'signal') throw clientError('지금은 이동을 예측할 수 없습니다.');
  round.movementPredictions[player.id] = {
    switchRange: ['none', 'few', 'many'].includes(payload.switchRange) ? payload.switchRange : 'few',
    winnerChange: Boolean(payload.winnerChange),
    gapTrend: ['narrower', 'same', 'wider'].includes(payload.gapTrend) ? payload.gapTrend : 'same'
  };
}

function useSkill(room, player, payload) {
  const round = requireRound(room);
  if (round.phase !== 'intel' || round.mode !== 'prediction') throw clientError('지금은 정보 스킬을 쓸 수 없습니다.');
  round.skills[player.id] ||= freshSkills();
  const state = round.skills[player.id];
  const skill = cleanText(payload.skill, 24);
  if (state.used.includes(skill)) throw clientError('이미 사용한 스킬입니다.');
  const infoSkills = new Set(['balance', 'range', 'radar', 'rank', 'second']);
  if (state.allIn) throw clientError('올인을 선택해 정보 스킬을 사용할 수 없습니다.');
  if (skill === 'allin') {
    if (state.used.length) throw clientError('아직 정보를 보지 않았을 때만 올인할 수 있습니다.');
    state.allIn = true;
    state.used.push(skill);
    state.logs.push({ skill, text: '올인 성공! 정보 없이 얻은 예측 점수가 2배가 됩니다.' });
    return;
  }
  if (![...infoSkills, 'split', 'insurance'].includes(skill)) throw clientError('알 수 없는 스킬입니다.');
  if (state.tokens < 1) throw clientError('정보 토큰을 모두 사용했습니다.');
  const counts = countVotes(room, 'first');
  let text = '';
  if (skill === 'balance') {
    const [a, b] = [payload.a, payload.b].map((optionId) => round.options.find((option) => option.id === optionId));
    if (!a || !b || a.id === b.id) throw clientError('서로 다른 두 선택지를 골라 주세요.');
    const av = counts[a.id] || 0;
    const bv = counts[b.id] || 0;
    text = av === bv ? `${a.label}과(와) ${b.label}은 같다.` : `${av > bv ? a.label : b.label} 쪽이 더 많다.`;
  } else if (skill === 'range') {
    const option = round.options.find((item) => item.id === payload.optionId);
    if (!option) throw clientError('확인할 선택지를 골라 주세요.');
    const value = counts[option.id] || 0;
    text = `${option.label}: ${value <= 4 ? '0~4표' : value <= 8 ? '5~8표' : '9표 이상'} 구간이다.`;
  } else if (skill === 'radar') {
    text = `1위와 2위 차이는 ${topGap(counts) <= 2 ? '2표 이하' : '3표 이상'}다.`;
  } else if (skill === 'rank') {
    const option = round.options.find((item) => item.id === payload.optionId);
    if (!option) throw clientError('확인할 선택지를 골라 주세요.');
    const inTopTwo = positionRange(counts, option.id).first <= 2;
    text = `${option.label}은(는) 현재 상위 2개 ${inTopTwo ? '안에 있다' : '안에 없다'}.`;
  } else if (skill === 'second') text = '최종 예측에서 선택을 한 번 수정할 수 있다.';
  else if (skill === 'split') text = '1위 후보를 두 개 고를 수 있다. 적중 점수는 절반이다.';
  else if (skill === 'insurance') text = '예상 1위가 실제 2위라면 보험 점수 1점을 받는다.';
  state.tokens -= 1;
  state.used.push(skill);
  state.logs.push({ skill, text });
}

// 팀 답안은 한 명이 제출하면 확정되어 다른 팀원이 덮어쓸 수 없다.
function submitTeamGuess(room, player, payload) {
  const round = requireRound(room);
  if (round.mode !== 'alliance' || round.phase !== 'team_guess') throw clientError('지금은 팀 답안을 제출할 수 없습니다.');
  const locked = round.teamGuesses[player.team];
  if (locked) throw clientError(`${locked.submittedBy} 학생이 이미 팀 답안을 확정했어요.`, 409);
  const ids = round.options.map((option) => option.id);
  const order = Array.isArray(payload.order) ? payload.order.filter((item) => ids.includes(item)) : [];
  if (new Set(order).size !== ids.length) throw clientError('모든 선택지의 순위를 정해 주세요.');
  const counts = Object.fromEntries(ids.map((optionId) => [optionId, clampNumber(payload.counts?.[optionId], 0, 50, 0)]));
  round.teamGuesses[player.team] = { order, counts, submittedBy: player.name, submittedById: player.id, lockedAt: Date.now() };
}

// ---------- 화면 상태 ----------

function publicResults(room, role, all = null) {
  const round = room.currentRound;
  if (!round || !['reveal', 'finished'].includes(round.phase)) return null;
  const ranking = all || orderedResults(round, countVotes(room));
  const revealComplete = round.phase === 'finished' || round.reveal.step >= round.reveal.totalSteps;
  if (role !== 'teacher' && round.config.resultPrivacy === 'hidden') return [];
  if (role !== 'teacher' && round.config.resultPrivacy === 'winner') {
    if (!revealComplete || !ranking.some((item) => item.count)) return [];
    return ranking.filter((item) => item.rank === 1).map((item) => ({ ...item, count: null }));
  }
  if (round.phase === 'finished' || round.config.revealStyle === 'instant') return ranking;
  if (round.config.revealStyle === 'drumroll') {
    if (!round.reveal.step) return [];
    const partial = Object.fromEntries(round.options.map((option) => [option.id, 0]));
    for (const optionId of round.reveal.tallyOrder.slice(0, round.reveal.step)) partial[optionId] += 1;
    return orderedResults(round, partial);
  }
  if (revealComplete) return ranking;
  // 낮은 순위부터 공개하는 도중에는 동점 여부를 숨긴다. 동점 표시는 남은 상위권의 결과를 미리 알려 줄 수 있다.
  const visible = new Set(round.reveal.order.slice(0, round.reveal.step));
  return ranking
    .map((item, index) => ({ ...item, rank: index + 1, tied: false }))
    .filter((item) => visible.has(item.id));
}

function submissionCounts(round) {
  if (!round) return {};
  return {
    vote: Object.keys(round.votes.first).length,
    revote: Object.keys(round.confirmations || {}).length,
    prediction: Object.values(round.predictions).filter((item) => item.initial).length,
    finalPrediction: Object.values(round.predictions).filter((item) => item.final).length,
    movementPrediction: Object.keys(round.movementPredictions).length,
    teamGuess: Object.keys(round.teamGuesses).length
  };
}

// 한 번의 브로드캐스트에서 모든 접속자가 함께 쓰는 계산(집계·순위·명단)을 한 번만 한다.
function buildViewContext(room, onlineTokens = new Set()) {
  const players = Object.values(room.players);
  const context = {
    playersByToken: new Map(players.map((player) => [player.token, player])),
    teamScores: players.reduce((acc, player) => {
      acc[player.team] = (acc[player.team] || 0) + player.score;
      return acc;
    }, {}),
    publicPlayers: players.map((player) => ({
      id: player.id,
      name: player.name,
      team: player.team,
      online: onlineTokens.has(player.token),
      score: null
    })),
    round: null
  };
  const round = room.currentRound;
  if (round) {
    const counts = countVotes(room);
    context.round = {
      counts,
      ranking: orderedResults(round, counts),
      total: sum(Object.values(counts)),
      participants: participantIds(room, round),
      submissions: submissionCounts(round),
      results: {}
    };
  }
  return context;
}

function resultsFor(room, role, view) {
  const key = role === 'teacher' ? 'teacher' : 'public';
  if (!(key in view.results)) view.results[key] = publicResults(room, role, view.ranking);
  return view.results[key];
}

function clientState(room, auth, onlineTokens = new Set(), joinUrl = null, context = null) {
  const view = context || buildViewContext(room, onlineTokens);
  const round = room.currentRound;
  const me = auth.player || null;
  const state = {
    serverTime: Date.now(),
    role: auth.role,
    room: { code: room.code, className: room.className, teacherName: room.teacherName, joinUrl },
    players: me
      ? view.publicPlayers.map((player) => (player.id === me.id ? { ...player, score: me.score } : player))
      : view.publicPlayers,
    teamScores: view.teamScores,
    history: auth.role === 'teacher' ? room.history.slice(0, 5) : [],
    me: me ? { id: me.id, name: me.name, team: me.team, score: me.score } : null,
    round: null
  };
  if (!round) return state;
  const tally = view.round;
  const playerId = me?.id;
  const participating = playerId ? isParticipant(round, playerId) : null;
  state.round = {
    id: round.id,
    mode: round.mode,
    title: round.title,
    options: round.options,
    phase: round.phase,
    phaseIndex: round.phaseIndex,
    phases: MODES[round.mode].phases,
    timerEnd: round.timerEnd,
    timerExpired: Boolean(round.timerExpired),
    config: round.config,
    submissions: tally.submissions,
    totalPlayers: tally.participants.length,
    waitingPlayers: Object.keys(room.players).length - tally.participants.length,
    signal: ['signal', 'revote', 'reveal', 'finished'].includes(round.phase) ? round.signal : null,
    results: resultsFor(room, auth.role, tally),
    revealStep: round.reveal.step,
    revealTotal: round.reveal.totalSteps,
    participating,
    myVote: playerId ? (round.votes.final[playerId] || round.votes.first[playerId] || null) : null,
    canRevote: playerId ? roleCanRevote(round, playerId) : false,
    prediction: playerId ? round.predictions[playerId] || null : null,
    movementPrediction: playerId ? round.movementPredictions[playerId] || null : null,
    skillState: playerId ? round.skills[playerId] || null : null,
    clues: playerId ? round.clues[playerId] || [] : [],
    mission: playerId ? missionText(round, round.missions[playerId]) : '',
    missionSuccess: playerId && round.scored && round.missions[playerId]
      ? missionSucceeded(round.missions[playerId], tally.counts, tally.total)
      : null,
    roleCard: playerId ? roleText(round.roles[playerId]) : null,
    myPoints: playerId && round.scored && participating ? round.points[playerId] || 0 : null,
    teamGuess: playerId ? round.teamGuesses[me.team] || null : null
  };
  return state;
}

function publicDisplayOutcome(room) {
  const round = room.currentRound;
  if (!round || round.phase !== 'finished' || round.config.resultPrivacy === 'hidden') return null;
  const ctx = scoringContext(room, round);
  if (!ctx.total) return { kind: 'none', title: '아직 집계된 표가 없습니다', winners: [] };
  const outcome = MODES[round.mode].outcome(ctx);
  const showCount = round.config.resultPrivacy === 'full';
  return {
    ...outcome,
    winners: outcome.winners.map((item) => ({ id: item.id, label: item.label, color: item.color, count: showCount ? item.count : null }))
  };
}

function displayState(room, onlineTokens = new Set(), joinUrl = null, context = null) {
  const state = clientState(room, { role: 'display', player: null }, onlineTokens, joinUrl, context);
  if (state.round) state.round.displayOutcome = publicDisplayOutcome(room);
  return {
    serverTime: state.serverTime,
    role: 'display',
    room: state.room,
    players: state.players.map((player) => ({ online: player.online })),
    teamScores: state.teamScores,
    round: state.round
  };
}

// ---------- 명령 ----------

function teacherAction(room, action, payload = {}) {
  if (action === 'create_round') return createRound(room, payload);
  if (action === 'advance') return advanceRound(room);
  if (action === 'reveal_next') return revealNext(room);
  if (action === 'finish_round') return completeRound(room);
  if (action === 'set_timer') {
    const round = requireRound(room);
    if (round.phase === 'finished') throw clientError('이미 끝난 라운드에는 시간을 설정할 수 없습니다.');
    round.config.timerSeconds = clampNumber(payload.seconds, 0, 600, round.config.timerSeconds);
    startTimer(round);
  } else if (action === 'remove_player') {
    removePlayer(room, cleanText(payload.playerId, 30));
  } else if (action === 'set_team') {
    const player = room.players[cleanText(payload.playerId, 30)];
    if (player) player.team = cleanText(payload.team, 12) || player.team;
  } else if (action === 'reset_scores') {
    Object.values(room.players).forEach((player) => { player.score = 0; });
  } else throw clientError('알 수 없는 교사 명령입니다.');
  return null;
}

const STUDENT_ACTIONS = {
  vote: submitVote,
  predict: submitPrediction,
  movement_predict: submitMovementPrediction,
  use_skill: useSkill,
  team_guess: submitTeamGuess
};

function studentAction(room, player, action, payload = {}) {
  const handler = STUDENT_ACTIONS[action];
  if (!handler) throw clientError('지금 할 수 없는 행동입니다.');
  const round = requireRound(room);
  if (!isParticipant(round, player.id)) throw clientError(LATE_JOIN_MESSAGE, 403);
  handler(room, player, payload || {});
}

function requireRound(room) {
  if (!room.currentRound) throw clientError('진행 중인 투표가 없습니다.');
  return room.currentRound;
}

// ---------- 저장 형식 ----------

function tallyFromRevealOrder(round) {
  const counts = Object.fromEntries(round.options.map((option) => [option.id, 0]));
  for (const optionId of round.reveal.tallyOrder) if (optionId in counts) counts[optionId] += 1;
  return counts;
}

function migrateRound(room, round) {
  round.votes = { first: round.votes?.first || {}, final: round.votes?.final || {} };
  for (const key of ['confirmations', 'predictions', 'movementPredictions', 'skills', 'clues', 'teamGuesses', 'missions', 'roles', 'points']) {
    if (!round[key] || typeof round[key] !== 'object') round[key] = {};
  }
  round.config ||= {};
  round.reveal ||= { step: 0, totalSteps: 0, order: [], tallyOrder: [] };
  round.reveal.tallyOrder ||= [];
  round.clueDeck ||= [];
  if (!round.participants) {
    // 예전 버전은 도중에 들어온 학생도 바로 참여시켰다. 역할·임무 라운드가 아니고 공개 전이면 지금 있는 학생 모두를 참여자로 본다.
    const everyone = !['reveal', 'finished'].includes(round.phase) && !lateJoinersWait(round);
    const involved = new Set([
      ...Object.keys(round.skills),
      ...Object.keys(round.votes.first),
      ...Object.keys(round.votes.final),
      ...Object.keys(round.predictions),
      ...Object.keys(round.movementPredictions),
      ...Object.keys(round.missions),
      ...Object.keys(round.roles)
    ]);
    const ids = Object.keys(room.players).filter((playerId) => everyone || involved.has(playerId));
    round.participants = Object.fromEntries(ids.map((playerId) => [playerId, true]));
    for (const playerId of ids) round.skills[playerId] ||= freshSkills();
  }
  round.lateJoiners ||= {};
  if (['reveal', 'finished'].includes(round.phase)) {
    if (!round.tally) {
      freezeTally(room);
      // 예전 버전에서 이미 공개를 시작했다면 공개 순서에 담긴 표를 그대로 최종 집계로 쓴다.
      if (round.reveal.tallyOrder.length) round.tally.final = tallyFromRevealOrder(round);
    }
  } else {
    for (const map of [round.votes.first, round.votes.final, round.confirmations]) {
      for (const playerId of Object.keys(map)) if (!room.players[playerId]) delete map[playerId];
    }
  }
  if (round.phase === 'finished') recordHistory(room, round);
}

// 저장된 방을 현재 형식으로 바꾼다. 바뀐 내용이 있으면 true를 돌려준다.
function migrateRoom(room) {
  if (!room || typeof room !== 'object' || room.version >= SCHEMA_VERSION) return false;
  if (!room.players || typeof room.players !== 'object') room.players = {};
  if (!Array.isArray(room.history)) room.history = [];
  if (room.currentRound) migrateRound(room, room.currentRound);
  room.version = SCHEMA_VERSION;
  return true;
}

const __test = {
  countVotes,
  orderedResults,
  qualitativeSignal,
  gapBucket,
  missionSucceeded,
  defaultOptions,
  prepareReveal,
  publicResults,
  publicDisplayOutcome,
  displayState,
  revealNext,
  scoreRound,
  freezeTally,
  MODE_PHASES
};

export {
  MODE_PHASES,
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
  teacherAction,
  __test
};
