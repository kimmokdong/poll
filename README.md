# 마음신호

교사·학생·교실 TV가 실시간으로 연결되는 교실용 투표·추리 게임입니다. 정식 투표부터 표심전, 소수파 생존, 정확히 N명, 정보 연합전, 비밀 목표전까지 8개 모드를 제공합니다.

## 운영 구조

- 정적 화면과 API: Cloudflare Workers
- 방별 상태 저장: Durable Objects의 영구 저장소
- 실시간 동기화: WebSocket Hibernation API
- 방 보관: 마지막 활동 후 24시간, 이후 자동 삭제
- 배포: GitHub `main` 브랜치와 Cloudflare Workers Builds 연결

각 방 코드는 독립된 Durable Object 하나에 연결됩니다. 여러 교사가 동시에 서로 다른 방을 만들어도 학생·투표·점수·TV 연결이 섞이지 않습니다. Worker가 쉬거나 새 버전이 배포되어도 방 상태는 저장소에 남고, 24시간 동안 활동이 없을 때만 자동 정리됩니다.

## 로컬 실행

Node.js 20 이상에서 실행합니다.

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
- Deploy command: `npx wrangler deploy`
- Root directory: 저장소 루트

## 교실 운영

1. 교사가 첫 화면에서 학급방을 만들고 4자리 관리 PIN을 정합니다.
2. 교사 화면에서 `학생 참여 링크 복사`를 눌러 그 링크만 학생에게 보냅니다.
3. 교사 화면에서 `📺 교실 TV 열기`를 눌러 앞 TV에 공개 화면을 띄웁니다.
4. 투표나 게임을 열면 학생·교사·TV 화면이 WebSocket으로 즉시 동기화됩니다.
5. 같은 브라우저는 입장 정보를 기억하지만, 방이 24시간 동안 사용되지 않아 삭제되면 새 방에 다시 입장해야 합니다.

TV에는 학생 이름·개별 선택·비밀 임무를 보내지 않고 참여 인원, 타이머, 공개 단서와 결과만 표시합니다.

## 사용 자료

- 앱 첫 화면의 `📘 사용설명서` 또는 `/manual/`: 교사·학생·교실 TV용 실제 화면 안내
- `260822_game_mode_guide/output/presentation.pptx`: 게임 모드 설명용 발표 자료

## 확인

```powershell
npm test
npm run build
npx wrangler deploy --dry-run
```
