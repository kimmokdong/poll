import * as crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

const MAX_HISTORY = 20;
const MAX_PLAYERS = 50;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GAME_MODES = new Set(['minority', 'exact', 'migration', 'alliance', 'mission']);
const ROLE_MODES = new Set(['minority', 'mission']);

const MODE_PHASES = {
  official: ['vote', 'reveal', 'finished'],
  show: ['vote', 'reveal', 'finished'],
  prediction: ['vote', 'predict', 'intel', 'final_predict', 'reveal', 'finished'],
  minority: ['vote', 'signal', 'revote', 'reveal', 'finished'],
  exact: ['vote', 'signal', 'revote', 'reveal', 'finished'],
  migration: ['vote', 'signal', 'revote', 'reveal', 'finished'],
  alliance: ['vote', 'clue', 'team_guess', 'reveal', 'finished'],
  mission: ['mission', 'vote', 'signal', 'revote', 'reveal', 'finished']
};

function id(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

function roomCode() {
  return Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
}

function cleanText(value, max = 50) {
  return String(value ?? '').trim().replace(/[<>]/g, '').slice(0, max);
}

function pinHash(pin, salt) {
  return crypto.createHash('sha256').update(`${salt}:${String(pin)}`).digest('hex');
}

function secureEqual(left, right) {
  const a = Buffer.from(left || '', 'hex');
  const b = Buffer.from(right || '', 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createRoom(input, code = roomCode()) {
  const className = cleanText(input.className, 30);
  const teacherName = cleanText(input.teacherName, 20) || '선생님';
  const pin = String(input.pin ?? '');
  if (!className) throw clientError('반 이름을 입력해 주세요.');
  if (!/^\d{4}$/.test(pin)) throw clientError('교사 PIN은 숫자 4자리여야 합니다.');
  const salt = crypto.randomBytes(16).toString('hex');
  const room = {
    version: 2,
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
  return room;
}

function joinRoom(room, input) {
  const name = cleanText(input.name, 18);
  if (!name) throw clientError('이름을 입력해 주세요.');
  const existing = Object.values(room.players).find((player) => player.token === input.deviceToken);
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
  return player;
}

function assignTeam(room) {
  const names = ['별빛팀', '구름팀', '새싹팀', '파도팀'];
  const counts = Object.values(room.players).reduce((acc, player) => {
    acc[player.team] = (acc[player.team] || 0) + 1;
    return acc;
  }, {});
  return names.sort((a, b) => (counts[a] || 0) - (counts[b] || 0))[0];
}

function authenticate(room, token) {
  if (token === room.teacherToken) return { role: 'teacher', player: null };
  const player = Object.values(room.players).find((item) => item.token === token);
  if (player) return { role: 'student', player };
  throw authError('입장 정보가 만료되었습니다. 다시 입장해 주세요.');
}

function defaultOptions(inputOptions, mode) {
  const palette = ['#e9542d', '#75ad94', '#e7b946', '#d68e34', '#2f6b59', '#c95736'];
  const options = (Array.isArray(inputOptions) ? inputOptions : [])
    .map((option, index) => ({
      id: id('o_'),
      label: cleanText(typeof option === 'string' ? option : option.label, 30),
      color: palette[index % palette.length],
      capacity: mode === 'exact' && Number.isFinite(Number(option.capacity))
        ? Math.max(1, Math.min(50, Number(option.capacity)))
        : null
    }))
    .filter((option) => option.label);
  if (options.length < 2 || options.length > 6) throw clientError('선택지는 2개에서 6개까지 만들 수 있습니다.');
  if (mode === 'exact' && !options.some((option) => option.capacity)) {
    options.forEach((option, index) => { option.capacity = 3 + index * 2; });
  }
  return options;
}

function createRound(room, input) {
  const mode = MODE_PHASES[input.mode] ? input.mode : 'official';
  const options = defaultOptions(input.options, mode);
  const playerIds = Object.keys(room.players);
  if (GAME_MODES.has(mode) && playerIds.length < 2) throw clientError('게임 모드는 학생이 2명 이상 입장한 뒤 시작할 수 있습니다.');
  if (mode === 'mission' && playerIds.length < 3) throw clientError('비밀 목표전은 학생이 3명 이상일 때 시작할 수 있습니다.');
  const round = {
    id: id('r_'),
    mode,
    title: cleanText(input.title, 60) || '오늘의 선택',
    options,
    phase: MODE_PHASES[mode][0],
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
      roles: Boolean(input.roles) && ROLE_MODES.has(mode),
      falseClue: Boolean(input.falseClue) && mode === 'alliance'
    },
    votes: { first: {}, final: {} },
    confirmations: {},
    predictions: {},
    movementPredictions: {},
    skills: {},
    clues: {},
    teamGuesses: {},
    missions: {},
    roles: {},
    signal: null,
    reveal: { step: 0, totalSteps: 0, order: [], tallyOrder: [] },
    points: {},
    scored: false
  };
  for (const playerId of playerIds) {
    round.skills[playerId] = { tokens: 2, used: [], logs: [], allIn: false };
  }
  if (round.config.roles) assignRoles(round, playerIds);
  if (mode === 'mission') assignMissions(round, playerIds);
  room.currentRound = round;
  startTimer(round);
  return round;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function assignRoles(round, playerIds) {
  const roleDeck = shuffled(playerIds).map((playerId, index) => {
    const roles = ['analyst', 'floater', 'citizen', 'citizen'];
    if (playerIds.length >= 8) roles.push('influencer');
    return [playerId, roles[index % roles.length]];
  });
  round.roles = Object.fromEntries(roleDeck);
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

function startTimer(round) {
  round.timerExpired = false;
  round.timerEnd = round.config.timerSeconds > 0 ? Date.now() + round.config.timerSeconds * 1000 : null;
}

function countVotes(room, stage = 'final') {
  const round = room.currentRound;
  if (!round) return {};
  const source = stage === 'first' ? round.votes.first : { ...round.votes.first, ...round.votes.final };
  const counts = Object.fromEntries(round.options.map((option) => [option.id, 0]));
  for (const [playerId, optionId] of Object.entries(source)) {
    if (!(optionId in counts)) continue;
    const influence = round.config.roles && round.roles[playerId] === 'influencer' ? 2 : 1;
    counts[optionId] += influence;
  }
  return counts;
}

function orderedResults(round, counts) {
  return round.options
    .map((option) => ({ ...option, count: counts[option.id] || 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'));
}

function qualitativeSignal(round, counts) {
  const values = round.options.map((option) => counts[option.id] || 0);
  const max = Math.max(...values);
  const min = Math.min(...values);
  return Object.fromEntries(round.options.map((option) => {
    const count = counts[option.id] || 0;
    const label = max === min ? '보통' : count === max ? '혼잡' : count === min ? '한산' : '보통';
    return [option.id, label];
  }));
}

function generateClues(room) {
  const round = room.currentRound;
  const counts = countVotes(room, 'first');
  const ranking = orderedResults(round, counts);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const trueClues = [];
  for (const option of round.options) {
    const value = counts[option.id] || 0;
    trueClues.push(`${option.label}은(는) ${Math.max(0, value - 1)}표 이상이다.`);
    trueClues.push(`${option.label}은(는) ${value + 1}표 미만이다.`);
    if (ranking[0]?.id !== option.id) trueClues.push(`${option.label}은(는) 현재 1위가 아니다.`);
  }
  if (ranking[0]) trueClues.push(`현재 1위는 ${Math.max(0, ranking[0].count - 1)}표 이상이다.`);
  trueClues.push(ranking[0]?.count > total / 2 ? '과반수를 넘은 선택지가 있다.' : '과반수를 넘은 선택지는 없다.');
  if (round.options.length >= 2) {
    const [a, b] = round.options;
    const diff = Math.abs((counts[a.id] || 0) - (counts[b.id] || 0));
    trueClues.push(`${a.label}과(와) ${b.label}의 차이는 ${diff <= 2 ? '2표 이하' : '3표 이상'}이다.`);
  }
  const deck = shuffled([...new Set(trueClues)]);
  const players = shuffled(Object.keys(room.players));
  players.forEach((playerId, index) => { round.clues[playerId] = [deck[index % deck.length]]; });
  if (round.config.roles) {
    players.filter((playerId) => round.roles[playerId] === 'analyst').forEach((playerId, index) => {
      round.clues[playerId].push(deck[(players.length + index) % deck.length]);
    });
  }
  if (round.config.falseClue && players.length) {
    const target = players[players.length - 1];
    const option = ranking[0];
    round.clues[target].push(`${option.label}은(는) 현재 1위가 아니다.`);
  }
}

function prepareReveal(room) {
  const round = room.currentRound;
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
  const round = room.currentRound;
  if (!round) throw clientError('진행 중인 투표가 없습니다.');
  const phases = MODE_PHASES[round.mode];
  if (round.phaseIndex >= phases.length - 1) return round;
  const leaving = round.phase;
  round.phaseIndex += 1;
  round.phase = phases[round.phaseIndex];

  if (leaving === 'vote' && ['minority', 'exact', 'migration', 'mission'].includes(round.mode)) {
    round.signal = qualitativeSignal(round, countVotes(room, 'first'));
    round.votes.final = { ...round.votes.first };
    round.confirmations = {};
    Object.keys(round.roles).filter((playerId) => round.roles[playerId] === 'influencer').forEach((playerId) => {
      round.confirmations[playerId] = true;
    });
    generateClues(room);
  }
  if (leaving === 'vote' && round.mode === 'alliance') generateClues(room);
  if (round.phase === 'reveal') {
    prepareReveal(room);
    if (round.config.revealStyle === 'instant') scoreRound(room);
  }
  if (round.phase === 'finished') scoreRound(room);
  startTimer(round);
  return round;
}

function roleCanRevote(round, playerId) {
  if (!round.config.roles) return true;
  return ['floater', 'citizen', 'analyst'].includes(round.roles[playerId]);
}

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

function gapBucket(first, second) {
  const gap = Math.abs((first?.count || 0) - (second?.count || 0));
  return gap <= 2 ? 'close' : gap <= 5 ? 'middle' : 'wide';
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
  if (round.phase === 'final_predict' && !current.initial) throw clientError('먼저 1차 예측을 제출해 주세요.');
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

function skillResult(room, player, payload) {
  const round = requireRound(room);
  if (round.phase !== 'intel' || round.mode !== 'prediction') throw clientError('지금은 정보 스킬을 쓸 수 없습니다.');
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
  const ranking = orderedResults(round, counts);
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
    text = `1위와 2위 차이는 ${Math.abs((ranking[0]?.count || 0) - (ranking[1]?.count || 0)) <= 2 ? '2표 이하' : '3표 이상'}다.`;
  } else if (skill === 'rank') {
    const option = round.options.find((item) => item.id === payload.optionId);
    if (!option) throw clientError('확인할 선택지를 골라 주세요.');
    text = `${option.label}은(는) 현재 상위 2개 ${ranking.slice(0, 2).some((item) => item.id === option.id) ? '안에 있다' : '안에 없다'}.`;
  } else if (skill === 'second') text = '최종 예측에서 선택을 한 번 수정할 수 있다.';
  else if (skill === 'split') text = '1위 후보를 두 개 고를 수 있다. 적중 점수는 절반이다.';
  else if (skill === 'insurance') text = '예상 1위가 실제 2위라면 보험 점수 1점을 받는다.';
  state.tokens -= 1;
  state.used.push(skill);
  state.logs.push({ skill, text });
}

function submitTeamGuess(room, player, payload) {
  const round = requireRound(room);
  if (round.mode !== 'alliance' || round.phase !== 'team_guess') throw clientError('지금은 팀 답을 제출할 수 없습니다.');
  const ids = round.options.map((option) => option.id);
  const order = Array.isArray(payload.order) ? payload.order.filter((item) => ids.includes(item)) : [];
  if (new Set(order).size !== ids.length) throw clientError('모든 선택지의 순위를 정해 주세요.');
  const counts = Object.fromEntries(ids.map((optionId) => [optionId, clampNumber(payload.counts?.[optionId], 0, 50, 0)]));
  round.teamGuesses[player.team] = { order, counts, submittedBy: player.name };
}

function revealNext(room) {
  const round = requireRound(room);
  if (round.phase !== 'reveal') throw clientError('지금은 결과 공개 단계가 아닙니다.');
  round.reveal.step = Math.min(round.reveal.totalSteps, round.reveal.step + 1);
  if (round.reveal.step >= round.reveal.totalSteps) scoreRound(room);
}

function scoreRound(room) {
  const round = room.currentRound;
  if (!round || round.scored) return;
  const counts = countVotes(room);
  const firstCounts = countVotes(room, 'first');
  const ranking = orderedResults(round, counts);
  const firstRanking = orderedResults(round, firstCounts);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const points = Object.fromEntries(Object.keys(room.players).map((playerId) => [playerId, 0]));

  if (round.mode === 'prediction') {
    for (const playerId of Object.keys(points)) {
      const skill = round.skills[playerId] || { tokens: 0, used: [] };
      const prediction = round.predictions[playerId]?.final || round.predictions[playerId]?.initial;
      if (!prediction) continue;
      let base = 0;
      const splitActive = skill.used.includes('split') && prediction.split?.length;
      if (splitActive ? prediction.split.includes(ranking[0]?.id) : prediction.first === ranking[0]?.id) base += splitActive ? 1.5 : 3;
      if (prediction.second === ranking[1]?.id) base += 2;
      if (prediction.gap === gapBucket(ranking[0], ranking[1])) base += 2;
      if (prediction.first === ranking[0]?.id && prediction.second === ranking[1]?.id && prediction.gap === gapBucket(ranking[0], ranking[1])) base += 2;
      if (skill.used.includes('insurance') && prediction.first === ranking[1]?.id) base += 1;
      points[playerId] += (skill.allIn ? base * 2 : base) + skill.tokens;
    }
  } else if (round.mode === 'minority') {
    const qualified = ranking.filter((option) => option.count >= round.config.minorityMinimum).sort((a, b) => a.count - b.count);
    const winnerId = qualified[0]?.id;
    for (const playerId of Object.keys(points)) if ((round.votes.final[playerId] || round.votes.first[playerId]) === winnerId) points[playerId] += 3;
  } else if (round.mode === 'exact') {
    const successful = new Set(round.options.filter((option) => option.capacity === counts[option.id]).map((option) => option.id));
    for (const playerId of Object.keys(points)) if (successful.has(round.votes.final[playerId] || round.votes.first[playerId])) points[playerId] += 3;
  } else if (round.mode === 'migration') {
    const switched = Object.keys(points).filter((playerId) => round.votes.first[playerId] && round.votes.final[playerId] && round.votes.first[playerId] !== round.votes.final[playerId]).length;
    const actualRange = switched === 0 ? 'none' : switched <= 3 ? 'few' : 'many';
    const winnerChanged = firstRanking[0]?.id !== ranking[0]?.id;
    const oldGap = Math.abs((firstRanking[0]?.count || 0) - (firstRanking[1]?.count || 0));
    const newGap = Math.abs((ranking[0]?.count || 0) - (ranking[1]?.count || 0));
    const trend = newGap === oldGap ? 'same' : newGap < oldGap ? 'narrower' : 'wider';
    for (const playerId of Object.keys(points)) {
      const guess = round.movementPredictions[playerId];
      if (!guess) continue;
      if (guess.switchRange === actualRange) points[playerId] += 2;
      if (guess.winnerChange === winnerChanged) points[playerId] += 2;
      if (guess.gapTrend === trend) points[playerId] += 2;
    }
  } else if (round.mode === 'alliance') {
    for (const [team, guess] of Object.entries(round.teamGuesses)) {
      let teamPoints = guess.order.reduce((sum, optionId, index) => sum + (ranking[index]?.id === optionId ? 1 : 0), 0);
      teamPoints += Object.entries(guess.counts).reduce((sum, [optionId, value]) => sum + (counts[optionId] === value ? 1 : 0), 0);
      if (guess.order.every((optionId, index) => ranking[index]?.id === optionId)) teamPoints += 3;
      Object.values(room.players).filter((player) => player.team === team).forEach((player) => { points[player.id] += teamPoints; });
    }
  } else if (round.mode === 'mission') {
    for (const playerId of Object.keys(points)) if (missionSucceeded(round.missions[playerId], ranking, counts, total)) points[playerId] += 4;
  }

  for (const [playerId, score] of Object.entries(points)) {
    if (room.players[playerId]) room.players[playerId].score += score;
  }
  round.points = points;
  round.scored = true;
}

function missionSucceeded(mission, ranking, counts, total) {
  if (!mission) return false;
  if (mission.type === 'chosen_first') return ranking[0]?.id === mission.optionId;
  if (mission.type === 'chosen_second') return ranking[1]?.id === mission.optionId;
  if (mission.type === 'close_gap') return Math.abs((ranking[0]?.count || 0) - (ranking[1]?.count || 0)) <= 2;
  if (mission.type === 'no_majority') return (ranking[0]?.count || 0) <= total / 2;
  if (mission.type === 'exact_count') return counts[mission.optionId] === mission.target;
  if (mission.type === 'all_minimum') return Object.values(counts).every((count) => count >= 2);
  return false;
}

function finishRound(room) {
  const round = requireRound(room);
  scoreRound(room);
  round.phaseIndex = MODE_PHASES[round.mode].length - 1;
  round.phase = 'finished';
  round.timerEnd = null;
  if (!room.history.some((item) => item.id === round.id)) {
    room.history.unshift({ id: round.id, title: round.title, mode: round.mode, endedAt: Date.now(), results: orderedResults(round, countVotes(room)) });
    room.history = room.history.slice(0, MAX_HISTORY);
  }
}

function missionText(round, mission) {
  if (!mission) return '';
  const option = round.options.find((item) => item.id === mission.optionId)?.label || '선택지';
  const texts = {
    chosen_first: `${option}을(를) 정확히 1위로 만들어라.`,
    chosen_second: `${option}을(를) 정확히 2위로 만들어라.`,
    close_gap: '1위와 2위의 차이를 2표 이내로 만들어라.',
    no_majority: '어떤 선택지도 과반수를 넘지 않게 하라.',
    exact_count: `${option}이(가) 정확히 ${mission.target}표를 얻도록 하라.`,
    all_minimum: '모든 선택지가 최소 2표 이상을 얻도록 하라.'
  };
  return texts[mission.type] || '';
}

function roleText(role) {
  return {
    influencer: { name: '영향가', description: '내 선택은 2표로 계산되지만 2차 이동은 할 수 없습니다.' },
    analyst: { name: '분석가', description: '표는 1표이고 비밀 단서를 하나 더 받습니다.' },
    floater: { name: '유동가', description: '표는 1표이고 중간 신호 뒤 자유롭게 이동할 수 있습니다.' },
    citizen: { name: '시민', description: '표는 1표이고 중간 신호 뒤 한 번 이동할 수 있습니다.' }
  }[role] || null;
}

function publicResults(room, role) {
  const round = room.currentRound;
  if (!round || !['reveal', 'finished'].includes(round.phase)) return null;
  const all = orderedResults(round, countVotes(room)).map((item, index) => ({ ...item, rank: index + 1 }));
  const revealComplete = round.phase === 'finished' || round.reveal.step >= round.reveal.totalSteps;
  if (role !== 'teacher' && round.config.resultPrivacy === 'hidden') return [];
  if (role !== 'teacher' && round.config.resultPrivacy === 'winner') {
    return revealComplete ? all.slice(0, 1).map((item) => ({ ...item, count: null })) : [];
  }
  if (round.phase === 'finished' || round.config.revealStyle === 'instant') return all;
  if (round.config.revealStyle === 'drumroll') {
    if (!round.reveal.step) return [];
    const partial = Object.fromEntries(round.options.map((option) => [option.id, 0]));
    for (const optionId of round.reveal.tallyOrder.slice(0, round.reveal.step)) partial[optionId] += 1;
    return orderedResults(round, partial).map((item, index) => ({ ...item, rank: index + 1 }));
  }
  const visible = new Set(round.reveal.order.slice(0, round.reveal.step));
  if (revealComplete) all.slice(0, 2).forEach((item) => visible.add(item.id));
  return all.filter((item) => visible.has(item.id));
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

function clientState(room, auth, onlineTokens = new Set(), joinUrl = null) {
  const round = room.currentRound;
  const teamScores = Object.values(room.players).reduce((acc, player) => {
    acc[player.team] = (acc[player.team] || 0) + player.score;
    return acc;
  }, {});
  const state = {
    serverTime: Date.now(),
    role: auth.role,
    room: { code: room.code, className: room.className, teacherName: room.teacherName, joinUrl },
    players: Object.values(room.players).map((player) => ({
      id: player.id,
      name: player.name,
      team: player.team,
      online: onlineTokens.has(player.token),
      score: auth.role === 'teacher' ? null : player.id === auth.player?.id ? player.score : null
    })),
    teamScores,
    history: auth.role === 'teacher' ? room.history.slice(0, 5) : [],
    me: auth.player ? { id: auth.player.id, name: auth.player.name, team: auth.player.team, score: auth.player.score } : null,
    round: null
  };
  if (!round) return state;
  const playerId = auth.player?.id;
  const myVote = playerId ? (round.votes.final[playerId] || round.votes.first[playerId] || null) : null;
  const totalPlayers = Object.keys(room.players).length;
  state.round = {
    id: round.id,
    mode: round.mode,
    title: round.title,
    options: round.options,
    phase: round.phase,
    phaseIndex: round.phaseIndex,
    phases: MODE_PHASES[round.mode],
    timerEnd: round.timerEnd,
    timerExpired: Boolean(round.timerExpired),
    config: round.config,
    submissions: submissionCounts(round),
    totalPlayers,
    signal: ['signal', 'revote', 'reveal', 'finished'].includes(round.phase) ? round.signal : null,
    results: publicResults(room, auth.role),
    revealStep: round.reveal.step,
    revealTotal: round.reveal.totalSteps,
    myVote,
    canRevote: playerId ? roleCanRevote(round, playerId) : false,
    prediction: playerId ? round.predictions[playerId] || null : null,
    movementPrediction: playerId ? round.movementPredictions[playerId] || null : null,
    skillState: playerId ? round.skills[playerId] || null : null,
    clues: playerId ? round.clues[playerId] || [] : [],
    mission: playerId ? missionText(round, round.missions[playerId]) : '',
    missionSuccess: playerId && round.scored ? missionSucceeded(round.missions[playerId], orderedResults(round, countVotes(room)), countVotes(room), Object.values(countVotes(room)).reduce((a, b) => a + b, 0)) : null,
    roleCard: playerId ? roleText(round.roles[playerId]) : null,
    myPoints: playerId && round.scored ? round.points[playerId] || 0 : null,
    teamGuess: playerId ? round.teamGuesses[auth.player.team] || null : null
  };
  return state;
}

function publicDisplayOutcome(room) {
  const round = room.currentRound;
  if (!round || round.phase !== 'finished' || round.config.resultPrivacy === 'hidden') return null;
  const counts = countVotes(room);
  const ranking = orderedResults(round, counts);
  const showCount = round.config.resultPrivacy === 'full';
  const winner = (item) => ({ id: item.id, label: item.label, color: item.color, count: showCount ? item.count : null });
  if (!Object.values(counts).some(Boolean)) return { kind: 'none', title: '아직 집계된 표가 없습니다', winners: [] };
  if (round.mode === 'minority') {
    const qualified = ranking
      .filter((option) => option.count >= round.config.minorityMinimum)
      .sort((a, b) => a.count - b.count || a.label.localeCompare(b.label, 'ko'));
    return qualified.length
      ? { kind: 'minority', title: '소수파 생존 성공', winners: [winner(qualified[0])] }
      : { kind: 'none', title: '최소 인원을 채운 문이 없습니다', winners: [] };
  }
  if (round.mode === 'exact') {
    const successful = ranking.filter((option) => option.capacity === counts[option.id]);
    return successful.length
      ? { kind: 'exact', title: '정원을 정확히 달성', winners: successful.map(winner) }
      : { kind: 'none', title: '정원을 정확히 채운 방이 없습니다', winners: [] };
  }
  return { kind: 'leader', title: '최종 집계 1위', winners: [winner(ranking[0])] };
}

function displayState(room, onlineTokens = new Set(), joinUrl = null) {
  const state = clientState(room, { role: 'display', player: null }, onlineTokens, joinUrl);
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

function teacherAction(room, action, payload) {
  if (action === 'create_round') return createRound(room, payload);
  if (action === 'advance') return advanceRound(room);
  if (action === 'reveal_next') revealNext(room);
  else if (action === 'finish_round') finishRound(room);
  else if (action === 'set_timer') {
    const round = requireRound(room);
    round.config.timerSeconds = clampNumber(payload.seconds, 0, 600, round.config.timerSeconds);
    startTimer(round);
  } else if (action === 'remove_player') {
    const playerId = cleanText(payload.playerId, 30);
    delete room.players[playerId];
  } else if (action === 'set_team') {
    const player = room.players[cleanText(payload.playerId, 30)];
    if (player) player.team = cleanText(payload.team, 12) || player.team;
  } else if (action === 'reset_scores') {
    Object.values(room.players).forEach((player) => { player.score = 0; });
  } else if (action !== 'create_round') throw clientError('알 수 없는 교사 명령입니다.');
}

function studentAction(room, player, action, payload) {
  if (action === 'vote') submitVote(room, player, payload);
  else if (action === 'predict') submitPrediction(room, player, payload);
  else if (action === 'movement_predict') submitMovementPrediction(room, player, payload);
  else if (action === 'use_skill') skillResult(room, player, payload);
  else if (action === 'team_guess') submitTeamGuess(room, player, payload);
  else throw clientError('지금 할 수 없는 행동입니다.');
}

function requireRound(room) {
  if (!room.currentRound) throw clientError('진행 중인 투표가 없습니다.');
  return room.currentRound;
}

function clientError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function authError(message) {
  return clientError(message, 401);
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
  MODE_PHASES
};

export {
  MODE_PHASES,
  advanceRound,
  authenticate,
  authError,
  clientError,
  clientState,
  createRoom,
  displayState,
  id,
  joinRoom,
  pinHash,
  roomCode,
  secureEqual,
  studentAction,
  teacherAction,
  __test
};
