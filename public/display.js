const MODES = {
  official: { icon: '✓', name: '정식 투표', color: '#75ad94' },
  show: { icon: '🎬', name: '결과 쇼', color: '#e9542d' },
  prediction: { icon: '🔮', name: '표심전', color: '#e7b946' },
  migration: { icon: '↝', name: '표심 이동전', color: '#75ad94' },
  minority: { icon: '🚪', name: '소수파 생존', color: '#e7b946' },
  exact: { icon: '🚀', name: '정확히 N명', color: '#d68e34' },
  alliance: { icon: '🧩', name: '정보 연합전', color: '#6f9b87' },
  mission: { icon: '🎭', name: '비밀 목표전', color: '#c95736' }
};

const PHASES = {
  mission: { name: '비밀 임무 확인', kicker: 'TOP SECRET', hint: '각자의 화면에서 비밀 임무를 확인하세요.', icon: '🎭' },
  vote: { name: '비밀 투표', kicker: 'MAKE YOUR CHOICE', hint: '아직 아무 결과도 공개되지 않습니다.', icon: '🔐' },
  predict: { name: '1차 결과 예측', kicker: 'READ THE ROOM', hint: '내 취향이 아니라 반 전체의 마음을 읽어 보세요.', icon: '🔮' },
  intel: { name: '정보 상점', kicker: 'INFORMATION MARKET', hint: '정보를 살 것인가, 점수를 노릴 것인가.', icon: '📡' },
  final_predict: { name: '최종 예측', kicker: 'FINAL CALL', hint: '확인한 정보를 조합해 마지막 답을 정하세요.', icon: '🎯' },
  signal: { name: '중간 신호와 협상', kicker: 'THE BOARD IS MOVING', hint: '정확한 표 수는 비밀. 공개된 흐름만 읽으세요.', icon: '⚡' },
  revote: { name: '최종 선택', kicker: 'LAST CHANCE', hint: '선택을 유지할지, 판을 뒤집을지 결정하세요.', icon: '⏳' },
  clue: { name: '비밀 단서 확인', kicker: 'CONNECT THE CLUES', hint: '서로 다른 단서를 말로 합쳐 진실을 찾으세요.', icon: '🧩' },
  team_guess: { name: '팀 추리 제출', kicker: 'ONE TEAM · ONE ANSWER', hint: '팀이 합의한 단 하나의 답을 제출하세요.', icon: '🤝' },
  reveal: { name: '결과 공개', kicker: 'THE TRUTH UNFOLDS', hint: '한 단계씩, 마지막까지 눈을 떼지 마세요.', icon: '✨' },
  finished: { name: '라운드 완료', kicker: 'FINAL RESULT', hint: '모든 선택이 하나의 결과가 되었습니다.', icon: '🏆' }
};

const app = document.querySelector('#display-app');
const audioGate = document.querySelector('#audio-gate');
const audioToggle = document.querySelector('#audio-toggle');
const codeToggle = document.querySelector('#code-toggle');
const toast = document.querySelector('#display-toast');
const pathParts = decodeURIComponent(location.pathname).split('/').filter(Boolean);
const queryCode = new URLSearchParams(location.search).get('room');
const roomCode = String(pathParts[0] === 'display' ? pathParts[1] || queryCode || '' : queryCode || '')
  .trim().toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);

let state = null;
let source = null;
let reconnectTimer = null;
let clockOffset = 0;
let toastTimer = null;
let controlsTimer = null;
let lastTimerTick = null;
let codeHidden = localStorage.getItem('maeum-display-hide-code') === 'true';
let audioEnabled = false;
let soundscape = null;

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#e9542d';
}

function createStars() {
  const stars = Array.from({ length: 54 }, (_, index) => {
    const x = (index * 37 + 11) % 101;
    const y = (index * 61 + 7) % 97;
    const size = 1 + (index % 3);
    const alpha = .22 + (index % 5) * .11;
    return `<i class="star" style="--x:${x}%;--y:${y}%;--size:${size}px;--alpha:${alpha};--duration:${2.4 + index % 5}s;--delay:-${index % 7}s"></i>`;
  }).join('');
  document.querySelector('#star-field').innerHTML = stars;
}

function visibleCode() {
  return codeHidden ? '•••••' : state?.room?.code || roomCode;
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `display-toast show ${error ? 'error' : ''}`;
  toastTimer = setTimeout(() => { toast.className = 'display-toast'; }, 2800);
}

function showControls() {
  clearTimeout(controlsTimer);
  document.body.classList.add('controls-visible');
  controlsTimer = setTimeout(() => document.body.classList.remove('controls-visible'), 3500);
}

function roomEntry() {
  return `<section class="room-entry">
    <img src="/assets/app-icon.png" alt="" class="gate-logo">
    <h1>교실 방송국 연결</h1>
    <p>교사 화면에 보이는 5자리 방 코드를 입력하세요.</p>
    <form id="display-room-form"><input name="code" maxlength="5" autocomplete="off" aria-label="방 코드" placeholder="ABCDE" required autofocus><button type="submit">연결하기</button></form>
  </section>`;
}

function errorScreen(message) {
  return `<section class="error-screen"><span style="font-size:78px">📡</span><h1>신호를 찾지 못했어요</h1><p>${esc(message)}</p><a href="/display/">다른 방 연결하기</a></section>`;
}

function topbar(round = null) {
  const mode = round ? MODES[round.mode] : null;
  const online = state.players.filter((player) => player.online).length;
  return `<header class="tv-topbar">
    <div class="tv-brand"><img src="/assets/app-icon.png" alt=""><span><strong>마음신호 방송국</strong><small>CLASSROOM VOTE BROADCAST</small></span></div>
    <div class="tv-meta">
      ${mode ? `<span class="mode-pill" style="border-color:${mode.color}55;color:${mode.color}">${mode.icon} ${mode.name}</span>` : ''}
      <span class="connection-pill"><i></i>${online}/${state.players.length}명 연결</span>
      <span class="tv-room">ROOM <strong class="room-code-value">${esc(visibleCode())}</strong></span>
    </div>
  </header>`;
}

function phaseFooter(round = null, message = '') {
  const phases = round?.phases || [];
  const scores = Object.entries(state.teamScores || {}).sort((a, b) => b[1] - a[1]);
  return `<footer class="tv-footer">
    <div>${round ? `<div class="phase-progress" aria-label="${round.phaseIndex + 1}/${phases.length}단계">${phases.map((_, index) => `<i class="${index <= round.phaseIndex ? 'done' : ''}"></i>`).join('')}</div>` : `<span class="footer-message">${esc(message)}</span>`}</div>
    ${scores.length ? `<div class="team-strip" aria-label="팀 점수">${scores.map(([team, score]) => `<div class="team-chip"><span>${esc(team)}</span><strong>${score}</strong></div>`).join('')}</div>` : '<span class="footer-message">학생이 입장하면 팀이 자동 배정됩니다</span>'}
  </footer>`;
}

function frame(content, round = null, footerMessage = '') {
  return `<section class="tv-screen" data-phase="${round?.phase || 'lobby'}"><div class="phase-sweep" aria-hidden="true"></div>${topbar(round)}<main class="tv-main">${content}</main>${phaseFooter(round, footerMessage)}</section>`;
}

function lobby() {
  const online = state.players.filter((player) => player.online).length;
  return frame(`<section class="stage-content lobby-stage">
    <div><p class="eyebrow">${esc(state.room.className)} · READY ROOM</p><h1 class="stage-title">모두의 선택이<br><span class="gradient-word">이야기</span>가 되는 순간</h1><p class="stage-copy">초대 링크를 열거나 메인 화면에서 5자리 학급 코드로 들어오세요. 투표가 시작되면 이 화면이 교실 전체의 무대가 됩니다.</p></div>
    <div class="lobby-code-card"><span>학생 참여 안내</span><strong class="lobby-invite-title">참여 링크를 열거나<br>5자리 코드를<br>입력하세요</strong><small class="join-address">메인 화면 → 학급 코드로 들어가기</small><div class="people-badge">현재 <strong>${online}</strong>명 접속 · 전체 ${state.players.length}명</div></div>
  </section>`, null, `${state.room.teacherName}의 다음 신호를 기다리는 중`);
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

function timerRing(round) {
  const remaining = remainingSeconds(round);
  const total = Math.max(1, Number(round.config.timerSeconds) || remaining || 1);
  const progress = remaining === null ? 100 : Math.min(100, remaining / total * 100);
  return `<div class="timer-ring ${remaining !== null && remaining <= 10 ? 'urgent' : ''}" data-tv-timer-ring style="--progress:${progress}"><strong data-tv-timer>${formatTime(remaining)}</strong><small>TIME LEFT</small></div>`;
}

function optionGrid(round) {
  const columns = round.options.length <= 3 ? round.options.length : round.options.length === 4 ? 4 : 3;
  return `<div class="options-grid" style="--columns:${columns}">${round.options.map((option, index) => `<div class="tv-option" style="--option-color:${safeColor(option.color)};--delay:${index * .07}s"><strong>${esc(option.label)}${option.capacity ? `<small>정원 ${option.capacity}명</small>` : ''}</strong></div>`).join('')}</div>`;
}

function progressData(round) {
  const map = { vote: 'vote', revote: 'revote', predict: 'prediction', final_predict: 'finalPrediction', team_guess: 'teamGuess', signal: round.mode === 'migration' ? 'movementPrediction' : null };
  const key = map[round.phase];
  if (!key) return null;
  const total = round.phase === 'team_guess' ? Math.max(1, Object.keys(state.teamScores || {}).length) : Math.max(1, round.totalPlayers);
  const done = round.submissions[key] || 0;
  return { done, total, percent: Math.min(100, Math.round(done / total * 100)) };
}

function progressPanel(round) {
  const progress = progressData(round);
  if (!progress) return '';
  return `<div class="progress-show"><strong>${progress.done}/${progress.total}</strong><div class="progress-track"><i style="--progress:${progress.percent}%"></i></div><span>${progress.percent === 100 ? '모두 제출 완료!' : '비밀리에 제출 중'}</span></div>`;
}

function standardPhase(round) {
  const phase = PHASES[round.phase];
  return `<section class="stage-content">
    <div class="round-stage"><div><p class="eyebrow">${phase.kicker}</p><h1 class="stage-title">${esc(round.title)}</h1><p class="stage-copy" style="margin-left:0">${phase.icon} ${phase.hint}</p></div>${timerRing(round)}</div>
    ${optionGrid(round)}${progressPanel(round)}
  </section>`;
}

function privatePhase(round) {
  const phase = PHASES[round.phase];
  return `<section class="stage-content private-show"><span class="private-icon">${phase.icon}</span><p class="eyebrow">${phase.kicker}</p><h1 class="stage-title">${phase.name}</h1><p class="stage-copy">${phase.hint}<br>비밀 내용은 각자의 화면에만 표시됩니다.</p></section>`;
}

function signalPhase(round) {
  const phase = PHASES[round.phase];
  const progress = progressPanel(round);
  return `<section class="stage-content"><div class="round-stage"><div><p class="eyebrow">${phase.kicker}</p><h1 class="stage-title">흐름이 공개되었습니다</h1><p class="stage-copy" style="margin-left:0">정확한 표 수는 끝까지 비밀입니다. 협상할 시간!</p></div>${timerRing(round)}</div>
    <div class="signal-board" style="--columns:${round.options.length <= 3 ? round.options.length : 3}">${round.options.map((option, index) => `<div class="signal-card" style="--delay:${index * .08}s"><strong>${esc(option.label)}</strong><span class="signal-state ${esc(round.signal?.[option.id] || '')}">${esc(round.signal?.[option.id] || '비공개')}</span></div>`).join('')}</div>${progress}</section>`;
}

function privacyMessage() {
  return `<div class="privacy-card"><span>🔒</span><h2>결과 비공개 투표</h2><p>교사가 선택한 공개 설정에 따라 이 화면에는 결과가 표시되지 않습니다.</p></div>`;
}

function resultBoard(round) {
  const results = round.results || [];
  const max = Math.max(1, ...results.map((item) => Number(item.count) || 0));
  return `<div class="result-board">${results.map((item, index) => {
    const width = item.count === null ? 100 : Math.max(5, (Number(item.count) || 0) / max * 100);
    return `<div class="result-card" style="--option-color:${safeColor(item.color)};--delay:${index * .08}s"><span class="result-rank">${item.rank || index + 1}</span><strong class="result-name">${esc(item.label)}</strong><span class="result-bar"><i style="--width:${width}%"></i></span><span class="result-count">${item.count === null ? '승리' : `${item.count}표`}</span></div>`;
  }).join('')}</div>`;
}

function revealPhase(round) {
  if (round.config.resultPrivacy === 'hidden') return privacyMessage();
  if (!round.results?.length) {
    return `<section class="stage-content sealed-result"><div><div class="vault"><span>🔒</span></div><p class="eyebrow">${PHASES.reveal.kicker}</p><h1 class="stage-title">결과는 아직 봉인되어 있습니다</h1><p class="stage-copy">선생님의 다음 공개 신호를 기다리세요.</p></div></section>`;
  }
  return `<section class="stage-content reveal-stage"><p class="eyebrow">REVEAL ${Math.min(round.revealStep, round.revealTotal)} / ${round.revealTotal}</p><h1 class="stage-title" style="font-size:clamp(32px,4vw,58px)">${esc(round.title)}</h1>${resultBoard(round)}</section>`;
}

function confetti() {
  const colors = ['#e9542d', '#75ad94', '#e7b946', '#f4e7cc', '#d68e34', '#ffffff'];
  return `<div class="confetti" aria-hidden="true">${Array.from({ length: 58 }, (_, index) => `<i style="--x:${(index * 47) % 101}%;--w:${5 + index % 8}px;--color:${colors[index % colors.length]};--rotate:${index * 29}deg;--fall:${3.2 + index % 5 * .45}s;--delay:-${index % 9 * .38}s;--drift:${-60 + index % 7 * 20}px"></i>`).join('')}</div>`;
}

function finishedPhase(round) {
  if (round.config.resultPrivacy === 'hidden' || !round.displayOutcome) return privacyMessage();
  const outcome = round.displayOutcome;
  if (!outcome.winners.length) {
    return `<section class="winner-stage"><span class="winner-crown">🌙</span><p class="winner-label">ROUND COMPLETE</p><h1 class="winner-name">승리 없음</h1><div class="winner-score">${esc(outcome.title)}</div></section>`;
  }
  const winners = outcome.winners.map((winner) => `<div class="winner-choice" style="--option-color:${safeColor(winner.color)}"><strong>${esc(winner.label)}</strong><span>${winner.count === null ? '조건 달성' : `${winner.count}표`}</span></div>`).join('');
  return `<section class="winner-stage"><span class="winner-crown">🏆</span><p class="winner-label">${esc(outcome.title)}</p><div class="winner-list ${outcome.winners.length > 1 ? 'multiple' : ''}">${winners}</div></section>${confetti()}`;
}

function roundScreen(round) {
  let content;
  if (round.phase === 'finished') content = finishedPhase(round);
  else if (round.phase === 'reveal') content = revealPhase(round);
  else if (round.phase === 'signal') content = signalPhase(round);
  else if (['mission', 'intel', 'clue'].includes(round.phase)) content = privatePhase(round);
  else content = standardPhase(round);
  return frame(content, round);
}

function render() {
  document.body.classList.toggle('code-hidden', codeHidden);
  codeToggle.setAttribute('aria-pressed', String(codeHidden));
  codeToggle.textContent = codeHidden ? '👁 방 코드 보이기' : '🙈 방 코드 숨기기';
  if (!roomCode) { app.innerHTML = roomEntry(); return; }
  if (!state) return;
  document.body.dataset.phase = state.round?.phase || 'lobby';
  app.innerHTML = state.round ? roundScreen(state.round) : lobby();
  updateTimer();
}

function phaseSignature(round) {
  return round ? `${round.id}:${round.phase}` : 'lobby';
}

function revealSignature(round) {
  return round ? `${round.id}:${round.phase}:${round.revealStep}` : 'none';
}

function receiveState(next) {
  const previousRound = state?.round;
  const phaseChanged = state && phaseSignature(previousRound) !== phaseSignature(next.round);
  const revealChanged = state && next.round?.phase === 'reveal' && revealSignature(previousRound) !== revealSignature(next.round);
  const justFinished = state && previousRound?.phase !== 'finished' && next.round?.phase === 'finished';
  state = next;
  clockOffset = next.serverTime - Date.now();
  render();
  soundscape?.setPhase(next.round?.phase || 'lobby');
  if (revealChanged) {
    triggerRevealHit();
    soundscape?.effect('reveal');
  } else if (justFinished) {
    triggerRevealHit();
    soundscape?.effect('victory');
  } else if (phaseChanged) soundscape?.effect('transition');
}

async function loadState() {
  if (!roomCode) { render(); return; }
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/display-state`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '방 코드를 확인해 주세요.');
    receiveState(payload);
    connect();
  } catch (error) {
    app.innerHTML = errorScreen(error.message);
    audioGate.classList.add('hidden');
  }
}

function connect() {
  clearTimeout(reconnectTimer);
  source?.close();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/api/rooms/${encodeURIComponent(roomCode)}/display-events`);
  source = socket;
  socket.addEventListener('message', (event) => {
    if (event.data === 'pong') return;
    try { receiveState(JSON.parse(event.data)); }
    catch { showToast('새 상태를 읽지 못했습니다.', true); }
  });
  socket.addEventListener('open', () => showToast('교사 화면과 실시간으로 연결되었습니다.'));
  socket.addEventListener('close', () => {
    if (source !== socket || !roomCode) return;
    showToast('연결을 다시 시도하고 있습니다.', true);
    reconnectTimer = setTimeout(connect, 1500);
  });
  socket.addEventListener('error', () => socket.close());
}

function triggerRevealHit() {
  document.body.classList.remove('reveal-hit');
  void document.body.offsetWidth;
  document.body.classList.add('reveal-hit');
  setTimeout(() => document.body.classList.remove('reveal-hit'), 650);
}

function updateTimer() {
  const round = state?.round;
  const timer = document.querySelector('[data-tv-timer]');
  const ring = document.querySelector('[data-tv-timer-ring]');
  if (!round || !timer || !ring) return;
  const remaining = remainingSeconds(round);
  const total = Math.max(1, Number(round.config.timerSeconds) || remaining || 1);
  const progress = remaining === null ? 100 : Math.min(100, remaining / total * 100);
  timer.textContent = formatTime(remaining);
  ring.style.setProperty('--progress', progress);
  ring.classList.toggle('urgent', remaining !== null && remaining <= 10);
  if (audioEnabled && remaining !== null && remaining > 0 && remaining <= 10 && remaining !== lastTimerTick) {
    soundscape?.effect('tick', remaining);
    lastTimerTick = remaining;
  }
}

function midi(note) {
  return 440 * (2 ** ((note - 69) / 12));
}

class Soundscape {
  constructor() {
    this.context = null;
    this.master = null;
    this.music = null;
    this.effects = null;
    this.scheduler = null;
    this.nextNote = 0;
    this.step = 0;
    this.phase = 'lobby';
    this.muted = false;
  }

  async start() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContext();
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -22;
      compressor.knee.value = 24;
      compressor.ratio.value = 8;
      compressor.attack.value = .004;
      compressor.release.value = .28;
      this.master = this.context.createGain();
      this.music = this.context.createGain();
      this.effects = this.context.createGain();
      this.master.gain.value = .28;
      this.music.gain.value = .32;
      this.effects.gain.value = .5;
      this.music.connect(this.master);
      this.effects.connect(this.master);
      this.master.connect(compressor);
      compressor.connect(this.context.destination);
      this.nextNote = this.context.currentTime + .05;
      this.scheduler = setInterval(() => this.schedule(), 90);
    }
    await this.context.resume();
    this.setMuted(false);
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.master || !this.context) return;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(muted ? .0001 : .28, this.context.currentTime, .08);
  }

  setPhase(phase) {
    if (this.phase === phase) return;
    this.phase = phase || 'lobby';
    this.step = 0;
    if (this.context) this.nextNote = Math.max(this.nextNote, this.context.currentTime + .04);
  }

  profile() {
    const profiles = {
      lobby: { bpm: 62, notes: [45, 52, 57, 52, 48, 52, 57, 52], bass: 33, wave: 'sine' },
      mission: { bpm: 74, notes: [45, 48, 52, 55, 52, 48, 43, 48], bass: 33, wave: 'triangle' },
      vote: { bpm: 86, notes: [45, 52, 55, 60, 55, 52, 48, 52], bass: 33, wave: 'triangle' },
      predict: { bpm: 82, notes: [45, 52, 57, 60, 57, 52, 48, 55], bass: 33, wave: 'sine' },
      intel: { bpm: 90, notes: [52, 55, 59, 64, 59, 55, 50, 55], bass: 40, wave: 'triangle' },
      final_predict: { bpm: 96, notes: [45, 52, 57, 60, 57, 64, 60, 55], bass: 33, wave: 'triangle' },
      signal: { bpm: 104, notes: [43, 50, 55, 58, 55, 50, 46, 53], bass: 31, wave: 'sawtooth' },
      revote: { bpm: 112, notes: [45, 52, 55, 60, 57, 64, 60, 55], bass: 33, wave: 'sawtooth' },
      clue: { bpm: 78, notes: [47, 50, 54, 59, 54, 50, 45, 50], bass: 35, wave: 'sine' },
      team_guess: { bpm: 94, notes: [47, 54, 59, 62, 59, 54, 50, 57], bass: 35, wave: 'triangle' },
      reveal: { bpm: 124, notes: [40, 47, 52, 55, 58, 55, 52, 47], bass: 28, wave: 'sawtooth' },
      finished: { bpm: 76, notes: [48, 52, 55, 60, 55, 64, 60, 55], bass: 36, wave: 'triangle' }
    };
    return profiles[this.phase] || profiles.lobby;
  }

  schedule() {
    if (!this.context || this.context.state !== 'running') return;
    const profile = this.profile();
    const beat = 60 / profile.bpm / 2;
    while (this.nextNote < this.context.currentTime + .35) {
      const note = profile.notes[this.step % profile.notes.length];
      const accent = this.step % 4 === 0;
      this.tone(midi(note), this.nextNote, beat * .78, accent ? .055 : .032, profile.wave, this.music);
      if (accent) {
        this.tone(midi(profile.bass), this.nextNote, beat * 1.7, .055, 'sine', this.music);
        this.kick(this.nextNote, this.phase === 'reveal' || this.phase === 'revote' ? .085 : .045);
      }
      if (this.step % 8 === 0) this.pad([note - 12, note - 5, note], this.nextNote, beat * 7.2);
      this.step += 1;
      this.nextNote += beat;
    }
  }

  tone(frequency, start, duration, level, type, destination) {
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(type === 'sawtooth' ? 900 : 1500, start);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + .04);
  }

  pad(notes, start, duration) {
    for (const note of notes) this.tone(midi(note), start, duration, .013, 'sine', this.music);
  }

  kick(start, level = .06) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(105, start);
    oscillator.frequency.exponentialRampToValueAtTime(38, start + .18);
    gain.gain.setValueAtTime(level, start);
    gain.gain.exponentialRampToValueAtTime(.0001, start + .24);
    oscillator.connect(gain);
    gain.connect(this.effects);
    oscillator.start(start);
    oscillator.stop(start + .26);
  }

  sweep(start, duration = .45) {
    const length = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / length);
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(320, start);
    filter.frequency.exponentialRampToValueAtTime(2600, start + duration);
    filter.Q.value = .8;
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(.1, start + duration * .55);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.effects);
    source.start(start);
  }

  effect(kind, value = 0) {
    if (!this.context || this.muted || this.context.state !== 'running') return;
    const now = this.context.currentTime + .02;
    if (kind === 'tick') {
      this.tone(value <= 3 ? 1050 : 760, now, .07, value <= 3 ? .09 : .05, 'sine', this.effects);
      return;
    }
    if (kind === 'transition') {
      this.sweep(now, .5);
      this.tone(midi(57), now + .18, .55, .06, 'triangle', this.effects);
      return;
    }
    if (kind === 'reveal') {
      this.kick(now, .2);
      this.sweep(now, .36);
      [40, 47, 52].forEach((note, index) => this.tone(midi(note), now + index * .035, .7, .08, 'sawtooth', this.effects));
      return;
    }
    if (kind === 'victory') {
      this.kick(now, .18);
      [60, 64, 67, 72, 76].forEach((note, index) => this.tone(midi(note), now + index * .13, .8, .09, 'triangle', this.effects));
    }
  }
}

async function enableAudio() {
  soundscape ||= new Soundscape();
  try {
    await soundscape.start();
    soundscape.setPhase(state?.round?.phase || 'lobby');
    audioEnabled = true;
    updateAudioButton();
    showToast('교실 BGM과 효과음이 시작되었습니다.');
  } catch {
    showToast('이 브라우저에서 소리를 시작하지 못했습니다.', true);
  }
}

function toggleAudio() {
  if (!soundscape || !audioEnabled) return enableAudio();
  audioEnabled = false;
  soundscape.setMuted(true);
  updateAudioButton();
  showToast('BGM을 껐습니다.');
}

function updateAudioButton() {
  audioToggle.setAttribute('aria-pressed', String(audioEnabled));
  audioToggle.textContent = audioEnabled ? '🔊 BGM 켜짐' : '🔇 BGM 켜기';
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { showToast('브라우저 메뉴에서 전체화면을 허용해 주세요.', true); }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-display-action]');
  if (!button) return;
  const action = button.dataset.displayAction;
  if (action === 'start-show') {
    audioGate.classList.add('hidden');
    await enableAudio();
    await toggleFullscreen();
  } else if (action === 'silent') audioGate.classList.add('hidden');
  else if (action === 'audio') {
    if (audioEnabled) toggleAudio();
    else await enableAudio();
  } else if (action === 'hide-code') {
    codeHidden = !codeHidden;
    localStorage.setItem('maeum-display-hide-code', String(codeHidden));
    render();
  } else if (action === 'fullscreen') await toggleFullscreen();
});

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'display-room-form') return;
  event.preventDefault();
  const code = String(new FormData(event.target).get('code') || '').trim().toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
  if (code.length === 5) location.href = `/display/${code}`;
});

document.addEventListener('mousemove', showControls, { passive: true });
document.addEventListener('keydown', async (event) => {
  if (event.target.matches('input')) return;
  if (event.key.toLowerCase() === 'm') audioEnabled ? toggleAudio() : await enableAudio();
  if (event.key.toLowerCase() === 'f') await toggleFullscreen();
  if (event.key.toLowerCase() === 'c') {
    codeHidden = !codeHidden;
    localStorage.setItem('maeum-display-hide-code', String(codeHidden));
    render();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && audioEnabled) soundscape?.context?.resume();
});

window.addEventListener('beforeunload', () => source?.close());
setInterval(updateTimer, 250);
createStars();
if (!roomCode) audioGate.classList.add('hidden');
render();
loadState();
showControls();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => null));
