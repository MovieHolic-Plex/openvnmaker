# @vnmaker/desktop — Electron 셸

스튜디오와 플레이어를 Windows·macOS 데스크톱 앱으로 띄운다.

## 왜 이런 구조인가

껍데기만 씌운 게 아니라 **로컬 HTTP 서버**를 하나 띄우고 창이 그 주소를 연다. `file://` 로는 앱이 동작하지 않는다.

1. 스튜디오는 `/project-assets-sw.js` 서비스 워커로 `/assets/user/**` 를 IndexedDB 에서 돌려준다.
   서비스 워커는 `file://` 에서 **등록 자체가 거부된다**(localhost 또는 HTTPS 만 허용). 사용자가 가져온 원화·음원이 전부 죽는다.
2. 원고가 `/assets/...` 루트 절대 경로를 쓰고, 게이트웨이가 `/api/*` 를 같은 오리진으로 기대한다.

그래서 개발 서버(Vite)가 하던 일 — 정적 파일 + `/api/*` + `/api/native-build/*` 를 한 오리진에 묶는 것 — 을 `src/server.ts` 가 그대로 재현한다.

### 포트를 고정하는 이유

작품·저장 슬롯·보관함이 전부 localStorage / IndexedDB 에 있고, 그 저장소는 **오리진(호스트+포트)** 으로 격리된다.
포트를 매번 새로 고르면 **실행할 때마다 빈 편집기가 열린다.** 그래서 기본 포트 `47831` 를 고정해서 쓴다.

이미 그 포트를 쓰는 프로그램이 있으면 앱은 조용히 다른 포트로 넘어가지 않고 오류를 띄운다(작품이 사라진 것처럼 보이는 쪽이 훨씬 나쁘다).
정 바꿔야 하면 `VNMAKER_DESKTOP_PORT` 로 지정하되, **이전 포트에 저장한 작품은 보이지 않으므로 먼저 JSON 으로 내보내야 한다.**

## 실행

```bash
pnpm desktop:dev      # Vite 개발 서버 + Electron (핫 리로드)
pnpm desktop:build    # 웹 자산 빌드 + 메인 프로세스 번들
pnpm desktop:start    # 빌드 후 배포와 같은 형태로 실행
pnpm desktop:pack     # 설치본 없이 앱 폴더만 (빠른 확인용)
pnpm desktop:dist     # 설치본 생성 (Windows: NSIS, macOS: dmg)
```

`electron` 바이너리가 없다는 오류가 나면 pnpm 이 첫 설치 실패를 "완료" 로 캐시한 것이다.
`pnpm rebuild electron` 또는 `node node_modules/electron/install.js` 로 내려받는다.

## 코드 서명과 공증

`electron-builder.yml` 은 **서명을 끈 상태**다. 인증서 없이도 설치본은 나오고 실행도 되지만, 첫 실행에서 경고가 뜬다.

| | 경고 | 사용자가 여는 법 | 없애려면 |
|---|---|---|---|
| Windows | SmartScreen "알 수 없는 게시자" | 추가 정보 → 실행 | Azure Trusted Signing(월 $10 수준) 또는 OV 인증서 |
| macOS | Gatekeeper "확인되지 않은 개발자" | 우클릭 → 열기, 또는 설정 → 개인정보 보호 및 보안 → 그래도 열기 | Apple Developer Program (연 $99) 후 `mac.notarize: true` |

인증서가 생기면 `CSC_LINK` / `CSC_KEY_PASSWORD`(Windows·macOS 공통)와
`APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`(공증)를 환경변수로 넘기면 된다.
이 비용은 Electron 이라서 드는 게 아니라 OS 게이트키퍼 때문이라, Tauri 로 바꿔도 똑같이 든다.

## 데이터가 저장되는 곳

| 내용 | 위치 |
|---|---|
| 작품·저장 슬롯·보관함 | Electron userData (메뉴 → 도움말 → 저장 위치 열기) |
| AI 자격증명(`auth.json`)·생성 이미지 | `~/.vnmaker/` — CLI 게이트웨이와 공유한다 |
| Ren'Py 빌드 산출물 | userData 아래 `output/editor-native-builds` |

## 아직 안 한 것

- **자동 업데이트**: `electron-updater` 미연결. 서명이 없으면 macOS 자동 업데이트는 어차피 동작하지 않는다.
- **Ren'Py 네이티브 빌드**: 미들웨어는 붙였지만 `nativeBuildService` 가 Windows + `VNMAKER_RENPY_SDK` 일 때만 가능하다고 보고한다(원래 제약 그대로).
- **일반 사용자용 AI 경로**: agy(비공식 Google 어댑터)와 codex(사용자가 직접 설치한 Codex CLI)에 그대로 의존한다. 일반 배포 전에 호스티드 백엔드나 BYO 키로 정리해야 한다.
