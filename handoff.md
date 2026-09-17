# vnmaker 인수인계

작성 2026-09-12. 이 문서만 읽고 이어서 작업할 수 있게 쓴다. 추측과 확인된 사실을 구분했다.
(이전 인수인계 — 2026-08-31, 코드 작성 전 시점 — 는 git 이력에서 복원 가능하다. agy 프로토콜 함정은 아래에 이어서 적었다.)

## 한 줄 요약

코드베이스 전체에 대한 **적대적 리뷰를 끝냈고, 코드 변경은 0**이다. 다음 할 일은 아래 발견 목록을 우선순위대로 수정하는 것이다. 가장 급한 건 `oauth.ts:33` — Windows에서 로그인이 깨진다.

## 저장소 상태

- pnpm 모노레포: `packages/{app,content,ir,gateway}`. Node 24.20.x, pnpm 11.24.0.
- 테스트 전부 통과하는 상태다:
  ```
  pnpm -r test && node tools/audio-check.mjs && node --test tools/momus-gate-doctor.test.mjs tools/audio/reproducibility.test.mjs
  ```
  (content 9, ir 15, gateway ~54, app 160, audio 15/15, doctor 26. e2e는 `tests/e2e/` 32개 — Playwright.)
- **단, 통과는 happy path의 증거다.** 아래 결함들을 잡는 테스트는 없다 — 수정할 때 회귀 테스트를 같이 넣어라.
- 루트에 untracked 테스트 산출물이 있다: `nul`, `wrong-server.json`, `fade*.jpeg`, `pending-*.jpeg`. 커밋하지 말 것. `nul`은 Windows 예약명이라 일반 경로로 삭제가 안 될 수 있다(`\\?\` 접두 필요).
- 커밋은 사용자가 명시적으로 요청할 때만.
- 리뷰 원문 전체(증거·시나리오 포함)는 대화 요약에 있다:
  `C:\Users\ubbio\AppData\Roaming\devin\cli\summaries\history_9ce6ac32623f4438.md`

## 모범 패턴 — 수정할 때 여기서 베끼면 된다

같은 레포 안에 이미 정답이 있다. **경화가 비일관적인 게 이 리뷰의 핵심 지적이다.**

- 원자적 쓰기: `packages/app/native-build-store.ts:26-31` (tmp 파일 + fsync + rename)
- 레코드 검증: 같은 파일 `validated()` — 손상은 `[]`/`null`이 아니라 **오류**로 보고
- 로컬 HTTP 보호: `packages/app/native-build-plugin.ts` — remoteAddress loopback + Host + Origin + `Sec-Fetch-Site` + `X-VNMaker-Studio` 커스텀 헤더. 게이트웨이 `/api/*`는 이 검사가 하나도 없다.
- ZIP/미디어 검증: `packages/app/src/studio/restoreBundle.ts`

## 확정 결함 — 우선순위

### 🔴 지금 고쳐야 할 것

| # | 결함 | 위치 | 내용 |
|---|------|------|------|
| 1 | **Windows OAuth 로그인 불가** | `packages/gateway/src/auth/oauth.ts:33` | `spawn("cmd",["/c","start","",url])` — `cmd /c start`가 `&`에서 명령을 분리해 브라우저에 잘린 동의 URL이 열림. **실측 확인됨.** URL을 따옴표로 감싸거나 `explorer.exe`/powershell `Start-Process`로 교체. 테스트: URL에 `&` 7개 들어간 상태로 동작 확인 필요 |
| 2 | **자격증명 파일 비원자적 쓰기** | `packages/gateway/src/auth/credentials.ts:53-59` | read→mutate→`writeFile` 직접. 크래시 시 절단 JSON → `read()` throw → 모든 AI 라우트 영구 502. tmp+rename으로. 같은 수정 대상: `project/store.ts:102,161`, `images/store.ts:58` |
| 3 | **토큰 갱신 경합** | `packages/gateway/src/auth/tokens.ts:62-74` | `ensureFreshAccess`가 read→refresh→write 비직렬화. 만료 직후 동시 요청(정상 패턴) 시 다중 refresh → last-write-wins. refresh token 회전 시 클러버 → 강제 재로그인. single-flight 뮤텍스 필요 |

### 🟠 높음

| # | 결함 | 위치 | 내용 |
|---|------|------|------|
| 4 | **CSRF — 바디 없는 POST** | `packages/gateway/src/routes/auth.ts:40,27` | `POST /api/auth/login`, `/api/auth/refresh`가 본문을 안 읽음 → 임의 웹사이트가 simple request(preflight 없음)로 호출 가능 → 사용자 브라우저에 Google 동의 화면 강제 오픈 + 콜백 서버 300초 점유 + 토큰 churn. CORS 허용목록(`app.ts:32-38`)은 읽기만 막지 부수효과는 못 막음. `/api/*`에 `X-VNMaker-Studio` 헤더 요구로 해결(native-build-plugin 방식) |
| 5 | **손상 삼킴 → 데이터 소실** | `packages/gateway/src/project/store.ts:114-126,143-156` | `readNode`/`readEdges`가 손상 JSON을 `null`/`[]`로 반환. 깨진 `edges.json` 상태에서 에이전트 `connect` 한 번이 `{edges:[새 엣지]}`로 덮어써 기존 엣지 전부 영구 소실. 손상은 오류로 보고해야 함 |
| 6 | **`connect` 참조 무결성 없음 + RMW 경합** | `packages/ir/src/index.ts:467`, `packages/gateway/src/agent/tools.ts` | 존재하지 않는 노드를 가리키는 엣지 허용 → 컴파일 시 missing scene. readEdges→push→writeEdges는 동시 호출 시 한쪽 소실 |
| 7 | **에이전트 도구 실패 마스킹** | `packages/gateway/src/agent/run.ts:51,83` | 도구 전부 실패해도 일부 diff 있으면 "그래프를 고쳤다." `playFrom`이 `opts.nodeId`로 초기화되어 `play_from` 미호출이어도 유효한 미리보기처럼 반환. 실패한 tool call을 응답에 노출해야 함 |

### 🟡 중간

| # | 결함 | 위치 | 내용 |
|---|------|------|------|
| 8 | **`compileGraph` 의미 파괴 (잠재)** | `packages/ir/src/index.ts` | ~~`from`당 첫 엣지만 유지 + `when` 폐기…~~ **해소(2026-09-16): 아래 "해소" 절 참조 — routes/set 의미를 정의하고 프로덕션에 연결했다** |
| 9 | ~~**버전 기록 프로젝트 미스코프**~~ | `versions.ts` | **해소**: `ProjectVersion.projectId` + `ownVersions` 스코프 + 레거시 행 정리(`staleVersionIds`) |
| 10 | ~~**`xdg-open` 없으면 프로세스 크래시**~~ | `oauth.ts` | **해소**: `open` 패키지로 교체(플랫폼 인용+reject 경로), `openBrowser`가 false를 반환해 URL을 로그로 안내 |
| 11 | ~~**콜백 HTML 미이스케이프 + state 로그**~~ | `oauth.ts` | **해소**: `escapeHtml` 적용, 동의 URL은 브라우저를 못 열었을 때만 로그 |
| 12 | ~~**PKCE 없음**~~ | `oauth.ts` | **해소**: S256 code_challenge/verifier 생성, 토큰 교환에 `code_verifier` 전달(`tokens.ts:24`), state 16B CSRF 검증 |
| 13 | ~~**바디 크기 제한 없음 + 비대칭 검증**~~ | `app.ts`, `images.ts` | **해소**: 전역 `bodyLimit`(4MB, losia 업로드 경로만 면제) + `GENERATE_PROMPT_MAX` + `model` 화이트리스트(`IMAGE_MODEL` 또는 codex 토큰 형식) |
| 14 | ~~**`POST /project/nodes` 쓰기 검증 느슨**~~ | `project/store.ts:79` | **해소**: 쓰기 시 `parseBeats`로 검증 — 잘못된 op는 400 거부 |
| 15 | ~~**autosave 이중 계층 불일치**~~ | `useProjectAutosave.ts` | **해소**: 600ms 디바운스+직렬화 큐(stringify는 디바운스 안), 사본 쓰기 실패 시 보관함 저장 성공 후 사본 제거로 계층 불일치 정리, pagehide/visibilitychange 플러시는 `ownsQuickRecovery`로 소유 사본만 갱신, 첫 자동 저장은 외부 사본 보호 |
| 16 | ~~**런타임↔네이티브 의미 차이**~~ | `renpyScript.ts` | **해소**: disable 선택지는 `vn_locked=True` 메뉴 인자 → choice 스크린이 `sensitive False`로 그림(`renpyTheme.ts:71`), `eq`/`ne`는 타입 일치 또는 양쪽 numeric일 때만 비교(`1==True` 불일치), `vn_patch`·`expression` 교체는 새 dict 리바인딩으로 롤백 안전 |

### 🔵 낮음/관찰 — 전부 해소 (확인 2026-09-17)

- ~~`GET /api/image/file/:name`~~ — `sec-fetch-site: cross-site`를 403으로 거부(`images.ts:162`). `<img>`는 헤더를 못 달아 사이트 간 임베드만 차단.
- ~~`.bin` mime~~ — `readImage`는 모르는 확장자를 `application/octet-stream`으로 서빙(`store.ts:74`).
- ~~Windows 예약명~~ — `sanitizeName`이 `con/prn/aux/nul/com1-9/lpt1-9`를 빈 문자열로 걸러 timestampName 폴백(`store.ts:35`).
- ~~preview `/api`~~ — `mountGateway`가 `configureServer`와 `configurePreviewServer` 둘 다 단다(`vite.config.ts:83-88`).
- ~~FNV-1a 32비트~~ — `scriptFingerprint`(production.ts)·`manuscriptKey`·edition 판정은 전부 64비트. `quickRecoveryHash`(project.ts)의 32비트는 메타↔본문 짝 확인용이라 유지.
- ~~recovery-preserved 누수~~ — 복원 때 최신 3개만 남기고 나머지 삭제(`ProjectRecovery.tsx:11-12`).

## 함정 — agy 프로토콜 (토큰/OAuth 코드 건드릴 때)

이전 세션의 실측 조사다. 다시 파지 마라.

- **User-Agent가 하드 게이트다.** `antigravity/hub/<version> (...)`. 버전이 낮으면 백엔드가 신모델을 카탈로그에서 조용히 뺀다. 신모델 안 보이면 이것부터 의심.
- **free-tier는 이식 오류가 아니다.** 서버가 그렇게 답하고 유료 경로 코드가 원본에도 없다.
- **쿼터는 Antigravity 데스크톱 앱과 같은 통**이다(계정+프로젝트 단위 서버 값).
- `auth.json` 스키마: `{refresh, access, expires, projectId, email}`. `expires`는 만료 5분 전을 미리 당겨 넣은 epoch ms.
- `client_id`/`client_secret`이 `config.ts`에 base64로 박혀 있다 — 공개값 취급. 폐기되면 저장 자격증명 전부 동시에 죽음.
- 참조 구현: `C:\Users\ubbio\Documents\_vendor\oh-my-pi` — **읽기 전용. 수정 금지.**
- 비공식 어댑터다. "Google 공식 연동"으로 포장하지 마라.

## losia.online 스토어 연동 (2026-09-13)

편집기(스튜디오)와 플레이어를 losia.online 에셋 스토어에 연결했다. 상세는 [docs/integration/losia-store.md](docs/integration/losia-store.md).

- 게이트웨이 프록시 `packages/gateway/src/routes/store.ts` — 카탈로그/매니페스트/파일 중계. `embedded` 등급 파일 요청은 서버에서 403. 스토어 주소는 `VNMAKER_LOSIA_URL`(기본 `https://losia.online`).
- 스튜디오 아트 디렉션의 `losia 스토어` 패널(`StorePanel.tsx`)에서 검색·설치. 설치한 파일은 IndexedDB 보관함(`/assets/user/<sha256>.<ext>`)에 들어가 프로젝트 Artwork/AudioAsset 으로 등록되므로 플레이어와 게임 ZIP 이 기존 자산과 같은 경로로 쓴다.
- 역할/표정/라이선스 매핑은 `packages/app/src/studio/storeInstall.ts`(순수 계산). 한글 표정 이름은 별칭표로 영문 키에 옮긴다.
- 검증: `pnpm --filter @vnmaker/{gateway,app} test`, `npx playwright test tests/e2e/store-install.spec.ts`, `node tools/qa/store-live.mjs`(실제 losia.online, 스크린샷 `evidence/store-live/`).

### losia 게시 (2026-09-16)

- 게이트웨이 `packages/gateway/src/routes/losia.ts` — `GET /api/losia/status`, `PUT/DELETE /api/losia/token`, 스트리밍 중계 `POST /api/losia/works`·`POST /api/losia/assets`. 업로드는 버퍼링 없이 바이트를 세며 상한(`VNMAKER_LOSIA_WORK_MAX` 700MB·`VNMAKER_LOSIA_ASSET_MAX` 360MB)을 강제하고, 전역 bodyLimit(4MB)은 이 두 경로만 면제한다.
- 토큰 저장소 `src/auth/losiaToken.ts` — `~/.vnmaker/losia-token.json`, 원자 쓰기+0600. 등록 전에 형식(`la_`+40hex)과 업스트림 검증(빈 `POST /api/works` → 401이면 거부, 400이면 유효 — losia는 인증을 본문 검사보다 먼저 한다).
- 스튜디오 `LosiaPublishButton.tsx`("losia에 게시") — 토큰 등록/삭제 → 제목·slug·소개 입력 → `buildExportBundle` → 업로드 → `playUrl` 링크. `fetchLosiaStatus`가 `/api/losia/status` 404면 같은 오리진 `/api/works`를 찔러 **losia 호스팅 스튜디오(`/make`)를 직통 모드**로 인식한다(세션 쿠키, 토큰 불필요). 이때 `buildExportBundle`은 `runtimeBase: "/make/export-runtime"`로 벤더된 런타임을 쓴다.
- 에셋 게시 (2026-09-17) — `LosiaAssetPublish.tsx` 다이얼로그가 아트 라이브러리(선택 패널)와 오디오 라이브러리(행)에서 사용자 제작 자산을 올린다. multipart 계약: `meta`(JSON)·`roles`(파일 순서와 동일한 JSON 배열)·`files`. 인물은 base 선택지 + "표정 패키지" 체크로 `expression:*` role을 붙인다. 재게시 가드: 내장(`art/bg/sprite`)·losia 유래(provenance.source에 losia 포함) 자산은 버튼이 안 뜬다. 인증 UI는 `LosiaAuth.tsx`로 공용화(작품 다이얼로그와 공유). 실측: prod에 stage 에셋 업로드→GET 200→`PATCH status:hidden` 정리까지 확인.
- e2e 그래프 격리 (2026-09-17) — playwright.config 의 webServer 에 `VNMAKER_PROJECT_DIR=/tmp/vnmaker-e2e-project`(`VNMAKER_E2E_PROJECT_DIR`로 변경 가능). `PUT /api/project/edges`는 전체 목록을 덮어쓰므로 사용자 프로젝트와 섞이면 데이터가 지워진다. **e2e 포트는 5199 전용** — 5173 재사용은 이 격리를 무력화해 실제 프로젝트에 노드/엣지를 심는다(실제로 라디오부 엣지가 지워진 적 있음. evidence/thursday-radio/story/edges.json으로 복원).
- 에셋→VN 파이프라인 (2026-09-17) — 스토어 설치 자산이 씬·플레이어·export까지 간다. 오디오 라이브러리에 `StorePanel fixedKind="sound"` 패널 내장("스토어에서 음원 가져오기"). IR에 URL 자산 지원: `scene.bg`/`cg`가 `/`로 시작하면 `backgroundUrl`/`cgUrl`, `say`의 `bg`/`cg`는 줄 단위 URL, `show.image`는 `poseUrl`. 프로젝트 `story/characters.json`·`vnmaker.json`을 컴파일에 반영(한글 표시명·부제). base만 있는 인물 패키지는 base→neutral 폴백. 게이트웨이 자산 id 규칙을 `^[a-z0-9][a-z0-9-]{5,39}$`로 완화(losia에 접두사 없는 id 존재 — `164e5130e5`).
- 실측 (2026-09-17): prod losia에서 stage·character·sound 실자산 설치→씬 배치→플레이어 렌더 확인(스크린샷 evidence). 게이트웨이 경유 sound(`so…`)+캐릭터 패키지(`cha…`, roles `['base','expression:놀람']`) 업로드→GET→`PATCH status:hidden`→404 정리→로컬 토큰 삭제까지 확인.
- 에셋 게시 e2e: `tests/e2e/losia-asset-publish.spec.ts` 3개 — 배경 단일·캐릭터 표정 패키지·음원의 multipart 계약(meta/roles/files 순서)을 page.route 캡처로 검증.
- 플레이키 방지 (2026-09-17): losia 스펙의 `installProject`는 `addInitScript`로 첫 로드 전에 원고를 심는다(goto→심기→reload는 부하 시 부팅이 30초를 넘겼다). `store-install.spec.ts:50`은 `stage` testid 가시를 먼저 기다린 뒤 bg-image를 폴링한다 — 플레이어 부팅 전 폴링이 요소 부재(-1)로 착시되던 문제.

## 권고 작업 순서 — 리뷰 목록 전부 해소 (2026-09-17 확인)

위 표의 1~16과 🔵 항목은 전부 코드에 반영돼 있다(확인 완료). 남은 알려진 한계:

- `native-*` e2e 6개는 `VNMAKER_RENPY_SDK` 미설정 환경에서는 실행 불가.
- `editor-crash.spec.ts:38`은 브라우저 프로세스 크래시 시 localStorage 디스크 플러시 타이밍 의존이라 이 환경에서 간헐 실패.

## 해소 — 2026-09-16 그래프 파이프라인 연결

`compileGraph`가 프로덕션에 연결됐다. 결정 사항:

- **엣지 `when` → 구조화 `LineCondition`.** 순수 플래그명 문자열(`"metYuna"`)은 `{all:[name]}`으로 정규화, 표현식형 문자열은 거부 — `cond`를 죽인 방향과 같다.
- **다중 엣지 → `Scene.routes`.** 조건 경로를 순서대로 평가해 첫 매치로 이동. 무조건 엣지는 최대 1개 → `scene.next`(폴백). 두 번째 무조건 엣지·엔딩+무조건 출구·메뉴+경로 공존은 오류. 엔딩+조건 경로만은 허용(전부 실패 시 엔딩).
- **`set` 비트 → `Scene.set`** — 씬 진입 시 플래그 적용(새 dict, 롤백 안전). 런타임 leave 순서: choices → routes → ending → next.
- 파이프라인: 게이트웨이 `GET /api/project/script`(그래프 컴파일 + parseScript 검증) → 스튜디오 "그래프 미리보기" 버튼(`studio-graph-play`) → 기존 previewScript 경로로 재생.
- `Scene.routes`/`Scene.set`은 스키마·파서·감사·reducer·renpyScript·스튜디오 연산(rename/remove/flag rename)·StoryMap·prefetch 전부에 반영됐다.
