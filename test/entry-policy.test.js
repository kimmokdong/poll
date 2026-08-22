import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const displaySource = await readFile(new URL('../public/display.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const displayHtml = await readFile(new URL('../public/display.html', import.meta.url), 'utf8');
const manualHtml = await readFile(new URL('../manual/index.html', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

test('공개 메인은 교사 전용 진입점만 제공한다', () => {
  assert.doesNotMatch(appSource, /data-action="open-student"/);
  assert.match(appSource, /교사용 운영 화면/);
  assert.match(appSource, /학생 참여 링크 복사/);
});

test('학생은 방 코드가 포함된 초대 링크에서 이름만 입력한다', () => {
  assert.match(appSource, /screen = linkedRoom \? 'student' : 'landing'/);
  assert.match(appSource, /type="hidden" name="code" value="\$\{esc\(linkedRoom\)\}"/);
  assert.doesNotMatch(appSource, /id="join-code"/);
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
