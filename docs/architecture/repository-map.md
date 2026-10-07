# 저장소와 기능별 코드 지도

[문서 첫 화면](README.md) · 기준일 2026-08-31

## 1. 중요한 경로만 남긴 폴더 지도

아래는 조사한 폴더를 역할 중심으로 묶은 지도입니다. 캐시 안의 수많은 파일, 중복 이미지, 로컬 방 데이터는 나열하지 않았습니다.

```text
poll-main/
├─ public/                         # 브라우저에서 실행하는 앱 원본
│  ├─ index.html                   # 교사·학생 HTML 입구, #app, 스크립트 로딩
│  ├─ app.js                       # 교사·학생 화면, 입력, 세션, API, 실시간 연결
│  ├─ styles.css                   # 교사·학생 화면 스타일과 테마
│  ├─ display.html                 # 교실 TV HTML 입구
│  ├─ display.js                   # TV 장면, 공개 상태, BGM, 전체화면
│  ├─ display.css                  # TV 전용 스타일
│  ├─ sw.js                        # 정적 파일의 Service Worker 캐시
│  ├─ manifest.webmanifest         # 설치형 웹앱 이름·아이콘·시작 주소
│  ├─ _headers                     # 정적 응답 보안 헤더
│  └─ assets/                      # 앱 아이콘·배경·모드·스킬 PNG
├─ src/                            # Cloudflare에서 실행하는 서버 원본
│  ├─ worker.js                    # HTTP 입구, Room, 인증, 저장, WebSocket, 알람
│  └─ game.js                      # 방·학생·게임 규칙, 점수, 공개 상태 변환
├─ scripts/
│  └─ build-assets.js              # public과 배포용 manual 파일을 .dist에 복사
├─ test/
│  ├─ entry-policy.test.js         # 입장 화면·소스 수준 정책 검사
│  └─ game-engine.test.js          # 게임·인원·공개 범위·점수 등의 단위 테스트
├─ manual/                         # 실제 앱에서 /manual/로 제공하는 사용설명서
│  ├─ index.html                   # 배포되는 설명서 본문
│  ├─ assets/screenshots/          # 배포되는 설명용 화면 이미지 20개
│  ├─ manifest.yaml, STATUS.md     # 설명서 제작·범위 관리용, 배포하지 않음
│  ├─ HANDOFF.md                   # 설명서 인수인계 기록, 배포하지 않음
│  ├─ sources/workflow-inventory.md
│  └─ qa/                         # 검증 기록·이미지, 배포하지 않음
├─ 260822_game_mode_guide/         # 게임 모드 발표자료 제작 프로젝트
│  ├─ raw_script.md, slide_plan.json, slide_context.yaml
│  ├─ HANDOFF.md, assets/
│  └─ output/                      # 완성 HTML·PPTX·슬라이드 캡처, 앱 배포 대상 아님
├─ docs/architecture/              # 이번에 작성한 코드 구조 교육자료
├─ .dist/                          # 생성된 배포용 정적 파일: 직접 수정 금지
├─ .wrangler/                      # 로컬 실행 캐시·상태·임시 파일: 운영 원본 아님
├─ output/playwright/              # 화면 검사 결과·로그: 앱 배포 대상 아님
├─ package.json                    # Node 조건, 명령어, 직접 의존성
├─ package-lock.json               # 재현 가능한 의존성 버전 잠금
├─ wrangler.jsonc                  # Worker·정적 자산·DO 연결과 배포 설정
├─ .gitignore                      # 생성물·개발용 파일 제외 규칙
├─ README.md                       # 서비스 사용·개발·배포 개요
└─ prompt_history.md               # 기존 수정 과정에서 얻은 노하우 기록
```

`.dist`와 `.wrangler`에 파일이 있다고 해서 별도의 프론트엔드 프로젝트나 별도 DB 서버가 있는 것은 아닙니다. 로컬 폴더에는 현재 `.git`이 없으며 Git 작업 트리로 인식되지 않습니다.

## 2. 파일별 역할과 변경 영향

### A. 반드시 이해해야 하는 핵심 파일

| 파일 | 무엇을 담당하는가 / 언제 실행되는가 | 연결되는 파일 | 수정 출발점 / 삭제·변경 영향 |
|---|---|---|---|
| [package.json](../../package.json) | 개발자가 npm 명령을 실행할 때 사용할 스크립트·도구 | 빌드 스크립트, Wrangler, 테스트 | 실행 방법 확인의 출발점. 잘못 바꾸면 개발·배포 명령이 중단됨 |
| [public/index.html](../../public/index.html) | 브라우저가 교사·학생 앱을 처음 열 때 DOM 뼈대 생성 | `app.js`, `styles.css`, manifest | `#app`, toast, dialog와 script 연결을 바꾸면 화면·이벤트가 깨질 수 있음 |
| [public/app.js](../../public/app.js) | 브라우저 시작 및 입력·클릭·수신 때 화면과 요청 처리 | `index.html`, `styles.css`, `worker.js`, `game.js`의 응답 | 글자·폼·교사/학생 행동을 바꿀 때 첫 파일. 서버 검증도 함께 확인 |
| [src/worker.js](../../src/worker.js) | HTTP·WebSocket·알람 이벤트마다 실행 | `game.js`, Wrangler의 `ROOMS/ASSETS` | URL, 인증, 연결, 저장의 출발점. 오류는 모든 화면과 방 데이터에 영향 |
| [src/game.js](../../src/game.js) | 서버가 게임 명령·공개 상태 생성을 요청할 때 실행 | `worker.js`, 프론트 상태 소비 코드, 테스트 | 규칙·점수·단계를 바꿀 때 첫 파일. 화면만 바꿔서는 규칙이 바뀌지 않음 |
| [wrangler.jsonc](../../wrangler.jsonc) | Wrangler 개발·배포 때 읽고 런타임 바인딩에 반영 | Worker, `.dist`, DO 클래스 | 배포 위치와 저장소 연결 확인. 클래스·바인딩 변경은 데이터 접근에 영향 |

### B. 특정 기능을 수정할 때 보는 파일

| 파일·폴더 | 담당 / 실행 시점 | 연결 관계 | 변경 영향 |
|---|---|---|---|
| `public/styles.css` | 교사·학생 화면 표시 때 스타일 적용 | `app.js`가 만드는 class | 뒤쪽 테마 규칙이 앞쪽 규칙을 덮어씀. 앞부분만 수정하면 안 보일 수 있음 |
| `public/display.html`, `display.js`, `display.css` | TV 주소를 열 때 공개 장면·음향 표시 | `displayState`, 공개 API | TV 전용 변경은 교사·학생 JS와 분리되지만 데이터 형식은 서버와 공유 |
| `public/sw.js` | 설치·활성화·정적 GET 때 캐시 처리 | 두 UI의 Service Worker 등록 | API는 제외. 캐시 수정은 새 버전 반영·오프라인 표시와 연결 |
| `public/manifest.webmanifest`, `public/assets/` | 웹앱 설치 정보·그림 표시 | HTML, CSS, Service Worker | 파일 이름을 바꾸면 참조 경로와 캐시 목록도 확인 |
| `public/_headers` | 배포된 정적 파일 응답 헤더 | Static Assets | Worker가 직접 만든 JSON 응답과 적용 경계가 다름 |
| `scripts/build-assets.js` | `build`, `dev`, `deploy`의 준비 단계 | `public`, `manual`, `.dist` | 배포 파일 범위를 결정. 원본이 아닌 `.dist`만 수정하면 다음 빌드에 사라짐 |
| `test/*.test.js` | `npm test` / `node --test` | 소스 문자열과 `game.js` 내보내기 | UI·게임 회귀 검사. 실제 여러 브라우저 연결 검사와 같지 않음 |
| `manual/index.html`, `manual/assets/` | 사용자가 `/manual/`을 열 때 | 빌드 복사 대상 | 사용 안내 변경용. 규칙 설명은 게임 엔진과 맞춰야 함 |
| `manual/sources`, `manual/qa`, 제작 기록 | 문서 작성·QA 때 참고 | 설명서 | 운영 실행 코드는 아니지만 삭제하면 검증·인수인계 근거가 사라짐 |
| `260822_game_mode_guide/` | 별도 발표자료 작성·열람 때 | 자체 HTML·PPTX·이미지 | 운영 앱 모듈이 아님. 발표자료의 편집용 API를 앱 API로 오해하지 말 것 |

### C. 자동 생성되었거나 직접 수정하지 않는 것이 좋은 파일

| 경로 | 만들어지는 과정 | 다루는 원칙 |
|---|---|---|
| `.dist/` | `npm run build`가 출력 폴더를 비운 후 원본 복사 | 변경은 `public/`, `manual/` 원본에 함 |
| `.wrangler/` | Wrangler 로컬 개발·실행 | 로컬 방 상태가 포함될 수 있음. 문서나 버전 관리에 데이터 내용을 복사하지 않음 |
| `package-lock.json` | npm 의존성 설치·갱신 | 불필요한 라이브러리 목록으로 보고 삭제하지 않음. npm이 관리하도록 함 |
| `output/playwright/` | 이전 화면 검사 | 증거·임시 산출물. 스냅샷에 세션 정보가 있을 수 있어 외부 공유 전 검사 |
| 발표자료 `output/presentation.pptx`, `captures/` | HTML 기반 발표자료 변환·캡처 | 직접 코드 수정 대상이 아님. 발표자료 원본/제작 기록을 먼저 확인 |
| 발표자료 `output/index.html` | 만들어진 자체 완결형 발표 HTML | 앱 실행 코드와 분리. 제공된 제작 흐름을 확인한 뒤 수정 |
| `docs/architecture/images/*.svg`, `*.png` | Mermaid 원본 렌더링 | 종합 도식 변경은 `.mmd` 및 문서의 같은 코드부터 수정하고 재생성 |

## 3. 사용자가 보는 기능 → 코드 위치

표의 저장 위치는 별도 테이블명이 아니라 저장된 방 객체 내부 경로입니다. 모든 변경 API는 성공 시 `Room.persist()`를 거칩니다.

| 사용자가 보는 기능 | 시작되는 화면 또는 컴포넌트 | 핵심 로직 | 서버/API | 데이터 저장 위치 | 관련 파일 |
|---|---|---|---|---|---|
| 교사가 새 방 만들기 | `landing → authScreen`, 생성 폼 제출 | `createRoom`, `pinHash` | `POST /api/rooms` | `room`의 학급·교사·인증 필드 | `public/app.js`, `src/worker.js`, `src/game.js` |
| 교사가 기존 방 열기 | `authScreen('teacher-login')` | PIN 확인, 교사 토큰 재발급 | `POST /api/rooms/:code/teacher-login` | 교사 토큰·로그인 실패 제한 | 같은 세 파일 |
| 학생 초대·입장 | `linkedRoom`, 학생 입장 폼 | `joinRoom` | `POST /api/rooms/:code/join` | `room.players[playerId]` | `public/app.js`, `src/game.js` |
| 새로고침 뒤 재입장 | `readSession → restore` | `authenticate` | `GET /api/rooms/:code/state` | 브라우저 localStorage + 기존 방 | `public/app.js`, `src/worker.js` |
| 모드·제목·보기 설정 | `teacherSetup → roundForm` | `createRound`, `defaultOptions` | action: `create_round` | `room.currentRound` | `public/app.js`, `src/game.js` |
| 연결 명단과 현재 인원 | `roster` | `activePlayerIds`, `activeRoundPlayerIds` | WebSocket 상태 / action: `remove_player` | `players`, `disconnectedAt`; 연결 목록은 별도 | `public/app.js`, `src/worker.js`, `src/game.js` |
| 학생 투표 | `studentRound → votePanel` | `studentAction → submitVote` | action: `vote` | `votes.first/final[playerId]` | `public/app.js`, `src/game.js` |
| 표심전 1차·최종 예측 | `predictionPanel` | `submitPrediction` | action: `predict` | `predictions[playerId]` | 같은 두 파일 |
| 정보 토큰·올인 | `skillPanel`, `skillDialog` | `skillResult` | action: `use_skill` | `skills[playerId]` | 같은 두 파일 |
| 이동 예측 | `signalPanel` | `submitMovementPrediction` | action: `movement_predict` | `movementPredictions[playerId]` | 같은 두 파일 |
| 팀 단서·공동 답 | `cluePanel`, `teamGuessPanel` | `generateClues`, `submitTeamGuess` | action: `team_guess` | `clues[playerId]`, `teamGuesses[team]` | 같은 두 파일 |
| 비밀 임무·역할 카드 | `studentPhase`, `studentRound` | `assignMissions`, `missionText`, `assignRoles`, `roleText` | 라운드 생성과 상태 응답 | `missions/roles[playerId]` | 같은 두 파일 |
| 타이머·다음 단계 | `teacherLive`, `timerHtml` | `advanceRound`, `maybeAdvanceCompletedPhase`, `Room.alarm` | action: `set_timer`, `advance` | `phase`, `timerEnd`, `timerExpired` | `public/app.js`, `src/game.js`, `src/worker.js` |
| 결과 공개·개인 점수 내역 | `resultList`, `scoreReceipt` | `revealNext`, `scoreRound`, `clientState` | action: `reveal_next`, `finish_round` | `points`, `pointBreakdowns`, `players[].score` | `public/app.js`, `src/game.js` |
| 교실 TV·BGM·팀 현황 | `frame`, 장면 함수, `Soundscape` | `receiveState`, `displayState`, `publicDisplayOutcome` | `display-state`, `display-events` | 게임 상태는 방; 음량·코드 숨김은 localStorage | `public/display.*`, `src/game.js` |
| 사용설명서 | `manual/index.html` | 자체 탭·이미지 확대 코드 | `/manual/` 정적 응답 | 서버에 사용자 입력 저장 없음 | `manual/`, `scripts/build-assets.js` |

회원가입, 이메일 로그인, 게임 중 파일 업로드, 지도, 결제, AI 생성 기능은 운영 앱에서 확인되지 않았으므로 기능 표에 만들어 넣지 않았습니다.

## 4. 실행 위치별 분류

| 분류 | 실제 파일 | 주의할 경계 |
|---|---|---|
| 프론트엔드 | `public/*.html`, `app.js`, `display.js`, CSS, `sw.js`, 정적 설명서 | 사용자가 내려받아 볼 수 있는 코드 |
| 백엔드 | `src/worker.js`, `src/game.js` | 권한·게임 규칙의 최종 판단은 여기 |
| 공통 코드 | 별도의 브라우저·서버 공유 모듈 없음 | `game.js`는 Worker와 테스트에서 공유하지만 브라우저에서 import하지 않음 |
| DB 관련 코드 | `Room.loadRoom/persist/expire`, `wrangler.jsonc`의 DO 설정 | 따로 `db.js`, ORM, SQL 스키마 파일이 있는 구조 아님 |
| 외부 API 연동 | 운영 게임의 업무용 외부 API 모듈 없음 | Cloudflare 바인딩·Wrangler는 인프라 연결 |
| 배포 설정 | `wrangler.jsonc`, `package.json`, 빌드 스크립트, `_headers` | 프론트와 서버를 한 Worker 배포에 포함 |
| 개발 도구 | `package-lock.json`, `.gitignore` | 직접 의존성은 개발용 Wrangler 하나 |
| 테스트 | `test/`, 기존 QA 산출물 | 단위 테스트와 브라우저 검사는 서로 다른 증거 |

## 5. 없음을 확인한 설정

Vite·Next·TypeScript 설정, `.env.example`, `.env`, `.dev.vars`, Firebase·Firestore·Supabase·Prisma 설정, 별도 `migrations/`, Render·Netlify·Vercel 설정, Dockerfile·Compose, `.github/workflows`, `server.*`, 별도 `api/`, `routes/`, `services/`, `lib/`, `config/` 폴더는 현재 프로젝트에서 확인되지 않았습니다.

단, **마이그레이션 설정 자체가 없는 것은 아닙니다.** `wrangler.jsonc`에 DO 클래스 생성을 위한 `migrations`가 있습니다. 또한 `api()`라는 함수는 `src/worker.js` 안에 있습니다. 폴더명이 없다고 기능도 없다고 판단하면 안 됩니다.

## 6. 사용되지 않거나 중복될 가능성이 있는 것

| 대상 | 실제 확인 내용 | 판정 |
|---|---|---|
| `round.config.anonymous` | 생성·상태 응답에는 있으나 동작을 분기하는 사용처 없음 | 저장 필드는 남아 있지만 기능 연결 없음 |
| 교사 action `set_team` | 서버 처리기는 있으나 현재 앱에서 호출하는 UI 없음 | 미연결 API 기능; 향후 의도는 확인 필요 |
| `history` | 서버에 보관·교사 응답에 포함하지만 별도 기록 화면 없음 | 저장 기능은 사용 중, UI는 미연결 |
| 앞쪽 CSS의 모드·스킬·히어로 이미지 | 뒤쪽 테마에서 숨기거나 배경을 덮어씀 | 현재 화면 사용성 확인 후 정리할 후보 |
| TV의 `.aurora`, `.star-field` | 뒤쪽 CSS에서 숨김. `createStars`는 여전히 요소 생성 | 가려진 연출 코드 후보 |
| 앱 atlas·hero PNG | 현재 테마에서 덜 쓰여도 `sw.js` 사전 캐시에 등록됨 | 완전 미참조 파일이라고 단정하면 안 됨 |
| `.gitignore`의 `/data/rooms.json` | 현재 `data/`와 해당 저장 코드는 없음 | 이전 구조의 제외 규칙으로 보이는 흔적 |
| 발표자료 편집용 `/api/save-*`, `/api/upload-image` | 로컬 개발 호스트에서만 시도하는 보조 코드, 현재 서버 구현 없음 | 운영 앱 API가 아닌 분리된 제작 도구 흔적 |
| Wrangler 간접 의존성 | lock에 `ws`, `esbuild`, `sharp` 등 존재 | 앱의 불필요한 직접 라이브러리로 분류하지 않음 |

이번 조사에서는 위 후보를 삭제하거나 정리하지 않았습니다. 구체적인 영향은 [위험요소](findings.md), 수정 전 확인은 [수정 안내](modification-guide.md)를 참고하세요.
