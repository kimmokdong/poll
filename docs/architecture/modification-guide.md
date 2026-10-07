# 무엇을 바꾸려면 어디부터 볼까?

[문서 첫 화면](README.md) · 기준일 2026-08-31

이 문서는 **다음 수정 작업을 위한 안내**입니다. 이번 조사에서는 기존 기능·배포 설정을 바꾸지 않았습니다. 문제 목록에 있다고 해서 자동으로 수정한 것은 아닙니다.

## 1. 수정 작업별 출발점

| 수정하고 싶은 것 | 먼저 볼 파일 | 함께 확인할 파일 | 수정 영향 | 테스트 방법 |
|---|---|---|---|---|
| 교사·학생 화면의 글자 | `public/app.js`: 해당 화면 함수 | `src/game.js`의 오류·규칙 문구, `manual/index.html` | 설명과 실제 규칙의 일치 | 해당 역할·단계 열기, 긴 문장·휴대폰 폭 확인 |
| 모드 목적·점수 안내 | `app.js`: `MODE_GUIDES`, `studentActionGuide` | `game.js`: `scoreRound`, `MODE_PHASES`, 설명서 | 사용자가 예상하는 행동·보상 | 안내 점수와 실제 `pointBreakdown` 대조 |
| 버튼·카드·색상·배치 | `public/styles.css`, 화면 class | `app.js`, 뒤쪽 테마 override | 데스크톱·학생 휴대폰 UI | 모바일/데스크톱, 포커스·긴 제목·비활성 버튼 검사 |
| TV 화면 위치·팀 표시 | `public/display.js`: `frame`, `teamScoreboard` | `display.css`, `game.js`: `displayState` | TV만의 화면과 정보 공개 | 팀 모드/일반 모드, 작은 TV 해상도, 결과 단계 확인 |
| TV 소리·음량 | `display.js`: `Soundscape`, 오디오 이벤트 | `display.html`, `display.css` | 브라우저 합성음·음량 설정 | 최초 클릭 허용, 음소거, 새로고침, 교실 TV 실제 출력 확인 |
| 투표 제목·보기 입력 보존 | `app.js`: 폼 초안·`render/receiveState` | `roundForm`, 입력 이벤트, `entry-policy.test.js` | 실시간 수신 중 입력·포커스·스크롤 | 두 브라우저로 다른 학생 접속/투표 중 교사 폼 입력 유지 확인 |
| 학생의 예측 선택 보존 | `app.js`: `predictionPanel`, `formDraftKey` | `game.js`: `submitPrediction`, 상태 DTO | 단계 전환과 미제출 초안의 경계 | 다른 학생 제출 중 선택 유지, 1차→최종 전환, 실패 후 재시도 |
| 새 화면·메뉴 | `app.js`: `render`와 이벤트 위임 | `index.html`, CSS; 새 주소면 Worker·Wrangler | 화면 전환·초기 주소·세션 복원 | URL 직접 열기, 새로고침, 뒤로가기, 역할별 접근 확인 |
| 새 게임 모드 | `game.js`: `MODE_PHASES`, `createRound`, `studentAction`, `scoreRound` | `app.js`의 MODES/안내/폼, `display.js`의 MODES/장면, 테스트·설명서 | 서버·학생·교사·TV 전반 | 전체 단계, 최소 인원, 점수, 비밀 정보, 중간 입장, 시간 만료 |
| 점수 규칙·항목별 내역 | `game.js`: `scoreRound` | `clientState`, `app.js`: `scoreReceipt`, 안내, 테스트 | 누적 점수·이번 점수·팀 합계 | 정상·0점·동점·소수점·중복 공개의 기대값 비교 |
| 자동 마감·시간 정책 | `game.js`: `maybeAdvanceCompletedPhase`, `startTimer`, `advanceRound` | `worker.js`: `alarm/scheduleAlarm`, 두 UI 타이머 | 실제 단계·인원·수정 가능한 제출 | 전원 완료, 세컨드 찬스, 0명, 연결 유예, `autoAdvance` 켜기/끄기 |
| 학생 연결·재입장 정책 | `worker.js`: 소켓 처리; `game.js`: 활동 인원 | `app.js`: `restore/connect`, TV 연결 코드 | 학생 중복·관전·완료 분모·세션 유지 | 오프라인/온라인, 새로고침, 두 탭, 유예 전후, 토큰 없는 재입장 |
| 방·라운드에 새 필드 | `game.js`: 생성 함수·규칙 | `worker.js`: 저장, `clientState/displayState`, 소비 UI | 기존 저장 객체와 신규 객체 호환 | 필드 없는 이전 객체와 신규 객체를 각각 검사 |
| API 요청·응답 변경 | `worker.js`: `api`, `Room.fetch` | `app.js`: `api/action`, `display.js`, `game.js` DTO | 세 클라이언트의 계약 | 정상·잘못된 JSON·권한 오류·오래된 화면의 요청 검사 |
| 교사·학생 권한 | `game.js`: `authenticate`, 역할별 action | `worker.js`: 로그인·토큰 전달, `clientState/displayState` | 비밀 정보·관리 명령 접근 | 학생 토큰으로 교사 action 거절, TV 무인증 공개 범위 확인 |
| 데이터 보관·방 만료 | `worker.js`: `ttlMs/touch/alarm/expire` | `wrangler.jsonc`, `game.js`: `finishRound/history` | 장기 기록·방 복원·삭제 | 시간 경계, 활성/휴면, 새 라운드 교체, 기록 존재 여부 |
| 서비스 주소·배포 경로 | `wrangler.jsonc`, 루트 README | Worker 라우팅, `app.js/display.js`의 location 기반 URL | 링크·세션 origin·캐시·기존 DO 연결 | 새 주소 정적 파일·API·WSS·초대·TV·설명서 확인 |
| 서버 설정 추가 | `wrangler.jsonc`와 사용하는 서버 함수 | 미설정 기본 처리, 배포 계정 설정 | 로컬/운영 동작 차이 | 미설정·유효값·잘못된 값 검사; 비밀값 브라우저 전달 금지 |
| 사용설명서·삽화 | `manual/index.html`, `manual/assets/` | 제작 기록, `scripts/build-assets.js` | `/manual/`에 제공되는 안내 | 앵커·탭·이미지 확대·휴대폰 가독성 확인 |
| 캐시·업데이트 반영 | `public/sw.js` | 두 UI 등록, `public/_headers`, 배포 자산 | 구버전 화면·오프라인 표시 | 새 배포/구캐시, API 제외, 자산 경로 변경 확인 |

## 2. 작은 화면 수정의 추천 순서

1. 화면 문구나 `data-action`을 `public/app.js` 또는 `public/display.js`에서 찾습니다.
2. 그 HTML을 만드는 함수와 적용된 class를 확인합니다. CSS는 같은 선택자의 뒤쪽 덮어쓰기도 찾습니다.
3. 클릭/제출 이벤트에서 요청까지 이어지는지 확인합니다. 글자 변경과 게임 규칙 변경을 구분합니다.
4. 원본만 수정합니다. `.dist`나 테스트 캡처를 실행 원본으로 고치지 않습니다.
5. `npm test`로 기존 검사에 영향이 없는지 확인합니다.
6. 로컬 build/dev로 실제 역할과 화면 크기를 확인합니다. 화면 검증 전에는 배포가 필요하지 않습니다.

DOM 전체 교체가 필요한지, 타이머·진행률의 숫자만 바꾸면 되는지를 구분하세요. 현재 코드는 초안·포커스·스크롤을 지키는 보완이 있으므로 이 경로를 무심코 우회하면 입력 초기화 문제가 다시 생길 수 있습니다.

## 3. 게임 규칙을 바꿀 때 반드시 맞출 네 곳

| 책임 | 실제 위치 | 예: 예측 배점을 바꾼다면 |
|---|---|---|
| 최종 계산 | `src/game.js` | `scoreRound`와 항목 내역을 변경 |
| 학생 설명·표시 | `public/app.js` | `MODE_GUIDES`, 단계 안내, `scoreReceipt` 확인 |
| 공용 화면 | `public/display.js` | 결과 공개·팀 합계·표시 메시지의 모순 확인 |
| 검사·설명서 | `test/`, `manual/` | 기대 점수와 교사 안내를 함께 갱신 |

프론트와 서버가 공유하는 단일 모드 정의 모듈은 없습니다. 지금은 각 실행 환경의 정의를 함께 확인하는 것이 필요한 작업입니다. 문서화를 위해 새로운 프레임워크나 공유 계층을 추가하지 않았습니다.

## 4. 데이터 필드를 추가할 때의 체크리스트

- `createRoom/createRound/joinRoom` 중 어디에 속하는 값인지 먼저 결정합니다.
- 이전에 저장된 객체에는 필드가 없을 수 있습니다. 기존 값을 읽을 때의 기본값·검증을 마련합니다.
- `room.version` 숫자가 있다고 자동 데이터 마이그레이션 코드가 동작하는 것은 아닙니다.
- 원본에 저장하는 필드와 `clientState/displayState`로 공개할 필드를 따로 결정합니다.
- 점수 합계·연결 여부처럼 계산할 수 있는 값을 별도로 중복 저장할 필요가 있는지 확인합니다.
- 필드를 추가하는 일과 DO 클래스/namespace를 바꾸는 일은 다릅니다. 후자는 기존 데이터 접근에 더 큰 영향을 줄 수 있습니다.
- 토큰·개별 비밀 선택·임무가 다른 학생 또는 TV 응답에 포함되지 않는지 검사합니다.

## 5. 검증 방법을 구분하기

| 검사 | 현재 있는 도구·코드 | 확인하는 것 | 이것만으로 알 수 없는 것 |
|---|---|---|---|
| 소스 수준 정책 검사 | `test/entry-policy.test.js` | 입구·UI 안내·CSS/HTML 등의 특정 조건 | 실제 클릭 순서와 모든 화면 레이아웃 |
| 게임 단위 테스트 | `test/game-engine.test.js` | 메모리 객체의 투표·공개·점수·참가 처리 | Cloudflare 실제 저장·알람·네트워크 |
| 로컬 여러 브라우저 | Wrangler + 독립 세션 | 교사/학생/TV의 왕복 흐름·초안 보존 | 학교 현장 네트워크·기기 음향 |
| 운영 읽기 전용 검사 | 공개 정적 URL | 배포 접근·파일 반영 | 관리자 권한·방 데이터·동시 투표 완전성 |
| 교실 현장 검사 | 실제 학생 기기·TV | 네트워크 끊김·소리·가독성·인원 규모 | 장기 데이터 보관 정책의 적절성 |

여러 브라우저 테스트에서는 교사와 학생의 localStorage가 섞이지 않도록 서로 다른 프로필/컨텍스트를 사용하세요. 실제 학급방에서 삭제·점수 초기화·새 라운드 테스트를 하는 대신 테스트 방과 합성 데이터를 쓰는 것이 안전합니다.

## 6. 수정 순서를 고를 때

먼저 [위험요소](findings.md)의 확정 사실과 정책 확인 항목을 구분하세요. 예를 들어 ‘연결이 끊긴 학생의 표를 남길 것인가’는 단순 삭제 버그 수정이 아니라 학급 투표 정책에 관한 선택입니다. ‘일반 시민이 한 번만 바꿀 수 있는가’도 안내를 바꿀지 서버 제한을 넣을지 먼저 결정해야 합니다.

현재 문서에는 수정 제안과 테스트 방향만 있습니다. 배포, 데이터 삭제, 저장 구조 변경은 실제 수정 요청과 검증을 거쳐 별도로 진행해야 합니다.
