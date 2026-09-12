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
| 8 | **`compileGraph` 의미 파괴 (잠재)** | `packages/ir/src/index.ts:419-421,363,373` | `from`당 첫 엣지만 유지 + `when` 폐기. `menu` 선택지의 `when`→`cond` 매핑인데 `cond`는 브라우저에서 **무조건 숨김**(표현식 미평가, `ChoiceMenu.tsx:34`), 네이티브 export는 cond 존재 시 **거부**(`renpyScript.ts:13`). `set` 비트도 컴파일 타임 전역으로 폴딩. **현재 프로덕션 미호출**(`compileNode`만 사용) — 고치기 전에 그래프→스크립트 파이프라인을 연결할 건지 사용자와 확인. 안 쓰면 삭제 |
| 9 | **버전 기록 프로젝트 미스코프** | `packages/app/src/studio/versions.ts`, `VersionHistory.tsx` | 단일 스토어에 `projectId` 필드 없음, 전 프로젝트 공유 20개. A의 자동 체크포인트가 B의 수동 버전을 밀어내고, 복원 시 다른 프로젝트 원고가 현재 프로젝트에 로드됨. 스토어에 `projectId` 추가 + 조회/삭제 스코프 |
| 10 | **`xdg-open` 없으면 프로세스 크래시** | `oauth.ts:33-35` | `spawn` 후 `'error'` 리스너 없음 → 비동기 error 이벤트가 unhandled → 게이트웨이 크래시. try/catch는 동기 throw만 잡음. `.on("error",()=>{})` 추가 |
| 11 | **콜백 HTML 미이스케이프 + state 로그** | `oauth.ts:21-28,81`, `auth.ts:44` | `error_description`을 HTML에 그대로 삽입(인젝션). 동의 URL 전체(state 포함)를 console에 남김 |
| 12 | **PKCE 없음** | `oauth.ts:55-57` | 문서화된 선택이지만 추가 비용 사실상 0. client_secret이 공개 내장값이라 state만이 방어. 도입하려면 코드 챌린지 생성·검증 추가 |
| 13 | **바디 크기 제한 없음 + 비대칭 검증** | `packages/gateway/src/app.ts`, `routes/images.ts:33-34,57-59`, `routes/generate.ts:31,49` | bodyLimit 미들웨어 없음 → 로컬 프로세스가 GB급 POST로 OOM. `/image/generate`는 프롬프트 cap 없음(`/generate`의 16000과 비대칭). `model`/`imageSize` 무비판 패스스루 → 임의 모델 쿼터 소진 |
| 14 | **`POST /project/nodes` 쓰기 검증 느슨** | `project/store.ts:36-50` | `asNode`가 `beats` 배열 여부만 봄 → `{beats:[{op:"bogus"}]}`가 디스크에 기록되고 이후 읽기 경로가 조용히 무시 → 오염 노드가 그래프에서 증발. 쓸 때 `parseBeats`로 검증 |
| 15 | **autosave 이중 계층 불일치** | `packages/app/src/studio/useProjectAutosave.ts:13`, `projects.ts:7-11` | 매 편집마다 전체 원고 JSON.stringify+localStorage 동기 쓰기(대형 원고 입력 지연). localStorage 성공+IndexedDB 실패 시 두 계층 불일치. `activateProject` 롤백도 quota 소진 상태에서 예외 안전하지 않음 |
| 16 | **런타임↔네이티브 의미 차이** | `renpyScript.ts:126` 등 | `disable:true` 선택지: 브라우저=비활성 표시, Ren'Py=`if False` 완전 숨김. `eq`/`ne`: JS `===` vs Python `1==True` 타입 관용. `vn_patch`가 `vn_slots`를 제자리 변경 → Ren'Py 롤백이 못 되돌림(주석도 인정) |

### 🔵 낮음/관찰

- `GET /api/image/file/:name` — 인증 없음, `<img>`로 사이트 간 임베드 가능, 타임스탬프 이름 추측 가능.
- `images/store.ts:69` — `.bin` 등 모르는 확장자를 `image/png`로 서빙.
- `sanitizeName`이 Windows 예약명(`con`/`nul`/`aux`)을 못 걸러 쓰기 실패 → 루트의 `nul` 파일이 이미 그 흔적.
- `mountGateway`/`exportRuntimePlugin`에 `configurePreviewServer` 없음 — `vite preview`(4173)에서 `/api/*` 죽는데 CORS는 4173 허용 — 의도와 배선 불일치.
- `scriptFingerprint`/`initializeEdition`의 FNV-1a 32비트를 변경 판정에 사용 — 자동 체크포인트 스킵이 2^-32로 거짓 음성.
- `ProjectRecovery`의 `recovery-preserved.<uuid>` 키가 복원마다 누적, 정리 경로 없음 → localStorage quota 누수.

## 함정 — agy 프로토콜 (토큰/OAuth 코드 건드릴 때)

이전 세션의 실측 조사다. 다시 파지 마라.

- **User-Agent가 하드 게이트다.** `antigravity/hub/<version> (...)`. 버전이 낮으면 백엔드가 신모델을 카탈로그에서 조용히 뺀다. 신모델 안 보이면 이것부터 의심.
- **free-tier는 이식 오류가 아니다.** 서버가 그렇게 답하고 유료 경로 코드가 원본에도 없다.
- **쿼터는 Antigravity 데스크톱 앱과 같은 통**이다(계정+프로젝트 단위 서버 값).
- `auth.json` 스키마: `{refresh, access, expires, projectId, email}`. `expires`는 만료 5분 전을 미리 당겨 넣은 epoch ms.
- `client_id`/`client_secret`이 `config.ts`에 base64로 박혀 있다 — 공개값 취급. 폐기되면 저장 자격증명 전부 동시에 죽음.
- 참조 구현: `C:\Users\ubbio\Documents\_vendor\oh-my-pi` — **읽기 전용. 수정 금지.**
- 비공식 어댑터다. "Google 공식 연동"으로 포장하지 마라.

## 권고 작업 순서

1. `oauth.ts:33` — 한 줄짜리인데 Windows 로그인이 깨져 있다. 수정 + 수동 확인.
2. 저장소 원자성 — credentials/project/images에 tmp+rename 적용 + `ensureFreshAccess` single-flight. 회귀 테스트: 크래시 시뮬레이션(중간 truncate), 동시 refresh.
3. `/api/*`에 `X-VNMaker-Studio` 헤더 요구 + bodyLimit + `/image/generate` 프롬프트 cap. 회귀 테스트: 헤더 없는 POST 거부.
4. `versions.ts`에 `projectId` 추가. 회귀 테스트: 두 프로젝트 간 복원 격리.
5. `compileGraph`는 **사용자 확인 후** — 연결할 거면 다중 엣지/`when`/`cond` 의미부터 정의하고, 안 쓸 거면 삭제.
6. 나머지 중간/낮음 항목은 위 작업과 같은 파일을 건드릴 때 묶어서.

## 미확인 — 사용자 답변 필요

- 그래프→스크립트(`compileGraph`) 파이프라인을 실제로 연결할 계획인가? (연결 계획에 따라 #8의 처리가 달라진다)
- `compileGraph`의 `cond` 의미: 조건식 평가를 구현할 것인가, 아니면 필드 자체를 제거할 것인가?
