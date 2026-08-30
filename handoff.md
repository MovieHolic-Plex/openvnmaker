# vnmaker 인수인계

작성 2026-08-31. 이 문서만 읽고 이어서 작업할 수 있게 쓴다. 추측과 측정값을 구분해 적었다.

## 한 줄 요약

기획 문서 3종과 Antigravity OAuth 로그인 스크립트까지 끝났다. 앱 코드는 아직 한 줄도 없다. 다음 할 일은 게이트웨이 골격이다.

## 저장소 상태

- 커밋이 **0개**다. `main` 브랜치에 아직 아무것도 없다. 전부 untracked.
- 커밋은 사용자가 명시적으로 요청할 때만 한다. 임의로 하지 말 것.
- `.omo/`, `.senpi/`는 도구 작업 디렉터리다. 커밋 대상이 아니다. `.gitignore`가 아직 없으니 첫 커밋 전에 만들어야 한다.

```
docs/vision/index.html        기술 기획서 (이번 세션에서 여러 군데 정정)
docs/concepts/index.html      컨셉 시각화
docs/report/index.html        조사 리포트
docs/grok-imagine.md          이미지 생성 참고 메모
tools/agy-login.mjs           Antigravity OAuth 로그인 (동작 검증 완료)
settings.json                 shellPath만 들어있음
```

문서 사이트는 `data-img` 속성과 하단 스크립트의 `CANDIDATES` 폴백으로 이미지를 로드한다. 그래서 **HTML을 다른 디렉터리로 복사하면 이미지가 깨진다**. 스크린샷을 찍으려면 임시 복사본도 `docs/<사이트>/` 안에 만들고 끝나면 지워라.

## Gemini(Antigravity) OAuth — 구현 완료로 간주

`tools/agy-login.mjs`. 의존성 없음, Node 20+. 명령 4개.

```
node tools/agy-login.mjs login     # 브라우저 동의 → 토큰 → 프로젝트 발견 → 저장
node tools/agy-login.mjs status    # 저장된 자격증명 요약 (토큰 값은 안 찍는다)
node tools/agy-login.mjs refresh   # refresh_token으로 access_token 재발급
node tools/agy-login.mjs models    # fetchAvailableModels 로 카탈로그 확인
```

**이걸 다시 구현하지 마라.** 실제로 끝까지 통과시킨 코드다. 다음 단계는 재작성이 아니라 `packages/gateway`로 모듈화해 옮기는 것이다.

실측으로 확인된 값 (2026-08-30~31):

```
계정      hyeonseokoh94ultra@gmail.com
project   aicode-consumers
tier      free-tier          ← 서버가 준 값. 아래 "tier" 항목 반드시 읽어라
모델      28종               claude-opus-4-6-thinking, claude-sonnet-4-6,
                             gpt-oss-120b-medium, gemini-3.7-flash 등
refresh   재발급 정상 (3599s)
저장 위치 ~/.vnmaker/auth.json  키 "google-antigravity"
```

`auth.json` 스키마: `{ refresh, access, expires, projectId, email }`. `expires`는 만료 5분 전을 미리 당겨 넣은 epoch ms다.

**보안 미해결.** 리프레시 토큰이 평문이고 Windows에서는 `chmod 0600`이 무시된다. `%USERPROFILE%\.vnmaker` 폴더 ACL을 사용자 전용으로 좁히는 작업이 남아 있다. 사용자에게 제안했고 아직 실행 안 했다.

### 프로토콜 요점 (oh-my-pi 원본과 대조 완료)

```
AUTH    https://accounts.google.com/o/oauth2/v2/auth
TOKEN   https://oauth2.googleapis.com/token
CCA     https://daily-cloudcode-pa.googleapis.com/v1internal:{loadCodeAssist,onboardUser,fetchAvailableModels,streamGenerateContent}
콜백    http://127.0.0.1:51121/oauth-callback   (점유 시 임의 포트로 폴백)
스코프  cloud-platform, userinfo.email, userinfo.profile, cclog, experimentsandconfigs
```

- **PKCE를 쓰지 않는다.** state 16B 랜덤 hex로 CSRF만 막고, 데스크톱 클라이언트에 박힌 `client_secret`으로 코드를 교환한다. oh-my-pi의 `docs/provider-quirks.md`는 PKCE라고 써놨지만 코드와 불일치한다. 코드가 맞다.
- `metadata`는 `{ ideType: "ANTIGRAVITY" }` 단일 필드. 더 넣지 마라.
- **User-Agent가 하드 게이트다.** `antigravity/hub/2.8.0 (aidev_client; os_type=darwin; arch=arm64; cl=963137146)`. 이게 빠지거나 버전이 낮으면 백엔드가 신모델을 카탈로그에서 뺀다. 에러가 아니라 조용히 사라진다. `cl`은 검증하지 않는다(원본에 실측 주석 있음). **version만 게이트다.**
- 유료 tier 경로는 존재하지 않는다. `onboardUser`는 항상 `tierId:"free-tier"`로 보낸다.

### tier가 free-tier인 이유 — 다시 파헤치지 마라

이미 끝난 조사다. 결론만 옮긴다.

1. 이식 오류가 아니다. oh-my-pi의 antigravity 어댑터 자체가 `FREE_TIER_ID = "free-tier"` 하드코딩이고 유료 tier를 요청하는 코드 경로가 없다.
2. 서버가 그렇게 답한다. 호스트를 prod(`cloudcode-pa`)로 바꾸고 metadata를 gemini-cli 방식으로 바꿔도 네 조합 모두 `free-tier`다. `paidTier` 필드는 응답에 아예 없다.
3. 응답에 `upgradeSubscriptionText: "Upgrade to ... with Google AI Pro"`와 그 계정 이메일이 박힌 `one.google.com/ai` 링크가 같이 온다. 구글 백엔드가 이 계정에 유료 AI 구독이 없다고 보고 있다는 뜻이다.
4. oh-my-pi 전체에 Google One / AI Pro / AI Ultra 엔타이틀먼트를 읽는 코드가 없다. 구독을 사도 이 경로에서 달라지는 게 없다.

사용자가 "왜 free냐"고 다시 물으면 위 4줄로 답하고, 계정 쪽 확인(Ultra가 다른 계정인지, 구독이 활성인지)을 요청하라. 코드로 고칠 수 있는 문제가 아니다. 사용자 답변은 아직 못 받았다.

### 할당량

`fetchAvailableModels` 응답의 모델별 `quotaInfo`에 `remainingFraction`과 `resetTime`만 온다. 절대 상한값은 안 준다. 관측 예:

```
gemini-3.6-flash-*    remainingFraction 0.965   reset 2026-08-30T19:21Z
gpt-oss-120b-medium   remainingFraction 1.0     reset 2026-08-31T00:19Z
```

**카운터는 계정+프로젝트 단위 서버 값이고, Antigravity 데스크톱 앱과 같은 통이다.** 로컬 카운터가 없고 우리 코드는 데스크톱 앱의 UA와 `ideType`을 그대로 흉내낸다. 사용자 PC에 Antigravity 앱이 설치돼 있으므로(`%LOCALAPPDATA%\Programs\Antigravity`), 앱에서 쓴 만큼 vnmaker 몫이 줄어든다. 설계와 사용자 안내에 이걸 반영해라.

## 확정된 설계 결정

- Vite UI + 로컬 Hono 게이트웨이. UI는 `POST /api/auth/login`만 친다. OAuth 콜백 서버는 게이트웨이 프로세스가 연다.
- 이식 위치는 `packages/gateway`. agy OAuth와 envelope를 게이트웨이가 전부 흡수하고 바깥에는 표준 형태로 노출한다. **이 한 겹은 타협 대상이 아니다.** agy가 깨지면 게이트웨이 안쪽만 고치면 되도록 한다.
- 게이트웨이를 `0.0.0.0`에 바인딩하거나 Tailscale로 열지 않는다. 토큰 프록시다. 원격 작업은 SSH 포트포워딩으로 한다: `ssh -L 51121:127.0.0.1:51121 -L 5173:127.0.0.1:5173`.
- 이미지 생성은 텍스트 경로와 분리한다.

## 열린 결정 — 사용자 답변 필요

**이미지 생성을 어디로 보낼지.** 아직 사용자가 고르지 않았다. 임의로 정하지 말고 물어라.

- (A) Antigravity 무료 경로: `gemini-3-pro-image`, `/v1internal:streamGenerateContent`에 `responseModalities:["IMAGE"]`. 공짜지만 코딩 할당량과 **같은 통**을 파먹고 취약점 5개를 그대로 상속한다. `projectId` 필수.
- (B) Gemini API 키 유료 경로: `gemini-3-pro-image-preview`, `generateContent`에 `responseModalities:["IMAGE"]`, 인증은 `x-goog-api-key`. **OAuth 자격증명으로는 안 된다.** AI Studio 키가 필요하고 Ultra 구독과 무관한 별도 과금이다.

참고: **Imagen이 아니다.** 문서에 Imagen이라고 써있던 건 이번에 다 정정했다. oh-my-pi에 `imagen-*`은 한 번도 등장하지 않는다.

## 다음 작업 순서

1. `.gitignore` (`.omo/`, `.senpi/`, `node_modules/`, `dist/`) 만들고 첫 커밋. **사용자 승인 받고** 진행.
2. 프로젝트 골격: Vite + `packages/gateway`(Hono). 패키지 매니저와 워크스페이스 방식은 사용자에게 확인.
3. `tools/agy-login.mjs`를 `packages/gateway`의 모듈로 이식. 나눌 조각: 콜백 서버, 토큰 교환/갱신, 프로젝트 발견, 자격증명 저장소. 로직을 바꾸지 말고 옮기기만 해라.
4. `POST /api/auth/login`, `GET /api/auth/status`, 자동 토큰 갱신.
5. 모델 카탈로그 프록시 + `quotaInfo` 노출. 남은 비율을 UI에 보여줘야 사용자가 앱과 공유하는 걸 체감한다.
6. 이미지 경로는 (A)/(B) 결정 후.

## 함정

이미 밟았거나 코드에서 확인한 것들이다.

1. **omo-ai를 참조하지 마라.** 사용자 PC의 omo-ai(`5.0.0-0.beta.26`, 내부 엔진 `@code-yeongyu/senpi 2026.8.28-2`, pi-mono 계열)에는 agy가 없다. pi-mono `0.71.0`(2026-04-30)에서 Breaking Change로 제거됐다. 패키지 전체를 훑어도 구현 코드 0건이고 모델명 정규식 하나만 화석으로 남았다. 제거 이유는 changelog에 없다. 유일한 참조 구현은 `_vendor/oh-my-pi`다.
2. **UA 버전 핀이 가장 먼저 깨진다.** 원본은 Cloud Run의 electron-builder 매니페스트를 긁어 버전을 정하고 실패하면 `catch {}`로 삼켜 `2.8.0`으로 후퇴한다. 우리 스크립트는 `PI_AI_ANTIGRAVITY_VERSION` 환경변수 + `2.8.0` 고정이다. 신모델이 안 보이면 제일 먼저 이걸 의심하라.
3. 모델 id와 wire 프로필(`maxOutputTokens`, 불투명 enum)은 손으로 캡처한 표다. Claude는 64000을 넘기면 400이 온다. 새 모델은 프로필이 없다.
4. `allowedTiers`에서 `free-tier`가 빠지면 로그인이 하드 실패한다. 폴백 경로가 없다.
5. `v1internal` + `daily-` 호스트는 호환성 약속이 없는 내부 표면이다. 원본에는 `daily-cloudcode-pa.sandbox.googleapis.com` 폴백이 있는데 우리 스크립트에는 아직 없다. 이식할 때 넣을 가치가 있다.
6. 박혀 있는 `client_id`/`client_secret` 한 쌍이 폐기되면 저장된 자격증명이 전부 동시에 죽는다.
7. 이건 비공식 어댑터다. 설정 화면에 경고 한 줄을 넣기로 했다. "Google 공식 연동"으로 포장하지 마라.

## 문서 정정 이력 (docs/vision/index.html)

이번 세션에 고쳤다. 옛 서술을 근거로 되돌리지 마라.

- PKCE 서술 제거. 제목을 "OAuth 2.0 authorization code (PKCE 아님)"으로, 1단계를 state 16B로, 4단계를 `client_secret` 교환으로 정정
- 스코프에서 `aicode` 삭제. 5개로 전 구간 통과 확인
- "로그인 이후 API" 블록에 `User-Agent: antigravity/hub/2.8.0 (...)` 추가
- Imagen 서술 3곳 정정 → `gemini-3-pro-image-preview` + `responseModalities:["IMAGE"]`, API 키 전용
- 이미지를 agy에서 분리하는 이유를 "카운터를 데스크톱 앱과 공유한다"로 교체
- 실측 결과 검증 노트 추가

## 참조

- `C:\Users\ubbio\Documents\_vendor\oh-my-pi` — 유일한 agy 참조 구현. **읽기 전용. 수정하지 마라.**
  - `packages/ai/src/registry/oauth/google-antigravity.ts` 자격증명·스코프·프로젝트 발견
  - `packages/ai/src/registry/oauth/google-oauth-shared.ts` authorize → token
  - `packages/catalog/src/wire/gemini-headers.ts` UA와 wire 프로필
  - `packages/ai/src/usage/google-antigravity.ts` quota 해석
- oh-my-pi의 Google 경로는 4개다. `google`(API 키, 이미지 O), `google-vertex`(이미지 X), `google-gemini-cli`(tier 3종 실제 처리, 이미지 X), `google-antigravity`(free-tier 고정, 이미지 O).

## 미확인

- 사용자의 Ultra 구독 실체 (질문했고 답 못 받음)
- agy의 절대 할당량 상한 (API가 안 줌)
- 이미지 경로 (A)/(B) 선택
- 패키지 매니저·워크스페이스 구성
- `~/.vnmaker` ACL 적용
