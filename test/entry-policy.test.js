import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const displaySource = await readFile(new URL('../public/display.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const displayHtml = await readFile(new URL('../public/display.html', import.meta.url), 'utf8');
const displayStyles = await readFile(new URL('../public/display.css', import.meta.url), 'utf8');
const manualHtml = await readFile(new URL('../manual/index.html', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const teacherStepImages = await Promise.all([
  '02-teacher-create.png',
  '14-teacher-tv-button.png',
  '06-teacher-setup.png',
  '07-teacher-live.png',
  '09-teacher-progress.png',
  '12-teacher-reveal.png'
].map((name) => readFile(new URL(`../manual/assets/screenshots/${name}`, import.meta.url))));

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

test('공개 메인은 교사 운영과 학생 학급 코드 입장을 함께 제공한다', () => {
  assert.match(appSource, /data-action="open-student-code"/);
  assert.match(appSource, /학급 코드로 들어가기/);
  assert.match(appSource, /교사·학생 시작 화면/);
  assert.match(appSource, /학생 참여 링크 복사/);
});

test('학생은 초대 링크 또는 5자리 학급 코드로 같은 입장 API를 사용한다', () => {
  assert.match(appSource, /screen = linkedRoom \? 'student' : 'landing'/);
  assert.match(appSource, /type="hidden" name="code" value="\$\{esc\(linkedRoom\)\}"/);
  assert.match(appSource, /'student-code':/);
  assert.match(appSource, /id="student-code" name="code" minlength="5" maxlength="5"/);
  assert.match(appSource, /command === 'open-student-code'/);
  assert.match(appSource, /api\(`\/api\/rooms\/\$\{code\}\/join`/);
  assert.match(appSource, /session\?\.role !== 'student' \|\| session\.code !== linkedRoom/);
});

test('교실 TV도 코드 직접 입력 대신 교사 참여 링크를 안내한다', () => {
  assert.match(displaySource, /선생님이 보낸 참여 링크/);
  assert.doesNotMatch(displaySource, /학생 입장 코드/);
});

test('모든 공개 화면에 만든이 김현승쌤 표기를 유지한다', () => {
  for (const source of [indexHtml, displayHtml, manualHtml]) {
    assert.match(source, /aria-label="만든이 김현승쌤"/);
    assert.match(source, /<span>만든이<\/span><strong>김현승쌤<\/strong>/);
  }
});

test('교사 모드 선택기는 데스크톱에서 한 줄, 선택지는 두 열로 압축한다', () => {
  assert.match(stylesSource, /\.mode-grid\s*\{[^}]*repeat\(8,/s);
  assert.match(stylesSource, /\.option-editor\s*\{[^}]*repeat\(2,/s);
  assert.match(appSource, /aria-pressed="\$\{key === draftMode\}"/);
});

test('실시간 갱신은 작성 중인 폼을 보존하고 TV 전환 애니메이션을 단계 변화에만 실행한다', () => {
  assert.match(appSource, /captureVisibleForms\(\)/);
  assert.match(appSource, /restoreFormDrafts\(\)/);
  assert.match(displaySource, /visualSignature\(state\) !== visualSignature\(next\)/);
  assert.match(displaySource, /animatePhase \? '<div class="phase-sweep"/);
});

test('학생 화면은 모든 모드의 목표·현재 행동·점수 규칙과 점수 영수증을 직접 안내한다', () => {
  for (const mode of ['official', 'show', 'prediction', 'migration', 'minority', 'exact', 'alliance', 'mission']) {
    assert.match(appSource, new RegExp(`${mode}: \\{ goal:`));
  }
  assert.match(appSource, /이번 게임 목표/);
  assert.match(appSource, /지금 할 일/);
  assert.match(appSource, /점수 얻는 법/);
  assert.match(appSource, /남은 토큰 1개마다 \+1점/);
  assert.match(appSource, /class="score-receipt"/);
});

test('교실 TV는 정보 연합전에서만 팀 점수를 위쪽에 보이고 BGM 음량을 조절한다', () => {
  assert.match(displaySource, /round\?\.mode !== 'alliance'/);
  assert.match(displaySource, /class="tv-team-row"/);
  assert.match(displayStyles, /\.tv-team-row\s*\{[^}]*grid-row: 2/s);
  assert.match(displayHtml, /id="volume-slider"[^>]*type="range"/);
  assert.match(displaySource, /this\.master\.gain\.value = \.55 \* this\.volume/);
});

test('설명서는 번호 없는 연결선과 8가지 게임 모드 상세 안내를 제공한다', () => {
  assert.equal((manualHtml.match(/class="mode-guide-card"/g) || []).length, 8);
  assert.doesNotMatch(manualHtml, /<circle cx="\$\{mx\}"/);
  assert.doesNotMatch(manualHtml, /<text x="\$\{mx\}"/);
  for (const mode of ['정식 투표', '결과 쇼', '표심전', '표심 이동전', '소수파 생존', '정확히 N명', '정보 연합전', '비밀 목표전']) {
    assert.match(manualHtml, new RegExp(mode));
  }
});

test('설명서 본문은 큰 글자와 쉬운 단계 표현을 유지한다', () => {
  assert.match(manualHtml, /body\{[^}]*font-size:16px/s);
  assert.match(manualHtml, /\.mode-guide-body p\{[^}]*font-size:15px/s);
  assert.equal((manualHtml.match(/<b>이럴 때 써요:<\/b>/g) || []).length, 8);
  assert.match(manualHtml, /1\. 이렇게 하세요/);
  assert.match(manualHtml, /2\. 잘됐는지 확인하세요/);
  assert.match(manualHtml, /3\. 이것만 조심하세요/);
});

test('교사용 실제 화면 6단계 이미지는 모두 같은 크기다', () => {
  for (const image of teacherStepImages) {
    assert.deepEqual(pngDimensions(image), { width: 1440, height: 1000 });
  }
});


test('학생·교실 TV·설명서는 body 시작 직후 공통 방문 집계 스크립트를 한 번만 불러온다', () => {
  const tag = '<script defer src="https://hsstudio.pages.dev/project-visits.js" referrerpolicy="no-referrer"></script>';
  for (const html of [indexHtml, displayHtml, manualHtml]) {
    assert.ok(html.slice(html.indexOf('<body')).startsWith('<body>\n  ' + tag));
    assert.equal(html.split(tag).length - 1, 1);
  }
});
