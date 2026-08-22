import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const displaySource = await readFile(new URL('../public/display.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const displayHtml = await readFile(new URL('../public/display.html', import.meta.url), 'utf8');
const manualHtml = await readFile(new URL('../manual/index.html', import.meta.url), 'utf8');

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
