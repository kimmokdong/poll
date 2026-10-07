# 외부 서비스·인증·환경변수 지도

[문서 첫 화면](README.md) · 기준일 2026-08-31

## 1. 운영 게임의 업무용 외부 API 연결 없음

운영 앱은 투표·예측·채점할 때 OpenAI, Firebase, Supabase, 지도, 결제, 이메일 같은 외부 업무 API를 호출하지 않습니다. 브라우저의 API 요청은 현재 서비스와 같은 origin의 `/api/rooms/...`로 갑니다.

다만 **외부 API가 없다는 것과 클라우드 서비스를 안 쓴다는 것은 다릅니다.** 서버 실행·저장·정적 파일 배포는 Cloudflare를 사용합니다. 별도 발표자료 HTML에는 외부 글꼴 연결이 있어 아래에서 구분합니다.

## 2. 서비스·플랫폼별 연결

| 외부 서비스 | 사용 목적 | 호출되는 코드 위치 | 인증 방식 | 주고받는 데이터 | 장애 시 영향 |
|---|---|---|---|---|---|
| Cloudflare Workers | HTTPS API·정적 경로 입구 | `src/worker.js` 기본 export `fetch`, `api` | 앱 API는 자체 방 세션; 배포 계정 인증과 별개 | 요청 JSON·응답 JSON·정적 파일 | 방 생성·입장·명령·접속 불가 |
| Cloudflare Durable Objects | 방별 처리·저장·WebSocket 관리 | `roomStub`, `Room` 클래스; `wrangler.jsonc`의 `ROOMS` | 플랫폼 바인딩으로 접근; Room에서 앱 권한 검사 | 방 객체·실시간 연결·알람 | 해당 방 상태 저장·게임 진행·실시간 갱신 영향 |
| DO Storage | SQLite 기반 영구 저장 | `Room.loadRoom/persist/expire` | `ctx.storage`를 서버에서만 사용 | `room` 키의 객체 | 읽기/저장 실패가 API 오류로 이어짐 |
| Workers Static Assets | 화면 파일·이미지·설명서 전달 | `env.ASSETS.fetch`, `.dist` 설정 | 공개 정적 자산; 별도 앱 토큰 불필요 | HTML·CSS·JS·PNG 등 | 화면 로딩 실패; 일부 이전 캐시만 남을 수 있음 |
| Cloudflare 관측 기능 | Worker 실행 로그 확인 | `wrangler.jsonc`의 observability, 서버 `console.error` | Cloudflare 계정 권한 | 플랫폼 실행·오류 정보 | 서비스 자체와 별개로 문제 원인 추적이 어려워짐 |
| Wrangler / Cloudflare 계정 | 개발·배포 인증과 업로드 | `package.json`, `wrangler.jsonc` | CLI 로그인 등 도구 인증. 비밀값 미조사·미수록 | 코드·설정·정적 배포 자산 | 새 배포·관리 작업 실패; 이미 배포된 앱의 사용자 로그인과는 별개 |
| Workers Builds / GitHub | README에 적힌 자동 배포 연결 대상 | 루트 `README.md`의 연결 안내 | 원격 대시보드 연결 상태 **확인 필요** | 연결된 경우 소스·빌드 결과 | 현재 활성 여부를 몰라 영향도 확인 필요 |
| Google Fonts — 발표자료만 | 별도 슬라이드의 글꼴 | `260822_game_mode_guide/output/index.html`의 font link | 공개 글꼴 요청, API 키 없음 | 글꼴 CSS·font 파일 | 발표자료 글꼴·줄바꿈이 대체될 수 있음; 운영 앱에는 해당 없음 |

Cloudflare 서비스들은 실제 런타임·배포 연결이며, GitHub 자동 배포는 README에 기록된 설정 의도입니다. 두 종류를 같은 수준으로 ‘현재 활성화됨’이라고 단정하지 않습니다.

## 3. 어느 쪽에서 호출하는가?

| 구분 | 실제 사용 |
|---|---|
| 브라우저 → 업무용 외부 도메인 | 운영 앱에는 없음. 별도 발표자료만 Google Fonts 사용 |
| 브라우저 → 우리 서버 | `app.js`: `api`, `connect`; `display.js`: `loadState`, `connect` |
| 우리 서버 → 외부 업무 API | 없음 |
| 우리 서버 → 플랫폼 내부 서비스 | `ROOMS` 바인딩으로 방 객체, `ASSETS` 바인딩으로 정적 파일, `ctx.storage`로 저장 |
| DB 역할 | Durable Object Storage |
| 학생·교사 로그인 역할 | 외부 서비스가 아니라 `src/game.js`와 `Room.fetch`의 자체 구현 |
| 배포·호스팅 역할 | Wrangler, Cloudflare Workers, Static Assets |

`room.internal`이라는 문자열은 `ROOMS`를 통해 얻은 stub에 전달할 내부 요청 URL입니다. 이 주소를 사용하는 제3자 API나 실제 외부 DB 서버가 있는 것으로 설명하면 안 됩니다.

## 4. 인증: 앱 입장과 클라우드 배포를 구분하기

### 앱 사용자 인증

- 교사는 새 방 생성 때 숫자 4자리 PIN을 정합니다. 서버는 salt와 SHA-256 해시를 보관합니다.
- 기존 방에서는 PIN을 검증한 뒤 교사 토큰을 새로 발급합니다. 실패 횟수에 따른 짧은 잠금 처리가 있습니다.
- 학생은 초대 링크에 포함된 방 코드 또는 메인 화면에 직접 입력한 5자리 코드와 이름으로 들어옵니다. 두 경로 모두 같은 입장 API를 사용하고, 서버가 학생별 불투명 토큰을 발급합니다. 별도 이메일 회원가입·비밀번호 계정은 없습니다.
- HTTP 요청에서 브라우저는 `Authorization: Bearer` 방식으로 세션 토큰을 보냅니다. WebSocket 연결에서는 query 매개변수로 보냅니다.
- `authenticate()`가 토큰을 검사하고, `Room.fetch()`가 교사/학생 action을 분리합니다. `studentAction()`은 참가자와 단계도 확인합니다.
- TV 공개 조회는 토큰을 요구하지 않습니다. 방 코드는 공개 TV 상태를 찾을 수 있는 정보이므로 공개 범위를 이해하고 공유해야 합니다.

토큰은 JWT가 아니며, Firebase Auth·Supabase Auth·Netlify Identity·OAuth를 학생 로그인에 사용하는 코드도 없습니다. 학생 본인 확인의 강도는 학교 계정 로그인과 같지 않습니다.

### 배포 인증

Wrangler의 Cloudflare 로그인은 ‘누가 이 Worker를 배포·관리할 수 있는가’를 확인합니다. 앱의 교사 PIN은 ‘누가 이 학급방을 조작할 수 있는가’를 확인합니다. 한쪽 정보를 다른 쪽 코드에 넣지 마세요. 현재 로컬 계정의 인증 파일이나 비밀값은 문서화 대상에서 제외했습니다.

## 5. 환경변수 지도 — 이름과 용도만

### 앱 코드가 실제로 읽는 환경변수

| 환경변수 이름 | 사용 위치 | 용도 | 브라우저 노출 가능 여부 | 배포 플랫폼 설정 필요 여부 |
|---|---|---|---|---|
| `ROOM_TTL_HOURS` | `wrangler.jsonc`의 vars, `src/worker.js`: `Room.ttlMs()` | 방 데이터의 비활동 만료 기간 제어 | 비밀키는 아니지만 현재 클라이언트로 전달하지 않음 | 현재 Wrangler 설정으로 제공; 미설정 시 코드의 기본 처리 있음 |

실제 설정값은 생략했습니다. 이 항목은 DB 접속 비밀번호·API 주소·환경 구분 값이 아니라 **서버 동작 설정**입니다. 현재 코드에서 읽지 않는 추가 앱 환경변수는 확인되지 않았습니다.

### `env` 안에 있지만 단순 문자열 환경변수가 아닌 것

| 이름 | 종류 | 용도 | 브라우저에 전달하는가? |
|---|---|---|---|
| `ROOMS` | Durable Object namespace 바인딩 | 방 코드로 Room 객체 찾기 | 아니요 |
| `ASSETS` | 정적 자산 바인딩 | 배포 파일 응답 | 바인딩 자체는 전달하지 않고 요청한 파일만 전달 |

`ROOMS`, `ASSETS`를 `.env`에 문자열로 적는다고 같은 객체가 생기지 않습니다. `wrangler.jsonc`가 플랫폼 리소스와 연결합니다. `ctx.storage`도 환경변수나 DB URL이 아니라 해당 DO에 주어진 저장소 객체입니다.

### 별도로 확인해야 하는 도구 설정

- 저장소에 `.env.example`, `.env`, `.dev.vars`는 없었습니다.
- Wrangler 인증에 필요한 개인 로컬 설정이나 원격 CI의 비밀변수는 조사하지 않았습니다. 존재·방식은 **확인 필요**입니다.
- 이 저장소에 없는 DB 접속정보, 외부 API 키, 환경변수를 관례대로 만들어 목록에 추가하지 않았습니다.

## 6. 이미지·파일 업로드·음향

| 대상 | 실제 보관·처리 |
|---|---|
| 앱 이미지 | `public/assets/`의 PNG → build → `.dist/assets/` → Static Assets |
| 설명서 이미지 | `manual/assets/screenshots/` → `.dist/manual/assets/` |
| 게임 중 사용자 파일 업로드 | 운영 앱에 업로드 폼·API·저장소 없음 |
| 외부 파일 저장소 | S3·R2·Firebase Storage 등 연결 없음 |
| TV BGM | `public/display.js`의 `Soundscape`가 Web Audio로 합성. 외부 음원·오디오 업로드 없음 |
| 발표자료 이미지 | 발표자료 폴더 안의 자체 assets/output 산출물; 앱 배포와 분리 |

발표자료의 `output/index.html`에는 `/api/save-theme`, `/api/save-order`, `/api/save-text-edits`, `/api/upload-image` 보조 코드가 있습니다. 로컬 개발 호스트에서 사용하는 편집 기능 흔적이며, 현재 `src/worker.js`에 대응 서버가 없습니다. `upload-image`에 파일을 base64로 보내는 코드가 있다고 해서 운영 게임이 이미지 업로드 기능을 제공하는 것은 아닙니다. 저장용 로컬 서버의 원래 위치는 **확인 필요**입니다.

발표자료 HTML에는 Reveal.js 계열 코드도 내장되어 있습니다. 운영 앱의 화면 프레임워크나 package.json의 직접 의존성으로 분류하지 않았습니다.

## 7. 보안상 공유하면 안 되는 것

- 교사·학생 토큰이 들어 있는 localStorage, WebSocket 연결 URL, 개발자도구 화면.
- PIN, PIN 해시·salt, Cloudflare 로그인 파일, 플랫폼 API 키.
- `.wrangler/state/`의 실제 방 데이터, 검수하지 않은 테스트 로그·스냅샷.

현재 공개 소스에서 실제 플랫폼 비밀키가 하드코딩된 사실은 확인하지 못했습니다. 그러나 브라우저 localStorage에는 세션 인증정보를 보관하고 있으며, PIN 입력칸은 현재 비밀번호 마스킹 타입이 아닙니다. 공유 PC·화면 녹화·스크립트 삽입에 대한 주의가 필요합니다. 이는 키 유출이 발생했다는 단정과는 다릅니다. 자세한 우선순위는 [위험요소](findings.md)에 정리했습니다.
