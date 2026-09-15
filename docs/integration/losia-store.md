# losia.online 에셋 스토어 연동

작성 2026-09-13. 이 문서만 읽고 연동을 이어서 고칠 수 있게 쓴다. 계약 원본은
`losia/docs/vnmaker-contract.md`(losia 저장소)다.

## 무엇이 연결됐나

편집기(스튜디오)에서 losia.online 의 공개 자산을 검색해 **설치**하면, 그 파일이
이 브라우저의 작품 보관함(IndexedDB)에 들어가고 프로젝트 아트로 등록된다.
등록된 자산은 기존 아트와 완전히 같은 경로를 쓴다 — 그래서 플레이어가 렌더하고,
게임 ZIP(독립 실행 배포)에도 그대로 담긴다.

```
스튜디오(브라우저)                게이트웨이(로컬, 5173 의 /api)        losia.online
  StorePanel ──/api/store/catalog──────────▶  서버사이드 fetch  ──────▶ GET /api/assets
        설치 ──/api/store/assets/:id/manifest▶                     ──────▶ GET /api/assets/:id/manifest
             ──/api/store/assets/:id/files/:role ▶                ──────▶ GET files[].url
        │
        └─ blob → storage/projectAssets.ts(IndexedDB) → /assets/user/<sha256>.<ext>
                 → storeInstall.ts 로 Artwork/AudioAsset 생성 → 원고에 등록
```

브라우저가 losia.online 을 직접 부르지 않는 이유는 CORS 때문이다. 게이트웨이가
서버사이드로 대신 부르므로 정책(라이선스)도 서버 쪽에서 강제된다.

## 파일 지도

| 파일 | 역할 |
|---|---|
| `packages/gateway/src/routes/store.ts` | 카탈로그·매니페스트·파일 프록시. `embedded` 등급 파일 요청은 403 |
| `packages/gateway/src/config.ts` | `VNMAKER_LOSIA_URL`(기본 `https://losia.online`), 타임아웃, `take` 상한, 파일 크기 상한 |
| `packages/app/src/api/store.ts` | 앱 쪽 클라이언트(`/api/store/*` 상대경로, GET 만) |
| `packages/app/src/studio/storeInstall.ts` | 역할/표정/라이선스 → Artwork 매핑(순수 계산, 테스트 대상) |
| `packages/app/src/studio/installFromStore.ts` | 다운로드 → 보관함 → 매핑 IO 묶음 |
| `packages/app/src/studio/StorePanel.tsx` | 스튜디오 아트 디렉션의 스토어 패널 |
| `packages/app/src/studio/AssetLibrary.tsx` | 패널을 작업대에 붙이고, 설치 직후 그 카드를 선택 상태로 만든다 |

## role → vnmaker 매핑

| losia `files[].role` | vnmaker |
|---|---|
| `base` (kind=stage) | Artwork `kind:"background"` |
| `base` (kind=character) | Artwork `kind:"character"` (포즈/기본 원화) |
| `variant:<시간대·날씨>` | Artwork `kind:"background"`, 이름에 변형을 붙임 |
| `expression:<표정>` | Artwork `kind:"character"` + `expression` |
| `pose:<구도>` | Artwork `kind:"character"` (expression 없음 = 포즈) |
| `cg`, `cg~N` | Artwork `kind:"cg"` |
| `audio` | AudioAsset (`kind` 은 태그로 bgm/sfx 판정) |
| 그 외 | 설치하지 않고 `ignored` 로 보고(조용히 버리지 않는다) |

표정 이름은 losia 가 한글(`expression:슬픔`)이고 vnmaker 표정 키는 영문 slug 다.
`storeInstall.ts` 의 `EXPRESSION_ALIASES` 가 미소/슬픔/놀람/화남/울음/부끄러움/무표정을
smile/sad/surprised/angry/cry/shy/neutral 로 옮긴다. 모르는 이름은 `x-<hash>` 로
안정적으로 합성하고 한글 라벨은 이름에 남긴다.

## 라이선스

| 등급 | 동작 |
|---|---|
| `downloadable` | 설치 가능. 출처는 `provenance{creator, source, license, credit}` 로 원고에 남는다 |
| `attribution` | 설치 가능. 같은 출처 기록 + 크레딧 문구(`<업로더> · losia.online`) |
| `embedded` | **설치 불가.** 매니페스트에 `url` 이 없고, 게이트웨이가 파일 요청을 403 으로 막는다(클라이언트를 고쳐도 우회 불가). UI 는 버튼을 비활성화하고 이유를 보여 준다 |

## 설정

| 환경변수 | 기본 | 뜻 |
|---|---|---|
| `VNMAKER_LOSIA_URL` | `https://losia.online` | 스토어 주소. 스테이징(`http://127.0.0.1:3001` 등)을 보려면 여기를 바꾼다 |
| `VNMAKER_LOSIA_TIMEOUT_MS` | `20000` | 프록시 타임아웃 |
| `VNMAKER_LOSIA_TAKE_MAX` | `60` | 카탈로그 한 번에 받는 최대 개수 |
| `VNMAKER_LOSIA_FILE_MAX` | `67108864` | 프록시가 중계하는 파일 상한 |

## 검증

```bash
pnpm --filter @vnmaker/gateway test    # 프록시 규칙(허용 파라미터, embedded 403, 경로 검증)
pnpm --filter @vnmaker/app test        # 역할/표정/라이선스 매핑
npx playwright test tests/e2e/store-install.spec.ts   # 설치→등록→장면 적용→플레이어 렌더
node tools/qa/store-live.mjs           # 실제 losia.online 으로 카탈로그·설치·플레이어 (스크린샷)
node tools/qa/store-visual-qa.mjs      # 적대적 시각 QA: 11개 폭 + 빈결과/오류/로딩 + 긴 이름·태그·썸네일 없음·404·embedded + 설치 진행/완료 + 플레이어 (24캡처 + 지표)
```

`store-live.mjs` 는 `evidence/store-live/` 에 스크린샷과 `summary.json` 을 남긴다.
`store-visual-qa.mjs` 는 `evidence/store-visual-qa/` 에 캡처와 `metrics.json`(가로 넘침·잘림·작은 타깃·깨진 이미지·저대비·겹침)을 남긴다 — 공유 박스에서는 브라우저 기동과 이미지 디코드에 상한을 두었고, 진입 실패 시 3회 재시도한다.
읽기와 다운로드만 한다 — 스토어에 아무것도 올리지 않는다.

## 게시(vnmaker → losia)

아직 없다. 게시는 `POST /api/assets` + 개인 토큰(`la_…`)이 필요하고, 토큰을 어디에
보관할지(게이트웨이 `~/.vnmaker/`)와 업로드 UI 는 결정이 남아 있다. 설치 방향만
먼저 붙였다 — 계약 §6 의 양방향 중 한 방향.

## 남은 것

- 카탈로그 썸네일은 losia.online 의 공개 미리보기 URL 을 브라우저가 직접 읽는다(이미지라 CORS 무관).
  오프라인/핫링크 차단 환경에서는 썸네일이 비고 설치는 정상 동작한다.
- 카탈로그 페이지네이션은 "더 보기"(12개씩)만 있다.
- 음원 설치의 bgm/sfx 판정은 태그 기반 휴리스틱이다(계약에 종류 필드가 없다).
