const SESSION_KEY = 'maeum-signal-session-v1';

const MODES = {
  official: { level: '0', name: '정식 투표', icon: '✓', summary: '공정하고 조용한 의사결정', category: '공정 투표' },
  show: { level: '1', name: '결과 쇼', icon: '🎬', summary: '표는 그대로, 공개는 드라마틱하게', category: '공정 투표' },
  prediction: { level: '2', name: '표심전', icon: '🔮', summary: '반 전체의 마음을 읽는 예측전', category: '공정 투표' },
  migration: { level: '3', name: '표심 이동전', icon: '↝', summary: '토론 전후 표의 움직임 예측', category: '전략 투표' },
  minority: { level: '4', name: '소수파 생존', icon: '🚪', summary: '너무 적지도 많지도 않게', category: '완전 게임' },
  exact: { level: '4', name: '정확히 N명', icon: '🚀', summary: '정원을 정확히 맞추는 협력과 배신', category: '완전 게임' },
  alliance: { level: '4', name: '정보 연합전', icon: '🧩', summary: '서로 다른 단서를 합쳐 결과 추리', category: '완전 게임' },
  mission: { level: '4', name: '비밀 목표전', icon: '🎭', summary: '나만의 승리 조건을 숨겨라', category: '완전 게임' }
};

const PHASES = {
  mission: { name: '비밀 임무 확인', hint: '각자 받은 목표와 역할을 조용히 확인합니다.' },
  vote: { name: '비밀 투표', hint: '모두가 동시에 자신의 선택을 제출합니다.' },
  predict: { name: '1차 결과 예측', hint: '정보를 보기 전, 반 전체의 표심을 예상합니다.' },
  intel: { name: '정보 상점', hint: '토큰을 아낄지, 정보를 살지 결정합니다.' },
  final_predict: { name: '최종 예측', hint: '얻은 정보를 바탕으로 마지막 예측을 제출합니다.' },
  signal: { name: '중간 신호와 협상', hint: '정확한 표 수 없이 분위기만 보고 이야기합니다.' },
  revote: { name: '최종 선택', hint: '중간 정보를 반영해 선택을 유지하거나 바꿉니다.' },
  clue: { name: '비밀 단서 확인', hint: '팀원마다 다른 단서를 받았습니다. 교실에서 합쳐 보세요.' },
  team_guess: { name: '팀 추리 제출', hint: '팀이 합의한 최종 순위와 득표수를 제출합니다.' },
  reveal: { name: '결과 공개', hint: '선택 결과와 점수를 단계적으로 확인합니다.' },
  finished: { name: '라운드 완료', hint: '결과가 확정되었습니다.' }
};

const SKILLS = {
  balance: { icon: '⚖️', name: '저울', text: '두 선택지 중 어느 쪽이 더 많은지 확인' },
  range: { icon: '📡', name: '구간 스캔', text: '선택지의 득표 구간을 확인' },
  radar: { icon: '🎯', name: '박빙 레이더', text: '1·2위 차이가 2표 이내인지 확인' },
  rank: { icon: '🔭', name: '순위 탐지', text: '선택지가 상위 2개인지 확인' },
  second: { icon: '↩️', name: '세컨드 찬스', text: '최종 예측을 한 번 수정' },
  split: { icon: '🪄', name: '분산 예측', text: '1위 후보 2개, 적중 점수는 절반' },
  allin: { icon: '🔥', name: '올인', text: '정보 없이 예측 점수를 2배로' },
  insurance: { icon: '🛟', name: '보험', text: '예상 1위가 실제 2위면 부분 점수' }
};

let session = readSession();
let state = null;
let eventSource = null;
const linkedRoom = new URLSearchParams(location.search).get('room')?.trim().toUpperCase().slice(0, 5) || '';
let screen = linkedRoom ? 'student' : 'landing';
let draftMode = 'prediction';
let draftOptions = [
  { label: '운동장 놀이', capacity: 4 },
  { label: '보드게임', capacity: 6 },
  { label: '독서', capacity: 8 },
  { label: '학급 퀴즈', capacity: 10 }
];
let clockOffset = 0;
let busy = false;
let toastTimer = null;

const app = document.querySelector('#app');
const toastElement = document.querySelector('#toast');
const dialog = document.querySelector('#dialog');

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); }
  catch { return null; }
}

function saveSession(next) {
  session = next;
  if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  else localStorage.removeItem(SESSION_KEY);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function header(extra = '') {
  return `<header class="topbar">
    <button class="brand btn-reset" data-action="home" aria-label="마음신호 홈">
      <span class="brand-mark"><img src="/assets/app-icon.png" alt=""></span>
      <span>마음신호<small>교실 투표 방송국</small></span>
    </button>
    <div class="top-actions">${extra}</div>
  </header>`;
}

function landing() {
  return `<div class="shell">
    ${header('<span class="status-chip"><i class="online-dot"></i> 설치 없이 바로 시작</span>')}
    <section class="hero glass">
      <div>
        <p class="eyebrow">모두의 선택이 이야기가 되는 순간</p>
        <h1>손들기보다<br><span class="gradient-text">짜릿한 투표</span></h1>
        <p class="hero-copy">모두가 동시에 비밀 선택하고, 서로 다른 정보를 모아 추리하고, 결과를 한 단계씩 공개하세요. 공정한 학급 결정부터 치열한 심리전까지 한곳에서 이어집니다.</p>
        <div class="button-row">
          <button class="btn btn-primary" data-action="open-teacher-create">교사로 방 만들기 <span>→</span></button>
          <button class="btn btn-pink" data-action="open-student">학생으로 입장하기</button>
          <button class="btn btn-ghost" data-action="open-teacher-login">기존 방 관리</button>
          <a class="btn btn-ghost" href="/manual/" target="_blank" rel="noopener">📘 사용설명서</a>
        </div>
        <div class="mini-features">
          <div class="mini-feature"><span>🙈</span><strong>완전 비밀 선택</strong><small>누가 무엇을 골랐는지 공개하지 않아요.</small></div>
          <div class="mini-feature"><span>🧠</span><strong>8가지 게임</strong><small>정식 투표부터 비밀 목표전까지.</small></div>
          <div class="mini-feature"><span>🎁</span><strong>정보 아이템</strong><small>표를 건드리지 않고 추리만 도와요.</small></div>
          <div class="mini-feature"><span>📺</span><strong>결과 쇼</strong><small>전자칠판에서 한 표씩 극적으로.</small></div>
        </div>
      </div>
      <div class="hero-art" role="img" aria-label="친구들과 투표 게임을 즐기는 교실">
        <div class="float-card one">🔒 내 선택은 나만 알아요</div>
        <div class="float-card two">✨ 마지막 한 표의 반전</div>
      </div>
    </section>
  </div>`;
}

function authScreen(kind) {
  const configs = {
    'teacher-create': {
      eyebrow: '새 학급방', title: '30초면 준비 끝', description: '교사 PIN은 방을 다시 관리할 때 사용합니다.', form: `
        <form id="create-room-form" class="form-stack">
          <div class="field"><label for="class-name">반 이름</label><input class="input" id="class-name" name="className" maxlength="30" placeholder="예: 5학년 2반" required autofocus></div>
          <div class="field"><label for="teacher-name">선생님 이름</label><input class="input" id="teacher-name" name="teacherName" maxlength="20" placeholder="예: 김목동 선생님" required></div>
          <div class="field"><label for="teacher-pin">교사 PIN</label><input class="input" id="teacher-pin" name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="숫자 4자리" required><span class="helper">학생에게는 보이지 않습니다. 잊지 않도록 기억해 주세요.</span></div>
          <button class="btn btn-primary" type="submit">학급방 만들기</button>
        </form>`
    },
    'teacher-login': {
      eyebrow: '기존 학급방', title: '다시 만나 반가워요', description: '방 코드와 교사 PIN으로 관리 화면을 엽니다.', form: `
        <form id="teacher-login-form" class="form-stack">
          <div class="field"><label for="login-code">방 코드</label><input class="input" id="login-code" name="code" maxlength="5" autocomplete="off" placeholder="예: M7K2P" required autofocus></div>
          <div class="field"><label for="login-pin">교사 PIN</label><input class="input" id="login-pin" name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="숫자 4자리" required></div>
          <button class="btn btn-primary" type="submit">관리 화면 열기</button>
        </form>`
    },
    student: {
      eyebrow: '학생 입장', title: '마음신호 보내기', description: '처음 한 번만 입장하면 이 기기에 반 정보가 저장됩니다.', form: `
        <form id="student-join-form" class="form-stack">
          <div class="field"><label for="join-code">방 코드</label><input class="input" id="join-code" name="code" maxlength="5" autocomplete="off" placeholder="칠판의 5자리 코드" value="${esc(linkedRoom)}" required autofocus></div>
          <div class="field"><label for="student-name">내 이름</label><input class="input" id="student-name" name="name" maxlength="18" autocomplete="name" placeholder="예: 김하늘" required></div>
          <button class="btn btn-pink" type="submit">입장하기</button>
        </form>`
    }
  };
  const config = configs[kind];
  return `<div class="shell">
    ${header('<button class="btn btn-ghost btn-small" data-action="home">처음으로</button>')}
    <div class="auth-wrap"><section class="auth-card glass">
      <p class="eyebrow">${config.eyebrow}</p><h1>${config.title}</h1><p>${config.description}</p>${config.form}
    </section></div>
  </div>`;
}

function roomHeader() {
  const isTeacher = state.role === 'teacher';
  const me = state.me;
  return header(`
    <button class="room-chip" data-action="copy-code" title="방 코드 복사">방 <strong>${esc(state.room.code)}</strong> ⧉</button>
    ${me ? `<span class="score-chip">✨ ${me.score}점</span>` : ''}
    <span class="status-chip"><i class="online-dot"></i>${isTeacher ? '교사 화면' : esc(me?.name)}</span>
    <button class="btn btn-ghost btn-small" data-action="logout">나가기</button>`);
}

function teacherView() {
  const round = state.round;
  return `<div class="shell">${roomHeader()}${!round || round.phase === 'finished' ? teacherSetup(round) : teacherLive(round)}</div>`;
}

function teacherSetup(round) {
  const selected = MODES[draftMode];
  return `<div class="dashboard-grid">
    <section class="panel glass">
      ${round ? `<div class="panel-head"><div><span class="phase-badge">방금 끝난 게임</span><h2>${esc(round.title)}</h2><p>${MODES[round.mode].name} 결과가 저장되었습니다.</p></div><button class="btn btn-ghost btn-small" data-action="fullscreen">결과 크게 보기</button></div>${resultList(round.results, round.totalPlayers)}<div class="divider"></div>` : ''}
      <div class="panel-head"><div><h2>새 투표 게임</h2><p>목적에 맞는 강도를 고르세요. 실제 의사결정에는 0~3단계를 권장합니다.</p></div><span class="phase-badge">${selected.category}</span></div>
      <div class="mode-grid">${Object.entries(MODES).map(([key, mode]) => `
        <button class="mode-card ${key === draftMode ? 'selected' : ''}" data-action="select-mode" data-mode="${key}">
          <span class="mode-art" aria-hidden="true"></span><span class="mode-number">Lv.${mode.level}</span><strong>${mode.icon} ${mode.name}</strong><small>${mode.summary}</small>
        </button>`).join('')}</div>
      ${roundForm()}
    </section>
    <aside class="panel glass">${roomCodeCard()}${roster()}</aside>
  </div>`;
}

function roundForm() {
  const exact = draftMode === 'exact';
  const game = ['minority', 'mission'].includes(draftMode);
  const alliance = draftMode === 'alliance';
  return `<form id="round-form" class="round-form form-stack">
    <div class="two-col">
      <div class="field"><label for="round-title">질문 또는 게임 제목</label><input class="input" id="round-title" name="title" maxlength="60" placeholder="예: 금요일 마지막 활동은?" required></div>
      <div class="field"><label for="timer-seconds">단계별 제한 시간</label><select class="select" id="timer-seconds" name="timerSeconds"><option value="0">시간 제한 없음</option><option value="20">20초</option><option value="30">30초</option><option value="45" selected>45초</option><option value="60">1분</option><option value="120">2분</option></select></div>
    </div>
    <div class="field"><span class="field-label">선택지 ${exact ? '· 정원' : ''}</span><div class="option-editor" id="option-editor">
      ${draftOptions.map((option, index) => optionRow(option, index, exact)).join('')}
    </div><button class="btn btn-ghost btn-small" type="button" data-action="add-option" ${draftOptions.length >= 6 ? 'disabled' : ''}>＋ 선택지 추가</button></div>
    <div class="three-col">
      <div class="field"><label for="reveal-style">결과 공개</label><select class="select" id="reveal-style" name="revealStyle"><option value="staircase">낮은 순위부터</option><option value="drumroll">한 표씩 드럼롤</option><option value="instant">한 번에 공개</option></select></div>
      <div class="field"><label for="result-privacy">결과 표시</label><select class="select" id="result-privacy" name="resultPrivacy"><option value="full">득표수까지</option><option value="winner">1위만</option><option value="hidden">학생 화면 숨김</option></select></div>
      ${draftMode === 'minority' ? '<div class="field"><label for="minority-minimum">생존 최소 인원</label><input class="input" id="minority-minimum" name="minorityMinimum" type="number" min="1" max="20" value="3"></div>' : '<div></div>'}
    </div>
    <div class="two-col">
      <label class="switch-row"><span>시간 종료 후 자동 진행</span><span class="switch"><input type="checkbox" name="autoAdvance"><i></i></span></label>
      ${game ? '<label class="switch-row"><span>역할 카드 사용</span><span class="switch"><input type="checkbox" name="roles"><i></i></span></label>' : '<div></div>'}
      ${alliance ? '<label class="switch-row"><span>거짓 단서 1개 섞기</span><span class="switch"><input type="checkbox" name="falseClue"><i></i></span></label>' : ''}
    </div>
    <div class="button-row"><button class="btn btn-primary" type="submit">${MODES[draftMode].icon} ${MODES[draftMode].name} 시작하기</button><span class="helper">시작하면 학생 화면에 즉시 표시됩니다.</span></div>
  </form>`;
}

function optionRow(option, index, exact) {
  return `<div class="option-row ${exact ? 'with-capacity' : ''}">
    <input class="input" data-option-index="${index}" data-option-key="label" value="${esc(option.label)}" maxlength="30" aria-label="선택지 ${index + 1}" placeholder="선택지 ${index + 1}" required>
    ${exact ? `<input class="input" data-option-index="${index}" data-option-key="capacity" type="number" min="1" max="50" value="${option.capacity || index * 2 + 4}" aria-label="정원">` : ''}
    <button class="btn btn-ghost btn-icon" type="button" data-action="remove-option" data-index="${index}" aria-label="선택지 삭제" ${draftOptions.length <= 2 ? 'disabled' : ''}>×</button>
  </div>`;
}

function roomCodeCard() {
  const joinUrl = state.room.joinUrl || location.origin;
  return `<div class="big-code"><small>학생에게 알려줄 방 코드</small><strong>${esc(state.room.code)}</strong><span>${esc(joinUrl)}</span><div class="big-code-actions"><button class="btn btn-small join-link-button" data-action="copy-link">🔗 입장 링크 복사</button><button class="btn btn-small btn-tv" data-action="open-display">📺 교실 TV 열기</button></div></div>`;
}

function roster() {
  const online = state.players.filter((player) => player.online).length;
  return `<div class="section-title">참여 학생 <span class="helper">${online}/${state.players.length}명 접속</span></div>
    <div class="roster">${state.players.length ? state.players.map((player) => `
      <div class="person"><span class="avatar">${esc(player.name.slice(-2))}</span><span><strong>${esc(player.name)}</strong><small>${esc(player.team)}</small></span><span class="person-actions"><i class="presence ${player.online ? 'online' : ''}" title="${player.online ? '접속 중' : '오프라인'}"></i><button class="remove-person" data-action="remove-player" data-player-id="${player.id}" data-player-name="${esc(player.name)}" aria-label="${esc(player.name)} 학생 삭제">×</button></span></div>`).join('') : '<div class="empty">아직 입장한 학생이 없습니다.<br>방 코드를 알려 주세요.</div>'}</div>
    <div class="section-title title-with-action"><span>팀 점수</span>${state.players.length ? '<button class="btn btn-ghost btn-small" data-action="reset-scores">점수 초기화</button>' : ''}</div>${teamBoard()}`;
}

function teamBoard() {
  const entries = Object.entries(state.teamScores || {});
  return entries.length ? `<div class="team-board">${entries.map(([team, score]) => `<div class="team-score"><small>${esc(team)}</small><strong>${score}</strong></div>`).join('')}</div>` : '<div class="helper">학생이 입장하면 자동으로 팀이 배정됩니다.</div>';
}

function teacherLive(round) {
  const phase = PHASES[round.phase];
  const progress = phaseProgress(round);
  return `<div class="live-grid">
    <section class="stage glass">
      <div class="stage-head"><div><span class="phase-badge">${MODES[round.mode].icon} ${MODES[round.mode].name} · ${phase.name}</span><h1>${esc(round.title)}</h1><p>${phase.hint}</p></div>${timerHtml(round)}</div>
      ${phaseTrack(round)}
      <div class="metric-grid"><div class="metric"><small>참여 인원</small><strong>${round.totalPlayers}</strong>명</div><div class="metric"><small>현재 제출</small><strong>${progress.done}</strong>/${progress.total}</div><div class="metric"><small>진행 단계</small><strong>${round.phaseIndex + 1}</strong>/${round.phases.length}</div></div>
      <div class="progress" aria-label="제출률"><i style="width:${progress.total ? Math.round(progress.done / progress.total * 100) : 0}%"></i></div>
      ${teacherStageContent(round)}
      <div class="teacher-controls">${teacherControls(round)}</div>
    </section>
    <aside class="panel glass side-panel">${roomCodeCard()}${roster()}</aside>
  </div>`;
}

function phaseProgress(round) {
  const map = { vote: 'vote', revote: 'revote', predict: 'prediction', final_predict: 'finalPrediction', signal: round.mode === 'migration' ? 'movementPrediction' : null, team_guess: 'teamGuess' };
  const key = map[round.phase];
  const total = round.phase === 'team_guess' ? Math.max(1, Object.keys(state.teamScores).length) : round.totalPlayers;
  return { done: key ? round.submissions[key] || 0 : 0, total };
}

function timerHtml(round) {
  return `<div class="timer ${remainingSeconds(round) === 0 ? 'done' : ''}" data-timer>${formatTime(remainingSeconds(round))}</div>`;
}

function remainingSeconds(round) {
  if (round.timerExpired) return 0;
  if (!round.timerEnd) return null;
  return Math.max(0, Math.ceil((round.timerEnd - (Date.now() + clockOffset)) / 1000));
}

function formatTime(seconds) {
  if (seconds === null) return '∞';
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function phaseTrack(round) {
  return `<div class="phase-track" aria-label="게임 진행 단계">${round.phases.map((_, index) => `<i class="phase-dot ${index <= round.phaseIndex ? 'done' : ''}"></i>`).join('')}</div>`;
}

function teacherStageContent(round) {
  if (['reveal', 'finished'].includes(round.phase)) return resultList(round.results, round.totalPlayers);
  if (round.phase === 'signal' && round.signal) return `<div class="section-title">학생에게 공개된 혼잡도</div>${signalGrid(round)}`;
  if (round.phase === 'mission') return '<div class="private-card"><small>개인 화면에만 표시 중</small><strong>학생마다 서로 다른 비밀 임무와 역할을 확인하고 있습니다.</strong></div>';
  if (round.phase === 'intel') return '<div class="skill-hero" role="img" aria-label="정보 아이템 모음"></div><div class="empty">학생들이 정보 토큰을 쓸지, 아낄지 선택하고 있습니다.</div>';
  if (round.phase === 'clue') return `<div class="private-card"><small>정보 연합전</small><strong>학생마다 실제 투표와 모순되지 않는 단서를 받았습니다.</strong><p>${round.config.falseClue ? '단, 전체 단서 중 하나는 거짓입니다.' : '팀원과 단서를 말로 공유해 결과를 추리합니다.'}</p></div>`;
  return `<div class="empty"><div class="waiting-orbit" aria-hidden="true"></div>${PHASES[round.phase].hint}<br><strong>개별 선택 내용은 교사 화면에도 표시되지 않습니다.</strong></div>`;
}

function teacherControls(round) {
  if (round.phase === 'reveal') {
    const done = round.revealStep >= round.revealTotal;
    return `${done ? '<button class="btn btn-primary" data-action="finish-round">결과 확정</button>' : '<button class="btn btn-primary" data-action="reveal-next">다음 결과 공개</button>'}<button class="btn btn-tv" data-action="open-display">📺 교실 TV 열기</button>`;
  }
  return `<button class="btn btn-primary" data-action="advance">다음 단계 · ${esc(PHASES[round.phases[round.phaseIndex + 1]]?.name || '완료')}</button><button class="btn btn-tv" data-action="open-display">📺 교실 TV 열기</button><button class="btn btn-ghost" data-action="set-timer">⏱ 시간 설정</button><button class="btn btn-danger" data-action="finish-round">라운드 종료</button>`;
}

function studentView() {
  const round = state.round;
  return `<div class="shell student-shell">${roomHeader()}<section class="student-main glass">${round ? studentRound(round) : studentLobby()}</section></div>`;
}

function studentLobby() {
  return `<div class="student-title"><p class="eyebrow">${esc(state.room.className)}</p><h1>다음 마음신호를 기다려요</h1><p>${esc(state.room.teacherName)}이(가) 새 투표를 열면 이 화면에 바로 나타납니다.</p></div><div class="waiting-orbit" aria-hidden="true"></div><div class="section-title">우리 팀 점수</div>${teamBoard()}`;
}

function studentRound(round) {
  const phase = PHASES[round.phase];
  return `<div class="student-title"><span class="phase-badge">${MODES[round.mode].icon} ${MODES[round.mode].name} · ${phase.name}</span><h1>${esc(round.title)}</h1><p>${phase.hint}</p>${round.timerEnd ? timerHtml(round) : ''}</div>${studentPhase(round)}`;
}

function studentPhase(round) {
  if (round.phase === 'mission') return missionCard(round);
  if (['vote', 'revote'].includes(round.phase)) return votePanel(round);
  if (['predict', 'final_predict'].includes(round.phase)) return predictionPanel(round);
  if (round.phase === 'intel') return skillPanel(round);
  if (round.phase === 'signal') return signalPanel(round);
  if (round.phase === 'clue') return cluePanel(round);
  if (round.phase === 'team_guess') return teamGuessPanel(round);
  if (['reveal', 'finished'].includes(round.phase)) return studentResults(round);
  return '<div class="waiting-orbit"></div>';
}

function missionCard(round) {
  return `<div class="private-card"><small>나만의 비밀 임무 · 성공하면 4점</small><strong>${esc(round.mission)}</strong><p>임무는 공개하지 않아도 됩니다. 말과 행동으로 원하는 결과를 만들어 보세요.</p></div>${round.roleCard ? `<div class="private-card role-card"><small>이번 라운드 역할</small><strong>${esc(round.roleCard.name)}</strong><p>${esc(round.roleCard.description)}</p></div>` : ''}<div class="waiting-orbit"></div><p class="helper" style="text-align:center">확인했다는 표정도 비밀! 선생님이 투표를 열 때까지 기다려요.</p>`;
}

function votePanel(round) {
  if (round.phase === 'revote' && !round.canRevote) return `${roleNotice(round)}<div class="private-card"><small>선택 유지</small><strong>영향가의 표는 2표로 계산되는 대신 이번에는 이동할 수 없습니다.</strong></div>`;
  return `${roleNotice(round)}<div class="option-grid">${round.options.map((option) => `
    <button class="vote-option ${round.myVote === option.id ? 'selected' : ''}" style="--option-color:${option.color}" data-action="vote" data-option-id="${option.id}"><span class="check">✓</span><strong>${esc(option.label)}${option.capacity ? `<small style="display:block;opacity:.8;margin-top:4px">정원 ${option.capacity}명</small>` : ''}</strong></button>`).join('')}</div>${round.myVote ? `<div class="submitted">✓ 선택 완료 · 단계가 끝나기 전까지 바꿀 수 있어요</div>` : ''}`;
}

function roleNotice(round) {
  return round.roleCard ? `<div class="clue" style="margin-bottom:14px">${esc(round.roleCard.name)} · ${esc(round.roleCard.description)}</div>` : '';
}

function predictionPanel(round) {
  const existing = round.phase === 'final_predict' ? (round.prediction?.final || round.prediction?.initial) : round.prediction?.initial;
  const split = round.skillState?.used.includes('split');
  const finalLocked = round.phase === 'final_predict' && round.prediction?.final
    && (!round.skillState?.used.includes('second') || round.prediction.secondChanceUsed);
  const optionSelect = (name, selected, label) => `<div class="field"><label for="${name}">${label}</label><select class="select" id="${name}" name="${name}" required><option value="">선택하세요</option>${round.options.map((option) => `<option value="${option.id}" ${selected === option.id ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select></div>`;
  return `<form id="prediction-form" class="form-stack">
    <div class="two-col">${optionSelect('first', existing?.first, '예상 1위')}${optionSelect('second', existing?.second, '예상 2위')}</div>
    ${split ? `<div class="field"><label>분산 예측 1위 후보 2개</label><div class="two-col">${optionSelect('splitA', existing?.split?.[0], '후보 A')}${optionSelect('splitB', existing?.split?.[1], '후보 B')}</div></div>` : ''}
    <div class="field"><label for="gap">1위와 2위 표 차이</label><select class="select" id="gap" name="gap" required><option value="close" ${existing?.gap === 'close' ? 'selected' : ''}>1~2표 · 박빙</option><option value="middle" ${existing?.gap === 'middle' ? 'selected' : ''}>3~5표 · 보통</option><option value="wide" ${existing?.gap === 'wide' ? 'selected' : ''}>6표 이상 · 큰 차이</option></select></div>
    <button class="btn btn-primary" type="submit" ${finalLocked ? 'disabled' : ''}>${round.phase === 'final_predict' ? (round.prediction?.final ? '최종 예측 수정' : '최종 예측 확정') : '1차 예측 제출'}</button>
    ${existing ? `<div class="submitted">✓ 예측이 저장되었습니다. ${finalLocked ? '최종 확정되었어요.' : '단계가 끝나기 전까지 수정할 수 있어요.'}</div>` : ''}
  </form>`;
}

function skillPanel(round) {
  const skill = round.skillState;
  return `<div class="skill-hero" role="img" aria-label="빛나는 정보 아이템 8종"></div>
    <div class="token-row">남은 정보 토큰 ${Array.from({ length: skill.tokens }, () => '<i class="token"></i>').join('')} <strong>${skill.tokens}개</strong></div>
    <div class="skill-grid">${Object.entries(SKILLS).map(([key, item]) => {
      const disabled = skill.used.includes(key)
        || (key === 'allin' && skill.used.length > 0)
        || (key !== 'allin' && (skill.allIn || skill.tokens < 1));
      return `<button class="skill-card" data-action="use-skill" data-skill="${key}" ${disabled ? 'disabled' : ''}><span>${item.icon}</span><strong>${item.name}</strong><small>${item.text}</small></button>`;
    }).join('')}</div>
    ${skill.logs.length ? `<ul class="intel-log">${skill.logs.map((log) => `<li>${SKILLS[log.skill]?.icon || '✦'} ${esc(log.text)}</li>`).join('')}</ul>` : ''}`;
}

function signalGrid(round) {
  return `<div class="signal-grid">${round.options.map((option) => `<div class="signal-item"><strong>${esc(option.label)}</strong><span class="signal-label ${round.signal?.[option.id]}">${round.signal?.[option.id] || '비공개'}</span></div>`).join('')}</div>`;
}

function signalPanel(round) {
  const clues = round.clues?.length ? `<div class="section-title">내 추가 단서</div>${round.clues.map((clue) => `<div class="clue">${esc(clue)}</div>`).join('')}` : '';
  if (round.mode !== 'migration') return `${signalGrid(round)}${clues}<div class="waiting-orbit"></div><p class="helper" style="text-align:center">교실에서 자유롭게 협상하세요. 한산한 곳으로 모두 몰리면 판세가 바뀔 수 있어요.</p>`;
  const guess = round.movementPrediction;
  return `${signalGrid(round)}<div class="section-title">최종 표 이동 예측</div><form id="movement-form" class="form-stack">
    <div class="field"><label for="switchRange">선택을 바꿀 사람 수</label><select class="select" id="switchRange" name="switchRange"><option value="none">0명</option><option value="few" ${guess?.switchRange === 'few' ? 'selected' : ''}>1~3명</option><option value="many" ${guess?.switchRange === 'many' ? 'selected' : ''}>4명 이상</option></select></div>
    <div class="two-col"><div class="field"><label for="winnerChange">1위가 바뀔까?</label><select class="select" id="winnerChange" name="winnerChange"><option value="false">아니오</option><option value="true" ${guess?.winnerChange ? 'selected' : ''}>예</option></select></div><div class="field"><label for="gapTrend">1·2위 표 차이</label><select class="select" id="gapTrend" name="gapTrend"><option value="narrower">줄어든다</option><option value="same" ${guess?.gapTrend === 'same' ? 'selected' : ''}>비슷하다</option><option value="wider">커진다</option></select></div></div>
    <button class="btn btn-primary" type="submit">이동 예측 제출</button>${guess ? '<div class="submitted">✓ 이동 예측 저장 완료</div>' : ''}
  </form>${clues}`;
}

function cluePanel(round) {
  return `<div class="private-card"><small>${esc(state.me.team)}만의 추리 재료</small><strong>내 단서를 팀원에게 말로 알려 주세요.</strong><p>${round.config.falseClue ? '주의: 전체 단서 중 하나는 앱이 섞은 거짓 단서입니다.' : '모든 단서는 실제 결과와 모순되지 않습니다.'}</p></div><div class="clue-list">${round.clues.map((clue) => `<div class="clue">🔐 ${esc(clue)}</div>`).join('')}</div><div class="waiting-orbit"></div>`;
}

function teamGuessPanel(round) {
  const guess = round.teamGuess;
  return `<form id="team-guess-form" class="form-stack"><div class="private-card"><small>${esc(state.me.team)} 공동 답안</small><strong>한 명이 제출하면 팀 전체 답안이 바뀝니다.</strong><p>팀원과 충분히 합의한 뒤 제출하세요.</p></div>
    <div class="section-title">예상 순위</div>${round.options.map((_, index) => `<div class="field"><label for="rank-${index}">${index + 1}위</label><select class="select" id="rank-${index}" name="rank-${index}" required><option value="">선택하세요</option>${round.options.map((option) => `<option value="${option.id}" ${guess?.order?.[index] === option.id ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select></div>`).join('')}
    <div class="section-title">예상 득표수</div><div class="two-col">${round.options.map((option) => `<div class="field"><label for="count-${option.id}">${esc(option.label)}</label><input class="input" id="count-${option.id}" name="count-${option.id}" type="number" min="0" max="50" value="${guess?.counts?.[option.id] ?? 0}"></div>`).join('')}</div>
    <button class="btn btn-primary" type="submit">팀 답안 제출</button>${guess ? `<div class="submitted">✓ ${esc(guess.submittedBy)} 학생이 제출한 답안입니다.</div>` : ''}</form>`;
}

function resultList(results, totalPlayers) {
  if (!results?.length) return '<div class="empty"><div class="waiting-orbit"></div>다음 공개를 기다리고 있어요.</div>';
  const max = Math.max(1, ...results.map((item) => item.count || 0));
  return `<div class="result-list">${results.map((item, index) => `<div class="result-row" style="animation-delay:${index * .08}s"><span class="rank">${item.rank || index + 1}</span><span class="result-name">${esc(item.label)}</span><span class="bar"><i style="width:${item.count === null ? 100 : Math.max(4, item.count / max * 100)}%;--option-color:${item.color}"></i></span><span class="result-count">${item.count === null ? '승리' : `${item.count}표`}</span></div>`).join('')}</div>`;
}

function studentResults(round) {
  const mission = round.mode === 'mission' && round.missionSuccess !== null ? `<div class="points-pop">${round.missionSuccess ? '🎭 비밀 임무 성공!' : '🕵️ 비밀 임무는 다음 기회에'} · ${esc(round.mission)}</div>` : '';
  const points = round.myPoints !== null ? `<div class="points-pop">이번 라운드에서 <strong>+${round.myPoints}점</strong>을 얻었어요.</div>` : '';
  return `${resultList(round.results, round.totalPlayers)}${mission}${points}${round.phase === 'finished' ? '<div class="section-title" style="text-align:center">다음 게임을 기다려 주세요 ✨</div>' : '<div class="waiting-orbit"></div>'}`;
}

function render() {
  document.documentElement.classList.remove('presentation');
  if (!state) app.innerHTML = screen === 'landing' ? landing() : authScreen(screen);
  else app.innerHTML = state.role === 'teacher' ? teacherView() : studentView();
  updateTimer();
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '요청을 처리하지 못했습니다.');
  return payload;
}

async function action(name, payload = {}) {
  if (busy) return;
  busy = true;
  try {
    const next = await api(`/api/rooms/${session.code}/action`, { method: 'POST', body: JSON.stringify({ action: name, payload }) });
    receiveState(next);
  } catch (error) { showToast(error.message, true); }
  finally { busy = false; }
}

function receiveState(next) {
  state = next;
  clockOffset = next.serverTime - Date.now();
  render();
}

function connect() {
  eventSource?.close();
  if (!session) return;
  eventSource = new EventSource(`/api/rooms/${encodeURIComponent(session.code)}/events?token=${encodeURIComponent(session.token)}`);
  eventSource.addEventListener('state', (event) => receiveState(JSON.parse(event.data)));
  eventSource.addEventListener('error', () => showToast('연결을 다시 시도하고 있어요.'));
}

async function restore() {
  if (!session?.code || !session?.token) return render();
  try {
    const next = await api(`/api/rooms/${session.code}/state`);
    receiveState(next);
    connect();
  } catch {
    saveSession(null);
    state = null;
    render();
  }
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.className = `toast show ${error ? 'error' : ''}`;
  toastTimer = setTimeout(() => { toastElement.className = 'toast'; }, 2600);
}

function openDialog(html) {
  dialog.innerHTML = `<div class="dialog-inner">${html}</div>`;
  dialog.showModal();
}

function closeDialog() {
  if (dialog.open) dialog.close();
}

function skillDialog(skill) {
  const options = state.round.options.map((option) => `<option value="${option.id}">${esc(option.label)}</option>`).join('');
  let fields = '';
  if (skill === 'balance') fields = `<div class="two-col"><div class="field"><label for="skill-a">선택지 A</label><select class="select" id="skill-a" name="a">${options}</select></div><div class="field"><label for="skill-b">선택지 B</label><select class="select" id="skill-b" name="b">${options}</select></div></div>`;
  if (['range', 'rank'].includes(skill)) fields = `<div class="field"><label for="skill-option">확인할 선택지</label><select class="select" id="skill-option" name="optionId">${options}</select></div>`;
  openDialog(`<div class="dialog-head"><div><span class="phase-badge">정보 토큰 1개</span><h2>${SKILLS[skill].icon} ${SKILLS[skill].name}</h2></div><button class="btn btn-icon btn-ghost" data-action="close-dialog">×</button></div><p class="helper">${SKILLS[skill].text}</p><form id="skill-form" class="form-stack"><input type="hidden" name="skill" value="${skill}">${fields}<button class="btn btn-primary" type="submit">사용하기</button></form>`);
}

function captureOptions() {
  document.querySelectorAll('[data-option-index]').forEach((input) => {
    const index = Number(input.dataset.optionIndex);
    const key = input.dataset.optionKey;
    if (draftOptions[index]) draftOptions[index][key] = key === 'capacity' ? Number(input.value) : input.value;
  });
}

app.addEventListener('input', (event) => {
  const input = event.target.closest('[data-option-index]');
  if (!input) return;
  const index = Number(input.dataset.optionIndex);
  const key = input.dataset.optionKey;
  draftOptions[index][key] = key === 'capacity' ? Number(input.value) : input.value;
});

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const command = button.dataset.action;
  if (command === 'home') {
    if (state) return;
    screen = 'landing'; render();
  } else if (command === 'open-teacher-create') { screen = 'teacher-create'; render(); }
  else if (command === 'open-teacher-login') { screen = 'teacher-login'; render(); }
  else if (command === 'open-student') { screen = 'student'; render(); }
  else if (command === 'logout') {
    eventSource?.close(); saveSession(null); state = null; screen = 'landing'; render();
  } else if (command === 'copy-code') {
    await navigator.clipboard?.writeText(state.room.code); showToast(`방 코드 ${state.room.code}를 복사했어요.`);
  } else if (command === 'copy-link') {
    const base = state.room.joinUrl || location.origin;
    await navigator.clipboard?.writeText(`${base}/?room=${state.room.code}`);
    showToast('학생 입장 링크를 복사했어요.');
  } else if (command === 'open-display') {
    const displayWindow = window.open(`/display/${encodeURIComponent(state.room.code)}`, '_blank');
    if (displayWindow) displayWindow.opener = null;
    else showToast('팝업이 차단되었습니다. 브라우저에서 새 창 열기를 허용해 주세요.', true);
  } else if (command === 'select-mode') {
    captureOptions(); draftMode = button.dataset.mode; render();
  } else if (command === 'add-option') {
    captureOptions(); draftOptions.push({ label: '', capacity: draftOptions.length * 2 + 4 }); render();
  } else if (command === 'remove-option') {
    captureOptions(); draftOptions.splice(Number(button.dataset.index), 1); render();
  } else if (command === 'advance') await action('advance');
  else if (command === 'reveal-next') await action('reveal_next');
  else if (command === 'finish-round') await action('finish_round');
  else if (command === 'remove-player') {
    if (confirm(`${button.dataset.playerName} 학생의 입장 정보와 누적 점수를 삭제할까요?`)) await action('remove_player', { playerId: button.dataset.playerId });
  } else if (command === 'reset-scores') {
    if (confirm('모든 학생의 누적 점수를 0점으로 초기화할까요?')) await action('reset_scores');
  }
  else if (command === 'vote') await action('vote', { optionId: button.dataset.optionId });
  else if (command === 'use-skill') {
    const skill = button.dataset.skill;
    if (['balance', 'range', 'rank'].includes(skill)) skillDialog(skill);
    else await action('use_skill', { skill });
  } else if (command === 'fullscreen') {
    document.documentElement.classList.toggle('presentation');
    if (document.documentElement.classList.contains('presentation')) document.documentElement.requestFullscreen?.().catch(() => null);
    else if (document.fullscreenElement) document.exitFullscreen?.();
  } else if (command === 'set-timer') {
    openDialog(`<div class="dialog-head"><h2>⏱ 제한 시간 설정</h2><button class="btn btn-icon btn-ghost" data-action="close-dialog">×</button></div><form id="timer-form" class="form-stack"><div class="field"><label for="timer-value">현재 단계 제한 시간(초)</label><input class="input" id="timer-value" name="seconds" type="number" min="0" max="600" value="45"><span class="helper">0초는 시간 제한 없음입니다.</span></div><button class="btn btn-primary" type="submit">타이머 다시 시작</button></form>`);
  }
});

dialog.addEventListener('click', (event) => {
  if (event.target === dialog || event.target.closest('[data-action="close-dialog"]')) closeDialog();
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'create-room-form') {
      const result = await api('/api/rooms', { method: 'POST', body: JSON.stringify(data) });
      saveSession({ code: result.code, token: result.teacherToken, role: 'teacher' });
      receiveState(result.state); connect();
    } else if (form.id === 'teacher-login-form') {
      const code = String(data.code).trim().toUpperCase();
      const result = await api(`/api/rooms/${code}/teacher-login`, { method: 'POST', body: JSON.stringify({ pin: data.pin }) });
      saveSession({ code, token: result.token, role: 'teacher' }); receiveState(result.state); connect();
    } else if (form.id === 'student-join-form') {
      const code = String(data.code).trim().toUpperCase();
      const result = await api(`/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ name: data.name, deviceToken: session?.role === 'student' ? session.token : null }) });
      saveSession({ code, token: result.token, role: 'student', name: data.name }); history.replaceState({}, '', '/'); receiveState(result.state); connect();
    } else if (form.id === 'round-form') {
      captureOptions();
      await action('create_round', {
        mode: draftMode, title: data.title, options: draftOptions,
        timerSeconds: Number(data.timerSeconds), autoAdvance: data.autoAdvance === 'on',
        revealStyle: data.revealStyle, resultPrivacy: data.resultPrivacy,
        minorityMinimum: Number(data.minorityMinimum || 3), roles: data.roles === 'on', falseClue: data.falseClue === 'on'
      });
    } else if (form.id === 'prediction-form') {
      await action('predict', { first: data.first, second: data.second, gap: data.gap, split: [data.splitA, data.splitB].filter(Boolean) });
    } else if (form.id === 'movement-form') {
      await action('movement_predict', { switchRange: data.switchRange, winnerChange: data.winnerChange === 'true', gapTrend: data.gapTrend });
    } else if (form.id === 'team-guess-form') {
      const round = state.round;
      const order = round.options.map((_, index) => data[`rank-${index}`]);
      const counts = Object.fromEntries(round.options.map((option) => [option.id, Number(data[`count-${option.id}`])]));
      await action('team_guess', { order, counts });
    } else if (form.id === 'skill-form') {
      closeDialog(); await action('use_skill', data);
    } else if (form.id === 'timer-form') {
      closeDialog(); await action('set_timer', { seconds: Number(data.seconds) });
    }
  } catch (error) { showToast(error.message, true); }
});

function updateTimer() {
  const element = document.querySelector('[data-timer]');
  if (!element || !state?.round) return;
  const remaining = remainingSeconds(state.round);
  element.textContent = formatTime(remaining);
  element.classList.toggle('done', remaining === 0);
}

setInterval(updateTimer, 500);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) document.documentElement.classList.remove('presentation');
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => null));

restore();
