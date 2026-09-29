# 마음신호

교사·학생·교실 TV가 실시간으로 연결되는 교실용 투표·추리 게임입니다. 정식 투표부터 표심전, 소수파 생존, 정확히 N명, 정보 연합전, 비밀 목표전까지 8개 모드를 제공합니다.

## 운영 구조

- 정적 화면과 API: Cloudflare Workers
- 방별 상태 저장: Durable Objects의 영구 저장소
- 실시간 동기화: WebSocket Hibernation API. `ping`은 런타임 자동 응답으로 처리해 Durable Object를 깨우지 않습니다.
- 방 보관: 마지막 활동 후 24시간, 이후 자동 삭제. 상태 조회·재접속만 있을 때는 10분에 한 번만 보관 기한을 늘려 저장소 쓰기를 줄입니다.
- 배포: GitHub `main` 브랜치와 Cloudflare Workers Builds 연결

방 코드는 숫자 5자리이고, 각 방 코드는 독립된 Durable Object 하나에 연결됩니다. 여러 교사가 동시에 서로 다른 방을 만들어도 학생·투표·점수·TV 연결이 섞이지 않습니다. Worker가 쉬거나 새 버전이 배포되어도 방 상태는 저장소에 남고, 24시간 동안 활동이 없을 때만 자동 정리됩니다.

## 로컬 실행

Node.js 22 이상에서 실행합니다. (Wrangler 4.125가 Node.js 22를 요구합니다.)

```powershell
npm install
npm run dev
```

브라우저에서 `http://127.0.0.1:8787`을 엽니다. 로컬 방 데이터는 `.wrangler/`에 저장되며 Git에는 올라가지 않습니다.

## Cloudflare 첫 배포

```powershell
npx wrangler login
npm run deploy
```

첫 배포에서 `maeum-signal-poll` Worker와 `Room` Durable Object가 만들어집니다. 이후 같은 명령으로 새 버전을 배포할 수 있습니다.

GitHub 자동 배포는 Cloudflare 대시보드에서 `kimmokdong/poll` 저장소의 `main` 브랜치를 연결하고 다음 값으로 설정합니다.

- Build command: `npm run build`
- Deploy command: `npm test && npx wrangler deploy`
- Root directory: 저장소 루트

Deploy command에 `npm test`를 넣어 두면 테스트가 실패한 커밋은 배포되지 않습니다. 모든 PR과 `main` 푸시는 GitHub Actions(`.github/workflows/ci.yml`)에서 테스트, 빌드, `wrangler deploy --dry-run`을 먼저 확인합니다.

## 교실 운영

1. 교사가 첫 화면에서 학급방을 만들고 4자리 관리 PIN을 정합니다.
2. 교사 화면에서 `학생 참여 링크 복사`를 눌러 그 링크만 학생에게 보냅니다.
3. 교사 화면에서 `📺 교실 TV 열기`를 눌러 앞 TV에 공개 화면을 띄웁니다.
4. 투표나 게임을 열면 학생·교사·TV 화면이 WebSocket으로 즉시 동기화됩니다. 제출이 한꺼번에 몰리면 약 0.1초 단위로 묶어 한 번에 보냅니다.
5. 연결이 끊기면 1.5초부터 최대 30초까지 간격을 늘려 가며 다시 연결하고, 끊긴 동안 놓친 상태를 받아 옵니다. 입장 정보는 서버가 만료를 알릴 때만 지웁니다.
6. 같은 브라우저는 입장 정보를 기억하지만, 방이 24시간 동안 사용되지 않아 삭제되면 새 방에 다시 입장해야 합니다.

TV에는 학생 이름·개별 선택·비밀 임무를 보내지 않고 참여 인원, 타이머, 공개 단서와 결과만 표시합니다. TV 위쪽의 `ROOM` 코드를 누르거나 `R` 키를 누르면 방 코드를 화면 가득 크게 보여 줍니다.

## 사용 자료

- 앱 첫 화면의 `📘 사용설명서` 또는 `/manual/`: 교사·학생·교실 TV용 실제 화면 안내
- `260822_game_mode_guide/output/presentation.pptx`: 게임 모드 설명용 발표 자료

## 확인

```powershell
npm test
npm run build
npx wrangler deploy --dry-run
```

`npm test`는 외부 패키지 없이 Node.js 기본 테스트 도구로 게임 규칙, 화면 진입 정책, Durable Object 동작(동시 입장·투표, 전송 묶음, 알람, 만료, 저장 형식 변환)을 확인합니다.

## 코드 구조

- `src/worker.js`: 요청 라우팅과 방별 Durable Object(`Room`) — 저장, 알람, 실시간 전송
- `src/game.js`: 방·라운드 진행, 학생 제출, 화면별 상태, 저장 형식 변환(`migrateRoom`)
- `src/modes.js`: 8개 모드의 단계·시작 조건·점수·TV 결과 판정
- `src/ranking.js`: 공동 순위(동점) 계산
- `public/`: 교사·학생 화면(`app.js`), 교실 TV(`display.js`), 서비스 워커(`sw.js`)
