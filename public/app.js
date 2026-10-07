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

const MODE_GUIDES = {
  official: { goal: '원하는 선택지 하나를 비밀로 골라 반의 결정을 확인합니다.', score: '점수 경쟁 없음 · 실제 의사결정 결과만 확인' },
  show: { goal: '원하는 선택지 하나를 고르고, 결과를 방송처럼 극적으로 공개합니다.', score: '점수 경쟁 없음 · 실제 의사결정 결과만 확인' },
  prediction: { goal: '내 취향과 별개로 반 전체의 최종 1위·2위와 표 차이를 맞힙니다.', score: '1위 3점 · 2위 2점 · 표 차이 2점 · 완벽 예측 +2점 · 남은 토큰 각 1점' },
  migration: { goal: '토론 전후에 몇 명이 움직이고 판세가 어떻게 바뀔지 맞힙니다.', score: '이동 인원·1위 변경·표 차이 변화 적중 시 각각 2점 · 최대 6점' },
  minority: { goal: (round) => `최소 ${round.config.minorityMinimum}명 이상 모인 선택지 중 가장 적은 쪽에서 살아남습니다.`, score: '소수파 생존 선택에 들어가면 3점' },
  exact: { goal: '내가 고른 선택지의 최종 인원을 카드에 적힌 정원과 정확히 맞춥니다.', score: '내 선택지의 정원을 정확히 맞추면 3점' },
  alliance: { goal: '팀원들의 단서를 합쳐 모든 선택지의 최종 순위와 득표수를 맞힙니다.', score: '순위 한 칸·득표수 하나마다 1점 · 전체 순위 완벽 적중 +3점 · 팀 공동' },
  mission: { goal: '나만의 비밀 임무를 들키지 않고 최종 투표 결과로 달성합니다.', score: '비밀 임무를 성공하면 4점' }
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
let reconnectTimer = null;
let linkedRoom = new URLSearchParams(location.search).get('room')?.trim().toUpperCase().slice(0, 5) || '';
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
let heartbeatTimer = null;
let connectionStatus = session ? 'connecting' : 'idle';
const formDrafts = new Map();
const HEARTBEAT_MS = 20_000;

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

function usesTeams(mode = state?.round?.mode) {
  return mode === 'alliance';
}

function modeGuide(round) {
  const guide = MODE_GUIDES[round.mode];
  return { ...guide, goal: typeof guide.goal === 'function' ? guide.goal(round) : guide.goal };
}

function studentActionGuide(round) {
  const generic = {
    mission: '비밀 임무와 역할을 읽고 기억하세요. 이 단계에는 제출할 버튼이 없습니다.',
    vote: '내가 실제로 원하는 선택지 하나를 누르세요. 첫 투표는 한 번 누르면 확정됩니다.',
    predict: '정보를 보기 전에 최종 득표 1위·2위와 두 선택지의 표 차이를 예상해 제출하세요.',
    intel: '토큰을 남겨 점수를 받을지, 토큰 1개를 써서 정보나 능력을 얻을지 선택하세요.',
    final_predict: '1차 예측에 얻은 정보를 반영해 마지막 답을 확인하고 확정하세요.',
    clue: '내 단서를 팀원에게 말로 공유하세요. 이 단계에는 앱으로 제출할 답이 없습니다.',
    team_guess: '팀이 합의한 전체 순위와 각 득표수를 입력하세요. 한 명이 제출하면 팀 답안이 됩니다.',
    reveal: '결과가 공개되는 중입니다. 집계가 끝나면 내 점수 근거가 아래에 나타납니다.',
    finished: '아래에서 이번 라운드 점수의 항목별 내역과 누적 점수를 확인하세요.'
  };
  if (round.phase === 'signal') return {
    migration: '혼잡도를 보고 바꿀 인원 수·1위 변경·표 차이 변화를 먼저 예측한 뒤 토론하세요.',
    minority: '혼잡·한산 신호만 보고 어디가 생존할 소수파가 될지 협상하세요.',
    exact: '혼잡·한산 신호만 보고 각 선택지의 표시 정원에 맞도록 협상하세요.',
    mission: '내 임무를 숨긴 채 공개된 신호를 이용해 원하는 결과를 협상하세요.'
  }[round.mode] || PHASES.signal.hint;
  if (round.phase === 'revote') return {
    migration: '토론 뒤의 실제 최종 선택을 유지하거나 바꾸세요. 앞서 낸 이동 예측과는 별개입니다.',
    minority: '최소 인원을 넘으면서 가장 적을 것 같은 선택지로 최종 선택하세요.',
    exact: '표시된 정원과 정확히 같아질 것 같은 선택지로 최종 선택하세요.',
    mission: '비밀 임무를 이루기 위한 마지막 선택을 유지하거나 바꾸세요.'
  }[round.mode] || PHASES.revote.hint;
  return generic[round.phase] || PHASES[round.phase]?.hint || '';
}

function studentGuide(round) {
  const guide = modeGuide(round);
  return `<section class="student-guide" aria-label="현재 게임 도움말">
    <div><small>🏁 이번 게임 목표</small><strong>${esc(guide.goal)}</strong></div>
    <div class="student-guide-now"><small>👉 지금 할 일 · ${round.phaseIndex + 1}/${round.phases.length}단계</small><strong>${esc(studentActionGuide(round))}</strong></div>
    <div><small>⭐ 점수 얻는 법</small><strong>${esc(guide.score)}</strong></div>
  </section>`;
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
    ${header('<span class="status-chip"><i class="online-dot"></i> 교사·학생 시작 화면</span>')}
    <section class="hero glass">
      <div>
        <p class="eyebrow">교사 운영 · 학생 코드 입장</p>
        <h1>손들기보다<br><span class="gradient-text">짜릿한 투표</span></h1>
        <p class="hero-copy">교사는 학급방과 투표를 만들고, 학생은 초대 링크를 열거나 선생님에게 받은 5자리 학급 코드로 들어갑니다.</p>
        <div class="button-row">
          <button class="btn btn-primary" data-action="open-teacher-create">새 학급방 만들기 <span>→</span></button>
          <button class="btn btn-ghost" data-action="open-teacher-login">기존 방 관리</button>
          <a class="btn btn-ghost" href="/manual/" target="_blank" rel="noopener">📘 사용설명서</a>
        </div>
        <div class="teacher-invite-guide"><span>🎒</span><div><strong>학생인가요?</strong><small>선생님에게 받은 5자리 코드를 입력하세요.</small></div><button class="btn btn-pink btn-small student-entry-button" data-action="open-student-code">학급 코드로 들어가기</button></div>
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
      eyebrow: '선생님이 보낸 초대', title: '이름만 입력하면 준비 끝', description: `방 ${esc(linkedRoom)}에 초대되었습니다. 이 기기에는 입장 정보가 안전하게 저장됩니다.`, form: `
        <form id="student-join-form" class="form-stack">
          <input type="hidden" name="code" value="${esc(linkedRoom)}">
          <div class="invite-room-badge"><span>참여할 방</span><strong>${esc(linkedRoom)}</strong></div>
          <div class="field"><label for="student-name">내 이름</label><input class="input" id="student-name" name="name" maxlength="18" autocomplete="name" placeholder="예: 김하늘" required autofocus></div>
          <button class="btn btn-pink" type="submit">입장하기</button>
        </form>`
    },
    'student-code': {
      eyebrow: '학생 입장', title: '학급 코드로 들어가기', description: '선생님에게 받은 학급 코드와 내 이름을 입력하세요.', form: `
        <form id="student-join-form" class="form-stack">
          <div class="field"><label for="student-code">학급 코드</label><input class="input room-code-input" id="student-code" name="code" minlength="5" maxlength="5" pattern="[A-HJ-NP-Za-hj-np-z2-9]{5}" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="next" placeholder="예: M7K2P" aria-describedby="student-code-help" required autofocus><span class="helper" id="student-code-help">선생님 화면에 보이는 영문·숫자 5자리입니다.</span></div>
          <div class="field"><label for="student-code-name">내 이름</label><input class="input" id="student-code-name" name="name" maxlength="18" autocomplete="name" enterkeyhint="go" placeholder="예: 김하늘" required></div>
          <button class="btn btn-pink" type="submit">학급방 들어가기</button>
        </form>`
    }
  };
  const config = configs[kind];
  const headerAction = kind === 'student'
    ? '<span class="status-chip"><i class="online-dot"></i> 학생 참여 화면</span>'
    : '<button class="btn btn-ghost btn-small" data-action="home">처음으로</button>';
  return `<div class="shell">
    ${header(headerAction)}
    <div class="auth-wrap"><section class="auth-card glass">
      <p class="eyebrow">${config.eyebrow}</p><h1>${config.title}</h1><p>${config.description}</p>${config.form}
    </section></div>
  </div>`;
}

function roomHeader() {
  const isTeacher = state.role === 'teacher';
  const me = state.me;
  const connection = {
    connected: { label: isTeacher ? '교사 화면 · 연결됨' : `${me?.name || ''} · 연결됨`, className: 'connected' },
    reconnecting: { label: '재연결 중', className: 'reconnecting' },
    offline: { label: '인터넷 연결 없음', className: 'offline' },
    connecting: { label: '연결 중', className: 'reconnecting' },
    idle: { label: isTeacher ? '교사 화면' : me?.name || '학생 화면', className: '' }
  }[connectionStatus];
  return header(`
    <button class="room-chip" data-action="copy-code" title="방 코드 복사">방 <strong>${esc(state.room.code)}</strong> ⧉</button>
    ${me ? `<span class="score-chip">✨ ${me.score}점</span>` : ''}
    <span class="status-chip" data-connection-status><i class="online-dot ${connection.className}"></i><span data-connection-label>${esc(connection.label)}</span></span>
    <button class="btn btn-ghost btn-small" data-action="logout">나가기</button>`);
}

function teacherView() {
  const round = state.round;
  return `<div class="shell">${roomHeader()}${!round || round.phase === 'finished' ? teacherSetup(round) : teacherLive(round)}</div>`;
}

function teacherSetup(round) {
  const selected = MODES[draftMode];
  return `<div class="dashboard-grid">
    <section class="panel glass setup-panel">
      ${round ? `<div class="panel-head"><div><span class="phase-badge">방금 끝난 게임</span><h2>${esc(round.title)}</h2><p>${MODES[round.mode].name} 결과가 저장되었습니다.</p></div><button class="btn btn-ghost btn-small" data-action="fullscreen">결과 크게 보기</button></div>${resultList(round.results, round.totalPlayers)}<div class="divider"></div>` : ''}
      <div class="panel-head setup-head"><div><h2>새 투표 게임</h2><p><strong>${selected.icon} ${selected.name}</strong> · ${selected.summary}<span class="setup-guidance"> 실제 의사결정에는 0~3단계를 권장합니다.</span></p></div><span class="phase-badge">${selected.category}</span></div>
      <div class="mode-grid">${Object.entries(MODES).map(([key, mode]) => `
        <button class="mode-card ${key === draftMode ? 'selected' : ''}" data-action="select-mode" data-mode="${key}" aria-pressed="${key === draftMode}" aria-label="Lv.${mode.level} ${mode.name}. ${mode.summary}" title="${mode.name} · ${mode.summary}">
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
  return `<form id="round-form" class="round-form form-stack setup-form">
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
      <label class="switch-row"><span>시간 종료 시 자동 진행 <small class="helper">미제출자가 있어도 이동</small></span><span class="switch"><input type="checkbox" name="autoAdvance"><i></i></span></label>
      ${game ? '<label class="switch-row"><span>역할 카드 사용</span><span class="switch"><input type="checkbox" name="roles"><i></i></span></label>' : '<div></div>'}
      ${alliance ? '<label class="switch-row"><span>거짓 단서 1개 섞기</span><span class="switch"><input type="checkbox" name="falseClue"><i></i></span></label>' : ''}
    </div>
    <div class="button-row"><button class="btn btn-primary" type="submit">${MODES[draftMode].icon} ${MODES[draftMode].name} 시작하기</button><span class="helper">첫 비밀투표는 제출 후 확정됩니다. 제한시간 안에 모두 제출하면 즉시 다음 단계로 이동하며, 최종 선택처럼 수정 가능한 단계는 기다립니다.</span></div>
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
  const inviteUrl = `${joinUrl.replace(/\/$/, '')}/?room=${encodeURIComponent(state.room.code)}`;
  return `<div class="big-code"><small>학급방 코드 · 링크로 보내거나 5자리 코드를 알려 주세요</small><strong>${esc(state.room.code)}</strong><span>${esc(inviteUrl)}</span><div class="big-code-actions"><button class="btn btn-small join-link-button" data-action="copy-link">🔗 학생 참여 링크 복사</button><button class="btn btn-small btn-tv" data-action="open-display">📺 교실 TV 열기</button></div></div>`;
}

function roster() {
  const online = state.players.filter((player) => player.online).length;
  const roundInProgress = state.round && state.round.phase !== 'finished';
  const showTeams = usesTeams();
  return `<div class="section-title">참여 학생 <span class="helper">현재 ${online}명 접속 · ${state.players.length}명 등록</span></div>
    <div class="roster" data-scroll-key="roster">${state.players.length ? state.players.map((player) => `
      <div class="person"><span class="avatar">${esc(player.name.slice(-2))}</span><span><strong>${esc(player.name)}</strong><small>${showTeams ? `${esc(player.team)} · ` : ''}${player.online ? roundInProgress && !player.roundActive ? '접속 중 · 이번 라운드 관전' : '접속 중' : roundInProgress && !player.roundActive ? '현재 라운드 제외' : roundInProgress ? '재접속 대기' : '오프라인'}</small></span><span class="person-actions"><i class="presence ${player.online ? 'online' : ''}" title="${player.online ? roundInProgress && !player.roundActive ? '접속 중이지만 다음 라운드부터 참여' : '접속 중' : roundInProgress && !player.roundActive ? '현재 라운드 인원에서 제외됨' : roundInProgress ? '30초 동안 재접속 대기' : '오프라인'}"></i><button class="remove-person" data-action="remove-player" data-player-id="${player.id}" data-player-name="${esc(player.name)}" aria-label="${esc(player.name)} 학생 삭제">×</button></span></div>`).join('') : '<div class="empty">아직 입장한 학생이 없습니다.<br>참여 링크를 보내거나 학급 코드를 알려 주세요.</div>'}</div>
    ${showTeams ? `<div class="section-title title-with-action"><span>정보 연합전 팀 누적 점수</span>${state.players.length ? '<button class="btn btn-ghost btn-small" data-action="reset-scores">점수 초기화</button>' : ''}</div>${teamBoard()}` : ''}`;
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
      <div class="metric-grid"><div class="metric"><small>현재 라운드 참여</small><strong>${round.totalPlayers}</strong>명</div>${progress.tracked ? `<div class="metric"><small>현재 제출</small><strong>${progress.done}</strong>/${progress.total}</div>` : '<div class="metric"><small>단계 상태</small><strong>진행 중</strong></div>'}<div class="metric"><small>진행 단계</small><strong>${round.phaseIndex + 1}</strong>/${round.phases.length}</div></div>
      ${progress.tracked ? `<div class="progress" aria-label="제출률"><i style="width:${progress.total ? Math.round(progress.done / progress.total * 100) : 0}%"></i></div>` : ''}
      ${teacherStageContent(round)}
      <div class="teacher-controls">${teacherControls(round)}</div>
    </section>
    <aside class="panel glass side-panel">${roomCodeCard()}${roster()}</aside>
  </div>`;
}

function phaseProgress(round) {
  const map = { vote: 'vote', revote: 'revote', predict: 'prediction', final_predict: 'finalPrediction', signal: round.mode === 'migration' ? 'movementPrediction' : null, team_guess: 'teamGuess' };
  const key = map[round.phase];
  const total = round.phase === 'team_guess' ? round.totalTeams : round.totalPlayers;
  return { done: key ? round.submissions[key] || 0 : 0, total, tracked: Boolean(key) };
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
  return `<div class="student-title"><p class="eyebrow">${esc(state.room.className)}</p><h1>다음 마음신호를 기다려요</h1><p>${esc(state.room.teacherName)}이(가) 새 투표를 열면 이 화면에 바로 나타납니다.<br>내 누적 점수는 위쪽의 ✨ 표시에서 확인할 수 있어요.</p></div><div class="waiting-orbit" aria-hidden="true"></div>`;
}

function studentRound(round) {
  const phase = PHASES[round.phase];
  return `<div class="student-title"><span class="phase-badge">${MODES[round.mode].icon} ${MODES[round.mode].name} · ${phase.name}</span><h1>${esc(round.title)}</h1><p>${phase.hint}</p>${round.timerEnd ? timerHtml(round) : ''}</div>${phaseTrack(round)}${studentGuide(round)}${studentPhase(round)}`;
}

function studentPhase(round) {
  if (round.participating === false) return '<div class="private-card"><small>이번 라운드 관전 중</small><strong>게임이 시작된 뒤 연결되어 이번에는 결과를 함께 지켜봅니다.</strong><p>다음 라운드가 시작되면 자동으로 참여 인원에 포함됩니다.</p></div>';
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
  const locked = round.phase === 'vote' && Boolean(round.myVote);
  const lockNotice = round.phase === 'vote' && !round.myVote ? '<p class="vote-lock-note">🔒 첫 비밀투표는 한 번 누르면 확정됩니다. 선택지를 확인한 뒤 눌러 주세요.</p>' : '';
  return `${roleNotice(round)}${lockNotice}<div class="option-grid">${round.options.map((option) => `
    <button class="vote-option ${round.myVote === option.id ? 'selected' : ''}" style="--option-color:${option.color}" data-action="vote" data-option-id="${option.id}" ${locked ? 'disabled' : ''}><span class="check">✓</span><strong>${esc(option.label)}${option.capacity ? `<small style="display:block;opacity:.8;margin-top:4px">정원 ${option.capacity}명</small>` : ''}</strong></button>`).join('')}</div>${round.myVote ? `<div class="submitted">✓ ${locked ? `첫 선택 확정${round.timerEnd ? ' · 모두 제출하면 바로 다음 단계로 이동해요' : ''}` : '최종 선택 저장 · 단계가 끝나기 전까지 바꿀 수 있어요'}</div>` : ''}`;
}

function roleNotice(round) {
  return round.roleCard ? `<div class="clue" style="margin-bottom:14px">${esc(round.roleCard.name)} · ${esc(round.roleCard.description)}</div>` : '';
}

function predictionPanel(round) {
  const existing = round.phase === 'final_predict' ? (round.prediction?.final || round.prediction?.initial) : round.prediction?.initial;
  const split = round.skillState?.used.includes('split');
  const finalLocked = round.phase === 'final_predict' && round.prediction?.final
    && (!round.skillState?.used.includes('second') || round.prediction.secondChanceUsed);
  const status = round.phase === 'final_predict'
    ? round.prediction?.final
      ? `✓ 최종 예측이 저장되었습니다. ${finalLocked ? '이제 확정되었어요.' : '세컨드 찬스로 한 번 수정할 수 있어요.'}`
      : round.prediction?.initial ? '↩ 1차 예측을 불러왔습니다. 확인한 뒤 최종 예측을 확정해 주세요.' : ''
    : existing ? '✓ 1차 예측이 저장되었습니다. 단계가 끝나기 전까지 수정할 수 있어요.' : '';
  const optionSelect = (name, selected, label) => `<div class="field"><label for="${name}">${label}</label><select class="select" id="${name}" name="${name}" required><option value="">선택하세요</option>${round.options.map((option) => `<option value="${option.id}" ${selected === option.id ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select></div>`;
  return `<form id="prediction-form" class="form-stack">
    <div class="two-col">${optionSelect('first', existing?.first, '예상 1위')}${optionSelect('second', existing?.second, '예상 2위')}</div>
    ${split ? `<div class="field"><label>분산 예측 1위 후보 2개</label><div class="two-col">${optionSelect('splitA', existing?.split?.[0], '후보 A')}${optionSelect('splitB', existing?.split?.[1], '후보 B')}</div></div>` : ''}
    <div class="field"><label for="gap">1위와 2위 표 차이</label><select class="select" id="gap" name="gap" required><option value="close" ${existing?.gap === 'close' ? 'selected' : ''}>1~2표 · 박빙</option><option value="middle" ${existing?.gap === 'middle' ? 'selected' : ''}>3~5표 · 보통</option><option value="wide" ${existing?.gap === 'wide' ? 'selected' : ''}>6표 이상 · 큰 차이</option></select></div>
    <button class="btn btn-primary" type="submit" ${finalLocked ? 'disabled' : ''}>${round.phase === 'final_predict' ? (round.prediction?.final ? '최종 예측 수정' : '최종 예측 확정') : '1차 예측 제출'}</button>
    ${status ? `<div class="submitted">${status}</div>` : ''}
  </form>`;
}

function skillPanel(round) {
  const skill = round.skillState;
  return `<div class="skill-hero" role="img" aria-label="빛나는 정보 아이템 8종"></div>
    <div class="token-tip"><strong>남기면 점수, 쓰면 정보</strong><span>라운드가 끝날 때 남은 토큰 1개마다 +1점입니다. 올인은 정보를 포기하고 예측 적중 점수를 2배로 만듭니다.</span></div>
    <div class="token-row">남은 정보 토큰 ${Array.from({ length: skill.tokens }, () => '<i class="token"></i>').join('')} <strong>${skill.tokens}개 · 현재 보너스 +${skill.tokens}점</strong></div>
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
  const receipt = round.myPoints !== null ? scoreReceipt(round) : '';
  return `${resultList(round.results, round.totalPlayers)}${mission}${receipt}${round.phase === 'finished' ? '<div class="section-title" style="text-align:center">다음 게임을 기다려 주세요 ✨</div>' : '<div class="waiting-orbit"></div>'}`;
}

function scoreReceipt(round) {
  if (['official', 'show'].includes(round.mode)) return '<div class="points-pop">이 모드는 점수 경쟁 없이 투표 결과만 확인합니다.</div>';
  const items = round.pointBreakdown || [];
  return `<section class="score-receipt" aria-label="이번 라운드 점수 내역">
    <div class="score-receipt-head"><span>이번 라운드 점수</span><strong>+${round.myPoints}점</strong></div>
    <ul>${items.length ? items.map((item) => `<li><span>${esc(item.label)}</span><strong>+${item.points}점</strong></li>`).join('') : '<li class="score-empty"><span>이번에는 적중한 점수 항목이 없어요.</span><strong>+0점</strong></li>'}</ul>
    <div class="score-total"><span>내 누적 점수</span><strong>${state.me.score}점</strong></div>
  </section>`;
}

function formDraftKey(form) {
  const roomKey = session?.code || linkedRoom || 'local';
  const viewKey = state?.round ? `${state.round.id}:${state.round.phase}` : 'setup';
  return `${roomKey}:${viewKey}:${form.id}`;
}

function captureFormDraft(form) {
  if (!form?.id) return;
  const values = {};
  Array.from(form.elements).forEach((field) => {
    if (!field.name || ['submit', 'button'].includes(field.type)) return;
    values[field.name] = ['checkbox', 'radio'].includes(field.type)
      ? { checked: field.checked }
      : { value: field.value };
  });
  formDrafts.set(formDraftKey(form), values);
}

function captureVisibleForms() {
  app.querySelectorAll('form[id]').forEach(captureFormDraft);
}

function restoreFormDrafts() {
  app.querySelectorAll('form[id]').forEach((form) => {
    const draft = formDrafts.get(formDraftKey(form));
    if (!draft) return;
    Array.from(form.elements).forEach((field) => {
      const saved = draft[field.name];
      if (!saved) return;
      if ('checked' in saved) field.checked = saved.checked;
      else if ('value' in saved) field.value = saved.value;
    });
  });
}

function captureFocusedControl() {
  const field = document.activeElement;
  if (!field || !app.contains(field) || !['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName)) return null;
  return {
    id: field.id,
    name: field.name,
    formId: field.form?.id,
    start: Number.isInteger(field.selectionStart) ? field.selectionStart : null,
    end: Number.isInteger(field.selectionEnd) ? field.selectionEnd : null
  };
}

function captureScrollState() {
  return {
    x: window.scrollX,
    y: window.scrollY,
    elements: Array.from(document.querySelectorAll('[data-scroll-key]')).map((element) => ({
      key: element.dataset.scrollKey,
      top: element.scrollTop,
      left: element.scrollLeft
    }))
  };
}

function restoreScrollState(snapshot) {
  if (!snapshot) return;
  snapshot.elements.forEach((saved) => {
    const element = document.querySelector(`[data-scroll-key="${saved.key}"]`);
    if (!element) return;
    element.scrollTop = saved.top;
    element.scrollLeft = saved.left;
  });
  const previousBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(snapshot.x, snapshot.y);
  document.documentElement.scrollTop = snapshot.y;
  document.documentElement.style.scrollBehavior = previousBehavior;
}

function restoreFocusedControl(snapshot) {
  if (!snapshot) return;
  const form = snapshot.formId ? document.getElementById(snapshot.formId) : null;
  const field = snapshot.id ? document.getElementById(snapshot.id) : Array.from(form?.elements || []).find((item) => item.name === snapshot.name);
  if (!field) return;
  field.focus({ preventScroll: true });
  if (snapshot.start !== null && typeof field.setSelectionRange === 'function') {
    field.setSelectionRange(snapshot.start, snapshot.end);
  }
}

function render({ capture = true, focus = captureFocusedControl(), scroll = captureScrollState() } = {}) {
  if (capture) captureVisibleForms();
  document.documentElement.classList.remove('presentation');
  if (!state) app.innerHTML = screen === 'landing' ? landing() : authScreen(screen);
  else app.innerHTML = state.role === 'teacher' ? teacherView() : studentView();
  restoreFormDrafts();
  restoreScrollState(scroll);
  restoreFocusedControl(focus);
  updateConnectionIndicator();
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

function studentVisualSignature(next) {
  if (next?.role !== 'student') return null;
  const round = next.round ? { ...next.round } : null;
  if (round) {
    const timerVisible = Boolean(round.timerEnd);
    delete round.submissions;
    delete round.timerEnd;
    delete round.timerExpired;
    delete round.totalPlayers;
    delete round.totalTeams;
    round.timerVisible = timerVisible;
    round.config = { ...round.config };
    delete round.config.timerSeconds;
    delete round.config.autoAdvance;
  }
  return JSON.stringify({ room: next.room, me: next.me, teamScores: next.teamScores, round });
}

function viewIdentity(next) {
  return next ? `${next.role}:${next.round ? `${next.round.id}:${next.round.phase}` : 'setup'}` : `screen:${screen}`;
}

function receiveState(next) {
  const canUpdateInPlace = state?.role === 'student' && next.role === 'student'
    && studentVisualSignature(state) === studentVisualSignature(next);
  if (canUpdateInPlace) {
    state = next;
    clockOffset = next.serverTime - Date.now();
    updateTimer();
    return;
  }
  const sameView = viewIdentity(state) === viewIdentity(next);
  const focus = sameView ? captureFocusedControl() : null;
  const scroll = sameView ? captureScrollState() : { x: 0, y: 0, elements: [] };
  captureVisibleForms();
  state = next;
  clockOffset = next.serverTime - Date.now();
  render({ capture: false, focus, scroll });
}

function connectionCopy() {
  const name = state?.role === 'teacher' ? '교사 화면' : state?.me?.name || '학생 화면';
  return {
    connected: `${name} · 연결됨`,
    reconnecting: '재연결 중',
    offline: '인터넷 연결 없음',
    connecting: '연결 중',
    idle: name
  }[connectionStatus];
}

function updateConnectionIndicator() {
  const indicator = document.querySelector('[data-connection-status]');
  if (!indicator) return;
  const dot = indicator.querySelector('.online-dot');
  dot?.classList.remove('connected', 'reconnecting', 'offline');
  if (connectionStatus === 'connected') dot?.classList.add('connected');
  if (['connecting', 'reconnecting'].includes(connectionStatus)) dot?.classList.add('reconnecting');
  if (connectionStatus === 'offline') dot?.classList.add('offline');
  const label = indicator.querySelector('[data-connection-label]');
  if (label) label.textContent = connectionCopy();
}

function setConnectionStatus(next) {
  connectionStatus = next;
  updateConnectionIndicator();
}

function stopHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function startHeartbeat(socket) {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (eventSource !== socket) return stopHeartbeat();
    if (socket.readyState === WebSocket.OPEN) socket.send('ping');
  }, HEARTBEAT_MS);
}

function handleExpiredConnection() {
  const studentRoom = session?.role === 'student' ? session.code : '';
  stopHeartbeat();
  eventSource = null;
  saveSession(null);
  state = null;
  setConnectionStatus('idle');
  if (studentRoom) {
    linkedRoom = studentRoom;
    history.replaceState({}, '', `/?room=${encodeURIComponent(studentRoom)}`);
    screen = 'student';
  } else {
    screen = 'teacher-login';
  }
  render();
  showToast('입장 정보가 만료되어 다시 확인이 필요합니다.', true);
}

function connect() {
  clearTimeout(reconnectTimer);
  stopHeartbeat();
  const previousSocket = eventSource;
  eventSource = null;
  previousSocket?.close();
  if (!session) return setConnectionStatus('idle');
  if (!navigator.onLine) {
    setConnectionStatus('offline');
    reconnectTimer = setTimeout(connect, 3000);
    return;
  }
  setConnectionStatus('connecting');
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/api/rooms/${encodeURIComponent(session.code)}/events?token=${encodeURIComponent(session.token)}`);
  eventSource = socket;
  socket.addEventListener('message', (event) => {
    if (event.data === 'pong') return;
    try { receiveState(JSON.parse(event.data)); }
    catch { showToast('새 상태를 읽지 못했습니다.', true); }
  });
  socket.addEventListener('open', () => {
    if (eventSource !== socket) return;
    setConnectionStatus('connected');
    startHeartbeat(socket);
  });
  socket.addEventListener('close', (event) => {
    if (eventSource !== socket || !session) return;
    stopHeartbeat();
    if (event.code === 4001) return handleExpiredConnection();
    eventSource = null;
    setConnectionStatus(navigator.onLine ? 'reconnecting' : 'offline');
    showToast('연결을 다시 시도하고 있어요.');
    reconnectTimer = setTimeout(connect, 1500);
  });
  socket.addEventListener('error', () => socket.close());
}

async function restore() {
  if (linkedRoom && (session?.role !== 'student' || session.code !== linkedRoom)) return render();
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
  if (event.target.form) captureFormDraft(event.target.form);
  const input = event.target.closest('[data-option-index]');
  if (!input) return;
  const index = Number(input.dataset.optionIndex);
  const key = input.dataset.optionKey;
  draftOptions[index][key] = key === 'capacity' ? Number(input.value) : input.value;
});

app.addEventListener('change', (event) => {
  if (event.target.form) captureFormDraft(event.target.form);
});

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const command = button.dataset.action;
  if (command === 'home') {
    if (state) return;
    screen = linkedRoom ? 'student' : 'landing'; render();
  } else if (command === 'open-teacher-create') { screen = 'teacher-create'; render(); }
  else if (command === 'open-teacher-login') { screen = 'teacher-login'; render(); }
  else if (command === 'open-student-code') { screen = 'student-code'; render(); }
  else if (command === 'logout') {
    const studentRoom = session?.role === 'student' ? (state?.room?.code || session.code) : '';
    clearTimeout(reconnectTimer); stopHeartbeat(); eventSource?.close(); eventSource = null;
    saveSession(null); state = null; connectionStatus = 'idle'; formDrafts.clear();
    if (studentRoom) {
      linkedRoom = studentRoom;
      history.replaceState({}, '', `/?room=${encodeURIComponent(studentRoom)}`);
      screen = 'student';
    } else {
      linkedRoom = '';
      history.replaceState({}, '', '/');
      screen = 'landing';
    }
    render();
  } else if (command === 'copy-code') {
    await navigator.clipboard?.writeText(state.room.code); showToast(`방 코드 ${state.room.code}를 복사했어요.`);
  } else if (command === 'copy-link') {
    const base = state.room.joinUrl || location.origin;
    await navigator.clipboard?.writeText(`${base.replace(/\/$/, '')}/?room=${state.room.code}`);
    showToast('학생 참여 링크를 복사했어요.');
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
  } else if (command === 'advance') {
    const progress = phaseProgress(state.round);
    const missing = Math.max(0, progress.total - progress.done);
    if (progress.tracked && missing > 0 && !confirm(`아직 ${missing}명이 제출하지 않았습니다. 그래도 다음 단계로 이동할까요?`)) return;
    await action('advance');
  }
  else if (command === 'reveal-next') await action('reveal_next');
  else if (command === 'finish-round') {
    if (state.round.phase !== 'reveal' && !confirm('라운드를 즉시 종료하면 현재까지 제출된 값으로 결과가 확정됩니다. 종료할까요?')) return;
    await action('finish_round');
  }
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
    openDialog(`<div class="dialog-head"><h2>⏱ 제한 시간 설정</h2><button class="btn btn-icon btn-ghost" data-action="close-dialog">×</button></div><form id="timer-form" class="form-stack"><div class="field"><label for="timer-value">현재 단계 제한 시간(초)</label><input class="input" id="timer-value" name="seconds" type="number" min="0" max="600" value="${Number(state.round.config.timerSeconds) || 0}"><span class="helper">0초는 시간 제한 없음입니다. 저장하면 지금부터 다시 시작합니다.</span></div><button class="btn btn-primary" type="submit">타이머 다시 시작</button></form>`);
  }
});

dialog.addEventListener('click', (event) => {
  if (event.target === dialog || event.target.closest('[data-action="close-dialog"]')) closeDialog();
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  captureFormDraft(form);
  const submittedDraftKey = form.id ? formDraftKey(form) : null;
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
    if (submittedDraftKey) formDrafts.delete(submittedDraftKey);
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
window.addEventListener('online', () => {
  if (session && eventSource?.readyState !== WebSocket.OPEN) connect();
});
window.addEventListener('offline', () => {
  clearTimeout(reconnectTimer);
  stopHeartbeat();
  const socket = eventSource;
  eventSource = null;
  socket?.close();
  setConnectionStatus('offline');
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session
    && ![WebSocket.OPEN, WebSocket.CONNECTING].includes(eventSource?.readyState)) connect();
});
window.addEventListener('beforeunload', () => {
  stopHeartbeat();
  eventSource?.close();
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => null));

restore();
